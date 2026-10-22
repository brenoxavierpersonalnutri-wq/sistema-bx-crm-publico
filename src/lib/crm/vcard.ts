// Contato compartilhado no WhatsApp chega como texto vCard cru (BEGIN:VCARD ... END:VCARD).
// Aqui viram dados de cartão: nome e telefones (com o número do WhatsApp, quando o waid vem).

export interface TelefoneVCard {
  /** Só dígitos, pronto para comparar com contact_phone (ex.: 5511999998888). */
  digitos: string;
  /** Como veio no cartão, para exibir se não der para formatar. */
  original: string;
}

export interface ContatoVCard {
  nome: string;
  telefones: TelefoneVCard[];
}

const RE_BLOCO = /BEGIN:VCARD[\s\S]*?END:VCARD/gi;

/** True quando o texto contém pelo menos um vCard completo. */
export function ehVCard(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return /BEGIN:VCARD/i.test(texto) && /END:VCARD/i.test(texto);
}

/** Desfaz o "line folding" do vCard (linha que começa com espaço/tab continua a anterior). */
function desdobrar(bloco: string): string[] {
  return bloco.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function desescapar(v: string): string {
  return v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
}

function lerBloco(bloco: string): ContatoVCard | null {
  let fn = "";
  let n = "";
  const telefones: TelefoneVCard[] = [];
  for (const linha of desdobrar(bloco)) {
    const i = linha.indexOf(":");
    if (i <= 0) continue;
    const chaveCompleta = linha.slice(0, i);
    const valor = linha.slice(i + 1);
    // "item1.TEL;type=CELL;waid=5511..." -> nome da propriedade é TEL
    const partes = chaveCompleta.split(";");
    const prop = partes[0].split(".").pop()!.toUpperCase();
    if (prop === "FN") fn = desescapar(valor);
    else if (prop === "N" && !n) n = desescapar(valor.split(";").filter(Boolean).reverse().join(" "));
    else if (prop === "TEL") {
      const waid = partes.map((p) => /^waid=(\d{6,20})$/i.exec(p.trim())?.[1]).find(Boolean);
      const digitos = waid || valor.replace(/\D/g, "");
      if (digitos.length >= 6 && !telefones.some((t) => t.digitos === digitos)) {
        telefones.push({ digitos, original: valor.trim() });
      }
    }
  }
  const nome = fn || n;
  if (!nome && telefones.length === 0) return null;
  return { nome: nome || "Contato", telefones };
}

/** Todos os contatos do texto (um compartilhamento pode trazer vários). Vazio se não for vCard. */
export function lerVCards(texto: string | null | undefined): ContatoVCard[] {
  if (!texto || !ehVCard(texto)) return [];
  const blocos = texto.match(RE_BLOCO) ?? [];
  return blocos.map(lerBloco).filter((c): c is ContatoVCard => c !== null);
}
