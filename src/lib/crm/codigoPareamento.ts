// "Entrar com número de telefone" em /crm/conexoes: máscara do número, validação e formato do código de 8
// caracteres do WhatsApp. Lógica pura (testada em src/test/codigoPareamento.test.tsx).

/** Só dígitos. */
export const soDigitos = (v: string): string => String(v ?? "").replace(/\D/g, "");

/** DDI: 1 a 3 dígitos. */
export const normalizarDdi = (v: string): string => soDigitos(v).slice(0, 3);

/** Número local digitado: no Brasil, até 11 dígitos (DDD + 9); fora, até 13. */
export function normalizarLocal(ddi: string, v: string): string {
  return soDigitos(v).slice(0, ddi === "55" ? 11 : 13);
}

/** Máscara BR: (31) 99999-8888 / (31) 3333-4444; outro DDI fica só com os dígitos. */
export function mascararLocal(ddi: string, local: string): string {
  const d = normalizarLocal(ddi, local);
  if (ddi !== "55") return d;
  if (d.length <= 2) return d.length ? `(${d}` : "";
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  if (resto.length <= 4) return `(${ddd}) ${resto}`;
  const corte = resto.length === 9 ? 5 : 4;
  return `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
}

/** Telefone completo (DDI + local) pronto para o pedido, ou null quando ainda não é válido. */
export function telefoneCompleto(ddi: string, local: string): string | null {
  const i = normalizarDdi(ddi);
  const l = normalizarLocal(i, local);
  if (!i) return null;
  if (i === "55") {
    if (l.length !== 10 && l.length !== 11) return null;
    if (l.startsWith("0") || l[0] === undefined) return null;
  }
  const t = `${i}${l}`;
  return /^\d{10,15}$/.test(t) ? t : null;
}

/** Telefone já gravado (ex.: 5531999998888) separado em DDI/local para pré-preencher. BR só. */
export function separarTelefoneBR(t: string | null | undefined): { ddi: string; local: string } {
  const d = soDigitos(t ?? "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return { ddi: "55", local: d.slice(2) };
  return { ddi: "55", local: "" };
}

/** ABCD1234 -> ABCD-1234 (como o WhatsApp mostra). */
export function formatarCodigo(c: string): string {
  const s = String(c ?? "").replace(/[\s-]/g, "").toUpperCase();
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

/** Segundos restantes -> m:ss. */
export function formatarRestante(seg: number): string {
  const s = Math.max(0, Math.floor(seg));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Número no formato em que o WhatsApp registra a conta (mesma regra de
 * supabase/functions/_shared/codigoPareamentoWa.ts, conferida pelo teste): celular BR de DDD 11-28 com o 9
 * (13 dígitos), DDD 31 em diante SEM o 9 (12 dígitos). Fixo e outro país passam como vieram.
 */
export function telefoneWhatsapp(t: string): string {
  const d = soDigitos(t);
  if (!d.startsWith("55")) return d;
  const ddd = Number(d.slice(2, 4));
  const local = d.slice(4);
  if (ddd >= 31 && local.length === 9 && local[0] === "9" && /^[6-9]/.test(local.slice(1))) return `55${d.slice(2, 4)}${local.slice(1)}`;
  if (ddd >= 11 && ddd <= 28 && local.length === 8 && /^[6-9]/.test(local)) return `55${d.slice(2, 4)}9${local}`;
  return d;
}

/** 5531999998888 -> "+55 (31) 99999-8888"; outro país: "+<dígitos>". */
export function exibirTelefone(t: string): string {
  const d = soDigitos(t);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return `+55 ${mascararLocal("55", d.slice(2))}`;
  return `+${d}`;
}
