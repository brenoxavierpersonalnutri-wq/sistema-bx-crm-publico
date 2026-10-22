// Gravador de áudio para um passo de roteiro: Gravar → (tempo + onda) → Parar → ouvir →
// "Usar este áudio" (o pai sobe para o Storage) ou Regravar/Descartar. Grava em Ogg/Opus
// (mesmo gravador do chat), então o áudio sai como nota de voz quando o roteiro é usado.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square, Trash2, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatarTempoGravacao, iniciarGravacaoOpus, mensagemErroMicrofone, nomeNotaDeVoz,
  type IniciarGravacao, type SessaoGravacao,
} from "@/lib/crm/gravadorVoz";

export const MAX_AUDIO_PASSO_MS = 15 * 60 * 1000;
const BARRAS = 28;

interface Props {
  /** Sobe o arquivo e grava a URL no passo. Devolve true se deu certo. */
  onUsar: (arquivo: File) => Promise<boolean>;
  onAviso?: (msg: string) => void;
  desabilitado?: boolean;
  iniciar?: IniciarGravacao;
}

type Estado = "parado" | "pedindo" | "gravando" | "previa" | "enviando";

export function GravadorAudioPasso({ onUsar, onAviso, desabilitado, iniciar = iniciarGravacaoOpus }: Props) {
  const [estado, setEstado] = useState<Estado>("parado");
  const [ms, setMs] = useState(0);
  const [niveis, setNiveis] = useState<number[]>([]);
  const [previa, setPrevia] = useState<{ arquivo: File; url: string | null } | null>(null);
  const sessao = useRef<SessaoGravacao | null>(null);
  const inicio = useRef(0);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; sessao.current?.cancelar(); sessao.current = null; };
  }, []);
  useEffect(() => () => { if (previa?.url) URL.revokeObjectURL(previa.url); }, [previa]);

  const parar = useCallback(async () => {
    const s = sessao.current;
    if (!s) return;
    sessao.current = null;
    try {
      const blob = await s.parar();
      if (!blob.size) throw new Error("vazio");
      const arquivo = new File([blob], nomeNotaDeVoz(), { type: "audio/ogg" });
      if (!montado.current) return;
      setPrevia({ arquivo, url: typeof URL.createObjectURL === "function" ? URL.createObjectURL(arquivo) : null });
      setEstado("previa");
    } catch {
      onAviso?.("A gravação falhou. Tente de novo.");
      if (montado.current) setEstado("parado");
    }
  }, [onAviso]);

  const comecar = async () => {
    setEstado("pedindo");
    try {
      const s = await iniciar();
      if (!montado.current) { s.cancelar(); return; }
      sessao.current = s;
      inicio.current = Date.now();
      setMs(0);
      setNiveis([]);
      setPrevia(null);
      setEstado("gravando");
    } catch (e) {
      onAviso?.(mensagemErroMicrofone(e));
      if (montado.current) setEstado("parado");
    }
  };

  useEffect(() => {
    if (estado !== "gravando") return;
    const t = setInterval(() => {
      const dec = Date.now() - inicio.current;
      setMs(dec);
      setNiveis((n) => [...n.slice(-(BARRAS - 1)), sessao.current?.nivel() ?? 0]);
      if (dec >= MAX_AUDIO_PASSO_MS) void parar();
    }, 100);
    return () => clearInterval(t);
  }, [estado, parar]);

  const descartar = () => { sessao.current?.cancelar(); sessao.current = null; setPrevia(null); setMs(0); setEstado("parado"); };

  const usar = async () => {
    if (!previa) return;
    setEstado("enviando");
    let ok = false;
    try { ok = await onUsar(previa.arquivo); } catch { ok = false; }
    if (!montado.current) return;
    if (ok) { setPrevia(null); setEstado("parado"); } else setEstado("previa");
  };

  if (estado === "parado" || estado === "pedindo") {
    return (
      <Button type="button" size="sm" variant="outline" disabled={desabilitado || estado === "pedindo"} onClick={comecar}>
        {estado === "pedindo" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Mic className="h-3 w-3 mr-1" />}
        Gravar áudio
      </Button>
    );
  }

  if (estado === "gravando") {
    return (
      <div className="flex items-center gap-2 rounded border border-destructive/50 px-2 py-1" data-testid="gravador-passo-ativo">
        <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" aria-hidden />
        <span className="text-xs tabular-nums w-10" aria-label="Tempo gravado">{formatarTempoGravacao(ms)}</span>
        <div className="flex items-center gap-[2px] h-5 w-28" aria-hidden>
          {Array.from({ length: BARRAS }, (_, i) => {
            const v = niveis[niveis.length - BARRAS + i] ?? 0;
            return <span key={i} className="w-[2px] rounded bg-destructive/70" style={{ height: `${Math.max(10, v * 100)}%` }} />;
          })}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={parar}><Square className="h-3 w-3 mr-1" />Parar</Button>
        <Button type="button" size="icon" variant="ghost" onClick={descartar} aria-label="Descartar gravação"><Trash2 className="h-4 w-4" /></Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded border px-2 py-1" data-testid="gravador-passo-previa">
      {previa?.url && <audio controls src={previa.url} className="h-8 w-56" aria-label="Prévia da gravação" />}
      <Button type="button" size="sm" disabled={estado === "enviando"} onClick={usar}>
        {estado === "enviando" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
        Usar este áudio
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={estado === "enviando"} onClick={comecar}>
        <RotateCcw className="h-3 w-3 mr-1" />Regravar
      </Button>
      <Button type="button" size="icon" variant="ghost" disabled={estado === "enviando"} onClick={descartar} aria-label="Descartar gravação"><Trash2 className="h-4 w-4" /></Button>
    </div>
  );
}
