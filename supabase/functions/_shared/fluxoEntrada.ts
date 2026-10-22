// Entrada de leads por webhook/API de um fluxo (igual ao "Webhook" do SellFlux): regras puras, sem Deno e
// sem banco. Usadas pela edge function fluxo-entrada e pela tela (mapeamento de campos). Testadas em
// src/test/crmFluxoEntrada.test.ts.
//
// Quem manda o POST (formulário de site, plataforma de vendas, Make/n8n, outro CRM) não segue padrão de
// nome de campo: o fluxo guarda um MAPEAMENTO (qual chave do JSON é nome/telefone/email/tags) e a tela mostra
// a última requisição recebida para escolher as chaves. Sem mapeamento, tenta os nomes mais comuns.
import { normalizarTag } from "./automacoes.ts";
import { normalizarEvento } from "./fluxos.ts";

export interface MapeamentoEntrada {
  nome?: string | null;
  telefone?: string | null;
  email?: string | null;
  tags?: string | null;
  /** chave com o nome de um evento extra (vira evento wh_<nome> para outros fluxos) */
  evento?: string | null;
}

export const CAMPOS_MAPEAVEIS: { campo: keyof MapeamentoEntrada; rotulo: string; obrigatorio?: boolean }[] = [
  { campo: "telefone", rotulo: "Telefone (WhatsApp)", obrigatorio: true },
  { campo: "nome", rotulo: "Nome" },
  { campo: "email", rotulo: "E-mail" },
  { campo: "tags", rotulo: "Tags (lista ou separadas por vírgula)" },
  { campo: "evento", rotulo: "Evento (opcional)" },
];

/** Nomes comuns, tentados quando o campo não foi mapeado. */
const PALPITES: Record<keyof MapeamentoEntrada, string[]> = {
  telefone: ["telefone", "phone", "whatsapp", "celular", "tel", "mobile", "fone", "phone_number", "telefone_whatsapp",
    "contact.phone", "lead.phone", "customer.phone", "buyer.phone", "buyer.checkout_full_phone", "data.buyer.checkout_full_phone"],
  nome: ["nome", "name", "full_name", "nome_completo", "first_name", "primeiro_nome", "contact.name", "lead.name", "customer.name", "buyer.name"],
  email: ["email", "e-mail", "e_mail", "mail", "contact.email", "lead.email", "customer.email", "buyer.email"],
  tags: ["tags", "tag", "etiquetas"],
  evento: [],
};

export const MAX_CORPO_BYTES = 64 * 1024;

/** Lê "a.b.0.c" (ou a chave literal, que pode ter ponto/colchete: "contact[phone]"). */
export function lerCaminho(obj: unknown, caminho: string | null | undefined): unknown {
  const c = String(caminho ?? "").trim();
  if (!c || obj === null || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  if (c in o) return o[c];
  let atual: unknown = obj;
  for (const parte of c.replace(/\[(\w+)\]/g, ".$1").split(".")) {
    if (atual === null || typeof atual !== "object") return undefined;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return atual;
}

/** Todas as chaves folha do corpo ("buyer.phone"), com um valor de exemplo (para o mapeamento na tela). */
export function chavesDoCorpo(corpo: unknown, max = 200): { chave: string; exemplo: string }[] {
  const saida: { chave: string; exemplo: string }[] = [];
  const andar = (v: unknown, prefixo: string, prof: number) => {
    if (saida.length >= max) return;
    if (v !== null && typeof v === "object" && !Array.isArray(v) && prof < 6) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) andar(x, prefixo ? `${prefixo}.${k}` : k, prof + 1);
      return;
    }
    if (!prefixo) return;
    const ex = Array.isArray(v) ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ") : v === null || v === undefined ? "" : String(v);
    saida.push({ chave: prefixo, exemplo: ex.slice(0, 80) });
  };
  andar(corpo, "", 0);
  return saida;
}

/**
 * Telefone BR para dígitos com DDI (5531999998888). Aceita "+55 (31) 99999-8888", "031999998888",
 * "31 9999-8888" (fixo/celular antigo de 8 dígitos começando em 6-9 ganha o 9). Número de fora do Brasil só
 * com "+" na frente (10 a 15 dígitos). Inválido = null.
 */
export function normalizarTelefoneBR(bruto: unknown): string | null {
  const texto = String(bruto ?? "").trim();
  if (!texto) return null;
  const internacional = texto.startsWith("+") && !texto.replace(/[^0-9+]/g, "").startsWith("+55");
  let d = texto.replace(/[^0-9]/g, "");
  if (internacional) return d.length >= 10 && d.length <= 15 ? d : null;
  d = d.replace(/^0+/, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = Number(d.slice(0, 2));
  let local = d.slice(2);
  if (ddd < 11 || ddd > 99) return null;
  if (local.length === 9 && local[0] !== "9") return null;
  if (local.length === 8 && /^[6-9]/.test(local)) local = `9${local}`;
  return `55${ddd}${local}`;
}

const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const texto = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return "";
  return String(v).trim();
};

function lerCampo(corpo: unknown, mapa: MapeamentoEntrada, campo: keyof MapeamentoEntrada): unknown {
  const escolhida = String(mapa[campo] ?? "").trim();
  if (escolhida) return lerCaminho(corpo, escolhida);
  for (const p of PALPITES[campo]) {
    const v = lerCaminho(corpo, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

export function tagsDe(v: unknown): string[] {
  const lista = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;]/) : [];
  return [...new Set(lista.map((x) => normalizarTag(typeof x === "object" && x ? (x as { name?: unknown; nome?: unknown }).name ?? (x as { nome?: unknown }).nome : x)).filter(Boolean))].slice(0, 30);
}

export interface LeadEntrada {
  telefone: string;
  nome: string | null;
  email: string | null;
  tags: string[];
  /** evento extra pedido no corpo (já com o prefixo wh_), ou null */
  evento: string | null;
  /** campos simples do corpo, para {dados.x} nas mensagens e condições do fluxo */
  dados: Record<string, string>;
}

/** Evento customizado vindo do webhook: sempre com prefixo wh_ (não finge ser formulário/PagTrust/banco). */
export function eventoCustomizado(v: unknown): string | null {
  const n = normalizarEvento(v);
  if (!n) return null;
  return normalizarEvento(n.startsWith("wh_") ? n : `wh_${n}`);
}

/** Corpo + mapeamento → lead pronta para gravar (ou o motivo de recusa). */
export function extrairLead(corpo: unknown, mapa: MapeamentoEntrada | null | undefined, tagsFixas: string[] = []):
  { ok: true; lead: LeadEntrada } | { ok: false; erro: string } {
  if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) return { ok: false, erro: "corpo precisa ser um objeto JSON ou formulário" };
  const m = mapa ?? {};
  const foneBruto = lerCampo(corpo, m, "telefone");
  if (foneBruto === undefined || foneBruto === null || foneBruto === "") {
    return { ok: false, erro: m.telefone ? `a chave "${m.telefone}" não veio no corpo` : "telefone não encontrado (mapeie a chave do telefone)" };
  }
  const telefone = normalizarTelefoneBR(texto(foneBruto));
  if (!telefone) return { ok: false, erro: `telefone inválido: ${texto(foneBruto).slice(0, 30)}` };
  const nome = texto(lerCampo(corpo, m, "nome")).slice(0, 120) || null;
  const emailBruto = texto(lerCampo(corpo, m, "email")).toLowerCase().slice(0, 200);
  const email = emailBruto && emailValido(emailBruto) ? emailBruto : null;
  const tags = [...new Set([...tagsFixas.map(normalizarTag), ...tagsDe(lerCampo(corpo, m, "tags"))].filter(Boolean))].slice(0, 30);
  const evento = m.evento ? eventoCustomizado(texto(lerCaminho(corpo, m.evento))) : null;
  const dados: Record<string, string> = {};
  for (const { chave } of chavesDoCorpo(corpo, 60)) {
    const v = lerCaminho(corpo, chave);
    if (v === null || v === undefined || typeof v === "object") continue;
    const k = chave.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
    if (k && !(k in dados)) dados[k] = String(v).slice(0, 300);
  }
  if (nome) dados.nome = nome;
  if (email) dados.email = email;
  dados.telefone = telefone;
  return { ok: true, lead: { telefone, nome, email, tags, evento, dados } };
}

/** Cópia do corpo para mostrar na tela: corta texto longo, profundidade e quantidade de chaves. */
export function amostraSegura(corpo: unknown, prof = 0): unknown {
  if (corpo === null || corpo === undefined) return corpo ?? null;
  if (typeof corpo === "string") return corpo.length > 500 ? `${corpo.slice(0, 500)}…` : corpo;
  if (typeof corpo !== "object") return corpo;
  if (prof >= 5) return "[…]";
  if (Array.isArray(corpo)) return corpo.slice(0, 20).map((x) => amostraSegura(x, prof + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(corpo as Record<string, unknown>).slice(0, 100)) out[k.slice(0, 80)] = amostraSegura(v, prof + 1);
  return out;
}

/** Formulário (x-www-form-urlencoded) → objeto; chave repetida vira lista. */
export function formParaObjeto(params: Iterable<[string, string]>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of params) {
    if (k in o) o[k] = Array.isArray(o[k]) ? [...(o[k] as unknown[]), v] : [o[k], v];
    else o[k] = v;
  }
  return o;
}

/** Compara a assinatura recebida (hex, com ou sem "sha256=") com a esperada, em tempo constante. */
export function assinaturaConfere(recebida: string | null | undefined, esperadaHex: string): boolean {
  const r = String(recebida ?? "").trim().toLowerCase().replace(/^sha256=/, "");
  const e = esperadaHex.toLowerCase();
  if (!r || r.length !== e.length) return false;
  let dif = 0;
  for (let i = 0; i < e.length; i++) dif |= r.charCodeAt(i) ^ e.charCodeAt(i);
  return dif === 0;
}

/** Igualdade de token em tempo constante. */
export function tokenConfere(recebido: string | null | undefined, esperado: string | null | undefined): boolean {
  const a = String(recebido ?? ""), b = String(esperado ?? "");
  if (!a || !b || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < b.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/** URL pública da entrada de um fluxo. */
export const urlEntrada = (baseFunctions: string, idPublico: string, token: string): string =>
  `${baseFunctions.replace(/\/+$/, "")}/fluxo-entrada?f=${encodeURIComponent(idPublico)}&k=${encodeURIComponent(token)}`;

/** Slug do nome do fluxo para base_leads.origem ("webhook:<slug>"). */
export const origemWebhook = (nomeFluxo: string): string =>
  `webhook:${String(nomeFluxo ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "fluxo"}`;
