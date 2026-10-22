export const formatCurrency = (value: number) => {
  if (typeof document !== "undefined" && document.body.classList.contains("privacy-on")) {
    return "R$ ••••••";
  }
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
};

export const formatCPFCNPJ = (value: string) => {
  const n = (value || "").replace(/\D/g, "");
  if (n.length <= 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, "$1.$2.$3-$4");
  return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{1,2})/, "$1.$2.$3/$4-$5");
};

export const formatPhone = (value: string) => {
  const n = (value || "").replace(/\D/g, "").slice(0, 11);
  if (n.length <= 10) return n.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3").trim();
  return n.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3").trim();
};

export const formatCardNumber = (value: string) =>
  (value || "").replace(/\s/g, "").replace(/(\d{4})/g, "$1 ").trim();

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export const TAXAS_PADRAO = {
  pix: 0.99,
  cartao_vista: 3.99,
  cartao_parcelado: 4.99,
  boleto: 2.49,
  fixa: 0.49,
};

export const calcularLiquido = (
  valor: number,
  metodo: "pix" | "cartao" | "boleto",
  parcelas = 1
) => {
  let perc = TAXAS_PADRAO.pix;
  if (metodo === "boleto") perc = TAXAS_PADRAO.boleto;
  if (metodo === "cartao") perc = parcelas > 1 ? TAXAS_PADRAO.cartao_parcelado : TAXAS_PADRAO.cartao_vista;
  const taxaValor = (valor * perc) / 100 + TAXAS_PADRAO.fixa;
  return { perc, fixa: TAXAS_PADRAO.fixa, taxaValor, liquido: Math.max(0, valor - taxaValor) };
};

export const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  pago: "Pago",
  cancelado: "Cancelado",
  reembolsado: "Reembolsado",
};

export const METODO_LABEL: Record<string, string> = {
  pix: "Pix",
  cartao: "Cartão",
  boleto: "Boleto",
};
