// Gravação de nota de voz no navegador, já em Ogg/Opus (o formato que o WhatsApp mostra como
// bolha de microfone). Chrome grava webm/opus e Safari mp4/aac no MediaRecorder; em vez de
// converter depois (no servidor), capturamos o PCM do microfone e codificamos com o libopus em
// WASM do opus-recorder (8.0.5, pinado), num Web Worker. Mono, 48 kHz, perfil de voz.
//
// A interface (SessaoGravacao / IniciarGravacao) é o que o componente usa; os testes injetam
// uma falsa, sem microfone nem WASM.

export interface SessaoGravacao {
  /** Nível instantâneo do microfone, 0..1 (para a onda). */
  nivel(): number;
  /** Para e devolve o áudio Ogg/Opus. Libera o microfone. */
  parar(): Promise<Blob>;
  /** Descarta tudo e libera o microfone. */
  cancelar(): void;
}

export type IniciarGravacao = () => Promise<SessaoGravacao>;

export type MotivoErroMicrofone = "negado" | "sem-microfone" | "sem-suporte" | "outro";

export class ErroMicrofone extends Error {
  constructor(public motivo: MotivoErroMicrofone, mensagem: string) {
    super(mensagem);
    this.name = "ErroMicrofone";
  }
}

/** Texto que o atendente lê quando não dá para gravar. */
export function mensagemErroMicrofone(e: unknown): string {
  const motivo = e instanceof ErroMicrofone ? e.motivo : "outro";
  if (motivo === "negado") {
    return "O navegador bloqueou o microfone. Clique no cadeado ao lado do endereço, permita o microfone para este site e tente de novo.";
  }
  if (motivo === "sem-microfone") return "Nenhum microfone encontrado. Conecte um microfone e tente de novo.";
  if (motivo === "sem-suporte") return "Este navegador não grava áudio. Use Chrome, Edge, Firefox ou Safari atualizados.";
  return "Não foi possível gravar o áudio. Tente de novo.";
}

/** Erro do getUserMedia → motivo. */
export function motivoDoErroGetUserMedia(e: unknown): MotivoErroMicrofone {
  const nome = e && typeof e === "object" ? String((e as { name?: unknown }).name ?? "") : "";
  if (nome === "NotAllowedError" || nome === "SecurityError" || nome === "PermissionDeniedError") return "negado";
  if (nome === "NotFoundError" || nome === "OverconstrainedError" || nome === "DevicesNotFoundError") return "sem-microfone";
  if (nome === "NotReadableError" || nome === "TrackStartError") return "sem-microfone";
  return "outro";
}

/** Formato fixo de 1:05 / 12:30. */
export function formatarTempoGravacao(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Nome do arquivo da nota (o .ogg é o que a edge function confere para aceitar ptt). */
export function nomeNotaDeVoz(agora: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `audio-${agora.getFullYear()}${p(agora.getMonth() + 1)}${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}${p(agora.getSeconds())}.ogg`;
}

type CtxAudio = typeof AudioContext;

/** Implementação real: microfone + opus-recorder. Carregado sob demanda (o WASM só baixa ao gravar). */
export const iniciarGravacaoOpus: IniciarGravacao = async () => {
  const w = window as unknown as { AudioContext?: CtxAudio; webkitAudioContext?: CtxAudio };
  const Ctx = w.AudioContext ?? w.webkitAudioContext;
  if (!navigator.mediaDevices?.getUserMedia || !Ctx || typeof WebAssembly === "undefined" || typeof Worker === "undefined") {
    throw new ErroMicrofone("sem-suporte", "sem suporte");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    throw new ErroMicrofone(motivoDoErroGetUserMedia(e), e instanceof Error ? e.message : "getUserMedia");
  }

  const ctx = new Ctx();
  const liberar = () => {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => undefined);
  };

  try {
    const [{ default: Recorder }, { default: encoderPath }] = await Promise.all([
      import("opus-recorder"),
      import("opus-recorder/dist/encoderWorker.min.js?url"),
    ]);
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);

    const fonte = ctx.createMediaStreamSource(stream);
    const analisador = ctx.createAnalyser();
    analisador.fftSize = 1024;
    fonte.connect(analisador);
    const amostras = new Uint8Array(analisador.fftSize);

    const pedacos: Uint8Array<ArrayBuffer>[] = [];
    const rec = new Recorder({
      sourceNode: fonte,
      encoderPath,
      numberOfChannels: 1,
      encoderApplication: 2048, // voz
      encoderSampleRate: 48000,
      encoderBitRate: 32000,
      streamPages: true,
    });
    rec.ondataavailable = (dados) => { pedacos.push(new Uint8Array(dados)); };
    await rec.start();

    let fechada = false;
    const fechar = () => {
      if (fechada) return;
      fechada = true;
      try { rec.close(); } catch { /* já fechado */ }
      liberar();
    };

    return {
      nivel() {
        if (fechada) return 0;
        analisador.getByteTimeDomainData(amostras);
        let soma = 0;
        for (const a of amostras) {
          const v = (a - 128) / 128;
          soma += v * v;
        }
        return Math.min(1, Math.sqrt(soma / amostras.length) * 4);
      },
      parar() {
        return new Promise<Blob>((resolve, reject) => {
          if (fechada) return reject(new Error("gravação já encerrada"));
          rec.onstop = () => {
            fechar();
            resolve(new Blob(pedacos, { type: "audio/ogg" }));
          };
          try { rec.stop(); } catch (e) { fechar(); reject(e); }
        });
      },
      cancelar() {
        rec.onstop = null;
        try { rec.stop(); } catch { /* ok */ }
        fechar();
      },
    };
  } catch (e) {
    liberar();
    if (e instanceof ErroMicrofone) throw e;
    throw new ErroMicrofone("outro", e instanceof Error ? e.message : "gravador");
  }
};
