// Cena do estúdio: quem está no palco e onde cada vídeo fica no quadro 16:9.
// Função pura, usada IGUAL pela prévia do estúdio e pela página de render do Egress
// (/lives/render/:id) — o que o produtor vê é o que sai na transmissão.
//
// Palco × bastidores: atributo de participante `stage` = "1" (no palco) ou "0"/ausente
// (bastidores). Ordem no palco: atributo `stage_ordem` (número), depois a entrada (identity).
// O render (recorder) e quem entra escondido nunca aparecem.

export type LayoutLive = "solo" | "lado-a-lado" | "grade" | "tela-pip" | "tela-cheia";
export const LAYOUTS: { key: LayoutLive; label: string }[] = [
  { key: "solo", label: "1 pessoa" },
  { key: "lado-a-lado", label: "2 lado a lado" },
  { key: "grade", label: "Grade" },
  { key: "tela-pip", label: "Tela + pessoa" },
  { key: "tela-cheia", label: "Só tela" },
];

/** Layouts que mostram a tela compartilhada (ou o vídeo da aula grande); os outros mostram só as câmeras. */
export const LAYOUTS_COM_TELA: LayoutLive[] = ["tela-pip", "tela-cheia"];

export interface ParticipanteCena {
  identity: string;
  nome?: string;
  attributes?: Record<string, string>;
  /** recorder do Egress / participante oculto */
  oculto?: boolean;
  temTela?: boolean;
}

export interface Bloco {
  key: string;
  identity: string;
  fonte: "camera" | "tela";
  x: number; // 0..1
  y: number;
  w: number;
  h: number;
  z: number;
}

export const estaNoPalco = (p: ParticipanteCena) => !p.oculto && p.attributes?.stage === "1";

export function noPalco(ps: ParticipanteCena[]): ParticipanteCena[] {
  const ordem = (p: ParticipanteCena) => {
    const n = Number(p.attributes?.stage_ordem);
    return Number.isFinite(n) ? n : 9999;
  };
  return ps
    .filter(estaNoPalco)
    .slice()
    .sort((a, b) => ordem(a) - ordem(b) || a.identity.localeCompare(b.identity));
}

export const nosBastidores = (ps: ParticipanteCena[]) => ps.filter((p) => !p.oculto && !estaNoPalco(p));

const MARGEM = 0.02;

function grade(n: number, x0 = 0, y0 = 0, W = 1, H = 1): { x: number; y: number; w: number; h: number }[] {
  if (n <= 0) return [];
  // quadro 16:9: colunas suficientes para os blocos ficarem perto de 16:9
  const cols = n <= 2 ? n : n <= 4 ? 2 : n <= 6 ? 3 : n <= 9 ? 3 : 4;
  const linhas = Math.ceil(n / cols);
  const w = (W - MARGEM * (cols + 1)) / cols;
  const h = (H - MARGEM * (linhas + 1)) / linhas;
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < n; i++) {
    const linha = Math.floor(i / cols);
    const naLinha = linha === linhas - 1 ? n - linha * cols : cols;
    const col = i - linha * cols;
    const sobra = (cols - naLinha) * (w + MARGEM); // centraliza a última linha
    out.push({
      x: x0 + MARGEM + sobra / 2 + col * (w + MARGEM),
      y: y0 + MARGEM + linha * (h + MARGEM),
      w,
      h,
    });
  }
  return out;
}

/** "Vídeo da aula" (LiveKit Ingress): identity aula-video-<id>. Conta como fonte de imagem grande, igual à tela. */
export const PREFIXO_AULA_CENA = "aula-video-";
export const ehAulaCena = (identity: string | null | undefined) => !!identity && identity.startsWith(PREFIXO_AULA_CENA);

/**
 * Quem está em destaque: o primeiro do palco (menor stage_ordem). "Destacar" alguém = dar a ele um stage_ordem
 * menor que o de todo mundo (ordemParaDestacar); por isso o destaque fica gravado na sala (atributo do participante
 * no LiveKit) e o render e os outros produtores veem o mesmo.
 */
export const destaqueDoPalco = (ps: ParticipanteCena[]): ParticipanteCena | undefined => noPalco(ps)[0];

const ordemDe = (p: ParticipanteCena) => {
  const n = Number(p.attributes?.stage_ordem);
  return Number.isFinite(n) ? Math.trunc(n) : 9999;
};

/** stage_ordem para pôr `identity` à frente de todos (vira o destaque e o 1º do lado a lado). */
export function ordemParaDestacar(ps: ParticipanteCena[], identity: string): number {
  const outros = noPalco(ps).filter((p) => p.identity !== identity);
  if (!outros.length) return 0;
  return Math.min(...outros.map(ordemDe)) - 1;
}

/**
 * stage_ordem de quem está subindo ao palco. Padrão pedido pelo Breno: o último que entrou fica em destaque,
 * menos quando o vídeo da aula está no palco — aí o vídeo continua em destaque e quem sobe entra logo atrás dele.
 * Devolve também as trocas de ordem que isso exige nos outros (vazio quase sempre).
 */
export function ordemAoSubir(ps: ParticipanteCena[], identity: string): { ordem: number; trocas: { identity: string; ordem: number }[] } {
  const palco = noPalco(ps).filter((p) => p.identity !== identity);
  if (!palco.length) return { ordem: 0, trocas: [] };
  if (ehAulaCena(identity) || !ehAulaCena(palco[0].identity)) return { ordem: ordemDe(palco[0]) - 1, trocas: [] };
  // vídeo da aula em destaque: entra em 2º; quem estava de 2º em diante desce uma casa se não houver vaga
  const aula = ordemDe(palco[0]);
  const segundo = palco[1] ? ordemDe(palco[1]) : aula + 2;
  if (segundo - aula >= 2) return { ordem: aula + 1, trocas: [] };
  const trocas = palco.slice(1).map((p, i) => ({ identity: p.identity, ordem: aula + 2 + i }));
  return { ordem: aula + 1, trocas };
}

/** Inverte os dois primeiros do palco (o 2º vira destaque). Devolve as duas trocas de stage_ordem, ou [] com menos de 2. */
export function inverterDoisPrimeiros(ps: ParticipanteCena[]): { identity: string; ordem: number }[] {
  const [a, b] = noPalco(ps);
  if (!a || !b) return [];
  const oa = ordemDe(a);
  const ob = ordemDe(b);
  // empate (os dois com 0, como o produtor e o vídeo da aula ao entrar; a identity desempata): o 2º passa à frente
  if (oa === ob) return [{ identity: b.identity, ordem: oa - 1 }];
  return [{ identity: a.identity, ordem: ob }, { identity: b.identity, ordem: oa }];
}

/**
 * Calcula os blocos da cena. A ordem do palco (stage_ordem) decide quem aparece:
 *  - solo ("1 pessoa"): só o destaque (o 1º do palco) em tela cheia — pode ser o vídeo da aula;
 *  - lado-a-lado: os 2 primeiros do palco, na ordem escolhida (Inverter troca os dois);
 *  - grade: todo mundo do palco;
 *  - tela-pip ("tela + pessoa"): a imagem grande é a tela compartilhada de alguém do palco ou, sem tela, o vídeo
 *    da aula; por cima, no canto, as pessoas do palco (até 3, sem o vídeo da aula);
 *  - tela-cheia ("só tela"): só a imagem grande (tela compartilhada ou vídeo da aula).
 *  Nos dois de tela, sem tela e sem vídeo da aula no palco, cai para a grade (o palco nunca fica preto por
 *  causa do layout). Nos layouts de pessoas a tela compartilhada não aparece (Solo com tela = a pessoa).
 */
export function calcularCena(layout: LayoutLive, ps: ParticipanteCena[]): Bloco[] {
  const palco = noPalco(ps);
  const tela = palco.find((p) => p.temTela && !ehAulaCena(p.identity));
  const aula = palco.find((p) => ehAulaCena(p.identity));
  const cams = palco.map((p) => ({ identity: p.identity, fonte: "camera" as const }));
  const bloco = (f: { identity: string; fonte: "camera" | "tela" }, r: { x: number; y: number; w: number; h: number }, z = 1): Bloco => ({
    key: `${f.identity}:${f.fonte}`,
    identity: f.identity,
    fonte: f.fonte,
    ...r,
    z,
  });

  if (cams.length === 0) return [];

  // imagem grande dos layouts de tela: a tela compartilhada; sem ela, o vídeo da aula
  const grande = tela ? { identity: tela.identity, fonte: "tela" as const } : aula ? { identity: aula.identity, fonte: "camera" as const } : null;

  if (grande && layout === "tela-cheia") return [bloco(grande, { x: 0, y: 0, w: 1, h: 1 })];

  if (grande && layout === "tela-pip") {
    const pipW = 0.22;
    // coordenadas normalizadas num quadro 16:9: bloco 16:9 de largura w tem altura w
    const pipH = pipW;
    const out: Bloco[] = [bloco(grande, { x: 0, y: 0, w: 1, h: 1 }, 1)];
    cams
      .filter((c) => !ehAulaCena(c.identity))
      .slice(0, 3)
      .forEach((c, i) => {
        out.push(bloco(c, { x: 1 - MARGEM - pipW, y: 1 - MARGEM - (i + 1) * pipH - i * MARGEM, w: pipW, h: pipH }, 2 + i));
      });
    return out;
  }

  if (layout === "solo") return [bloco(cams[0], { x: 0, y: 0, w: 1, h: 1 })];

  if (layout === "lado-a-lado") {
    const dois = cams.slice(0, 2);
    if (dois.length === 1) return [bloco(dois[0], { x: 0, y: 0, w: 1, h: 1 })];
    const n = dois.length;
    const w = (1 - MARGEM * (n + 1)) / n;
    const h = Math.min(1 - 2 * MARGEM, w); // bloco 16:9 (altura normalizada = largura)
    const y = (1 - h) / 2;
    return dois.map((f, i) => bloco(f, { x: MARGEM + i * (w + MARGEM), y, w, h }));
  }

  return grade(cams.length).map((r, i) => bloco(cams[i], r));
}

/** Quem aparece no ar em cada layout (identity:fonte, na ordem de desenho) — usado nos testes e na tela. */
export const quemAparece = (layout: LayoutLive, ps: ParticipanteCena[]) => calcularCena(layout, ps).map((b) => `${b.identity}:${b.fonte}`);

// ------------------------------------------------------------------ estado da cena (metadata da sala)

export type TipoOverlay = "logo" | "lower_third" | "banner";

export interface OverlayCena {
  id: string;
  tipo: TipoOverlay;
  visivel: boolean;
  conteudo: { texto?: string; subtitulo?: string; url_imagem?: string; cor?: string; posicao?: string; tema?: TemaFaixa; origem?: string };
}

/** Estilo da faixa (lower third) e do banner no quadro. */
export type TemaFaixa = "bloco" | "escuro" | "claro";
export const TEMAS_FAIXA: { key: TemaFaixa; label: string }[] = [
  { key: "bloco", label: "Bloco na cor da marca" },
  { key: "escuro", label: "Escuro com filete" },
  { key: "claro", label: "Claro com filete" },
];

export interface EstadoCena {
  layout: LayoutLive;
  overlays: OverlayCena[];
  cor?: string;
}

export const CENA_PADRAO: EstadoCena = { layout: "grade", overlays: [] };

/** Lê o JSON da metadata da sala do LiveKit sem nunca quebrar o render. */
export function lerEstadoCena(metadata: string | undefined | null): EstadoCena {
  if (!metadata) return CENA_PADRAO;
  try {
    const m = JSON.parse(metadata);
    const layout = LAYOUTS.some((l) => l.key === m?.layout) ? (m.layout as LayoutLive) : CENA_PADRAO.layout;
    const overlays = Array.isArray(m?.overlays)
      ? m.overlays.filter(
          (o: any) => o && typeof o.id === "string" && ["logo", "lower_third", "banner"].includes(o.tipo),
        )
      : [];
    return { layout, overlays, cor: typeof m?.cor === "string" ? m.cor : undefined };
  } catch {
    return CENA_PADRAO;
  }
}
