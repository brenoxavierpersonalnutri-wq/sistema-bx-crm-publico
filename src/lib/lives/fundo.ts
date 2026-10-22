// Desfoque do plano de fundo da câmera com @livekit/track-processors (MediaPipe, roda no navegador).
// A biblioteca e o modelo só carregam quando a pessoa liga o desfoque: quem não usa não baixa nada.

/** O pedaço da LocalVideoTrack do LiveKit que o desfoque usa. */
export interface FaixaComProcessador {
  setProcessor: (p: never, mostrarLocal?: boolean) => Promise<void>;
  stopProcessor: (manterElemento?: boolean) => Promise<void>;
  getProcessor?: () => unknown;
}

type Modulo = typeof import("@livekit/track-processors");
let carregando: Promise<Modulo> | null = null;
const carregar = () => (carregando ??= import("@livekit/track-processors").catch((e) => {
  carregando = null;
  throw e;
}));

export const RAIO_DESFOQUE = 12;

/** O navegador aguenta o desfoque? (precisa de WebGL2 e de processar quadros de vídeo) */
export async function desfoqueSuportado(): Promise<boolean> {
  try {
    const m = await carregar();
    return m.supportsBackgroundProcessors();
  } catch {
    return false;
  }
}

/**
 * Liga ou desliga o desfoque numa faixa de câmera do LiveKit. Ligar numa faixa que já tem processador não
 * duplica. Lança com mensagem em português se o navegador não suportar.
 */
export async function aplicarDesfoque(faixa: FaixaComProcessador, ligar: boolean): Promise<void> {
  const tem = !!faixa.getProcessor?.();
  if (!ligar) {
    if (tem) await faixa.stopProcessor();
    return;
  }
  if (tem) return;
  const m = await carregar();
  if (!m.supportsBackgroundProcessors()) throw new Error("Este navegador não consegue desfocar o fundo (precisa de WebGL2). Use o Chrome ou o Safari atualizados.");
  const proc = m.BackgroundProcessor({ mode: "background-blur", blurRadius: RAIO_DESFOQUE });
  try {
    await faixa.setProcessor(proc as never, true);
  } catch (e) {
    // processador que quebra ao iniciar não pode deixar a câmera presa nele: tira e a faixa segue crua
    try {
      await faixa.stopProcessor();
    } catch {
      /* nada a tirar */
    }
    throw e instanceof Error && e.message ? e : new Error("O desfoque do fundo não iniciou neste navegador");
  }
}
