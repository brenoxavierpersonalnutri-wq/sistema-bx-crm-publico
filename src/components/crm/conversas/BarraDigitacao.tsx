// Barra de digitação: emoji, anexar, campo que cresce, enviar (Enter) / quebra de linha
// (Shift+Enter); microfone grava nota de voz (GravadorVoz: clique ou segure, Ogg/Opus, vai como ptt).
// Anexos ficam PENDENTES (prévia acima do campo) até o atendente enviar: tanto o do clipe
// quanto os que o painel "Roteiros" joga aqui (texto + foto/áudio/documento).
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { FileText, Film, Loader2, Mic, Paperclip, SendHorizontal, Smile, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GravadorVoz } from "./GravadorVoz";
import type { IniciarGravacao } from "@/lib/crm/gravadorVoz";
import {
  anexoDeArquivo, pendenciasDoTexto, planejarEnvio, type AnexoPendente, type InsercaoRoteiro,
} from "@/lib/crm/roteirosChat";

const EMOJIS = [
  "😀", "😂", "😊", "😍", "🥰", "😘", "😉", "😎", "🤩", "🤔", "😅", "😭", "😢", "😡", "🙄", "😴",
  "👍", "👎", "👏", "🙏", "💪", "🤝", "👋", "👌", "✌️", "🙌", "❤️", "🔥", "✨", "🎉", "✅", "❌",
  "⭐", "💰", "📅", "⏰", "📍", "📲", "💬", "🚀",
];

const ALTURA_MAX = 132; // ~6 linhas

interface Props {
  desabilitado?: boolean;
  enviando: boolean;
  anexando: boolean;
  onEnviar: (texto: string) => Promise<boolean>;
  /** Envia um anexo pendente (arquivo do clipe ou link do roteiro) com a legenda. */
  onEnviarAnexo: (anexo: AnexoPendente, legenda: string) => Promise<boolean>;
  /** Conteúdo vindo do painel Roteiros: soma ao que já está na caixa. */
  insercao?: InsercaoRoteiro | null;
  /** Avisado depois que tudo da caixa foi enviado (passos de roteiro incluídos). */
  onEnviado?: (passoIds: string[]) => void;
  /** Aviso de bloqueio (ex.: variável sem preencher). */
  onAviso?: (msg: string) => void;
  /** Só nos testes: gravador falso. */
  iniciarGravacao?: IniciarGravacao;
  /** Foca o campo ao aparecer (depois de "HUMANO ASSUME DAQUI"). */
  focarAoMontar?: boolean;
}

export function BarraDigitacao({
  desabilitado, enviando, anexando, onEnviar, onEnviarAnexo, insercao, onEnviado, onAviso, iniciarGravacao, focarAoMontar,
}: Props) {
  const [texto, setTexto] = useState("");
  const [anexos, setAnexos] = useState<AnexoPendente[]>([]);
  const [passoIds, setPassoIds] = useState<string[]>([]);
  const [deRoteiro, setDeRoteiro] = useState(false);
  const [emojiAberto, setEmojiAberto] = useState(false);
  const [mandando, setMandando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const ultimaInsercao = useRef<string | null>(null);

  useEffect(() => {
    if (focarAoMontar) campo.current?.focus();
  }, [focarAoMontar]);

  useEffect(() => {
    if (!insercao || insercao.id === ultimaInsercao.current) return;
    ultimaInsercao.current = insercao.id;
    if (insercao.texto) setTexto((t) => (t.trim() ? `${t.replace(/\s+$/, "")}\n\n${insercao.texto}` : insercao.texto));
    if (insercao.anexos.length) setAnexos((a) => [...a, ...insercao.anexos]);
    setPassoIds((ids) => [...ids, ...insercao.passoIds]);
    setDeRoteiro(true);
    requestAnimationFrame(() => {
      const t = campo.current;
      if (!t) return;
      t.focus();
      t.setSelectionRange(t.value.length, t.value.length);
    });
  }, [insercao]);

  useEffect(() => {
    const t = campo.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, ALTURA_MAX)}px`;
    t.style.overflowY = t.scrollHeight > ALTURA_MAX ? "auto" : "hidden";
  }, [texto]);

  const limpar = () => {
    setTexto("");
    setAnexos([]);
    setPassoIds([]);
    setDeRoteiro(false);
  };

  const enviar = async () => {
    const t = texto.trim();
    if ((!t && anexos.length === 0) || enviando || anexando || mandando || desabilitado) return;
    if (deRoteiro) {
      const falta = pendenciasDoTexto(t);
      if (falta.length) {
        onAviso?.(`Falta preencher ${falta.map((v) => `{${v}}`).join(", ")} antes de enviar.`);
        return;
      }
    }
    const acoes = planejarEnvio(t, anexos);
    const ids = passoIds;
    setMandando(true);
    let restantes = [...anexos];
    let textoRestante = t;
    try {
      for (const a of acoes) {
        if (a.tipo === "texto") {
          setTexto("");
          const ok = await onEnviar(a.texto);
          if (!ok) return;
          textoRestante = "";
        } else {
          const ok = await onEnviarAnexo(a.anexo, a.legenda);
          if (!ok) return;
          restantes = restantes.filter((x) => x.id !== a.anexo.id);
          setAnexos(restantes);
          if (a.legenda) {
            textoRestante = "";
            setTexto("");
          }
        }
      }
      limpar();
      onEnviado?.(ids);
    } finally {
      // falhou no meio: o que não saiu continua na caixa para tentar de novo
      if (restantes.length || textoRestante) {
        setAnexos(restantes);
        setTexto(textoRestante);
      }
      setMandando(false);
      campo.current?.focus();
    }
  };

  const aoTeclar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      enviar();
    }
  };

  const inserirEmoji = (emoji: string) => {
    const t = campo.current;
    const ini = t?.selectionStart ?? texto.length;
    const fim = t?.selectionEnd ?? texto.length;
    const novo = texto.slice(0, ini) + emoji + texto.slice(fim);
    setTexto(novo);
    requestAnimationFrame(() => {
      t?.focus();
      const pos = ini + emoji.length;
      t?.setSelectionRange(pos, pos);
    });
  };

  const enviarVoz = useCallback(
    (arquivo: File) => onEnviarAnexo({ id: `voz-${Date.now()}`, tipo: "audio", nome: arquivo.name, arquivo, voz: true }, ""),
    [onEnviarAnexo],
  );

  const temTexto = texto.trim().length > 0 || anexos.length > 0;
  const ocupado = enviando || anexando || mandando;
  const pendentes = deRoteiro ? pendenciasDoTexto(texto) : [];

  return (
    <div className="crm-chat-barra shrink-0">
      {(anexos.length > 0 || pendentes.length > 0) && (
        <div className="px-3 md:px-5 pt-2 space-y-1.5" data-testid="anexos-pendentes">
          {anexos.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {anexos.map((a) => (
                <ChipAnexo key={a.id} anexo={a} onRemover={() => setAnexos((xs) => xs.filter((x) => x.id !== a.id))} />
              ))}
            </div>
          )}
          {pendentes.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400" role="status">
              Preencha antes de enviar: {pendentes.map((v) => `{${v}}`).join(", ")}
            </p>
          )}
        </div>
      )}
    <div className="flex items-end gap-1 px-2 md:px-4 py-2">
      {!gravando && (
      <Popover open={emojiAberto} onOpenChange={setEmojiAberto}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Emoji" className="shrink-0 rounded-full crm-chat-meta hover:bg-black/5" disabled={desabilitado}>
            <Smile className="h-6 w-6" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-72 p-2">
          <div className="grid grid-cols-8 gap-1">
            {EMOJIS.map((e) => (
              <button key={e} type="button" onClick={() => inserirEmoji(e)} className="text-xl h-8 w-8 rounded hover:bg-muted">
                {e}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      )}

      {!gravando && (
      <input
        ref={arquivo}
        type="file"
        accept="image/*,video/*,audio/*,application/pdf"
        className="hidden"
        multiple
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!fs.length) return;
          const grandes = fs.filter((f) => f.size > 16 * 1024 * 1024);
          if (grandes.length) onAviso?.("O WhatsApp aceita no máximo 16 MB por arquivo.");
          const ok = fs.filter((f) => f.size <= 16 * 1024 * 1024).map(anexoDeArquivo);
          if (ok.length) setAnexos((a) => [...a, ...ok]);
          campo.current?.focus();
        }}
      />
      )}
      {!gravando && (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Anexar"
        onClick={() => arquivo.current?.click()}
        disabled={ocupado || desabilitado}
        className="shrink-0 rounded-full crm-chat-meta hover:bg-black/5"
      >
        {anexando || mandando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
      </Button>
      )}

      {!gravando && (
      <textarea
        ref={campo}
        value={texto}
        rows={1}
        onChange={(e) => {
          setTexto(e.target.value);
          if (!e.target.value && anexos.length === 0) {
            setDeRoteiro(false);
            setPassoIds([]);
          }
        }}
        onKeyDown={aoTeclar}
        placeholder="Digite uma mensagem"
        aria-label="Mensagem"
        disabled={desabilitado}
        className="crm-chat-campo flex-1 resize-none rounded-lg px-3 py-2.5 text-sm leading-5 outline-none placeholder:text-muted-foreground my-0.5"
      />
      )}

      {(temTexto || ocupado) && !gravando ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Enviar"
          onClick={enviar}
          disabled={ocupado || desabilitado}
          className="shrink-0 rounded-full crm-chat-meta hover:bg-black/5"
        >
          {ocupado ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-6 w-6" />}
        </Button>
      ) : (
        <GravadorVoz
          desabilitado={desabilitado}
          ocupado={ocupado}
          onEnviar={enviarVoz}
          onAviso={onAviso}
          onAtivoChange={setGravando}
          iniciar={iniciarGravacao}
        />
      )}
    </div>
    </div>
  );
}

function ChipAnexo({ anexo, onRemover }: { anexo: AnexoPendente; onRemover: () => void }) {
  const [previa, setPrevia] = useState<string | null>(anexo.url ?? null);
  useEffect(() => {
    if (anexo.url || !anexo.arquivo || anexo.tipo !== "image" || typeof URL.createObjectURL !== "function") return;
    const u = URL.createObjectURL(anexo.arquivo);
    setPrevia(u);
    return () => URL.revokeObjectURL(u);
  }, [anexo]);
  return (
    <div className="relative shrink-0 rounded-lg bg-background/80 border border-black/5 dark:border-white/10 p-1.5 flex items-center gap-2 max-w-60" title={anexo.nome}>
      {anexo.tipo === "image" && previa ? (
        <img src={previa} alt={anexo.nome} className="h-14 w-14 rounded object-cover" />
      ) : anexo.tipo === "audio" && anexo.url ? (
        <audio controls src={anexo.url} className="h-9 w-48" aria-label={`Áudio ${anexo.nome}`} />
      ) : (
        <div className="flex items-center gap-1.5 text-xs crm-chat-texto px-1">
          {anexo.tipo === "video" ? <Film className="h-5 w-5 shrink-0" /> : anexo.tipo === "audio" ? <Mic className="h-5 w-5 shrink-0" /> : <FileText className="h-5 w-5 shrink-0" />}
          <span className="truncate max-w-36">{anexo.nome}</span>
        </div>
      )}
      <button
        type="button"
        onClick={onRemover}
        aria-label={`Tirar anexo ${anexo.nome}`}
        className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-foreground/80 text-background flex items-center justify-center"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
