// Nota de voz igual ao WhatsApp: microfone na barra de digitação.
// - Clique: começa a gravar e fica gravando (lixeira, tempo, onda, parar-e-ouvir, enviar).
// - Segurar: grava enquanto o botão está apertado; soltar envia; arrastar para a esquerda cancela.
// - Parar abre a prévia (ouvir antes de mandar), com lixeira e enviar.
// O áudio sai em Ogg/Opus (gravadorVoz.ts) e vai como nota de voz (ptt) pelo onEnviar.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as PointerEventReact } from "react";
import { Loader2, Mic, SendHorizontal, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatarTempoGravacao, iniciarGravacaoOpus, mensagemErroMicrofone, nomeNotaDeVoz,
  type IniciarGravacao, type SessaoGravacao,
} from "@/lib/crm/gravadorVoz";

/** Segurar por mais que isso e soltar = enviar (abaixo disso foi um clique: fica gravando). */
export const SEGURAR_MS = 450;
/** Arrastar o dedo/mouse para a esquerda além disso, segurando, cancela. */
export const DESLIZAR_CANCELA_PX = 90;
/** Teto de uma nota (o WhatsApp aceita até 16 MB; 15 min a 32 kbps dá ~3,6 MB). */
export const MAX_GRAVACAO_MS = 15 * 60 * 1000;
const BARRAS = 32;
/** Clique logo depois de começar = o soltar do próprio clique que iniciou (ver cliqueFantasma). */
export const CLIQUE_FANTASMA_MS = 600;

type Estado = "parado" | "pedindo" | "gravando" | "previa" | "enviando";

interface Props {
  desabilitado?: boolean;
  /** Outro envio em andamento: não deixa começar a gravar. */
  ocupado?: boolean;
  /** Manda a nota (Ogg/Opus). true = saiu; false = falhou (a nota fica na prévia para tentar de novo). */
  onEnviar: (arquivo: File) => Promise<boolean>;
  onAviso?: (msg: string) => void;
  /** Avisado quando a gravação/prévia ocupa a barra (a barra esconde o campo de texto). */
  onAtivoChange?: (ativo: boolean) => void;
  /** Injetável nos testes. */
  iniciar?: IniciarGravacao;
}

export function GravadorVoz({ desabilitado, ocupado, onEnviar, onAviso, onAtivoChange, iniciar = iniciarGravacaoOpus }: Props) {
  const [estado, setEstado] = useState<Estado>("parado");
  const [ms, setMs] = useState(0);
  const [niveis, setNiveis] = useState<number[]>([]);
  const [previa, setPrevia] = useState<{ arquivo: File; url: string | null } | null>(null);
  const [arrasto, setArrasto] = useState(0);
  const [segurando, setSegurando] = useState(false);

  const sessao = useRef<SessaoGravacao | null>(null);
  const inicio = useRef(0);
  const montado = useRef(true);
  const estadoRef = useRef<Estado>("parado");
  const gesto = useRef<{ x: number; t: number; ativo: boolean } | null>(null);

  const mudar = useCallback((e: Estado) => {
    estadoRef.current = e;
    setEstado(e);
  }, []);

  useEffect(() => {
    onAtivoChange?.(estado !== "parado" && estado !== "pedindo");
  }, [estado, onAtivoChange]);

  // desmontou no meio (troca de conversa): solta o microfone
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      sessao.current?.cancelar();
      sessao.current = null;
    };
  }, []);

  useEffect(() => () => { if (previa?.url) URL.revokeObjectURL(previa.url); }, [previa]);

  const zerar = useCallback(() => {
    sessao.current = null;
    gesto.current = null;
    setMs(0);
    setNiveis([]);
    setArrasto(0);
    setSegurando(false);
    setPrevia(null);
    mudar("parado");
  }, [mudar]);

  const cancelar = useCallback(() => {
    sessao.current?.cancelar();
    zerar();
  }, [zerar]);

  const pararParaArquivo = useCallback(async (): Promise<File | null> => {
    const s = sessao.current;
    if (!s) return null;
    sessao.current = null;
    try {
      const blob = await s.parar();
      if (!blob.size) throw new Error("vazio");
      return new File([blob], nomeNotaDeVoz(), { type: "audio/ogg" });
    } catch {
      onAviso?.("A gravação falhou. Tente de novo.");
      return null;
    }
  }, [onAviso]);

  const mostrarPrevia = useCallback((arquivo: File) => {
    const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(arquivo) : null;
    setPrevia({ arquivo, url });
    mudar("previa");
  }, [mudar]);

  const enviarArquivo = useCallback(async (arquivo: File) => {
    mudar("enviando");
    let ok = false;
    try { ok = await onEnviar(arquivo); } catch { ok = false; }
    if (!montado.current) return;
    if (ok) zerar();
    else mostrarPrevia(arquivo); // falhou: a nota fica para tentar de novo
  }, [mudar, onEnviar, zerar, mostrarPrevia]);

  const pararEOuvir = useCallback(async () => {
    if (estadoRef.current !== "gravando") return;
    mudar("enviando"); // trava os botões enquanto o encoder fecha o arquivo
    const arq = await pararParaArquivo();
    if (!montado.current) return;
    if (arq) mostrarPrevia(arq);
    else zerar();
  }, [mudar, pararParaArquivo, mostrarPrevia, zerar]);

  const pararEEnviar = useCallback(async () => {
    if (estadoRef.current === "previa" && previa) return enviarArquivo(previa.arquivo);
    if (estadoRef.current !== "gravando") return;
    mudar("enviando");
    const arq = await pararParaArquivo();
    if (!montado.current) return;
    if (arq) await enviarArquivo(arq);
    else zerar();
  }, [previa, enviarArquivo, mudar, pararParaArquivo, zerar]);

  const comecar = useCallback(async () => {
    if (estadoRef.current !== "parado" || desabilitado || ocupado) return;
    mudar("pedindo");
    try {
      const s = await iniciar();
      if (!montado.current || (estadoRef.current as Estado) !== "pedindo") { s.cancelar(); return; }
      sessao.current = s;
      inicio.current = Date.now();
      setMs(0);
      setNiveis([]);
      mudar("gravando");
    } catch (e) {
      if (!montado.current) return;
      gesto.current = null;
      setSegurando(false);
      mudar("parado");
      onAviso?.(mensagemErroMicrofone(e));
    }
  }, [desabilitado, ocupado, iniciar, mudar, onAviso]);

  // relógio + onda
  useEffect(() => {
    if (estado !== "gravando") return;
    const id = window.setInterval(() => {
      const passou = Date.now() - inicio.current;
      setMs(passou);
      const n = sessao.current?.nivel() ?? 0;
      setNiveis((xs) => [...xs.slice(-(BARRAS - 1)), n]);
      if (passou >= MAX_GRAVACAO_MS) {
        onAviso?.("Chegou a 15 minutos: a gravação parou. Ouça e envie.");
        void pararEOuvir();
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [estado, onAviso, pararEOuvir]);

  // Gesto de segurar/deslizar: escuta na janela (o botão do microfone some quando a barra muda).
  useEffect(() => {
    if (!segurando) return;
    const mover = (ev: PointerEvent) => {
      const g = gesto.current;
      if (!g) return;
      const dx = Math.min(0, ev.clientX - g.x);
      setArrasto(dx);
      if (-dx >= DESLIZAR_CANCELA_PX) {
        gesto.current = null;
        setSegurando(false);
        if (estadoRef.current === "gravando") cancelar();
        else if (estadoRef.current === "pedindo") mudar("parado"); // comecar() descarta a sessão ao chegar
      }
    };
    const soltar = () => {
      const g = gesto.current;
      gesto.current = null;
      setSegurando(false);
      setArrasto(0);
      if (!g) return;
      // segurou de verdade (gravação já rodando quando soltou): solta = envia, como no WhatsApp
      if (estadoRef.current === "gravando" && g.ativo && Date.now() - g.t >= SEGURAR_MS) void pararEEnviar();
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);
    return () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointercancel", soltar);
    };
  }, [segurando, cancelar, mudar, pararEEnviar]);

  // A gravação só "conta como segurar" se já estava rodando enquanto o botão seguia apertado
  // (se o navegador abriu o pedido de permissão, o soltar vira clique: fica gravando).
  useEffect(() => {
    if (estado === "gravando" && gesto.current) gesto.current.ativo = true;
  }, [estado]);

  const aoApertar = (e: PointerEventReact<HTMLButtonElement>) => {
    if (e.button > 0 || desabilitado || ocupado) return; // só botão principal (toque e caneta são 0)
    e.preventDefault();
    gesto.current = { x: e.clientX, t: Date.now(), ativo: false };
    setSegurando(true);
    void comecar();
  };

  const aoTeclar = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void comecar();
    }
  };

  if (estado === "parado" || estado === "pedindo") {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Gravar áudio"
        title="Clique para gravar, ou segure e solte para enviar"
        onPointerDown={aoApertar}
        onKeyDown={aoTeclar}
        onContextMenu={(e) => e.preventDefault()}
        disabled={desabilitado || ocupado}
        className="shrink-0 rounded-full crm-chat-meta hover:bg-black/5 touch-none select-none"
        data-testid="gravador-mic"
      >
        {estado === "pedindo" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-6 w-6" />}
      </Button>
    );
  }

  const enviando = estado === "enviando";
  // O soltar do clique que começou a gravação pode cair como "click" no botão que nasceu no lugar do
  // microfone (Enviar). Clique nos primeiros instantes da gravação é esse fantasma: ignora.
  const cliqueFantasma = () => estadoRef.current === "gravando" && Date.now() - inicio.current < CLIQUE_FANTASMA_MS;
  return (
    <div className="flex flex-1 items-center gap-1 min-w-0" data-testid="gravador-ativo" data-estado={estado}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={estado === "previa" ? "Descartar áudio" : "Cancelar gravação"}
        onClick={() => { if (!cliqueFantasma()) cancelar(); }}
        disabled={enviando}
        className="shrink-0 rounded-full text-red-600 hover:bg-red-500/10"
      >
        <Trash2 className="h-5 w-5" />
      </Button>

      <div className="crm-chat-campo flex flex-1 min-w-0 items-center gap-2 rounded-lg px-3 py-2 my-0.5 h-10">
        {estado === "previa" && previa ? (
          previa.url ? (
            <audio controls src={previa.url} className="h-8 w-full" aria-label="Prévia do áudio" />
          ) : (
            <span className="text-sm crm-chat-texto truncate">{previa.arquivo.name}</span>
          )
        ) : (
          <>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 animate-pulse" aria-hidden />
            <span role="timer" aria-live="off" aria-label="Tempo de gravação" className="text-sm tabular-nums crm-chat-texto shrink-0">
              {formatarTempoGravacao(ms)}
            </span>
            {segurando && arrasto < -10 ? (
              <span className="flex-1 truncate text-xs text-muted-foreground" style={{ opacity: Math.max(0.3, 1 + arrasto / DESLIZAR_CANCELA_PX) }}>
                ‹ solte aqui para enviar, arraste para cancelar
              </span>
            ) : (
              <div className="flex flex-1 items-center justify-end gap-[2px] h-6 overflow-hidden" aria-hidden data-testid="gravador-onda">
                {Array.from({ length: BARRAS }, (_, i) => {
                  const n = niveis[i - (BARRAS - niveis.length)] ?? 0;
                  return (
                    <span
                      key={i}
                      className="w-[3px] rounded-full bg-current opacity-60 crm-chat-meta"
                      style={{ height: `${Math.max(12, Math.round(n * 100))}%` }}
                    />
                  );
                })}
              </div>
            )}
            {segurando && <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:inline">‹ deslize para cancelar</span>}
          </>
        )}
      </div>

      {estado !== "previa" && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Parar e ouvir"
          onClick={() => { if (!cliqueFantasma()) void pararEOuvir(); }}
          disabled={enviando}
          className="shrink-0 rounded-full crm-chat-meta hover:bg-black/5"
        >
          <Square className="h-4 w-4 fill-current" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Enviar áudio"
        onClick={() => { if (!cliqueFantasma()) void pararEEnviar(); }}
        disabled={enviando}
        className="shrink-0 rounded-full crm-chat-meta hover:bg-black/5"
      >
        {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-6 w-6" />}
      </Button>
    </div>
  );
}
