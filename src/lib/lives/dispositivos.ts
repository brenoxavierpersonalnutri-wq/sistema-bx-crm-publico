// Regras puras dos aparelhos de mídia do estúdio (prévia "estilo Zoom", configurações e convidado):
// separar a lista do enumerateDevices, achar o aparelho salvo (pelo id e, se o id mudou, pelo nome),
// reagir ao devicechange (iPhone aparece/some), escolher a resolução, trocar o aparelho no LiveKit
// sem sair da sala e guardar as preferências por usuário neste navegador.

export type TipoAparelho = "videoinput" | "audioinput" | "audiooutput";

export interface Aparelho {
  deviceId: string;
  label: string;
  kind: string;
  groupId?: string;
}

export interface ListaAparelhos<T extends Aparelho = Aparelho> {
  cameras: T[];
  mics: T[];
  saidas: T[];
}

/**
 * Separa o enumerateDevices por tipo. Sem permissão o navegador devolve itens com deviceId vazio (ou um
 * só, sem nome): esses saem. Ids repetidos (alguns navegadores repetem) contam uma vez.
 */
export function separarAparelhos<T extends Aparelho>(lista: readonly T[]): ListaAparelhos<T> {
  const vistos = new Set<string>();
  const out: ListaAparelhos<T> = { cameras: [], mics: [], saidas: [] };
  for (const d of lista) {
    if (!d.deviceId) continue;
    const chave = `${d.kind}:${d.deviceId}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    if (d.kind === "videoinput") out.cameras.push(d);
    else if (d.kind === "audioinput") out.mics.push(d);
    else if (d.kind === "audiooutput") out.saidas.push(d);
  }
  return out;
}

/** Os nomes só vêm depois da permissão de câmera/microfone: sem nenhum nome, a lista está "cega". */
export const temNomes = (lista: readonly Aparelho[]) => lista.some((d) => !!d.label);

const BASE_ROTULO: Record<TipoAparelho, string> = { videoinput: "Câmera", audioinput: "Microfone", audiooutput: "Alto-falante" };

/** Nome que aparece no seletor: o nome real do aparelho; sem permissão, "Câmera 1", "Microfone 2"… */
export function rotuloAparelho(d: Aparelho, indice: number): string {
  const nome = d.label?.trim();
  if (nome) return nome;
  return `${BASE_ROTULO[d.kind as TipoAparelho] ?? "Aparelho"} ${indice + 1}`;
}

/**
 * Acha o aparelho salvo na lista atual: primeiro pelo id; se o navegador trocou o id (o Safari troca entre
 * sessões), pelo nome. Não achou: undefined (fica a padrão do sistema).
 */
export function acharAparelho<T extends Aparelho>(lista: readonly T[], id?: string | null, nome?: string | null): T | undefined {
  if (id) {
    const porId = lista.find((d) => d.deviceId === id);
    if (porId) return porId;
  }
  if (nome) return lista.find((d) => d.label === nome);
  return undefined;
}

export interface EscolhaAparelhos {
  cameraId?: string;
  micId?: string;
  saidaId?: string;
}

export interface MudancaAparelhos {
  escolha: EscolhaAparelhos;
  /** aparelhos escolhidos que sumiram da lista (ex.: o iPhone saiu de perto) */
  sumiram: { tipo: TipoAparelho; id: string }[];
}

const CAMPO: Record<TipoAparelho, keyof EscolhaAparelhos> = { videoinput: "cameraId", audioinput: "micId", audiooutput: "saidaId" };

/**
 * Depois de um devicechange: se o aparelho escolhido sumiu, volta para o primeiro da lista (ou a padrão).
 * Lista sem nomes (sem permissão) não decide nada: devolve a escolha como está.
 */
export function aposMudanca(escolha: EscolhaAparelhos, lista: ListaAparelhos): MudancaAparelhos {
  const nova: EscolhaAparelhos = { ...escolha };
  const sumiram: MudancaAparelhos["sumiram"] = [];
  const porTipo: [TipoAparelho, Aparelho[]][] = [["videoinput", lista.cameras], ["audioinput", lista.mics], ["audiooutput", lista.saidas]];
  for (const [tipo, itens] of porTipo) {
    const campo = CAMPO[tipo];
    const id = escolha[campo];
    if (!id || !temNomes(itens)) continue;
    if (itens.some((d) => d.deviceId === id)) continue;
    sumiram.push({ tipo, id });
    nova[campo] = itens[0]?.deviceId;
  }
  return { escolha: nova, sumiram };
}

/** Assina o devicechange (iPhone da Câmera de Continuidade entra e sai ao vivo). Devolve o "desassinar". */
export function observarAparelhos(md: Pick<MediaDevices, "addEventListener" | "removeEventListener"> | undefined, aoMudar: () => void): () => void {
  if (!md?.addEventListener) return () => undefined;
  md.addEventListener("devicechange", aoMudar);
  return () => md.removeEventListener?.("devicechange", aoMudar);
}

// ------------------------------------------------------------------ resolução

export interface Resolucao {
  width: number;
  height: number;
  frameRate: number;
}

export const RES_720: Resolucao = { width: 1280, height: 720, frameRate: 30 };
export const RES_1080: Resolucao = { width: 1920, height: 1080, frameRate: 30 };

/** 1920x1080 se a câmera aguenta (pelas capacidades da faixa), senão 1280x720. Sempre 30 fps. */
export function escolherResolucao(cap?: { width?: { max?: number }; height?: { max?: number } } | null): Resolucao {
  const w = cap?.width?.max ?? 0;
  const h = cap?.height?.max ?? 0;
  return w >= 1920 && h >= 1080 ? RES_1080 : RES_720;
}

/** Restrições de vídeo do getUserMedia para um aparelho e uma resolução (ideal, nunca exigida). */
export function restricoesVideo(cameraId: string | undefined, res: Resolucao = RES_720): MediaTrackConstraints {
  return {
    // ideal, nunca exact: aparelho que sumiu (iPhone desconectado) cai na câmera padrão em vez de dar OverconstrainedError
    ...(cameraId ? { deviceId: { ideal: cameraId } } : {}),
    width: { ideal: res.width },
    height: { ideal: res.height },
    frameRate: { ideal: res.frameRate },
  };
}

// ------------------------------------------------------------------ troca dentro da sala (LiveKit)

interface FaixaReiniciavel {
  restartTrack: (opcoes?: { deviceId?: ConstrainDOMString }) => Promise<void>;
}

/** O pedaço da Room do LiveKit que a troca usa (facilita testar sem servidor). */
export interface SalaTroca {
  switchActiveDevice: (kind: MediaDeviceKind, deviceId: string, exact?: boolean) => Promise<boolean>;
  localParticipant: {
    getTrackPublication: (fonte: never) => { track?: unknown } | undefined;
  };
}

/**
 * Troca câmera, microfone ou saída sem sair da sala. Usa o switchActiveDevice do LiveKit; se ele recusar
 * (devolve false ou lança) numa entrada, reinicia a faixa publicada com o aparelho novo (restartTrack).
 * Devolve true se trocou.
 */
export async function trocarNaSala(sala: SalaTroca, tipo: TipoAparelho, deviceId: string, fonte?: { camera: string; mic: string }): Promise<boolean> {
  let erro: unknown = null;
  try {
    // exact=false: o LiveKit guarda essa restrição na faixa e reusa ao religar a câmera; com exact, um iPhone
    // que saiu de perto fazia o "Ligar câmera" falhar (OverconstrainedError com mensagem vazia)
    if (await sala.switchActiveDevice(tipo, deviceId, false)) return true;
  } catch (e) {
    erro = e;
  }
  if (tipo === "audiooutput") {
    if (erro) throw erro;
    return false;
  }
  const nomeFonte = tipo === "videoinput" ? fonte?.camera ?? "camera" : fonte?.mic ?? "microphone";
  const faixa = sala.localParticipant.getTrackPublication(nomeFonte as never)?.track as FaixaReiniciavel | undefined;
  if (!faixa?.restartTrack) {
    if (erro) throw erro;
    return false;
  }
  await faixa.restartTrack({ deviceId: { ideal: deviceId } });
  return true;
}

// ------------------------------------------------------------------ preferências (por usuário, neste navegador)

export interface PrefsLives {
  /** "Sempre mostrar essa prévia ao entrar" */
  sempreMostrarPrevia: boolean;
  cam: boolean;
  mic: boolean;
  desfocar: boolean;
  cameraId?: string;
  cameraNome?: string;
  micId?: string;
  micNome?: string;
  saidaId?: string;
  saidaNome?: string;
  /** a câmera usada por último aguentava 1080p */
  hd1080?: boolean;
}

export const PREFS_PADRAO: PrefsLives = { sempreMostrarPrevia: true, cam: true, mic: true, desfocar: false };

export const chavePrefs = (usuario?: string | null) => `lives:previa:${usuario || "anonimo"}`;

export function lerPrefs(usuario?: string | null): PrefsLives {
  try {
    const bruto = localStorage.getItem(chavePrefs(usuario));
    if (!bruto) return { ...PREFS_PADRAO };
    const p = JSON.parse(bruto) as Partial<PrefsLives>;
    const txt = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    return {
      sempreMostrarPrevia: typeof p.sempreMostrarPrevia === "boolean" ? p.sempreMostrarPrevia : true,
      cam: typeof p.cam === "boolean" ? p.cam : true,
      mic: typeof p.mic === "boolean" ? p.mic : true,
      desfocar: p.desfocar === true,
      cameraId: txt(p.cameraId), cameraNome: txt(p.cameraNome),
      micId: txt(p.micId), micNome: txt(p.micNome),
      saidaId: txt(p.saidaId), saidaNome: txt(p.saidaNome),
      hd1080: p.hd1080 === true,
    };
  } catch {
    return { ...PREFS_PADRAO };
  }
}

export function salvarPrefs(usuario: string | null | undefined, parcial: Partial<PrefsLives>): PrefsLives {
  const nova = { ...lerPrefs(usuario), ...parcial };
  try {
    localStorage.setItem(chavePrefs(usuario), JSON.stringify(nova));
  } catch {
    /* modo privado / armazenamento bloqueado: vale só nesta tela */
  }
  return nova;
}

/** Guarda a escolha com o nome de cada aparelho, para reencontrar se o id mudar. */
export function prefsDaEscolha(escolha: EscolhaAparelhos, lista: ListaAparelhos): Partial<PrefsLives> {
  const nome = (itens: Aparelho[], id?: string) => (id ? itens.find((d) => d.deviceId === id)?.label || undefined : undefined);
  return {
    cameraId: escolha.cameraId, cameraNome: nome(lista.cameras, escolha.cameraId),
    micId: escolha.micId, micNome: nome(lista.mics, escolha.micId),
    saidaId: escolha.saidaId, saidaNome: nome(lista.saidas, escolha.saidaId),
  };
}

/** Escolha inicial a partir das preferências salvas e da lista atual (aparelho que não existe mais cai fora). */
export function escolhaDasPrefs(prefs: PrefsLives, lista: ListaAparelhos): EscolhaAparelhos {
  return {
    cameraId: acharAparelho(lista.cameras, prefs.cameraId, prefs.cameraNome)?.deviceId,
    micId: acharAparelho(lista.mics, prefs.micId, prefs.micNome)?.deviceId,
    saidaId: acharAparelho(lista.saidas, prefs.saidaId, prefs.saidaNome)?.deviceId,
  };
}

// ------------------------------------------------------------------ menu da barra (setinha ao lado de Mudo/Câmera)

/** ids "virtuais" do Chrome (seguem o aparelho padrão do sistema): não são aparelho novo quando mudam de nome */
const IDS_VIRTUAIS = new Set(["default", "communications"]);

/**
 * Avisos discretos do devicechange: o que entrou na lista desde a leitura anterior. Só fala quando as duas
 * listas têm nomes (sem permissão, ou na primeira leitura, não opina). AirPods aparecem como microfone e
 * alto-falante ao mesmo tempo: viram um aviso só (pelo groupId e pelo nome).
 */
export function avisosNovosAparelhos(antes: ListaAparelhos, depois: ListaAparelhos): string[] {
  const todosAntes = [...antes.cameras, ...antes.mics, ...antes.saidas];
  const todosDepois = [...depois.cameras, ...depois.mics, ...depois.saidas];
  if (!temNomes(todosAntes) || !temNomes(todosDepois)) return [];
  const tinha = new Set(todosAntes.map((d) => `${d.kind}:${d.deviceId}`));
  const avisos: string[] = [];
  const grupos = new Set<string>();
  for (const d of todosDepois) {
    if (!d.label || IDS_VIRTUAIS.has(d.deviceId) || tinha.has(`${d.kind}:${d.deviceId}`)) continue;
    const grupo = d.groupId ? `g:${d.groupId}` : `n:${d.label.replace(/^(Microfone|Alto-falantes?)\s*/i, "")}`;
    if (grupos.has(grupo)) continue;
    grupos.add(grupo);
    let msg: string;
    if (d.kind === "videoinput" && /visualiza[cç][aã]o da mesa|desk view/i.test(d.label)) msg = "Visualização da Mesa disponível";
    else if (d.kind === "videoinput" && /iphone|ipad/i.test(d.label)) msg = "Câmera do iPhone disponível";
    else if (/airpods/i.test(d.label)) msg = "AirPods conectados";
    else if (d.kind === "videoinput") msg = `Câmera disponível: ${d.label}`;
    else msg = `${d.label} conectado`;
    if (!avisos.includes(msg)) avisos.push(msg);
  }
  return avisos;
}

/** O navegador deixa escolher o alto-falante (HTMLMediaElement.setSinkId)? Chrome e Edge sim; outros podem não. */
export function suportaEscolherSaida(proto: object | undefined = typeof HTMLMediaElement !== "undefined" ? HTMLMediaElement.prototype : undefined): boolean {
  return !!proto && "setSinkId" in proto;
}

/** Aparelho marcado no menu: o escolhido, se ainda está na lista; senão o primeiro (é o que o navegador usa). */
export function aparelhoAtual(lista: readonly Aparelho[], id?: string): string | undefined {
  if (id && lista.some((d) => d.deviceId === id)) return id;
  return lista[0]?.deviceId;
}

export const AJUDA_AUDIO =
  "O navegador só enxerga os aparelhos de áudio que o macOS expõe: fones e microfones Bluetooth, como o AirPods, aparecem; outros aparelhos Bluetooth não aparecem aqui.";
export const AJUDA_VIDEO =
  "O navegador só enxerga as câmeras que o macOS expõe. No Chrome, a Câmera do iPhone sem fio pode não aparecer: conecte o iPhone pelo cabo USB ou abra o estúdio no Safari.";
