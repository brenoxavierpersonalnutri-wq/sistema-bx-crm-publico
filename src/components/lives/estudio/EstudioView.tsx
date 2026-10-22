// Layout do estúdio (sem dados próprios), no desenho de estúdio de transmissão no navegador:
// cabeçalho branco (marca, título, destinos em avatares, Gravar e "Ir ao vivo" à direita), palco 16:9 central,
// miniaturas de layout logo abaixo, fila de participantes (bastidores), barra inferior com botões rotulados,
// e à direita a coluna de ícones com o conteúdo da aba ao lado dela (gaveta no celular).
// Quem fornece os dados é a página (LiveKit de verdade) ou a rota de demonstração em dev.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, CalendarClock, Circle, Clapperboard, ExternalLink, Film, Info, Megaphone, MessageSquare, MessagesSquare, Moon, Palette,
  PanelRight, Radio, Rows3, Square, Sun, Users, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BarraLayouts, type OpcaoLayout } from "@/components/lives/estudio/BarraLayouts";
import { FilaBastidores, type PessoaFila } from "@/components/lives/estudio/FilaBastidores";
import { ControlesPalco } from "@/components/lives/estudio/ControlesPalco";
import { BarraControles } from "@/components/lives/estudio/BarraControles";
import type { ControleAparelhos } from "@/components/lives/estudio/MenuAparelhos";
import { PainelMarca } from "@/components/lives/estudio/PainelMarca";
import { PainelTextos } from "@/components/lives/estudio/PainelTextos";
import { PainelComentarios, type Comentario } from "@/components/lives/estudio/PainelComentarios";
import { PainelChat } from "@/components/lives/estudio/PainelChat";
import { PainelGravacoes } from "@/components/lives/estudio/PainelGravacoes";
import { PainelDestinos } from "@/components/lives/estudio/PainelDestinos";
import { PainelConvites, type Convite } from "@/components/lives/estudio/PainelConvites";
import { PainelVideoAula } from "@/components/lives/estudio/PainelVideoAula";
import { PainelProgramacao } from "@/components/lives/estudio/PainelProgramacao";
import { PilhaDestinos } from "@/components/lives/painel/IconeDestino";
import type { LiveDestino, LiveOverlay } from "@/lib/lives/api";
import type { LayoutLive, TemaFaixa } from "@/lib/lives/layout";
import { formatarDuracao, type LiveRoomExtra } from "@/lib/lives/painel";
import { textoUltimoErro } from "@/lib/lives/sessoes";
import { cn } from "@/lib/utils";
import { useTemaLives } from "@/components/lives/estudio/temaEscuro";
import { Marca } from "@/components/lives/tema/Marca";

export type AbaEstudio = "marca" | "comentarios" | "banners" | "faixas" | "chat" | "gravacoes" | "destinos" | "convidados" | "aula" | "programacao";

const ABAS: { key: AbaEstudio; label: string; Icone: typeof Palette }[] = [
  { key: "comentarios", label: "Comentários", Icone: MessageSquare },
  { key: "banners", label: "Banners", Icone: Megaphone },
  { key: "marca", label: "Marca", Icone: Palette },
  { key: "faixas", label: "Faixas", Icone: Rows3 },
  { key: "chat", label: "Chat privado", Icone: MessagesSquare },
  { key: "gravacoes", label: "Gravações", Icone: Film },
  { key: "destinos", label: "Destinos", Icone: Radio },
  { key: "aula", label: "Vídeo da aula", Icone: Clapperboard },
  { key: "programacao", label: "Programação", Icone: CalendarClock },
  { key: "convidados", label: "Convidados", Icone: Users },
];

function Cronometro({ desde }: { desde: string | null }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!desde) return null;
  return <span className="tabular-nums">{formatarDuracao((agora - new Date(desde).getTime()) / 1000)}</span>;
}

export interface EstudioViewProps {
  sala: LiveRoomExtra;
  destinos: LiveDestino[];
  overlays: LiveOverlay[];
  convites: Convite[];
  comentarios: Comentario[];
  palco: ReactNode;
  pessoas: PessoaFila[];
  onAlternarPalco: (identity: string, subir: boolean) => void;
  onRemover?: (identity: string) => void;
  /** põe a pessoa em destaque no palco (1ª da ordem) */
  onDestacar?: (identity: string) => void;
  /** inverte os dois primeiros do palco (layout 2 lado a lado) */
  onInverter?: () => void;
  ocupadoPessoa?: string | null;
  midia: { mic: boolean; cam: boolean; tela: boolean; onMic: () => void; onCam: () => void; onTela: () => void; aparelhos?: ControleAparelhos };
  onConvidar: () => void;
  onConfig: () => void;
  onSair: () => void;
  ocupado: boolean;
  onIrAoVivo: () => void;
  onEncerrar: () => void;
  onGravar: () => void;
  onLayout: (l: LayoutLive) => void;
  onLayoutPendente?: (o: OpcaoLayout) => void;
  /** some com o "Último erro" (limpa live_rooms.ultimo_erro) */
  onDispensarErro?: () => void;
  conectado: boolean;
  aviso?: string | null;
  modo?: "live" | "gravacao";
  renderUrl?: string | null;
  recarregar: () => void;
  abaInicial?: AbaEstudio;
  demo?: boolean;
}

export function EstudioView(p: EstudioViewProps) {
  const { escuro, trocar } = useTemaLives();
  const [aba, setAba] = useState<AbaEstudio>(p.abaInicial ?? "banners");
  const [painelAberto, setPainelAberto] = useState(true);
  const [gaveta, setGaveta] = useState(false);
  const [tema, setTema] = useState<TemaFaixa>(
    (p.overlays.find((o) => o.tipo === "lower_third")?.conteudo as { tema?: TemaFaixa } | undefined)?.tema ?? "bloco",
  );
  const aoVivo = p.sala.status === "ao_vivo";
  const gravando = !!p.sala.gravacao_egress_id;
  const destinosAtivos = p.destinos.filter((d) => d.ativo);
  const tiposAtivos = destinosAtivos.map((d) => d.tipo);
  if (p.sala.cf_live_input_uid && !tiposAtivos.includes("cloudflare")) tiposAtivos.push("cloudflare");
  const gravacao = p.modo === "gravacao";

  const conteudoAba = (a: AbaEstudio) => {
    switch (a) {
      case "marca":
        return <PainelMarca sala={p.sala} overlays={p.overlays} tema={tema} onTema={setTema} recarregar={p.recarregar} demo={p.demo} />;
      case "comentarios":
        return <PainelComentarios roomId={p.sala.id} comentarios={p.comentarios} overlays={p.overlays} recarregar={p.recarregar} demo={p.demo} />;
      case "banners":
        return <PainelTextos roomId={p.sala.id} tipo="banner" overlays={p.overlays} recarregar={p.recarregar} demo={p.demo} />;
      case "faixas":
        return <PainelTextos roomId={p.sala.id} tipo="lower_third" overlays={p.overlays} temaPadrao={tema} recarregar={p.recarregar} demo={p.demo} />;
      case "chat":
        return <PainelChat conectado={p.conectado} />;
      case "gravacoes":
        return <PainelGravacoes sala={p.sala} />;
      case "destinos":
        return <PainelDestinos sala={p.sala} destinos={p.destinos} recarregar={p.recarregar} />;
      case "convidados":
        return <PainelConvites roomId={p.sala.id} convites={p.convites} recarregar={p.recarregar} />;
      case "aula":
        return <PainelVideoAula sala={p.sala} pessoas={p.pessoas} onAlternarPalco={p.onAlternarPalco} recarregar={p.recarregar} demo={p.demo} />;
      case "programacao":
        return <PainelProgramacao sala={p.sala} destinos={p.destinos} recarregar={p.recarregar} demo={p.demo} />;
    }
  };
  const rotulo = ABAS.find((x) => x.key === aba)?.label;

  const abrirAba = (k: AbaEstudio) => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setAba(k);
      setGaveta(true);
      return;
    }
    if (aba === k && painelAberto) setPainelAberto(false);
    else {
      setAba(k);
      setPainelAberto(true);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-dvh flex-col bg-[hsl(var(--sy-palco-fundo))] text-foreground">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:gap-3 sm:px-4">
          <Link to="/lives" aria-label="Voltar ao painel" className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5 sm:hidden" />
            <Marca compacta className="hidden sm:inline-flex" />
          </Link>
          <div className="hidden h-6 w-px bg-border sm:block" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-medium sm:text-[15px]">{p.sala.titulo}</h1>
          </div>
          {aoVivo && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded bg-[hsl(var(--sy-ao-vivo))] px-2 py-1 text-xs font-semibold text-white">
              AO VIVO <span className="hidden sm:inline"><Cronometro desde={p.sala.iniciada_em} /></span>
            </span>
          )}
          {!aoVivo && <span className="hidden text-xs text-muted-foreground md:inline">{gravacao ? "Gravação" : p.sala.status === "encerrada" ? "Encerrada" : "Fora do ar"}</span>}
          {gravando && <span className="hidden items-center gap-1 text-xs sm:inline-flex font-medium text-[hsl(var(--sy-ao-vivo))]"><Circle className="h-2.5 w-2.5 fill-current" />REC</span>}
          {!gravacao && (
            <button type="button" className="hidden rounded-full p-0.5 hover:bg-secondary sm:block" onClick={() => abrirAba("destinos")} aria-label="Destinos">
              <PilhaDestinos tipos={tiposAtivos} />
            </button>
          )}
          {p.renderUrl && (
            <Button size="sm" variant="ghost" className="hidden md:inline-flex" asChild>
              <a href={p.renderUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-1" />Saída</a>
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" className="hidden h-9 w-9 sm:inline-flex" aria-label={escuro ? "Usar tema claro" : "Usar tema escuro"} onClick={() => trocar(escuro ? "claro" : "escuro")}>
                {escuro ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{escuro ? "Tema claro" : "Tema escuro"}</TooltipContent>
          </Tooltip>
          <Button variant="outline" className="h-9 px-3" disabled={p.ocupado} onClick={p.onGravar}>
            <Circle className={cn("h-4 w-4 sm:mr-1.5", gravando ? "fill-[hsl(var(--sy-ao-vivo))] text-[hsl(var(--sy-ao-vivo))]" : "text-[hsl(var(--sy-ao-vivo))]")} />
            <span className="hidden sm:inline">{gravando ? "Parar gravação" : "Gravar"}</span>
          </Button>
          {!gravacao && (aoVivo ? (
            <Button aria-label="Encerrar" className="h-9 bg-[hsl(var(--sy-ao-vivo))] px-3 font-medium sm:px-4 text-white hover:bg-[hsl(var(--sy-ao-vivo)/0.9)]" disabled={p.ocupado} onClick={p.onEncerrar}>
              <Square className="h-4 w-4 fill-current sm:mr-1.5" /><span className="hidden sm:inline">Encerrar</span>
            </Button>
          ) : (
            <Button className="h-9 px-4 font-medium" disabled={p.ocupado} onClick={p.onIrAoVivo}>
              <Radio className="mr-1.5 h-4 w-4" />Ir ao vivo
            </Button>
          ))}
          <Button size="icon" variant="ghost" className="lg:hidden" aria-label="Abrir painel" onClick={() => setGaveta(true)}><PanelRight className="h-5 w-5" /></Button>
        </header>

        {(p.aviso || p.sala.ultimo_erro) && (
          <div className="shrink-0">
            {p.aviso && <div className="flex items-start gap-2 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{p.aviso}</div>}
            {p.sala.ultimo_erro && (
              <div className="flex items-start gap-2 border-b border-red-300/60 bg-red-50 px-4 py-2 text-xs text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">{textoUltimoErro(p.sala.ultimo_erro) === p.sala.ultimo_erro ? `Último erro: ${p.sala.ultimo_erro}` : textoUltimoErro(p.sala.ultimo_erro)}</span>
                {p.onDispensarErro && (
                  <button type="button" aria-label="Dispensar erro" className="rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-500/20" onClick={p.onDispensarErro}><X className="h-3.5 w-3.5" /></button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
            {/* o palco ocupa o maior 16:9 que cabe no espaço livre (container query no tamanho) */}
            <div className="aspect-video shrink-0 px-3 pt-4 sm:px-8 lg:aspect-auto lg:min-h-0 lg:flex-1 lg:pt-6" style={{ containerType: "size" }}>
              <div className="mx-auto overflow-hidden rounded-md shadow-[0_1px_3px_rgba(16,24,40,0.12),0_0_0_1px_hsl(var(--border))]" style={{ width: "min(100cqw, calc(100cqh * 16 / 9))" }}>{p.palco}</div>
            </div>
            <div className="shrink-0 px-3 pb-1 pt-3 sm:px-8"><BarraLayouts valor={p.sala.layout} onEscolher={p.onLayout} onPendente={p.onLayoutPendente} /></div>
            <div className="shrink-0 px-3 pt-1 sm:px-8">
              <ControlesPalco layout={p.sala.layout} pessoas={p.pessoas} onDestacar={p.onDestacar} onInverter={p.onInverter} ocupado={!!p.ocupadoPessoa} />
            </div>
            <div className="shrink-0 px-3 py-2 sm:px-8">
              <FilaBastidores pessoas={p.pessoas} onAlternar={p.onAlternarPalco} onRemover={p.onRemover} onDestacar={p.onDestacar} ocupado={p.ocupadoPessoa} />
            </div>
            <div className="flex shrink-0 justify-center px-3 pb-4 pt-1">
              <BarraControles {...p.midia} onConvidar={p.onConvidar} onConfig={p.onConfig} onSair={p.onSair} />
            </div>
          </main>

          <aside className="hidden shrink-0 border-l bg-background lg:flex">
            {painelAberto && (
              <div className="flex w-[340px] min-w-0 flex-col border-r xl:w-[360px]">
                <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
                  <h2 className="text-[15px] font-medium">{rotulo}</h2>
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Fechar painel" onClick={() => setPainelAberto(false)}><X className="h-4 w-4" /></Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">{conteudoAba(aba)}</div>
              </div>
            )}
            <nav aria-label="Painéis do estúdio" className="flex w-[84px] shrink-0 flex-col items-stretch gap-0.5 overflow-y-auto px-1.5 py-2">
              {ABAS.map(({ key, label, Icone }) => {
                const ativa = painelAberto && aba === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={label}
                    aria-current={ativa ? "page" : undefined}
                    onClick={() => abrirAba(key)}
                    className={cn(
                      "flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-[11px] leading-tight transition-colors",
                      ativa ? "bg-accent text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <Icone className="h-[22px] w-[22px]" strokeWidth={1.75} />
                    <span className="w-full text-center">{label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>

        <Sheet open={gaveta} onOpenChange={setGaveta}>
          <SheetContent side="right" className="flex w-full flex-col bg-background p-0 text-foreground sm:max-w-md">
            <SheetHeader className="border-b px-4 py-3"><SheetTitle className="text-[15px] font-medium">{rotulo}</SheetTitle></SheetHeader>
            <div className="flex gap-1 overflow-x-auto border-b px-2 py-2">
              {ABAS.map(({ key, label, Icone }) => (
                <button key={key} type="button" aria-label={label} onClick={() => setAba(key)} className={cn("flex shrink-0 flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-[10px]", aba === key ? "bg-accent text-primary" : "text-muted-foreground")}>
                  <Icone className="h-5 w-5" strokeWidth={1.75} />{label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-4">{conteudoAba(aba)}</div>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}
