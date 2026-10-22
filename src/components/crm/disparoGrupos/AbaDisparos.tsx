import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Paperclip, Search, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { statusDaSessao } from "@/hooks/useCentralAutomacao";
import type { NumeroCRM, StatusNumero } from "@/lib/crm/central";
import {
  db, permissaoGrupo, subirMidia, tipoDoArquivo, TIPOS_COM_MENCAO,
  type CampanhaGrupos, type GrupoLinha, type NumeroWhatsApp, type TipoMensagemGrupo,
} from "@/lib/grupos";
import {
  edgeSuportaDisparo, enviosDeHoje, montarDisparo, LIMITE_GRUPO_POR_DIA, type AlvoDisparo,
} from "@/lib/disparoGrupos";
import { ImportarGrupos } from "./ImportarGrupos";
import { PermissaoBadge } from "./PermissaoBadge";
import { HistoricoDisparos } from "./HistoricoDisparos";

const seletor = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const ROTULO_TIPO: Partial<Record<TipoMensagemGrupo, string>> = {
  texto: "Texto", imagem: "Imagem", video: "Vídeo", audio: "Áudio", documento: "PDF/arquivo", enquete: "Enquete",
};
const paraInputLocal = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

type Linha = GrupoLinha & { campanha: CampanhaGrupos };

// Aba Disparos (estilo SendFlow): escolher o NÚMERO, os GRUPOS (das campanhas dele ou importados do WhatsApp),
// a MENSAGEM (texto, mídia, áudio gravado, mencionar todos, enquete) e QUANDO (agora ou agendado). Grava em
// grupos_mensagens com grupos_alvo e o disparador que já existe manda, grupo a grupo, nos limites do proxy.
export function AbaDisparos({ campanhas, numeros, onMudou, numeroInicial = null }: { campanhas: CampanhaGrupos[]; numeros: NumeroWhatsApp[]; onMudou: () => Promise<void>; numeroInicial?: string | null }) {
  const { toast } = useToast();
  const arquivoRef = useRef<HTMLInputElement>(null);
  const grupos1 = numeros.find((n) => n.sessao === "grupos-1");
  const [numeroId, setNumeroId] = useState<string>(numeroInicial ?? grupos1?.id ?? "");
  const [status, setStatus] = useState<Record<string, StatusNumero>>({});
  const [grupos, setGrupos] = useState<Linha[]>([]);
  const [allowlist, setAllowlist] = useState<Set<string>>(new Set());
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [importar, setImportar] = useState(false);
  const [modo, setModo] = useState<"conteudo" | "enquete">("conteudo");
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [ptt, setPtt] = useState(true);
  const [mencionar, setMencionar] = useState(false);
  const [linkPreview, setLinkPreview] = useState(true);
  const [opcoes, setOpcoes] = useState("");
  const [multipla, setMultipla] = useState(false);
  const [quandoModo, setQuandoModo] = useState<"agora" | "agendar">("agora");
  const [quando, setQuando] = useState(() => paraInputLocal(new Date(Date.now() + 30 * 60_000)));
  const [hoje, setHoje] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [versaoOk, setVersaoOk] = useState<boolean | null>(null);
  const [recarregarHistorico, setRecarregarHistorico] = useState(0);

  useEffect(() => { if (!numeroId && grupos1) setNumeroId(grupos1.id); }, [grupos1, numeroId]);
  useEffect(() => { edgeSuportaDisparo().then(setVersaoOk); }, []);

  // status de conexão de cada número (leitura, como a tela Conexões)
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      for (const n of numeros) {
        const st = await statusDaSessao({ id: n.id, tipo: "openwa", sessao_openwa: n.sessao ?? null, ativo: true } as NumeroCRM, token);
        if (!vivo) return;
        setStatus((s) => ({ ...s, [n.id]: st }));
      }
    })();
    return () => { vivo = false; };
  }, [numeros]);

  const doNumero = useMemo(() => campanhas.filter((c) => c.numero_id === numeroId && !c.encerrada), [campanhas, numeroId]);

  const carregarGrupos = useCallback(async () => {
    setMarcados(new Set());
    if (!numeroId || !doNumero.length) { setGrupos([]); setHoje(0); return; }
    const ids = doNumero.map((c) => c.id);
    const [{ data }, { data: todos }] = await Promise.all([
      db.from("grupos_campanha_grupos").select("*").in("campanha_id", ids).not("chat_id", "is", null).order("ordem"),
      // allowlist = o que o disparador grava no proxy: grupos com id de campanhas não encerradas (qualquer número)
      db.from("grupos_campanha_grupos").select("chat_id, grupos_campanhas!inner(encerrada)").not("chat_id", "is", null)
        .eq("grupos_campanhas.encerrada", false).limit(500),
    ]);
    const porId = new Map(doNumero.map((c) => [c.id, c]));
    setGrupos(((data ?? []) as GrupoLinha[]).map((g) => ({ ...g, campanha: porId.get(g.campanha_id)! })));
    setAllowlist(new Set((todos ?? []).map((g: { chat_id: string }) => g.chat_id)));
    setHoje(await enviosDeHoje(ids));
  }, [numeroId, doNumero]);
  useEffect(() => { carregarGrupos(); }, [carregarGrupos]);

  const visiveis = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return grupos.filter((g) => !b || `${g.nome} ${g.campanha?.nome}`.toLowerCase().includes(b));
  }, [grupos, busca]);

  const tipo: TipoMensagemGrupo = modo === "enquete" ? "enquete" : arquivo ? tipoDoArquivo(arquivo.type) : "texto";
  const alvos: AlvoDisparo[] = grupos.filter((g) => marcados.has(g.id)).map((g) => ({
    grupo_id: g.id, campanha_id: g.campanha_id, numero_id: g.campanha?.numero_id ?? null, chat_id: g.chat_id,
    nome: g.nome, ativo: g.ativo, permissao: permissaoGrupo(g), campanha_encerrada: g.campanha?.encerrada,
  }));
  const disparo = montarDisparo({
    numero_id: numeroId || null, alvos, allowlist, enviosHoje: hoje,
    quando: quandoModo === "agora" ? "agora" : (() => { const d = new Date(quando); return Number.isFinite(d.getTime()) ? d.toISOString() : "x"; })(),
    mensagem: {
      tipo, texto: tipo === "audio" ? null : texto, midia_path: arquivo ? "pendente/arquivo" : null, nome_arquivo: arquivo?.name ?? null,
      link_preview: linkPreview, enquete_opcoes: opcoes.split("\n"), enquete_multipla: multipla,
      ptt: tipo === "audio" && ptt, mencionar_todos: mencionar && TIPOS_COM_MENCAO.includes(tipo),
    },
  });
  const problemas = [...disparo.problemas];
  if (arquivo && arquivo.size > 50 * 1024 * 1024) problemas.push("Arquivo passa de 50 MB.");
  if (versaoOk === false) problemas.unshift("A função do disparador publicada ainda é a antiga (mandaria para todos os grupos da campanha). Publique a grupos-disparo-tick nova antes de disparar.");
  const pausadas = [...new Set(alvos.map((a) => a.campanha_id))].map((id) => campanhas.find((c) => c.id === id)).filter((c) => c?.disparos_pausados);

  async function disparar() {
    if (problemas.length) return;
    const quantos = disparo.total;
    if (!confirm(`${quandoModo === "agora" ? "Disparar agora" : "Agendar"} para ${quantos} grupo(s) pelo número ${numeros.find((n) => n.id === numeroId)?.rotulo ?? ""}?`)) return;
    setSalvando(true);
    try {
      let midia: string | null = null;
      if (arquivo) midia = await subirMidia(`disparo-${Date.now()}`, arquivo);
      const linhas = disparo.linhas.map((l) => ({
        ...l,
        midia_path: ["imagem", "video", "audio", "documento"].includes(l.tipo) ? midia : null,
        nome_arquivo: l.tipo === "documento" ? (arquivo?.name ?? "").slice(0, 255) || null : null,
        agendado_para: quandoModo === "agora" ? new Date().toISOString() : l.agendado_para,
      }));
      const { error } = await db.from("grupos_mensagens").insert(linhas);
      if (error) throw new Error(error.message);
      toast({ title: quandoModo === "agora" ? "Disparo na fila" : "Disparo agendado", description: `${quantos} grupo(s). Acompanhe no histórico abaixo.` });
      setTexto(""); setArquivo(null); setOpcoes(""); setMencionar(false); setMarcados(new Set());
      if (arquivoRef.current) arquivoRef.current.value = "";
      setRecarregarHistorico((n) => n + 1);
      await carregarGrupos();
    } catch (e) {
      toast({ title: "Não deu para gravar o disparo", description: (e as Error).message, variant: "destructive" });
    }
    setSalvando(false);
  }

  const alternar = (id: string) => setMarcados((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const jaTem = new Set(grupos.map((g) => g.chat_id).filter((c): c is string => Boolean(c)));
  const corStatus = (s?: StatusNumero) => (s?.estado === "conectado" ? "text-green-500" : s ? "text-muted-foreground" : "text-muted-foreground");

  return (
    <div className="space-y-5">
      <div className="rounded-md border p-4 space-y-3">
        <p className="font-medium">1. Número que dispara</p>
        <div className="flex flex-wrap gap-2">
          {numeros.map((n) => {
            const st = status[n.id];
            const destaque = n.sessao === "grupos-1";
            return (
              <button
                key={n.id} type="button" onClick={() => setNumeroId(n.id)}
                className={`rounded-md border px-3 py-2 text-left text-sm ${numeroId === n.id ? "border-primary bg-muted/50" : "hover:bg-muted/40"} ${destaque && st?.estado === "conectado" ? "ring-1 ring-green-600/60" : ""}`}
              >
                <div className="font-medium flex items-center gap-2">{n.rotulo}{destaque && <Badge variant="secondary">recomendado p/ grupos</Badge>}</div>
                <div className={`text-xs ${corStatus(st)}`}>{st ? st.rotulo : "lendo status..."}</div>
              </button>
            );
          })}
          {!numeros.length && <p className="text-sm text-muted-foreground">Nenhum número OpenWA ativo na Central.</p>}
        </div>
        {numeroId && status[numeroId] && status[numeroId].estado !== "conectado" && (
          <p className="text-xs text-amber-600">Este número não aparece conectado agora: o disparo fica na fila e falha se continuar desconectado.</p>
        )}
      </div>

      <div className="rounded-md border p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium flex-1">2. Grupos ({marcados.size} escolhido{marcados.size === 1 ? "" : "s"})</p>
          <Button size="sm" variant="outline" onClick={() => setImportar((v) => !v)} disabled={!numeroId}>Adicionar grupo existente do número</Button>
        </div>
        {importar && numeroId && (
          <ImportarGrupos numeroId={numeroId} campanhaId={null} jaTem={jaTem} onImportado={async () => { await onMudou(); setImportar(false); }} />
        )}
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome do grupo ou campanha" />
        </div>
        <div className="flex gap-2 text-xs">
          <button type="button" className="underline" onClick={() => setMarcados(new Set(visiveis.filter((g) => permissaoGrupo(g) !== "sem_permissao" && g.ativo).map((g) => g.id)))}>marcar os visíveis</button>
          <button type="button" className="underline" onClick={() => setMarcados(new Set())}>limpar</button>
        </div>
        <div className="max-h-72 overflow-y-auto space-y-1">
          {visiveis.map((g) => {
            const p = permissaoGrupo(g);
            const bloqueado = p === "sem_permissao" || !g.ativo;
            return (
              <label key={g.id} className={`flex items-center gap-2 text-sm border rounded px-2 py-1 ${bloqueado ? "opacity-60" : "cursor-pointer"}`}>
                <Checkbox checked={marcados.has(g.id)} disabled={bloqueado} onCheckedChange={() => alternar(g.id)} aria-label={`Selecionar ${g.nome || g.chat_id}`} />
                <span className="truncate flex-1">{g.nome || g.chat_id}</span>
                <span className="text-xs text-muted-foreground truncate max-w-[140px]">{g.campanha?.avulsa ? "Avulsos" : g.campanha?.nome}</span>
                <PermissaoBadge permissao={p} />
              </label>
            );
          })}
          {numeroId && !grupos.length && <p className="text-sm text-muted-foreground">Nenhum grupo deste número no CRM. Use "Adicionar grupo existente do número".</p>}
        </div>
        <p className="text-xs text-muted-foreground">Hoje este número já tem {hoje} envio(s) a grupo (teto {LIMITE_GRUPO_POR_DIA}/dia).</p>
      </div>

      <div className="rounded-md border p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">3. Mensagem</p>
          <select className={seletor} value={modo} onChange={(e) => setModo(e.target.value as "conteudo" | "enquete")} aria-label="Tipo de mensagem">
            <option value="conteudo">Texto ou mídia</option>
            <option value="enquete">Enquete</option>
          </select>
          <Badge variant="outline">{ROTULO_TIPO[tipo]}</Badge>
        </div>
        {modo === "conteudo" && (
          <div className="flex items-center gap-2">
            <input
              ref={arquivoRef} type="file" className="hidden" data-testid="arquivo-disparo"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,video/quicktime,audio/mpeg,audio/ogg,audio/mp4,audio/aac,audio/wav,audio/x-m4a,application/pdf"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => arquivoRef.current?.click()}><Paperclip className="h-4 w-4 mr-1" /> {arquivo ? "Trocar mídia" : "Imagem, vídeo, áudio ou PDF"}</Button>
            <span className="text-xs truncate">{arquivo?.name ?? "só texto"}</span>
            {arquivo && <Button type="button" variant="ghost" size="icon" onClick={() => { setArquivo(null); if (arquivoRef.current) arquivoRef.current.value = ""; }}><X className="h-4 w-4" /></Button>}
          </div>
        )}
        {tipo === "enquete" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Pergunta</Label>
              <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Qual horário é melhor pra você?" />
              <label className="flex items-center gap-2 text-sm"><Switch checked={multipla} onCheckedChange={setMultipla} /> Permitir mais de uma resposta</label>
            </div>
            <div className="space-y-1">
              <Label>Opções (uma por linha, 2 a 12)</Label>
              <Textarea rows={4} value={opcoes} onChange={(e) => setOpcoes(e.target.value)} placeholder={"19h\n20h\n21h"} />
            </div>
          </div>
        ) : tipo !== "audio" && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>{tipo === "texto" ? "Texto" : "Legenda (opcional)"}</Label>
              <Textarea rows={6} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Texto da mensagem. *negrito*, _itálico_. Links com https:// viram prévia." />
            </div>
            <div className="space-y-1">
              <Label>Pré-visualização</Label>
              <div className="rounded-lg bg-zinc-950 p-3 min-h-[120px]" data-testid="previa-disparo">
                <div className="ml-auto max-w-[90%] rounded-lg bg-emerald-800 px-3 py-2 text-sm text-white whitespace-pre-wrap break-words">
                  {arquivo && <div className="mb-1 text-xs opacity-80">[{ROTULO_TIPO[tipo]}: {arquivo.name}]</div>}
                  {texto || <span className="opacity-60">sua mensagem aparece aqui</span>}
                  {mencionar && <div className="mt-1 text-xs opacity-80">(notifica todos os membros)</div>}
                </div>
              </div>
            </div>
          </div>
        )}
        {tipo === "audio" && (
          <label className="flex items-center gap-2 text-sm"><Switch checked={ptt} onCheckedChange={setPtt} /> Enviar como áudio gravado (nota de voz){ptt && arquivo && !/ogg|opus/i.test(arquivo.type + arquivo.name) ? <span className="text-xs text-amber-600">.ogg (Opus) toca melhor como nota de voz</span> : null}</label>
        )}
        {TIPOS_COM_MENCAO.includes(tipo) && (
          <label className="flex items-center gap-2 text-sm"><Switch checked={mencionar} onCheckedChange={setMencionar} /> Mencionar todos (notifica todo mundo sem @ no texto)</label>
        )}
        {tipo === "texto" && <label className="flex items-center gap-2 text-sm"><Switch checked={linkPreview} onCheckedChange={setLinkPreview} /> Mostrar prévia do link</label>}
      </div>

      <div className="rounded-md border p-4 space-y-3">
        <p className="font-medium">4. Quando</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1"><input type="radio" name="quando" checked={quandoModo === "agora"} onChange={() => setQuandoModo("agora")} /> Agora</label>
          <label className="flex items-center gap-1"><input type="radio" name="quando" checked={quandoModo === "agendar"} onChange={() => setQuandoModo("agendar")} /> Agendar</label>
          {quandoModo === "agendar" && <Input className="w-56" type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} aria-label="Data e hora do disparo" />}
        </div>
        <p className="text-xs text-muted-foreground">Repetição (diária/semanal) ainda não existe no disparador: para repetir, agende cada data.</p>
        {disparo.avisos.length > 0 && <ul className="text-xs text-muted-foreground list-disc pl-4">{disparo.avisos.map((a) => <li key={a}>{a}</li>)}</ul>}
        {pausadas.length > 0 && <p className="text-xs text-amber-600">Disparos pausados em: {pausadas.map((c) => c!.nome).join(", ")}. A mensagem espera até despausar.</p>}
        {problemas.length > 0 && <ul className="text-xs text-destructive list-disc pl-4" data-testid="problemas-disparo">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>}
        <Button onClick={disparar} disabled={salvando || problemas.length > 0}>
          {salvando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
          {quandoModo === "agora" ? "Disparar agora" : "Agendar disparo"} ({disparo.total} grupo{disparo.total === 1 ? "" : "s"})
        </Button>
      </div>

      <HistoricoDisparos campanhas={campanhas} recarregar={recarregarHistorico} />
    </div>
  );
}
