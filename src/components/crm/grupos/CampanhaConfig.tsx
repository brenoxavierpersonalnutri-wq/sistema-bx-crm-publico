import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  db, slugDe, slugValido, INTERVALO_PADRAO, LIMITE_PADRAO, LIMITE_WHATSAPP_GRUPO,
  type CampanhaGrupos, type ModoDistribuicao, type NumeroWhatsApp,
} from "@/lib/grupos";

const seletorClasse = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

// Criar/editar campanha de grupos: nome, link (slug), número, limite, intervalo, pausas.
export function CampanhaConfig({
  campanha, numeros, onSalvo, numeroInicial = null,
}: { campanha: CampanhaGrupos | null; numeros: NumeroWhatsApp[]; onSalvo: (id: string) => void; numeroInicial?: string | null }) {
  const { toast } = useToast();
  const [nome, setNome] = useState(campanha?.nome ?? "");
  const [slug, setSlug] = useState(campanha?.slug ?? "");
  const [slugMexido, setSlugMexido] = useState(Boolean(campanha));
  const [numeroId, setNumeroId] = useState<string>(campanha?.numero_id ?? numeroInicial ?? "");
  const [limite, setLimite] = useState(campanha?.limite_por_grupo ?? LIMITE_PADRAO);
  const [tag, setTag] = useState(campanha?.tag ?? "");
  const [urlLotado, setUrlLotado] = useState(campanha?.url_lotado ?? "");
  const [minS, setMinS] = useState(campanha?.intervalo_min_s ?? INTERVALO_PADRAO.min);
  const [maxS, setMaxS] = useState(campanha?.intervalo_max_s ?? INTERVALO_PADRAO.max);
  const [linkPausado, setLinkPausado] = useState(campanha?.link_pausado ?? false);
  const [disparosPausados, setDisparosPausados] = useState(campanha?.disparos_pausados ?? false);
  const [encerrada, setEncerrada] = useState(campanha?.encerrada ?? false);
  const [modo, setModo] = useState<ModoDistribuicao>(campanha?.modo_distribuicao ?? "encher");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!slugMexido) setSlug(slugDe(nome));
  }, [nome, slugMexido]);

  const erros: string[] = [];
  if (!nome.trim()) erros.push("Dê um nome.");
  if (!slugValido(slug)) erros.push("Link: 3 a 60 caracteres, só letras minúsculas, números e hífen.");
  if (limite < 1 || limite > LIMITE_WHATSAPP_GRUPO) erros.push(`Limite entre 1 e ${LIMITE_WHATSAPP_GRUPO}.`);
  if (minS < 10 || maxS > 600 || minS > maxS) erros.push("Intervalo: mínimo ≥ 10 s, máximo ≤ 600 s, mínimo ≤ máximo.");
  if (urlLotado && !/^https:\/\//.test(urlLotado)) erros.push("URL de pausa precisa começar com https://");

  async function salvar() {
    if (erros.length) return;
    setSalvando(true);
    const linha = {
      nome: nome.trim(), slug, numero_id: numeroId || null, limite_por_grupo: limite, tag: tag.trim(),
      url_lotado: urlLotado.trim() || null, intervalo_min_s: minS, intervalo_max_s: maxS,
      // campanha nova nasce em rascunho: link e disparos pausados até alguém ligar na Configuração
      link_pausado: campanha ? linkPausado : true, disparos_pausados: campanha ? disparosPausados : true,
      encerrada, updated_at: new Date().toISOString(),
      // coluna da migration 20261108110000: só vai quando existe/usada (campanha antiga salva sem ela)
      ...(campanha?.modo_distribuicao !== undefined || modo !== "encher" ? { modo_distribuicao: modo } : {}),
    };
    const q = campanha
      ? db.from("grupos_campanhas").update(linha).eq("id", campanha.id).select("id").single()
      : db.from("grupos_campanhas").insert(linha).select("id").single();
    const { data, error } = await q;
    setSalvando(false);
    if (error) {
      const dup = /duplicate|unique/i.test(error.message);
      toast({ title: dup ? "Esse link já existe" : "Erro ao salvar", description: dup ? "Escolha outro." : error.message, variant: "destructive" });
      return;
    }
    toast({ title: campanha ? "Campanha salva" : "Campanha criada" });
    onSalvo(data.id);
  }

  return (
    <div className="space-y-4 max-w-xl rounded-md border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label>Nome</Label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Desafio 21 dias - turma de novembro" />
        </div>
        <div className="space-y-1">
          <Label>Link público</Label>
          <div className="flex items-center gap-1 text-sm">
            <span className="text-muted-foreground">/g/</span>
            <Input value={slug} onChange={(e) => { setSlugMexido(true); setSlug(e.target.value.toLowerCase()); }} placeholder="grupo-desafio" />
          </div>
          <p className="text-xs text-muted-foreground">Comece com "grupo-" para funcionar também em /r/ (ex.: grupo-desafio, o do template).</p>
        </div>
        <div className="space-y-1">
          <Label>Número de WhatsApp</Label>
          <select className={seletorClasse} value={numeroId} onChange={(e) => setNumeroId(e.target.value)}>
            <option value="">Sessão padrão do proxy</option>
            {numeros.map((n) => <option key={n.id} value={n.id}>{n.rotulo}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">Os grupos e o disparo usam a sessão deste número.</p>
        </div>
        <div className="space-y-1">
          <Label>Limite por grupo</Label>
          <Input type="number" min={1} max={LIMITE_WHATSAPP_GRUPO} value={limite} onChange={(e) => setLimite(Number(e.target.value))} />
        </div>
        <div className="space-y-1">
          <Label>Tag do lead</Label>
          <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder={slug ? `grupo-${slug}` : "grupo-<link>"} />
        </div>
        <div className="space-y-1">
          <Label>Intervalo entre grupos (s)</Label>
          <div className="flex items-center gap-2">
            <Input type="number" min={10} max={600} value={minS} onChange={(e) => setMinS(Number(e.target.value))} />
            <span className="text-muted-foreground">a</span>
            <Input type="number" min={10} max={600} value={maxS} onChange={(e) => setMaxS(Number(e.target.value))} />
          </div>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Distribuição do link /g/</Label>
          <select className={seletorClasse} value={modo} onChange={(e) => setModo(e.target.value as ModoDistribuicao)} aria-label="Modo de distribuição">
            <option value="encher">Encher um por vez (manda para o primeiro grupo com vaga até lotar)</option>
            <option value="split">Split entre grupos (reparte as entradas entre todos os grupos com vaga)</option>
          </select>
          <p className="text-xs text-muted-foreground">
            {modo === "split"
              ? "Cada entrada vai para o grupo menos cheio em proporção ao peso (peso igual = partes iguais; 70 e 30 = 70%/30%). Pula grupo cheio, inativo ou sem convite. Pesos na tabela de grupos."
              : "Enche o 1º grupo da ordem até o limite e passa para o próximo. Pula grupo cheio, inativo ou sem convite."}
          </p>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="url-pausado">URL quando o link estiver pausado (opcional)</Label>
          <Input id="url-pausado" value={urlLotado} onChange={(e) => setUrlLotado(e.target.value)} placeholder="https://..." />
          <p className="text-xs text-muted-foreground">
            Só vale quando você pausa o link: quem clicar vai para esta página (sem URL, vê que as entradas estão fechadas).
            Grupo lotado nunca usa esta URL: o CRM cria o próximo grupo sozinho e quem clicou espera alguns segundos na página do link.
          </p>
        </div>
      </div>

      {campanha && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm"><Switch checked={linkPausado} onCheckedChange={setLinkPausado} /> Pausar o link (ninguém entra)</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={disparosPausados} onCheckedChange={setDisparosPausados} /> Pausar os disparos (nada sai até despausar)</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={encerrada} onCheckedChange={setEncerrada} /> Encerrar campanha (link para de funcionar, fila cancela)</label>
        </div>
      )}

      {!campanha && (
        <p className="text-xs text-muted-foreground">A campanha nasce em rascunho: link e disparos pausados. Ligue os dois aqui na Configuração quando estiver pronta.</p>
      )}
      {erros.length > 0 && <ul className="text-xs text-destructive list-disc pl-4">{erros.map((e) => <li key={e}>{e}</li>)}</ul>}
      <Button onClick={salvar} disabled={salvando || erros.length > 0}>
        {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {campanha ? "Salvar" : "Criar campanha"}
      </Button>
    </div>
  );
}
