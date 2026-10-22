// Fluxos de várias etapas (espelho dos workflows do Full Funnel) e catálogo de templates oficiais.
// Tabelas da migration 20261023120000 (fora do types.ts gerado): acesso via `db`.
export {
  ETAPAS_FLUXO,
  MAX_PASSOS,
  resumoPasso,
  templatesNaoAprovados,
  validarFluxo,
  variaveisDoTemplate,
  type Condicao,
  type Desvio,
  type ExecucaoFluxo,
  type Fluxo,
  type FluxoGatilho,
  type PassoFluxo,
  type UnidadeEspera,
} from "../../supabase/functions/_shared/fluxos.ts";
export { db } from "@/lib/crmRoteiros";

export interface TemplateOficial {
  nome: string;
  meta_id: string | null;
  categoria: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  idioma: string;
  status: string;
  corpo: string;
  cabecalho: unknown;
  botoes: { type: string; text: string; url?: string }[];
  rotulos_variaveis: Record<string, string>;
  origem: string;
  sincronizado_em: string;
}

export const ROTULO_GATILHO_FLUXO: Record<string, string> = {
  evento: "Evento externo",
  tag: "Recebeu a tag",
  etapa: "Entrou na etapa",
};

/** Eventos que os produtores (PagTrust, formulário) podem registrar com crm_registrar_evento. */
export const EVENTOS_SUGERIDOS = [
  "lead_qualificado",
  "pagtrust_desafio_compra_aprovada",
  "pagtrust_desafio_carrinho_abandonado",
  "pagtrust_lowticket_compra_aprovada",
  "pagtrust_lowticket_carrinho_abandonado",
];

/** Valores aceitos nas variáveis do template: dados do contato e campos do evento. */
export const VALORES_VARIAVEL = ["{primeiro_nome}", "{nome}", "{telefone}", "{dados.email}", "{dados.produto}"];
