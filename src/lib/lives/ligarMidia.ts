// Ligar/desligar câmera e microfone dentro da sala do LiveKit sem falhar em silêncio.
//
// Por que existe (21/10/2026): o "Ligar câmera" do estúdio podia não fazer nada. As causas que o código
// permitia: (1) a faixa guardava o aparelho com `exact` (troca pelo seletor / switchActiveDevice), e ao
// religar o LiveKit pedia de novo aquele aparelho exato; se o iPhone (Câmera de Continuidade) tinha saído,
// vinha OverconstrainedError, cuja mensagem costuma ser vazia, e o toast saía em branco; (2) com a primeira
// publicação ainda pendente (permissão esperando resposta, câmera travada), o setCameraEnabled espera 10 s e
// devolve sem erro nenhum; (3) o processador do desfoque quebrando no reinício da faixa.
//
// Aqui: tenta o aparelho escolhido como `ideal`; se falhar, descarta a faixa velha (com o processador) e
// publica de novo na câmera padrão; confere de fato se ligou; e devolve SEMPRE uma mensagem em português.

export type TipoMidia = "camera" | "mic";

/** O pedaço da faixa local do LiveKit que usamos. */
export interface FaixaLocalMidia {
  stopProcessor?: (manterElemento?: boolean) => Promise<void>;
  getProcessor?: () => unknown;
}

/** O pedaço do LocalParticipant do LiveKit que usamos (facilita testar sem servidor). */
export interface ParticipanteMidia {
  readonly isCameraEnabled: boolean;
  readonly isMicrophoneEnabled: boolean;
  setCameraEnabled: (ligar: boolean, opcoes?: OpcoesCaptura) => Promise<unknown>;
  setMicrophoneEnabled: (ligar: boolean, opcoes?: OpcoesCaptura) => Promise<unknown>;
  getTrackPublication: (fonte: never) => { track?: unknown } | undefined;
  unpublishTrack: (faixa: never, pararAoDespublicar?: boolean) => Promise<unknown>;
}

export interface OpcoesCaptura {
  deviceId?: ConstrainDOMString;
  resolution?: { width: number; height: number; frameRate?: number };
}

export interface OpcoesLigar {
  /** aparelho escolhido (pode não existir mais: aí cai na padrão) */
  deviceId?: string;
  resolucao?: { width: number; height: number; frameRate?: number };
  /** nomes das fontes do LiveKit (Track.Source.Camera / Microphone) */
  fontes?: { camera: string; mic: string };
  /** teto de espera por tentativa, em ms (o LiveKit espera 10 s calado com publicação pendente) */
  tempoLimite?: number;
}

/** Erro já traduzido: `message` é o texto que vai para o toast. */
export class ErroMidia extends Error {
  constructor(message: string, readonly causa?: unknown) {
    super(message);
    this.name = "ErroMidia";
  }
}

class SemResposta extends Error {
  constructor() {
    super("sem resposta");
    this.name = "SemResposta";
  }
}

const nomeDe = (e: unknown) => (e && typeof e === "object" && "name" in e ? String((e as { name?: unknown }).name ?? "") : "");
const msgDe = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message ?? "") : typeof e === "string" ? e : "");

const PERMISSAO = new Set(["NotAllowedError", "PermissionDeniedError", "SecurityError"]);
const EM_USO = new Set(["NotReadableError", "TrackStartError", "AbortError"]);
const NAO_ACHOU = new Set(["NotFoundError", "DevicesNotFoundError", "OverconstrainedError", "ConstraintNotSatisfiedError"]);

/** Negado pelo navegador/sistema: tentar outro aparelho não adianta. */
export const ehPermissao = (e: unknown) => PERMISSAO.has(nomeDe(e)) || /permission denied|not allowed/i.test(msgDe(e));

type Alvo = TipoMidia | "aparelhos";

const TEXTOS: Record<Alvo, { semResposta: string; macos: string; negada: string; emUso: string; nenhum: string; generico: string }> = {
  camera: {
    semResposta: "A câmera não respondeu. O navegador pode estar esperando a sua permissão (ícone da câmera na barra de endereço) ou a câmera travou: escolha outra na setinha ao lado do botão.",
    macos: "O macOS bloqueou a câmera para o navegador: Ajustes do Sistema > Privacidade e Segurança > Câmera, ligue o navegador e recarregue a página.",
    negada: "Permissão da câmera negada no navegador. Clique no cadeado ao lado do endereço, permita a câmera e recarregue a página.",
    emUso: "Câmera em uso por outro app (Zoom, Meet, FaceTime, OBS…). Feche o outro app e tente de novo.",
    nenhum: "Nenhuma câmera encontrada. Conecte uma câmera e tente de novo.",
    generico: "Não foi possível ligar a câmera",
  },
  mic: {
    semResposta: "O microfone não respondeu. O navegador pode estar esperando a sua permissão (ícone na barra de endereço) ou o microfone travou: escolha outro na setinha ao lado do botão.",
    macos: "O macOS bloqueou o microfone para o navegador: Ajustes do Sistema > Privacidade e Segurança > Microfone, ligue o navegador e recarregue a página.",
    negada: "Permissão do microfone negada no navegador. Clique no cadeado ao lado do endereço, permita o microfone e recarregue a página.",
    emUso: "Microfone em uso por outro app. Feche o outro app e tente de novo.",
    nenhum: "Nenhum microfone encontrado. Conecte um microfone e tente de novo.",
    generico: "Não foi possível ligar o microfone",
  },
  aparelhos: {
    semResposta: "A câmera ou o microfone não respondeu. Veja se o navegador está esperando a sua permissão (ícone na barra de endereço).",
    macos: "O macOS bloqueou câmera/microfone para o navegador: Ajustes do Sistema > Privacidade e Segurança > Câmera e Microfone, ligue o navegador e recarregue a página.",
    negada: "Permissão de câmera/microfone negada no navegador. Clique no cadeado ao lado do endereço, permita câmera e microfone e recarregue a página.",
    emUso: "Câmera ou microfone em uso por outro app (Zoom, Meet, FaceTime, OBS…). Feche o outro app e tente de novo.",
    nenhum: "Câmera ou microfone não encontrado. Confira os aparelhos e tente de novo.",
    generico: "Não foi possível ligar câmera/microfone",
  },
};

/** É erro de aparelho de mídia (getUserMedia), e não de rede/servidor? */
export const ehErroAparelho = (e: unknown) =>
  e instanceof SemResposta || PERMISSAO.has(nomeDe(e)) || EM_USO.has(nomeDe(e)) || NAO_ACHOU.has(nomeDe(e));

/** Traduz qualquer erro de câmera/microfone para o texto do toast (nunca vazio). */
export function mensagemErroMidia(e: unknown, tipo: Alvo): string {
  if (e instanceof ErroMidia) return e.message;
  const t = TEXTOS[tipo];
  const nome = nomeDe(e);
  const msg = msgDe(e);
  if (e instanceof SemResposta) return t.semResposta;
  if (ehPermissao(e)) return /system/i.test(msg) ? t.macos : t.negada;
  if (EM_USO.has(nome) || /could not start|in use/i.test(msg)) return t.emUso;
  if (NAO_ACHOU.has(nome) || /requested device not found/i.test(msg)) return t.nenhum;
  if (/insufficient permissions|not allowed to publish/i.test(msg)) {
    return "O servidor da live não deixou você publicar câmera/microfone (o token de entrada veio sem permissão de publicar). Saia e entre de novo no estúdio.";
  }
  return `${t.generico}: ${msg || nome || "erro desconhecido"}`;
}

/** onError do LiveKitRoom: erro de aparelho na entrada vira o texto em português; o resto, a mensagem (nunca vazia). */
export function mensagemErroSala(e: unknown): string {
  if (ehErroAparelho(e) || /insufficient permissions|not allowed to publish/i.test(msgDe(e))) return mensagemErroMidia(e, "aparelhos");
  return msgDe(e) || nomeDe(e) || "Erro na sala do estúdio";
}

function comTeto<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((ok, falha) => {
    const t = setTimeout(() => falha(new SemResposta()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        ok(v);
      },
      (e) => {
        clearTimeout(t);
        falha(e);
      },
    );
  });
}

/** Restrição de aparelho que nunca dá OverconstrainedError: o navegador prefere este, mas aceita outro. */
export const aparelhoIdeal = (id?: string): { deviceId?: ConstrainDOMString } => (id ? { deviceId: { ideal: id } } : {});

/**
 * Liga a câmera ou o microfone. Ordem:
 *  1. o caminho normal do LiveKit (religa a faixa que já existe, ou cria uma no aparelho escolhido como `ideal`);
 *  2. falhou sem ser permissão: tira o processador (desfoque), descarta a faixa velha e publica de novo no
 *     aparelho escolhido (`ideal`);
 *  3. ainda falhou: publica na padrão do sistema.
 * Em cada passo confere se ficou ligado de verdade (o LiveKit pode devolver sem erro e sem ligar).
 * Lança ErroMidia com a mensagem pronta para o toast. Devolve um aviso quando ligou com plano B.
 */
export async function ligarMidia(part: ParticipanteMidia, tipo: TipoMidia, opcoes: OpcoesLigar = {}): Promise<{ aviso?: string }> {
  const cam = tipo === "camera";
  const teto = opcoes.tempoLimite ?? 12_000;
  const fonte = cam ? opcoes.fontes?.camera ?? "camera" : opcoes.fontes?.mic ?? "microphone";
  const ligado = () => (cam ? part.isCameraEnabled : part.isMicrophoneEnabled);
  const ligar = (o?: OpcoesCaptura) => (cam ? part.setCameraEnabled(true, o) : part.setMicrophoneEnabled(true, o));
  const captura = (id?: string): OpcoesCaptura => ({ ...aparelhoIdeal(id), ...(cam && opcoes.resolucao ? { resolution: opcoes.resolucao } : {}) });

  const tentar = async (o?: OpcoesCaptura) => {
    await comTeto(ligar(o), teto);
    if (!ligado()) throw new SemResposta();
  };

  let ultimo: unknown;
  // 1. caminho normal
  try {
    await tentar(captura(opcoes.deviceId));
    return {};
  } catch (e) {
    ultimo = e;
    if (ehPermissao(e)) throw new ErroMidia(mensagemErroMidia(e, tipo), e);
  }

  // 2. descarta a faixa velha (aparelho exato que sumiu, processador quebrado) e publica de novo
  const faixa = part.getTrackPublication(fonte as never)?.track as FaixaLocalMidia | undefined;
  // sem faixa e sem resposta = o navegador ainda está abrindo o aparelho (permissão pendente ou câmera
  // travada); tentar de novo só esperaria o mesmo pedido pendurado
  if (!faixa && ultimo instanceof SemResposta) throw new ErroMidia(mensagemErroMidia(ultimo, tipo), ultimo);
  if (faixa) {
    try {
      if (faixa.getProcessor?.()) await faixa.stopProcessor?.();
    } catch {
      /* processador já quebrado: a faixa vai embora de qualquer jeito */
    }
    try {
      await part.unpublishTrack(faixa as never, true);
    } catch {
      /* já saiu */
    }
  }
  const planos: (string | undefined)[] = opcoes.deviceId ? [opcoes.deviceId, undefined] : [undefined];
  for (const id of planos) {
    try {
      await tentar(captura(id));
      if (opcoes.deviceId && !id) {
        return { aviso: cam ? "A câmera escolhida não abriu; ligamos a câmera padrão." : "O microfone escolhido não abriu; ligamos o microfone padrão." };
      }
      return {};
    } catch (e) {
      ultimo = e;
      if (ehPermissao(e)) break;
    }
  }
  throw new ErroMidia(mensagemErroMidia(ultimo, tipo), ultimo);
}

/** Desliga a câmera/microfone; erro também vira mensagem em português. */
export async function desligarMidia(part: ParticipanteMidia, tipo: TipoMidia): Promise<void> {
  try {
    await (tipo === "camera" ? part.setCameraEnabled(false) : part.setMicrophoneEnabled(false));
  } catch (e) {
    throw new ErroMidia(mensagemErroMidia(e, tipo), e);
  }
}
