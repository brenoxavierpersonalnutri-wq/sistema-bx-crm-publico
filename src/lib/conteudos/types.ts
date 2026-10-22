// Área de conteúdos da aluna: módulos, aulas e progresso.
//
// Uma aula toca DENTRO do app. YouTube vira embed nocookie (a aluna não sai pro
// YouTube) e vídeo próprio vira arquivo no bucket `conteudos`, servido por URL
// assinada na hora de tocar.

export type TipoAula = "youtube" | "upload";

/**
 * Produto é o topo da hierarquia: Produto -> Módulo -> Aula. É o mesmo
 * desenho que o Breno já usa na plataforma de vendas — "Plataforma Magra e
 * Definida" é o produto, "Boas vindas" é um módulo dentro dele.
 */
export interface ConteudoProduto {
  id: string;
  titulo: string;
  descricao?: string | null;
  capa_url?: string | null;
  /** Vazio = todas as alunas. Preenchido = só quem está nesse plano. */
  programa?: string | null;
  ordem: number;
  publicado: boolean;
  created_at?: string;
}

export interface ConteudoModulo {
  id: string;
  produto_id?: string | null;
  titulo: string;
  descricao?: string | null;
  capa_url?: string | null;
  /** Legado: o acesso passou a ser decidido no produto. */
  programa?: string | null;
  ordem: number;
  publicado: boolean;
  created_at?: string;
}

export interface ConteudoAula {
  id: string;
  modulo_id: string;
  titulo: string;
  descricao?: string | null;
  capa_url?: string | null;
  tipo: TipoAula;
  youtube_id?: string | null;
  /** Caminho dentro do bucket `conteudos`, não URL. */
  video_path?: string | null;
  duracao_segundos?: number | null;
  destaque: boolean;
  ordem: number;
  publicado: boolean;
  created_at?: string;
}

export interface ConteudoProgresso {
  aluna_id: string;
  aula_id: string;
  segundos: number;
  concluida: boolean;
  updated_at?: string;
}

export interface ModuloComAulas extends ConteudoModulo {
  aulas: ConteudoAula[];
}

export interface ProdutoComModulos extends ConteudoProduto {
  modulos: ModuloComAulas[];
}

/** Todas as aulas de um produto, na ordem em que aparecem pra aluna. */
export function aulasDoProduto(produto: ProdutoComModulos): ConteudoAula[] {
  return produto.modulos.flatMap((m) => m.aulas);
}

/** Capa que a aula mostra na prateleira: a própria, ou a do YouTube. */
export function capaDaAula(aula: ConteudoAula): string | null {
  if (aula.capa_url) return aula.capa_url;
  if (aula.tipo === "youtube" && aula.youtube_id) {
    return `https://i.ytimg.com/vi/${aula.youtube_id}/hqdefault.jpg`;
  }
  return null;
}

/** mm:ss ou h:mm:ss. Aula sem duração cadastrada não mostra nada. */
export function duracaoLegivel(segundos?: number | null): string | null {
  if (!segundos || segundos <= 0) return null;
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = Math.floor(segundos % 60);
  const dois = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dois(m)}:${dois(s)}` : `${m}:${dois(s)}`;
}

/**
 * Quanto da aula já foi assistido, de 0 a 100. Sem duração cadastrada não dá
 * pra calcular percentual — devolve 0 pra barra não mentir.
 */
export function percentualAssistido(
  segundosVistos?: number | null,
  duracao?: number | null,
): number {
  if (!segundosVistos || !duracao || duracao <= 0) return 0;
  return Math.min(100, Math.round((segundosVistos / duracao) * 100));
}

/**
 * Aula já começada mas não terminada. É o que alimenta "Continue assistindo" —
 * quem só deu play e parou nos primeiros segundos não entra, senão a prateleira
 * enche de ruído.
 */
export function emAndamento(p: ConteudoProgresso, aula?: ConteudoAula): boolean {
  if (p.concluida) return false;
  if (p.segundos < 15) return false;
  if (aula?.duracao_segundos && p.segundos >= aula.duracao_segundos - 20) return false;
  return true;
}
