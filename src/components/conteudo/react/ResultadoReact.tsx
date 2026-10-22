import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Download, Instagram, Loader2, RefreshCw, Scissors, Settings2, Sparkles, Wand2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PublicarInstagramDialog } from "@/components/conteudo/PublicarInstagramDialog";
import type { CardPedido } from "@/lib/conteudo/publicacoes";
import {
  type EstadoServico, type Layout, type ListaModelos, type ProjetoReact, type ResumoIA, MODELOS_RESERVA, atualizarColunasIA, atualizarProjeto,
  baixarFinal, estadoLink, estadoMontagem, listarModelos, textoCredito,
} from "@/lib/conteudo/react/api";
import { formatarTempo } from "@/lib/conteudo/react/linhaTempo";
import { DURACOES, opcoesDoProjeto, resumoOpcoes, type OpcoesMontagem } from "@/lib/conteudo/react/opcoes";

export type { OpcoesMontagem };

interface Props {
  projeto: ProjetoReact;
  podePublicar: boolean;
  /** muda quando uma montagem nova é pedida: recomeça a consulta */
  rodada: number;
  onRemontar: (op: OpcoesMontagem) => Promise<void>;
  onNovo: () => void;
  /** abre a tela de edição (layout, pausas e som por trecho) */
  onEditar?: () => void;
}

let cacheModelos: Promise<ListaModelos> | null = null;

/** Modelos de edição do serviço (uma busca por sessão; sem resposta, só o Nativo). */
export function useModelos(): ListaModelos {
  const [lista, setLista] = useState<ListaModelos>(MODELOS_RESERVA);
  useEffect(() => {
    let vivo = true;
    cacheModelos ??= listarModelos();
    void cacheModelos.then((l) => { if (vivo) setLista(l); });
    return () => { vivo = false; };
  }, []);
  return lista;
}

/** Seletor "Modelo de edição": muda a legenda e o título (Nativo = legenda limpa como a do Instagram). */
export function SeletorModelo({ valor, onChange, desativado }: { valor: string; onChange: (id: string) => void; desativado?: boolean }) {
  const lista = useModelos();
  const atual = lista.modelos.find((m) => m.id === valor);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm">
        <span className="shrink-0 font-medium">Modelo de edição</span>
        <Select value={atual ? valor : lista.padrao} onValueChange={onChange} disabled={desativado}>
          <SelectTrigger className="h-9 min-w-0 flex-1" aria-label="Modelo de edição"><SelectValue /></SelectTrigger>
          <SelectContent>
            {lista.modelos.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
            {lista.planejados.map((m) => <SelectItem key={m.id} value={m.id} disabled>{m.nome} (em preparação)</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {atual?.descricao && <p className="text-xs text-muted-foreground">{atual.descricao}</p>}
    </div>
  );
}

export function OpcoesReact({ op, onChange, desativado }: { op: OpcoesMontagem; onChange: (o: OpcoesMontagem) => void; desativado?: boolean }) {
  return (
    <div className="space-y-3">
      <SeletorModelo valor={op.modelo} onChange={(modelo) => onChange({ ...op, modelo })} desativado={desativado} />
      <RadioGroup value={op.layout} onValueChange={(v) => onChange({ ...op, layout: v as Layout })} className="grid gap-2 sm:grid-cols-2" disabled={desativado}>
        <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
          <RadioGroupItem value="dividido" className="mt-0.5" />
          <span><b>Tela dividida</b><br /><span className="text-muted-foreground">Original em cima, você embaixo, o tempo todo.</span></span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
          <RadioGroupItem value="cheia_longos" className="mt-0.5" />
          <span><b>Você em tela cheia nos comentários longos</b><br /><span className="text-muted-foreground">Comentário de 5 s ou mais: você na tela toda e o original num quadrinho.</span></span>
        </label>
      </RadioGroup>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={op.legenda} onCheckedChange={(v) => onChange({ ...op, legenda: v })} disabled={desativado} /> Legenda automática
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={op.cortar_silencio} onCheckedChange={(v) => onChange({ ...op, cortar_silencio: v })} disabled={desativado} /> Cortar silêncios e respiros
        </label>
      </div>
      <div className="space-y-2 rounded-md border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch checked={op.ia} onCheckedChange={(v) => onChange({ ...op, ia: v })} disabled={desativado} aria-label="Edição com IA" />
          <Sparkles className="h-4 w-4" /> Edição com IA
        </label>
        <p className="text-xs text-muted-foreground">
          O Claude da sua assinatura corta repetição, erro e enrolação, abre o vídeo com o seu melhor comentário, dá zoom na sua câmera
          nos momentos fortes, escreve o título do topo e destaca as palavras-chave da legenda.
        </p>
        {op.ia && (
          <div className="flex items-center gap-2 text-sm">
            <span>Duração máxima</span>
            <Select value={String(op.duracao_max)} onValueChange={(v) => onChange({ ...op, duracao_max: Number(v) })} disabled={desativado}>
              <SelectTrigger className="h-8 w-28" aria-label="Duração máxima"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(DURACOES.includes(op.duracao_max) ? DURACOES : [...DURACOES, op.duracao_max].sort((a, b) => a - b))
                  .map((d) => <SelectItem key={d} value={String(d)}>{d < 60 || d % 60 ? `${d} s` : `${d / 60} min`}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}

/** "Opções" pequeno e recolhido: a tela de gravar fica só com o vídeo, a câmera e os botões. */
export function OpcoesRecolhidas({ op, onChange, desativado }: { op: OpcoesMontagem; onChange: (o: OpcoesMontagem) => void; desativado?: boolean }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Collapsible open={aberto} onOpenChange={setAberto} className="rounded-lg border">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
        <Settings2 className="h-4 w-4 shrink-0" />
        <span className="font-medium">Opções</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{resumoOpcoes(op)}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t p-3">
        <OpcoesReact op={op} onChange={onChange} desativado={desativado} />
      </CollapsibleContent>
    </Collapsible>
  );
}

const fmtTokens = (n: number) => n.toLocaleString("pt-BR");

/** O que a Edição com IA fez neste vídeo e quanto usou da cota. */
export function ResumoEdicaoIA({ ia }: { ia?: ResumoIA }) {
  if (!ia?.ligada) return null;
  const uso = ia.uso;
  const partes: string[] = [];
  if (ia.aplicada) {
    if (ia.gancho_seg) partes.push(`gancho de ${ia.gancho_seg.toFixed(1)} s`);
    if (ia.cortes) partes.push(`${ia.cortes} corte(s) de repetição/erro (${(ia.segundos_cortados_ia || 0).toFixed(1)} s)`);
    const fora = (ia.comentarios_removidos || 0) + (ia.comentarios_tirados_pela_duracao || 0);
    if (fora) partes.push(`${fora} comentário(s) fora`);
    if (ia.tocando_encurtado_seg) partes.push(`original encurtado em ${ia.tocando_encurtado_seg.toFixed(1)} s`);
    if (ia.zooms) partes.push(`${ia.zooms} zoom(s)`);
  }
  return (
    <div className="space-y-1 rounded-md border p-3 text-xs">
      <p className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="h-4 w-4" /> Edição com IA {ia.aplicada ? "" : "(não aplicada)"}</p>
      {ia.titulo && <p>Título: <b>{ia.titulo}</b></p>}
      {partes.length > 0 && <p className="text-muted-foreground">{partes.join(" · ")}</p>}
      {uso && uso.chamadas > 0 && (
        <p className="text-muted-foreground">
          {uso.fonte === "openrouter"
            ? `OpenRouter: US$ ${uso.custo_usd.toFixed(4)} (${fmtTokens(uso.tokens_entrada)} + ${fmtTokens(uso.tokens_saida)} tokens)`
            : `Cota do Claude: ${fmtTokens(uso.tokens_entrada)} tokens de entrada + ${fmtTokens(uso.tokens_saida)} de saída, ${uso.segundos.toFixed(0)} s, sem custo de API`}
        </p>
      )}
    </div>
  );
}

export function ResultadoReact({ projeto, podePublicar, rodada, onRemontar, onNovo, onEditar }: Props) {
  const [estado, setEstado] = useState<EstadoServico | null>(null);
  const [erroConsulta, setErroConsulta] = useState<string | null>(null);
  const [op, setOp] = useState<OpcoesMontagem>(() => opcoesDoProjeto(projeto));
  const [remontando, setRemontando] = useState(false);
  const [card, setCard] = useState<CardPedido | null>(null);
  const [arquivoPub, setArquivoPub] = useState<File | null>(null);
  const [preparandoPub, setPreparandoPub] = useState(false);
  const gravouStatus = useRef<string | null>(null);
  const [origem, setOrigem] = useState<{ autor?: string | null; url?: string | null }>({ autor: projeto.origem_autor, url: projeto.origem_url });
  const [credito, setCredito] = useState(true);

  // de onde veio o original (link do Instagram): o banco tem se a migration rodou; senão a VPS lembra
  useEffect(() => {
    if (projeto.origem_url) { setOrigem({ autor: projeto.origem_autor, url: projeto.origem_url }); return; }
    let vivo = true;
    void estadoLink(projeto.id).then((e) => { if (vivo && e.estado === "pronto") setOrigem({ autor: e.autor, url: e.url }); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [projeto.id, projeto.origem_url, projeto.origem_autor]);
  const linhaCredito = textoCredito(origem.autor, origem.url);

  // consulta o serviço a cada 2 s até ficar pronto/erro
  useEffect(() => {
    let vivo = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    gravouStatus.current = null;
    const passo = async () => {
      try {
        const e = await estadoMontagem(projeto.id);
        if (!vivo) return;
        setEstado(e);
        setErroConsulta(null);
        if (e.estado === "pronto" || e.estado === "erro") {
          if (gravouStatus.current !== e.estado) {
            gravouStatus.current = e.estado;
            void atualizarProjeto(projeto.id, e.estado === "pronto"
              ? { status: "pronto", erro: null, duracao_final_seg: e.resultado?.duracao_seg ?? null }
              : { status: "erro", erro: (e.erro || "erro na montagem").slice(0, 800) }).catch(() => undefined);
            if (e.estado === "pronto" && e.resultado?.ia) void atualizarColunasIA(projeto.id, { ia_uso: e.resultado.ia });
          }
          return;
        }
        if (e.estado === "novo") return; // nada no servidor (apagado pela faxina ou nunca enviado)
      } catch (err) {
        if (!vivo) return;
        setErroConsulta((err as Error).message);
      }
      t = setTimeout(passo, 2000);
    };
    void passo();
    return () => { vivo = false; if (t) clearTimeout(t); };
  }, [projeto.id, rodada]);

  const remontar = async () => {
    setRemontando(true);
    try {
      setEstado({ estado: "na_fila", progresso: 0, etapa: "na fila" });
      await onRemontar(op);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRemontando(false);
    }
  };

  const abrirPublicar = async () => {
    if (!estado?.arquivo) return;
    setPreparandoPub(true);
    try {
      const f = await baixarFinal(estado.arquivo, projeto.titulo);
      setArquivoPub(f);
      const texto = credito && linhaCredito ? `${projeto.titulo}\n\n${linhaCredito}` : projeto.titulo;
      setCard({ card_ref: `react:${projeto.id}`, perfil: projeto.perfil || "fitness", perfil_nome: "Estúdio React", coluna: "React", texto });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPreparandoPub(false);
    }
  };

  const montando = !estado || estado.estado === "na_fila" || estado.estado === "montando";
  const res = estado?.resultado;

  return (
    <div className="space-y-4">
      {onEditar && estado?.estado !== "novo" && (
        <Button className="h-12 w-full sm:w-auto" variant="secondary" onClick={onEditar}>
          <Scissors className="mr-2 h-4 w-4" /> Editar trechos (layout, pausas e som)
        </Button>
      )}
      {erroConsulta && <p className="text-sm text-destructive">{erroConsulta}</p>}
      {estado?.estado === "novo" && (
        <p className="text-sm text-muted-foreground">Os arquivos deste react não estão mais no servidor (a VPS guarda por 15 dias). Grave de novo.</p>
      )}
      {montando && estado?.estado !== "novo" && (
        <div className="space-y-2 rounded-lg border p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="h-4 w-4 animate-spin" />
            {estado?.estado === "na_fila" ? (estado.fila && estado.fila > 1 ? `Na fila (${estado.fila - 1} antes do seu)` : "Na fila") : (estado?.etapa || "Montando")}
          </div>
          <Progress value={Math.round((estado?.progresso || 0) * 100)} />
          <p className="text-xs text-muted-foreground">A montagem roda na VPS, um react por vez e sem atrapalhar live nem WhatsApp. Pode fechar esta tela: o react fica na lista lá embaixo.</p>
        </div>
      )}
      {estado?.estado === "erro" && (
        <div className="rounded-lg border border-destructive/40 p-4 text-sm">
          <p className="font-medium text-destructive">A montagem falhou</p>
          <p className="text-muted-foreground">{estado.erro}</p>
        </div>
      )}
      {estado?.estado === "pronto" && estado.arquivo && (
        <div className="flex flex-col gap-4 md:flex-row">
          <video src={estado.arquivo} poster={estado.capa} controls playsInline className="w-full max-w-xs rounded-lg bg-black" style={{ aspectRatio: "9 / 16" }} />
          <div className="flex-1 space-y-3 text-sm">
            {res && (
              <p className="text-muted-foreground">
                {formatarTempo(res.duracao_seg)} de vídeo · {formatarTempo(res.segundos_cortados)} de silêncio cortado · {res.comentarios} comentário(s)
                {res.legendas ? ` · ${res.legendas} blocos de legenda` : ""}
              </p>
            )}
            {res?.avisos?.map((a) => <p key={a} className="text-amber-700">{a}</p>)}
            <ResumoEdicaoIA ia={res?.ia} />
            {linhaCredito && (
              <label className="flex items-start gap-2 rounded-md border p-2 text-xs">
                <Checkbox checked={credito} onCheckedChange={(v) => setCredito(v === true)} className="mt-0.5" aria-label="Dar crédito ao autor na legenda" />
                <span><b>Dar crédito ao autor na legenda do post</b><br /><span className="text-muted-foreground">{linhaCredito}</span></span>
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button asChild><a href={estado.baixar} download><Download className="mr-2 h-4 w-4" /> Baixar MP4</a></Button>
              {podePublicar && (
                <Button variant="secondary" onClick={() => void abrirPublicar()} disabled={preparandoPub}>
                  {preparandoPub ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Instagram className="mr-2 h-4 w-4" />}
                  Publicar/Agendar no Instagram
                </Button>
              )}
              <Button variant="outline" onClick={onNovo}>Novo react</Button>
            </div>
          </div>
        </div>
      )}
      {(estado?.estado === "pronto" || estado?.estado === "erro") && (
        <div className="space-y-3 rounded-lg border p-4">
          <Label className="flex items-center gap-2"><Wand2 className="h-4 w-4" /> Montar de novo com outras opções</Label>
          <OpcoesReact op={op} onChange={setOp} desativado={remontando} />
          <Button variant="outline" onClick={() => void remontar()} disabled={remontando}>
            {remontando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Montar de novo
          </Button>
        </div>
      )}
      <PublicarInstagramDialog
        card={card}
        arquivoInicial={arquivoPub}
        tipoInicial="reels"
        onClose={() => { setCard(null); setArquivoPub(null); }}
        onConcluido={() => undefined}
      />
    </div>
  );
}
