// Base de leads: normalização de telefone (E.164 BR), tags e linha do CSV do SellFlux.

export function telefoneParaE164(bruto: unknown): string | null {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if (!d) return null;
  d = d.replace(/^0+/, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    // já tem DDI
  } else if (d.length === 10 || d.length === 11) {
    d = "55" + d;
  } else {
    return null;
  }
  const ddd = Number(d.slice(2, 4));
  const local = d.slice(4);
  if (ddd < 11 || ddd > 99) return null;
  if (local.length === 9 && local[0] !== "9") return null;
  if (local.length === 8 && !/[2-5]/.test(local[0])) return null; // fixo
  return "+" + d;
}

export function separarTags(bruto: unknown): string[] {
  const vistas = new Set<string>();
  for (const t of String(bruto ?? "").split(/[,;]/)) {
    const v = t.trim();
    if (v) vistas.add(v);
  }
  return [...vistas];
}

// "16/10/2026 14:30:05" (BRT) ou ISO -> ISO UTC; inválido -> null
export function dataDeOrigem(bruto: unknown): string | null {
  const s = String(bruto ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = m;
    const d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface LinhaBaseLead {
  origem: string;
  origem_id: string;
  nome: string | null;
  telefone_e164: string | null;
  email: string | null;
  tags: string[];
  produto: string | null;
  status: string | null;
  criado_origem: string | null;
}

// id "pagtrust:..." vem da PagTrust; o resto é SellFlux
export function origemDoId(id: string): string {
  return id.startsWith("pagtrust:") ? "pagtrust" : "sellflux";
}

export function linhaParaLead(r: Record<string, string>): LinhaBaseLead | null {
  const id = (r.id ?? "").trim();
  if (!id) return null;
  const email = (r.email ?? "").trim().toLowerCase();
  return {
    origem: origemDoId(id),
    origem_id: id,
    nome: (r.name ?? "").trim() || null,
    telefone_e164: telefoneParaE164(r.phone),
    email: email.includes("@") ? email : null,
    tags: separarTags(r.tags),
    produto: (r["nome-do-produto"] ?? "").trim() || null,
    status: (r.status ?? "").trim() || null,
    criado_origem: dataDeOrigem(r.created_at),
  };
}

export function emLotes<T>(itens: T[], tamanho = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho));
  return out;
}

// Escapa célula contra injeção de fórmula em planilha
export function celulaCsv(v: unknown): string {
  let s = Array.isArray(v) ? v.join(",") : String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Lê uma tabela inteira em páginas, com várias páginas em paralelo.
 * A primeira página vai sozinha (tabela pequena = 1 requisição); depois, lotes de `paralelo`
 * páginas até aparecer uma página incompleta. Erro de qualquer página rejeita a promessa:
 * quem chama decide o que mostrar, e nunca fica preso em "carregando".
 * `aoAvancar` recebe o acumulado a cada lote, para a tela ir mostrando enquanto lê.
 */
export async function lerTodasAsPaginas<T>(
  buscarPagina: (de: number, ate: number) => Promise<T[]>,
  opcoes: { tamanho?: number; paralelo?: number; aoAvancar?: (parcial: T[]) => void } = {},
): Promise<T[]> {
  const tamanho = opcoes.tamanho ?? 1000;
  const paralelo = Math.max(1, opcoes.paralelo ?? 4);
  const primeira = await buscarPagina(0, tamanho - 1);
  const todos: T[] = [...primeira];
  opcoes.aoAvancar?.(todos);
  if (primeira.length < tamanho) return todos;
  for (let pagina = 1; ; pagina += paralelo) {
    const lote = await Promise.all(
      Array.from({ length: paralelo }, (_, i) => {
        const de = (pagina + i) * tamanho;
        return buscarPagina(de, de + tamanho - 1);
      }),
    );
    let acabou = false;
    for (const linhas of lote) {
      todos.push(...linhas);
      if (linhas.length < tamanho) {
        acabou = true;
        break;
      }
    }
    opcoes.aoAvancar?.(todos);
    if (acabou) return todos;
  }
}
