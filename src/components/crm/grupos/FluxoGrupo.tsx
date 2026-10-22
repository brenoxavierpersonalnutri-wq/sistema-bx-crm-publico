import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, Plus, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  db, criarGrupoAgora, intervaloEfetivo, nomeGrupoDaCampanha, subirMidia, telefoneAdmin, MSG_NUMERO_NAO_CRIA,
  PAUSA_ENTRE_CRIACOES_MS, TETO_CRIACOES_DIA_POR_NUMERO,
  type CampanhaGrupos, type CriacaoGrupo,
} from "@/lib/grupos";

/** Pedaços da tela; a seção Disparo em grupo mostra cada um na sua aba. Sem `partes` = tudo (como antes). */
export type ParteFluxo = "evento" | "criacao" | "criarAgora" | "boasvindas";
const TODAS: ParteFluxo[] = ["evento", "criacao", "criarAgora", "boasvindas"];

/** "2026-10-20T19:30" (hora local do navegador) <-> ISO. */
const paraInputLocal = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const COR_CRIACAO: Record<CriacaoGrupo["status"], "default" | "secondary" | "destructive" | "outline"> = {
  ok: "default", criando: "secondary", erro: "destructive", abandonada: "outline",
};

// Fluxo de Grupo (padrão SendFlow): data do evento, ritmo anti-ban, criação automática de grupos
// (nome sequencial, descrição, foto, só admins, admins; SEMPRE ligada desde 21/10/2026) e mensagem de boas-vindas.
export function FluxoGrupo({ campanha, onSalvo, partes = TODAS, criaGrupo = true }: {
  campanha: CampanhaGrupos;
  onSalvo: () => void;
  partes?: ParteFluxo[];
  /** o número da campanha cria grupo? (só "grupos-N"/Baileys) */
  criaGrupo?: boolean;
}) {
  const tem = (p: ParteFluxo) => partes.includes(p);
  const { toast } = useToast();
  const fotoRef = useRef<HTMLInputElement>(null);
  const [dataEvento, setDataEvento] = useState(paraInputLocal(campanha.data_evento));
  const [teto, setTeto] = useState(campanha.teto_por_minuto ?? 3);
  const [prefixo, setPrefixo] = useState(campanha.prefixo_nome ?? "");
  const [proximo, setProximo] = useState(campanha.proximo_numero ?? 1);
  const [descricao, setDescricao] = useState(campanha.descricao_grupo ?? "");
  const [fotoPath, setFotoPath] = useState<string | null>(campanha.foto_path ?? null);
  const [foto, setFoto] = useState<File | null>(null);
  const [admins, setAdmins] = useState((campanha.admins_telefones ?? []).join("\n"));
  const [soAdminsEnviam, setSoAdminsEnviam] = useState(campanha.so_admins_enviam ?? true);
  const [soAdminsEditam, setSoAdminsEditam] = useState(campanha.so_admins_editam ?? true);
  const [folga, setFolga] = useState(campanha.folga_vagas ?? 30);
  const [maxGrupos, setMaxGrupos] = useState(campanha.max_grupos ?? 20);
  const [bvLigada, setBvLigada] = useState(campanha.boas_vindas_ligada ?? false);
  const [bvTexto, setBvTexto] = useState(campanha.boas_vindas_texto ?? "");
  const [bvMencionar, setBvMencionar] = useState(campanha.boas_vindas_mencionar ?? true);
  const [bvIntervalo, setBvIntervalo] = useState(campanha.boas_vindas_intervalo_min ?? 10);
  const [salvando, setSalvando] = useState(false);
  const [criando, setCriando] = useState(false);
  const [log, setLog] = useState<CriacaoGrupo[]>([]);

  const carregarLog = useCallback(async () => {
    const { data } = await db.from("grupos_criacoes").select("*").eq("campanha_id", campanha.id)
      .order("created_at", { ascending: false }).limit(20);
    setLog((data ?? []) as CriacaoGrupo[]);
  }, [campanha.id]);
  useEffect(() => { carregarLog(); }, [carregarLog]);

  const linhasAdmin = admins.split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean);
  const adminsNorm = linhasAdmin.map(telefoneAdmin);
  const ritmo = intervaloEfetivo(campanha.intervalo_min_s, campanha.intervalo_max_s, teto);

  const erros: string[] = [];
  if (adminsNorm.some((a) => !a)) erros.push("Telefone de admin inválido (use DDD + número; outro país com DDI).");
  if (adminsNorm.length > 10) erros.push("No máximo 10 admins.");
  if (prefixo.length > 80) erros.push("Prefixo passa de 80 caracteres.");
  if (descricao.length > 1024) erros.push("Descrição passa de 1024 caracteres.");
  if (folga < 1 || folga > 500) erros.push("Folga entre 1 e 500 vagas.");
  if (maxGrupos < 1 || maxGrupos > 200) erros.push("Máximo de grupos entre 1 e 200.");
  if (proximo < 1 || proximo > 9999) erros.push("Próximo número entre 1 e 9999.");
  if (teto < 1 || teto > 6) erros.push("Teto entre 1 e 6 grupos por minuto.");
  if (bvLigada && !bvTexto.trim()) erros.push("Boas-vindas ligada precisa do texto.");
  if (bvTexto.length > 2000) erros.push("Boas-vindas passa de 2000 caracteres.");
  if (bvIntervalo < 2 || bvIntervalo > 240) erros.push("Intervalo da boas-vindas entre 2 e 240 min.");
  if (foto && !/^image\/(jpeg|png|webp)$/.test(foto.type)) erros.push("Foto: JPG, PNG ou WebP.");

  async function salvar() {
    if (erros.length) return;
    setSalvando(true);
    try {
      let caminhoFoto = fotoPath;
      if (foto) caminhoFoto = await subirMidia(campanha.id, foto);
      const dataIso = dataEvento ? new Date(dataEvento).toISOString() : null;
      const { error } = await db.from("grupos_campanhas").update({
        data_evento: dataIso, teto_por_minuto: teto,
        prefixo_nome: prefixo.trim(), proximo_numero: proximo,
        descricao_grupo: descricao.trim() || null, foto_path: caminhoFoto,
        admins_telefones: adminsNorm.filter(Boolean), so_admins_enviam: soAdminsEnviam, so_admins_editam: soAdminsEditam,
        folga_vagas: folga, max_grupos: maxGrupos,
        boas_vindas_ligada: bvLigada, boas_vindas_texto: bvTexto.trim() || null, boas_vindas_mencionar: bvMencionar,
        boas_vindas_intervalo_min: bvIntervalo, updated_at: new Date().toISOString(),
      }).eq("id", campanha.id);
      if (error) throw new Error(error.message);
      setFoto(null);
      setFotoPath(caminhoFoto);
      toast({ title: "Fluxo salvo" });
      onSalvo();
    } catch (e) {
      toast({ title: "Não deu para salvar", description: (e as Error).message, variant: "destructive" });
    }
    setSalvando(false);
  }

  async function criarAgora() {
    if (!confirm(`Criar agora o grupo "${nomeGrupoDaCampanha(prefixo, campanha.nome, proximo)}" pelo número da campanha?`)) return;
    setCriando(true);
    try {
      const r = await criarGrupoAgora(campanha.id);
      toast({ title: r.resultado });
      onSalvo();
    } catch (e) {
      toast({ title: "Não deu para criar", description: (e as Error).message, variant: "destructive" });
    }
    await carregarLog();
    setCriando(false);
  }

  const secao = "rounded-md border p-4 space-y-3";

  return (
    <div className="space-y-4 max-w-2xl">
      {tem("evento") && <div className={secao}>
        <p className="font-medium">Evento e ritmo</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Data e hora do evento</Label>
            <Input type="datetime-local" value={dataEvento} onChange={(e) => setDataEvento(e.target.value)} />
            <p className="text-xs text-muted-foreground">Mensagens "relativas ao evento" (D-3, D-1, na hora) seguem esta data. Mudou a data, elas mudam junto.</p>
          </div>
          <div className="space-y-1">
            <Label>Teto de grupos por minuto</Label>
            <Input type="number" min={1} max={6} value={teto} onChange={(e) => setTeto(Number(e.target.value))} />
            <p className="text-xs text-muted-foreground">
              Cada mensagem sai grupo a grupo a cada {ritmo.min}-{ritmo.max} s. O proxy ainda limita 6/min e 200/dia por número.
            </p>
          </div>
        </div>
      </div>}

      {!criaGrupo && (tem("criacao") || tem("criarAgora")) && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{MSG_NUMERO_NAO_CRIA}</p>
      )}

      {tem("criacao") && <div className={secao}>
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">Criação automática de grupos</p>
          <Badge variant="secondary">sempre ligada</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Lotou, cria grupo: quando as vagas somadas dos grupos ativos ficam abaixo da folga, o CRM cria o próximo grupo pelo número da campanha
          (1 por vez por campanha, no máximo 1 a cada {Math.round(PAUSA_ENTRE_CRIACOES_MS / 60_000)} min e {TETO_CRIACOES_DIA_POR_NUMERO} por dia por número),
          aplica as configurações abaixo e põe o grupo no fim da fila do link. Quem clica enquanto o grupo nasce espera alguns segundos na página do link.
          Só o número de grupos (Grupos 1) cria, e ele precisa estar conectado; os admins entram no grupo e viram administradores.
        </p>
        {!adminsNorm.filter(Boolean).length && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            Sem admin, o grupo novo não nasce: o WhatsApp não cria grupo só com o número. Cadastre pelo menos 1 telefone abaixo.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Prefixo do nome</Label>
            <Input value={prefixo} onChange={(e) => setPrefixo(e.target.value)} placeholder={campanha.nome} />
            <p className="text-xs text-muted-foreground">Próximo: <b>{nomeGrupoDaCampanha(prefixo, campanha.nome, proximo)}</b>{!prefixo.trim() && " (sem prefixo, usa o nome da campanha)"}</p>
          </div>
          <div className="space-y-1">
            <Label>Próximo número</Label>
            <Input type="number" min={1} max={9999} value={proximo} onChange={(e) => setProximo(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>Criar quando sobrarem menos de (vagas)</Label>
            <Input type="number" min={1} max={500} value={folga} onChange={(e) => setFolga(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>Máximo de grupos na campanha</Label>
            <Input type="number" min={1} max={200} value={maxGrupos} onChange={(e) => setMaxGrupos(Number(e.target.value))} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Descrição do grupo (opcional)</Label>
            <Textarea rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Regras, link da aula, horário..." />
          </div>
          <div className="space-y-1">
            <Label>Foto do grupo (opcional)</Label>
            <div className="flex items-center gap-2">
              <input ref={fotoRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
              <Button type="button" variant="outline" size="sm" onClick={() => fotoRef.current?.click()}>
                <Paperclip className="h-4 w-4 mr-1" /> {foto || fotoPath ? "Trocar" : "Escolher"}
              </Button>
              <span className="text-xs truncate">{foto?.name ?? (fotoPath ? "foto salva" : "sem foto")}</span>
              {(foto || fotoPath) && (
                <Button type="button" variant="ghost" size="icon" onClick={() => { setFoto(null); setFotoPath(null); if (fotoRef.current) fotoRef.current.value = ""; }}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label>Admins (um telefone por linha, até 10)</Label>
            <Textarea rows={3} value={admins} onChange={(e) => setAdmins(e.target.value)} placeholder={"11999998888\n21988887777"} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={soAdminsEnviam} onCheckedChange={setSoAdminsEnviam} /> Grupo nasce fechado (só admins enviam)</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={soAdminsEditam} onCheckedChange={setSoAdminsEditam} /> Só admins editam nome, foto e descrição</label>
      </div>}

      {tem("criarAgora") && <div className={secao}>
        <p className="font-medium">Criar agora e histórico de criação</p>
        <p className="text-xs text-muted-foreground">
          Próximo: <b>{nomeGrupoDaCampanha(campanha.prefixo_nome, campanha.nome, campanha.proximo_numero ?? 1)}</b> · prefixo, admins, descrição e foto vêm da configuração de criação da campanha.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={criarAgora} disabled={criando || !criaGrupo || !(campanha.admins_telefones ?? []).length}>
            {criando ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Criar o próximo grupo agora
          </Button>
          <span className="text-xs text-muted-foreground">usa o que está salvo (salve antes de criar)</span>
        </div>
        {log.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">Grupos criados pelo CRM</p>
              <Button size="icon" variant="ghost" onClick={carregarLog} title="Atualizar"><RefreshCw className="h-3.5 w-3.5" /></Button>
            </div>
            {log.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="truncate max-w-[200px]">{c.nome}</span>
                <Badge variant={COR_CRIACAO[c.status]}>{c.status}</Badge>
                <span className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · etapa {c.etapa}</span>
                {c.erro && <span className="text-xs text-destructive">{c.erro}</span>}
                {c.avisos?.length > 0 && <span className="text-xs text-amber-600">{c.avisos.join(" · ")}</span>}
              </div>
            ))}
          </div>
        )}
        {!log.length && <p className="text-xs text-muted-foreground">Nenhum grupo criado pelo CRM nesta campanha ainda.</p>}
      </div>}

      {tem("boasvindas") && <div className={secao}>
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">Boas-vindas</p>
          <label className="flex items-center gap-2 text-sm"><Switch checked={bvLigada} onCheckedChange={setBvLigada} /> {bvLigada ? "ligada" : "desligada"}</label>
        </div>
        <p className="text-xs text-muted-foreground">
          Junta quem entrou e manda uma mensagem por grupo, no máximo 1 a cada N minutos (nunca uma por pessoa).
          Precisa dos eventos de entrada do WhatsApp ligados na VPS; quem entrou há mais de 6 h não recebe.
        </p>
        <Textarea rows={4} value={bvTexto} onChange={(e) => setBvTexto(e.target.value)} placeholder={"Seja bem-vinda {mencoes}! Fixe o grupo e ative as notificações."} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm"><Switch checked={bvMencionar} onCheckedChange={setBvMencionar} /> Marcar quem entrou ({"{mencoes}"} no texto, ou no fim)</label>
          <div className="flex items-center gap-2 text-sm">
            <span>No máximo 1 a cada</span>
            <Input className="w-20" type="number" min={2} max={240} value={bvIntervalo} onChange={(e) => setBvIntervalo(Number(e.target.value))} />
            <span>min por grupo</span>
          </div>
        </div>
      </div>}

      {(tem("evento") || tem("criacao") || tem("boasvindas")) && <>
        {erros.length > 0 && <ul className="text-xs text-destructive list-disc pl-4">{erros.map((e) => <li key={e}>{e}</li>)}</ul>}
        <Button onClick={salvar} disabled={salvando || erros.length > 0}>
          {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {tem("boasvindas") && !tem("criacao") ? "Salvar boas-vindas" : "Salvar fluxo"}
        </Button>
      </>}
    </div>
  );
}
