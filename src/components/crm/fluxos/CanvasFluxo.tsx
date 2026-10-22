// Canvas do construtor (pegada do Builder do Full Funnel): caixa de gatilhos no topo (vários, com "Ou"),
// linha vertical com "+" entre os passos, Se/Senão abrindo em dois ramos e "FIM" no final.
// Arrastar o fundo move; Ctrl/⌘ + roda (ou os botões) dá zoom. Layout vertical próprio (sem biblioteca).
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, Ban, Bot, Clock, Hand, Columns3, GitBranch, Maximize, MessageCircle, Minus, Plus, Tag, Trash2,
  Sparkles, UserCheck, Webhook, Workflow, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  resumoGatilho,
  type CaminhoLista,
  type CatalogoConstrutor,
  type GatilhoFluxo,
  type NoFluxo,
  type PassoArvore,
} from "@/lib/crm/fluxosConstrutor";
import { NOMES_ETAPAS } from "@/components/crm/automacoes/useCatalogo";
import { useEtapas } from "@/hooks/useEtapas";

export const TIPOS_PASSO: { tipo: PassoArvore["tipo"]; rotulo: string; icone: typeof Clock; grupo: string }[] = [
  { tipo: "whatsapp", rotulo: "Enviar WhatsApp", icone: MessageCircle, grupo: "Comunicação" },
  { tipo: "ia_followup", rotulo: "Mensagem da IA (follow-up)", icone: Sparkles, grupo: "Comunicação" },
  { tipo: "esperar", rotulo: "Esperar", icone: Clock, grupo: "Controle" },
  { tipo: "se", rotulo: "Condição Se/Senão", icone: GitBranch, grupo: "Controle" },
  { tipo: "ir_fluxo", rotulo: "Ir para outro fluxo", icone: Workflow, grupo: "Controle" },
  { tipo: "parar", rotulo: "Parar", icone: Ban, grupo: "Controle" },
  { tipo: "tag", rotulo: "Adicionar/remover tag", icone: Tag, grupo: "Contato" },
  { tipo: "etapa", rotulo: "Mudar etapa", icone: Columns3, grupo: "Contato" },
  { tipo: "atribuir", rotulo: "Atribuir atendente", icone: UserCheck, grupo: "Contato" },
  { tipo: "transferir_ia", rotulo: "Transferir para agente IA", icone: Bot, grupo: "Contato" },
  { tipo: "agente_ia", rotulo: "Ligar/pausar agente de IA", icone: Bot, grupo: "Contato" },
  { tipo: "transferir_humano", rotulo: "Transferir para humano", icone: Hand, grupo: "Contato" },
  { tipo: "webhook", rotulo: "Webhook", icone: Webhook, grupo: "Integração" },
];

export const infoTipo = (t: PassoArvore["tipo"]) =>
  TIPOS_PASSO.find((x) => x.tipo === t) ?? { tipo: t, rotulo: "Condição (antiga)", icone: GitBranch, grupo: "Controle" };

export function resumoNo(p: PassoArvore, cat: CatalogoConstrutor | null): string {
  switch (p.tipo) {
    case "whatsapp": {
      const num = cat?.numeros.find((n) => n.id === p.numero_id);
      const via = num ? `${num.apelido}${num.tipo === "oficial" ? " (oficial)" : ""}` : "número padrão";
      if (p.template) return `Template ${p.template} · ${via}`;
      if (p.roteiro_id) return `Roteiro ${cat?.roteiros.find((r) => r.id === p.roteiro_id)?.nome ?? ""} · ${via}`;
      if (p.passo_id) return `Um passo de roteiro · ${via}`;
      if (p.midia_url) return `${p.midia_tipo === "audio" ? "Áudio" : p.midia_tipo === "image" ? "Imagem" : "Documento"}${p.texto ? ` + texto` : ""} · ${via}`;
      return p.texto ? `"${p.texto.slice(0, 48)}${p.texto.length > 48 ? "…" : ""}" · ${via}` : "Escolha o número e a mensagem";
    }
    case "ia_followup": {
      const ag = cat?.agentes.find((a) => a.id === p.agente_id)?.nome;
      const num = cat?.numeros.find((n) => n.id === p.numero_id);
      const via = num ? num.apelido : "número do fluxo";
      if (!p.agente_id) return "Escolha o agente de follow-up";
      const detalhe = p.instrucao ? `${p.instrucao.slice(0, 40)}${p.instrucao.length > 40 ? "…" : ""}` : p.tentativa ? `${p.tentativa}ª tentativa` : "";
      return `${ag ?? "agente"}${detalhe ? ` · ${detalhe}` : ""} · ${via}`;
    }
    case "esperar": return `${p.quantidade} ${Number(p.quantidade) === 1 ? p.unidade.replace(/s$/, "") : p.unidade}${p.ate_responder ? " ou até responder" : ""}`;
    case "se": {
      const c = p.condicao;
      return c.tipo === "respondeu" ? "Respondeu?" : c.tipo === "ia_transferiu" ? "A IA transferiu para humano?" : c.tipo === "tem_tag" ? `Tem a tag ${c.valor}?` : c.tipo === "etapa" ? `Está em ${NOMES_ETAPAS[c.valor] ?? c.valor}?`
        : `${c.campo} ${c.operador === "existe" ? "preenchido" : `${c.operador === "igual" ? "=" : "contém"} "${c.valor ?? ""}"`}?`;
    }
    case "tag": return `${p.acao === "por" ? "Adicionar" : "Remover"} "${p.tag}"`;
    case "etapa": return `Mover para ${NOMES_ETAPAS[p.etapa] ?? p.etapa}`;
    case "atribuir": return p.atendente || "Escolha o atendente";
    case "agente_ia": return p.acao === "ligar" ? `Ligar ${cat?.agentes.find((a) => a.slug === p.agente)?.nome ?? p.agente ?? ""}` : "Pausar o agente";
    case "transferir_ia": return p.agente ? `${cat?.agentes.find((a) => a.slug === p.agente)?.nome ?? p.agente}${p.mesmo_com_humano ? " · mesmo com humano" : ""}` : "Escolha o agente de IA";
    case "transferir_humano": return [p.para ? `Para ${p.para}` : "Fila geral", p.tag ? `tag ${p.tag}` : "", p.etapa ? `→ ${NOMES_ETAPAS[p.etapa] ?? p.etapa}` : "", p.sem_mensagem || !p.despedida ? "sem despedida" : `"${p.despedida.slice(0, 30)}${p.despedida.length > 30 ? "…" : ""}"`].filter(Boolean).join(" · ");
    case "webhook": return p.url || "Informe a URL";
    case "ir_fluxo": return cat?.fluxos.find((f) => f.id === p.fluxo_id)?.nome ?? "Escolha o fluxo";
    case "parar": return "Encerra o fluxo para o contato";
    case "condicao": return "Desvio por número de passo (refaça como Se/Senão)";
  }
}

interface Props {
  gatilhos: GatilhoFluxo[];
  arvore: NoFluxo[];
  catalogo: CatalogoConstrutor | null;
  erros: Record<string, string[]>;
  destaque?: Set<string>;
  canvas: { zoom?: number; x?: number; y?: number };
  onCanvas: (c: { zoom: number; x: number; y: number }) => void;
  onAbrirGatilho: (i: number | null) => void;
  onAbrirNo: (id: string) => void;
  onInserir: (caminho: CaminhoLista, pos: number, tipo: PassoArvore["tipo"]) => void;
  onRemover: (id: string) => void;
  somenteLeitura?: boolean;
}

export function CanvasFluxo(props: Props) {
  useEtapas(); // re-renderiza com os nomes de crm_etapas (NOMES_ETAPAS nos resumos)
  const { canvas, onCanvas } = props;
  const [vista, setVista] = useState({ zoom: canvas.zoom ?? 1, x: canvas.x ?? 0, y: canvas.y ?? 0 });
  const arrasto = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => onCanvas(vista), 800);
    return () => window.clearTimeout(t);
  }, [vista]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = (d: number) => setVista((v) => ({ ...v, zoom: Math.min(2, Math.max(0.3, Math.round((v.zoom + d) * 10) / 10)) }));

  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const roda = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY > 0 ? -0.1 : 0.1); }
      else { e.preventDefault(); setVista((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })); }
    };
    el.addEventListener("wheel", roda, { passive: false });
    return () => el.removeEventListener("wheel", roda);
  }, []);

  return (
    <div
      ref={caixa}
      className="relative overflow-hidden rounded-md border bg-muted/30 select-none"
      style={{ height: "calc(100vh - 190px)", minHeight: 480, backgroundImage: "radial-gradient(hsl(var(--muted-foreground) / 0.25) 1px, transparent 1px)", backgroundSize: `${20 * vista.zoom}px ${20 * vista.zoom}px`, backgroundPosition: `${vista.x}px ${vista.y}px` }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("[data-no-arrasto]")) return;
        arrasto.current = { x: e.clientX, y: e.clientY, vx: vista.x, vy: vista.y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const a = arrasto.current;
        if (a) setVista((v) => ({ ...v, x: a.vx + e.clientX - a.x, y: a.vy + e.clientY - a.y }));
      }}
      onPointerUp={() => { arrasto.current = null; }}
      aria-label="Canvas do fluxo"
    >
      <div className="absolute inset-x-0 top-6 flex justify-center" style={{ transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.zoom})`, transformOrigin: "top center", cursor: arrasto.current ? "grabbing" : "grab" }}>
        <div className="flex flex-col items-center pb-24">
          <CaixaGatilhos {...props} />
          <ListaNos nos={props.arvore} caminho={[]} p={props} />
          <div className="rounded-full border bg-background px-4 py-1 text-xs font-semibold tracking-wider text-muted-foreground shadow-sm">FIM</div>
        </div>
      </div>

      <div data-no-arrasto className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md border bg-background p-1 shadow-sm">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => zoom(-0.1)} aria-label="Diminuir zoom"><Minus className="h-4 w-4" /></Button>
        <span className="w-11 text-center text-xs tabular-nums">{Math.round(vista.zoom * 100)}%</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => zoom(0.1)} aria-label="Aumentar zoom"><Plus className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setVista({ zoom: 1, x: 0, y: 0 })} aria-label="Centralizar"><Maximize className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

function CaixaGatilhos({ gatilhos, catalogo, onAbrirGatilho, somenteLeitura }: Props) {
  return (
    <div data-no-arrasto className="w-80 rounded-lg border-2 border-dashed border-primary/40 bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary"><Zap className="h-3.5 w-3.5" /> Gatilhos</div>
      <div className="space-y-1.5">
        {gatilhos.map((g, i) => (
          <div key={i}>
            {i > 0 && <div className="py-0.5 text-center text-[11px] font-semibold text-muted-foreground">Ou</div>}
            <button onClick={() => onAbrirGatilho(i)} className="w-full rounded-md border bg-muted/40 px-2.5 py-1.5 text-left text-sm hover:border-primary">
              <span className="block text-[11px] text-muted-foreground">{({ tag: "Tag adicionada", etapa: "Entrou na etapa", evento: "Formulário / evento", segmento: "Segmento / base", sem_resposta: "Sem resposta", data: "Data / agenda", banco: "Novo lead no banco", webhook: "Webhook / API" } as Record<GatilhoFluxo["tipo"], string>)[g.tipo]}</span>
              {resumoGatilho(g, catalogo ?? undefined, NOMES_ETAPAS)}
            </button>
          </div>
        ))}
      </div>
      {!somenteLeitura && (
        <Button variant="outline" size="sm" className="mt-2 h-8 w-full border-dashed" onClick={() => onAbrirGatilho(null)}>
          <Plus className="h-4 w-4" /><span className="ml-1">Adicionar gatilho</span>
        </Button>
      )}
    </div>
  );
}

function Conector({ caminho, pos, p, curto }: { caminho: CaminhoLista; pos: number; p: Props; curto?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const grupos = [...new Set(TIPOS_PASSO.map((t) => t.grupo))];
  return (
    <div className="flex flex-col items-center">
      <div className={`w-px bg-border ${curto ? "h-3" : "h-5"}`} />
      {!p.somenteLeitura && (
        <Popover open={aberto} onOpenChange={setAberto}>
          <PopoverTrigger asChild>
            <button data-no-arrasto aria-label="Adicionar passo" className="flex h-6 w-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:border-primary hover:text-primary">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent data-no-arrasto className="w-64 p-1.5" align="center">
            {grupos.map((g) => (
              <div key={g} className="mb-1">
                <div className="px-2 py-1 text-[11px] font-semibold uppercase text-muted-foreground">{g}</div>
                {TIPOS_PASSO.filter((t) => t.grupo === g).map((t) => (
                  <button key={t.tipo} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => { setAberto(false); p.onInserir(caminho, pos, t.tipo); }}>
                    <t.icone className="h-4 w-4 text-primary" />{t.rotulo}
                  </button>
                ))}
              </div>
            ))}
          </PopoverContent>
        </Popover>
      )}
      <div className={`w-px bg-border ${curto ? "h-3" : "h-5"}`} />
    </div>
  );
}

function CartaoNo({ n, p, children }: { n: NoFluxo; p: Props; children?: ReactNode }) {
  const info = infoTipo(n.passo.tipo);
  const erros = p.erros[n.id];
  const Icone = info.icone;
  return (
    <div data-no-arrasto className={`group relative w-72 rounded-lg border bg-card shadow-sm transition-colors ${erros ? "border-destructive/70" : "hover:border-primary"} ${p.destaque?.has(n.id) ? "ring-2 ring-emerald-500" : ""}`}>
      <button className="flex w-full items-start gap-2.5 p-3 text-left" onClick={() => p.onAbrirNo(n.id)}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Icone className="h-4 w-4" /></span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{info.rotulo}</span>
          <span className="block truncate text-xs text-muted-foreground">{resumoNo(n.passo, p.catalogo)}</span>
          {erros && <span className="mt-1 flex items-center gap-1 text-[11px] text-destructive"><AlertTriangle className="h-3 w-3" />{erros[0]}</span>}
        </span>
      </button>
      {!p.somenteLeitura && (
        <button aria-label={`Remover ${info.rotulo}`} onClick={() => p.onRemover(n.id)}
          className="absolute right-1.5 top-1.5 hidden rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive group-hover:block">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      {children}
    </div>
  );
}

function ListaNos({ nos, caminho, p }: { nos: NoFluxo[]; caminho: CaminhoLista; p: Props }) {
  return (
    <div className="flex flex-col items-center">
      <Conector caminho={caminho} pos={0} p={p} />
      {nos.map((n, i) => (
        <div key={n.id} className="flex flex-col items-center">
          {n.passo.tipo === "se" ? <BlocoSe n={n} caminho={caminho} p={p} /> : <CartaoNo n={n} p={p} />}
          {n.passo.tipo !== "parar" || i < nos.length - 1 ? <Conector caminho={caminho} pos={i + 1} p={p} /> : <div className="h-4" />}
        </div>
      ))}
    </div>
  );
}

function BlocoSe({ n, caminho, p }: { n: NoFluxo; caminho: CaminhoLista; p: Props }) {
  if (n.passo.tipo !== "se") return null;
  const ramo = (r: "sim" | "nao") => {
    const lista = (n.passo as { sim: NoFluxo[]; nao: NoFluxo[] })[r];
    return (
      <div className="relative flex flex-col items-center px-5">
        <div className={`absolute top-0 h-px bg-border ${r === "sim" ? "left-1/2 right-0" : "left-0 right-1/2"}`} />
        <div className="h-4 w-px bg-border" />
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${r === "sim" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"}`}>
          {r === "sim" ? "Sim" : "Senão"}
        </span>
        <ListaNos nos={lista} caminho={[...caminho, { id: n.id, ramo: r }]} p={p} />
        <div className="w-px flex-1 bg-border" />
        <div className={`absolute bottom-0 h-px bg-border ${r === "sim" ? "left-1/2 right-0" : "left-0 right-1/2"}`} />
      </div>
    );
  };
  return (
    <div className="flex flex-col items-center">
      <CartaoNo n={n} p={p} />
      <div className="h-4 w-px bg-border" />
      <div className="flex items-stretch">
        {ramo("sim")}
        {ramo("nao")}
      </div>
    </div>
  );
}
