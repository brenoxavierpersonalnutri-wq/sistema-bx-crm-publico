// Câmera + microfone do Estúdio React, no navegador (celular e computador).
//
// Mesmo cuidado das lives (commit 37a55c4, lib/lives/ligarMidia.ts): o aparelho escolhido vai como `ideal`
// (nunca `exact`: com o iPhone da Continuidade ou o AirPods fora, `exact` dá OverconstrainedError com mensagem
// vazia); se falhar sem ser permissão, tenta o aparelho padrão; tudo com teto de espera; e o erro SEMPRE vira texto em
// português (mensagemErroMidia). Formato de gravação: MP4 H.264/AAC quando o navegador grava (Safari, Chrome novo),
// senão WebM; a VPS normaliza qualquer um dos dois antes de montar.
import { aparelhoIdeal, ehPermissao, mensagemErroMidia } from "@/lib/lives/ligarMidia";
import { separarAparelhos, type ListaAparelhos } from "@/lib/lives/dispositivos";

/** Ordem de preferência (mesma do Estúdio BX Correção): MP4 com avc1/mp4a explícitos primeiro, depois WebM. */
export const FORMATOS = [
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  'video/mp4;codecs="avc1.4D401F,mp4a.40.2"',
  'video/mp4;codecs="avc1.64001F,mp4a.40.2"',
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/webm;codecs=h264,opus",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
] as const;

export function escolherFormato(suporta: (mime: string) => boolean): string | null {
  for (const m of FORMATOS) {
    let ok = false;
    try { ok = suporta(m); } catch { ok = false; }
    if (ok) return m;
  }
  return null;
}

export const extensaoDoFormato = (mime: string) => (mime.startsWith("video/mp4") ? "mp4" : "webm");

export interface EscolhaCamera {
  cameraId?: string;
  micId?: string;
  /** sem lista de aparelhos (celular antes da permissão): frente ou traseira */
  lado?: "user" | "environment";
}

export class ErroCamera extends Error {
  constructor(message: string, readonly causa?: unknown) {
    super(message);
    this.name = "ErroCamera";
  }
}

class SemResposta extends Error {
  constructor() {
    super("sem resposta");
    this.name = "SemResposta";
  }
}

function comTeto<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((ok, falha) => {
    const t = setTimeout(() => falha(new SemResposta()), ms);
    p.then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); falha(e); });
  });
}

/** Restrições: aparelho como `ideal`, 720p/30 como `ideal` (a montagem usa 1080x960, 720p sobra). */
export function restricoes(esc: EscolhaCamera): MediaStreamConstraints {
  const video: MediaTrackConstraints = {
    ...(esc.cameraId ? aparelhoIdeal(esc.cameraId) : { facingMode: { ideal: esc.lado || "user" } }),
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  };
  const audio: MediaTrackConstraints = {
    ...aparelhoIdeal(esc.micId),
    // cancelamento de eco: o som do original saindo do alto-falante não volta pela voz dele
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  return { video, audio };
}

/**
 * Liga câmera e microfone. 1) o aparelho escolhido (ideal); 2) falhou sem ser permissão: o padrão do sistema;
 * 3) ainda falhou: só pede vídeo+áudio sem nada. Erro sempre traduzido.
 */
export async function abrirCamera(esc: EscolhaCamera, md: MediaDevices | undefined = navigator.mediaDevices): Promise<MediaStream> {
  if (!md?.getUserMedia) {
    throw new ErroCamera("Este navegador não libera a câmera. Use o Chrome, o Safari ou o Edge atualizados (e o site em https).");
  }
  const tentativas: MediaStreamConstraints[] = [restricoes(esc), restricoes({ lado: esc.lado }), { video: true, audio: true }];
  let ultimo: unknown;
  for (const r of tentativas) {
    try {
      const s = await comTeto(md.getUserMedia(r), 15_000);
      if (!s.getVideoTracks().length || !s.getAudioTracks().length) {
        s.getTracks().forEach((t) => t.stop());
        throw new ErroCamera("O navegador liberou só a câmera ou só o microfone: o react precisa dos dois.");
      }
      return s;
    } catch (e) {
      ultimo = e;
      if (ehPermissao(e) || e instanceof ErroCamera) break;
    }
  }
  if (ultimo instanceof ErroCamera) throw ultimo;
  if (ultimo instanceof SemResposta) {
    throw new ErroCamera("A câmera ou o microfone não respondeu. Veja se o navegador está esperando a sua permissão (ícone na barra de endereço) ou feche outro app que esteja usando a câmera.");
  }
  throw new ErroCamera(mensagemErroMidia(ultimo, "aparelhos"), ultimo);
}

export async function listarAparelhos(md: MediaDevices | undefined = navigator.mediaDevices): Promise<ListaAparelhos> {
  try {
    return separarAparelhos(await md.enumerateDevices());
  } catch {
    return { cameras: [], mics: [], saidas: [] };
  }
}

/** Próxima câmera da lista (botão "Trocar câmera"); sem lista, alterna frente/traseira. */
export function proximaCamera(lista: ListaAparelhos, atual: EscolhaCamera): EscolhaCamera {
  if (lista.cameras.length > 1) {
    const i = lista.cameras.findIndex((c) => c.deviceId === atual.cameraId);
    return { ...atual, cameraId: lista.cameras[(i + 1) % lista.cameras.length].deviceId };
  }
  return { ...atual, cameraId: undefined, lado: atual.lado === "environment" ? "user" : "environment" };
}

export const pararStream = (s: MediaStream | null | undefined) => s?.getTracks().forEach((t) => t.stop());

/** MediaRecorder com relógio próprio: `agora()` = segundos desde o início real da gravação (evento start). */
export class Gravador {
  private rec: MediaRecorder | null = null;
  private partes: Blob[] = [];
  private t0 = 0;
  readonly formato: string;

  constructor(private stream: MediaStream, formato?: string) {
    const f = formato ?? escolherFormato((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
    if (!f || typeof MediaRecorder === "undefined") throw new ErroCamera("Este navegador não grava vídeo. Use o Chrome, o Safari ou o Edge atualizados.");
    this.formato = f;
  }

  /** Começa. Resolve quando o MediaRecorder disparou "start" (o relógio zera aí). */
  iniciar(): Promise<void> {
    this.partes = [];
    const rec = new MediaRecorder(this.stream, { mimeType: this.formato, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 });
    this.rec = rec;
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) this.partes.push(ev.data); };
    const comecou = new Promise<void>((ok, falha) => {
      rec.onstart = () => { this.t0 = performance.now(); ok(); };
      rec.onerror = (ev) => falha(new ErroCamera(`a gravação falhou: ${(ev as unknown as { error?: Error }).error?.message || "erro do navegador"}`));
    });
    this.t0 = performance.now();
    rec.start(1000);
    return comecou;
  }

  agora(): number {
    return (performance.now() - this.t0) / 1000;
  }

  get gravando(): boolean {
    return this.rec?.state === "recording";
  }

  parar(): Promise<Blob> {
    const rec = this.rec;
    if (!rec || rec.state === "inactive") return Promise.resolve(new Blob(this.partes, { type: this.formato.split(";")[0] }));
    return new Promise((ok) => {
      rec.onstop = () => ok(new Blob(this.partes, { type: this.formato.split(";")[0] }));
      rec.stop();
    });
  }

  descartar() {
    try { if (this.rec && this.rec.state !== "inactive") this.rec.stop(); } catch { /* já parado */ }
    this.partes = [];
  }
}

/** Mantém a tela do celular acesa durante a gravação (quando o navegador deixa). */
export async function manterTelaAcesa(): Promise<() => void> {
  try {
    const wl = await (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen");
    return () => { void wl?.release().catch(() => undefined); };
  } catch {
    return () => undefined;
  }
}
