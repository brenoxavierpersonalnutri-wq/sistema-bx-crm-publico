// Fonte de DEMONSTRAÇÃO da tela de fluxos (rota /dev/automacao-v2, só em desenvolvimento): dados fictícios em
// memória, nada vai ao banco. Espelha os 5 workflows do Full Funnel + um fluxo de exemplo com Se/Senão.
import {
  compilarArvore,
  no,
  normalizarFluxo,
  origemWebhook,
  type CatalogoConstrutor,
  type EntradaFluxo,
  type ExecucaoLinha,
  type FluxoConstrutor,
  type FonteFluxos,
  type LinhaListaFluxo,
  type LogLinha,
  type NoFluxo,
  type Pasta,
} from "./fluxosConstrutor";
import type { GatilhoFluxo } from "../../../supabase/functions/_shared/fluxos.ts";
import { normalizarTag, type TagExistente } from "./tags";

const OFICIAL = "num-oficial";
const CLOSER = "num-closer";

const CATALOGO: CatalogoConstrutor = {
  numeros: [
    { id: CLOSER, apelido: "Closer", tipo: "openwa", telefone: null, ativo: true },
    { id: "num-fit2", apelido: "Comercial Fit 2", tipo: "openwa", telefone: null, ativo: true },
    { id: "num-sup", apelido: "Suporte Consultoria", tipo: "openwa", telefone: null, ativo: true },
    { id: "num-impl", apelido: "Comercial Implementação", tipo: "openwa", telefone: null, ativo: true },
    { id: OFICIAL, apelido: "Oficial (Full Funnel)", tipo: "oficial", telefone: "553170000102", ativo: true },
  ],
  templates: [
    { nome: "qualificadoavaliacao", status: "APPROVED", categoria: "UTILITY", corpo: "Olá, {{1}}! 👋\n\nRecebemos o seu formulário de avaliação com sucesso. ✅\n\nAgora é só tocar no botão abaixo para iniciar a sua avaliação.", rotulos_variaveis: { "1": "nome" } },
    { nome: "boasvindas", status: "APPROVED", categoria: "MARKETING", corpo: "Sua compra na oferta especial do meu *{{1}}* acaba de ser confirmada... {{2}} ... Email: {{3}}", rotulos_variaveis: { "1": "produto", "2": "nome", "3": "email" } },
    { nome: "acesso_desafio_grupo_v1", status: "APPROVED", categoria: "UTILITY", corpo: "Olá, {{1}}! Seu pagamento do DESAFIO MAIS SLIM 14 DIAS foi aprovado.", rotulos_variaveis: { "1": "nome" } },
  ],
  segmentos: [
    { id: "seg-qualif", nome: "Avaliação qualificados" },
    { id: "seg-abandono", nome: "Abandonou carrinho / Pix não pago" },
    { id: "seg-compradores", nome: "Compradores PagTrust" },
    { id: "seg-ex", nome: "Ex-alunas", alunas: true },
  ],
  listas: ["avaliacao", "compra", "individual", "pagtrust", "sellflux"],
  roteiros: [{ id: "rot-1", nome: "Recuperação de carrinho (3 mensagens)" }, { id: "rot-2", nome: "Boas-vindas avaliação" }],
  passosRoteiro: [{ id: "pr-1", roteiro_id: "rot-1", ordem: 1, rotulo: "Oi, vi que ficou faltando..." }],
  agentes: [
    { id: "ag-avaliacao", slug: "avaliacao", nome: "Agente Avaliação", tipo: "atendimento" },
    { id: "ag-individual", slug: "individual", nome: "Agente Individual", tipo: "atendimento" },
    { id: "ag-followup", slug: "followup-demo", nome: "Follow-up", tipo: "followup" },
  ],
  atendentes: ["Breno Xavier", "Gabi (closer)", "Suporte"],
  fluxos: [],
};

const dia = (d: number, h = 10) => new Date(Date.UTC(2026, 9, d, h + 3, 12)).toISOString();

function base(id: string, nome: string, ff: string | null, gatilhos: GatilhoFluxo[], arvore: NoFluxo[], extra: Partial<FluxoConstrutor> = {}): FluxoConstrutor {
  return normalizarFluxo({
    id, nome, descricao: null, ativo: false, gatilho_tipo: gatilhos[0]?.tipo ?? "evento", gatilho_valor: null, gatilhos,
    parar_se_responder: false, permitir_repetir: true, ligado_em: null, origem_ff_workflow_id: ff, numero_id: OFICIAL,
    config: { hora_inicio: 8, hora_fim: 20, limite_dia: 100 }, canvas: {}, pasta_id: "pasta-ff", excluido_em: null,
    created_at: dia(17, 9), updated_at: dia(17, 11), arvore, passos: compilarArvore(arvore), ...extra,
  });
}

const tag = (t: string) => no({ tipo: "tag", acao: "por", tag: t });

function semente(): FluxoConstrutor[] {
  return [
    base("f-leads", "Leads qualificados – Breno Xavier (FF)", "621465f1-a79b-41a0-9c94-54553b23ae3c",
      [{ tipo: "evento", valor: "lead_qualificado" }],
      [tag("lead-qualificado-breno"), tag("lead-qualificado-avaliacao"),
        no({ tipo: "whatsapp", numero_id: OFICIAL, template: "qualificadoavaliacao", variaveis: { "1": "{primeiro_nome}" } })]),
    base("f-dca", "PagTrust Desafio – Carrinho abandonado (FF)", "2cde495b-5650-4d0d-af57-121a605c2cf6",
      [{ tipo: "evento", valor: "pagtrust_desafio_carrinho_abandonado" }], [tag("desafio-carrinho-abandonado")]),
    base("f-dcp", "PagTrust Desafio – Compra aprovada (FF)", "fcb742cf-88cb-4546-9ed3-b03f9ef24bae",
      [{ tipo: "evento", valor: "pagtrust_desafio_compra_aprovada" }], [tag("desafio-compradora")]),
    base("f-lca", "PagTrust Low Ticket – Carrinho abandonado (FF)", "005c66c3-50d6-483c-9880-7dab49371a7f",
      [{ tipo: "evento", valor: "pagtrust_lowticket_carrinho_abandonado" }], [tag("lowticket-carrinho-abandonado")]),
    base("f-lcp", "PagTrust Low Ticket – Compra aprovada (FF)", "0aadc5a9-f954-49b6-ac40-6c80e17b5022",
      [{ tipo: "evento", valor: "pagtrust_lowticket_compra_aprovada" }], [tag("lowticket-comprador")]),
    base("f-recup", "Recuperação de Pix (exemplo)", null,
      [{ tipo: "evento", valor: "pagtrust_desafio_pix_gerado" }, { tipo: "segmento", segmento_id: "seg-abandono", modo: "novos" }],
      [
        no({ tipo: "esperar", quantidade: 30, unidade: "minutos" }),
        no({ tipo: "whatsapp", numero_id: CLOSER, texto: "Oi {primeiro_nome}, vi que seu Pix ficou pendente. Posso te ajudar?" }),
        no({ tipo: "esperar", quantidade: 1, unidade: "dias", ate_responder: true }),
        no({
          tipo: "se", condicao: { tipo: "respondeu" },
          sim: [no({ tipo: "etapa", etapa: "contato" }), no({ tipo: "atribuir", atendente: "Gabi (closer)" })],
          nao: [no({ tipo: "whatsapp", numero_id: CLOSER, roteiro_id: "rot-1" }), tag("pix-sem-resposta")],
        }),
      ],
      { ativo: true, pasta_id: null, numero_id: CLOSER, parar_se_responder: true, updated_at: dia(17, 14), canvas: { zoom: 0.7, x: 0, y: 0 } }),
    base("f-velho", "Teste antigo (excluído)", null, [{ tipo: "tag", valor: "teste" }], [tag("x")],
      { pasta_id: null, excluido_em: dia(15), updated_at: dia(15) }),
  ];
}

const RESUMO: Record<string, LinhaListaFluxo["resumo"]> = {
  "f-recup": { total_inscritos: 18, inscritos_ativos: 6, enviados: 27, respondidos: 7, falhas: 1 },
};

function execucoes(id: string): ExecucaoLinha[] {
  if (id !== "f-recup") return [];
  const nomes = ["Ana Paula", "Juliana Reis", "Camila Souza", "Marta Lima", "Bruna Alves", "Patrícia Gomes"];
  const st: ExecucaoLinha["status"][] = ["ativo", "concluido", "parado", "ativo", "erro", "concluido"];
  return nomes.map((n, i) => ({
    id: 100 + i, fluxo_id: id, contact_phone: `55319990000${i}`, passo_idx: [2, 9, 3, 1, 4, 9][i], status: st[i],
    proximo_em: dia(18, 9), aguardando_resposta: i === 0, iniciado_em: dia(17, 8 + i), ultimo_envio_em: dia(17, 9 + i),
    dados: {}, nome_contato: n, motivo: st[i] === "parado" ? "a lead respondeu (parar se responder)" : st[i] === "erro" ? "não entrou na fila: número desativado" : null,
  }));
}

function logs(id: string): LogLinha[] {
  if (id !== "f-recup") return [];
  return [
    { id: 9, contact_phone: "553199900000", canal: "whatsapp", tipo: "text", status: "ok", detalhe: "passo 1", created_at: dia(17, 9) },
    { id: 8, contact_phone: "553199900001", canal: "crm", tipo: "etapa", status: "ok", detalhe: "→ contato (fluxo passo 6)", created_at: dia(17, 10) },
    { id: 7, contact_phone: "553199900004", canal: "whatsapp", tipo: "text", status: "erro", detalhe: "passo 1: HTTP 503", created_at: dia(17, 12) },
    { id: 6, contact_phone: "553199900002", canal: "crm", tipo: "atribuir", status: "ok", detalhe: "atendente Gabi (closer)", created_at: dia(17, 13) },
  ];
}

export function criarFonteDemo(): FonteFluxos {
  let fluxos = semente();
  let pastas: Pasta[] = [{ id: "pasta-ff", nome: "Espelho do Full Funnel" }];
  const achar = (id: string) => fluxos.find((f) => f.id === id);
  const tocar = (f: FluxoConstrutor) => { f.updated_at = new Date().toISOString(); };
  return {
    demo: true,
    async listar() {
      return fluxos.map((f) => ({
        id: f.id, nome: f.nome, ativo: f.ativo, pasta_id: f.pasta_id, excluido_em: f.excluido_em, created_at: f.created_at,
        updated_at: f.updated_at, gatilhos: f.gatilhos ?? [], origem_ff_workflow_id: f.origem_ff_workflow_id ?? null,
        resumo: RESUMO[f.id] ?? { total_inscritos: 0, inscritos_ativos: 0, enviados: 0, respondidos: 0, falhas: 0 },
      }));
    },
    async pastas() { return pastas; },
    async criarPasta(nome) { const p = { id: `pasta-${Date.now()}`, nome }; pastas = [...pastas, p]; return p; },
    async moverPasta(id, pasta) { const f = achar(id); if (f) { f.pasta_id = pasta; tocar(f); } },
    async obter(id) { const f = achar(id); return f ? JSON.parse(JSON.stringify(f)) : null; },
    async criar(nome, pasta, modelo) {
      const f = modelo
        ? base(`f-${Date.now()}`, nome || modelo.nome || "Novo fluxo", null, modelo.gatilhos ?? [], modelo.arvore, {
            pasta_id: pasta, numero_id: modelo.numero_id ?? null, parar_se_responder: modelo.parar_se_responder ?? true,
            permitir_repetir: !!modelo.permitir_repetir, config: modelo.config ?? undefined, ativo: false,
          })
        : base(`f-${Date.now()}`, nome || "Novo fluxo", null, [], [], { pasta_id: pasta, numero_id: null, parar_se_responder: true });
      fluxos = [f, ...fluxos];
      return f.id;
    },
    async salvar(f) {
      const novo = { ...JSON.parse(JSON.stringify(f)), passos: compilarArvore(f.arvore), updated_at: new Date().toISOString() };
      fluxos = fluxos.map((x) => (x.id === f.id ? novo : x));
      return novo.updated_at;
    },
    async salvarCanvas(id, canvas) { const f = achar(id); if (f) f.canvas = canvas; },
    async publicar(id, ativo) { const f = achar(id); if (f) { f.ativo = ativo; tocar(f); } },
    async excluir(id) { const f = achar(id); if (f) { f.excluido_em = new Date().toISOString(); f.ativo = false; tocar(f); } },
    async restaurar(id) { const f = achar(id); if (f) { f.excluido_em = null; tocar(f); } },
    async catalogo() { return { ...CATALOGO, fluxos: fluxos.filter((f) => !f.excluido_em).map((f) => ({ id: f.id, nome: f.nome })) }; },
    async historico(id) { return execucoes(id); },
    async logs(id) { return logs(id); },
    async cancelarExecucao() { /* demonstração */ },
    async entrada(fluxoId, nomeFluxo) {
      if (!entradas.has(fluxoId)) entradas.set(fluxoId, {
        fluxo_id: fluxoId, id_publico: "a1b2c3d4e5f6a7b8c9", token: "demo".padEnd(48, "0"), segredo_assinatura: null, ativo: true,
        mapeamento: {}, tags: [], origem: origemWebhook(nomeFluxo), limite_minuto: 60, total: 1,
        ultima_amostra: { name: "Maria Silva", phone: "+55 (31) 99999-0000", email: "maria@exemplo.com", tags: "lead-site, ebook", utm_source: "instagram" },
        ultima_em: new Date().toISOString(), ultimo_status: "rascunho", ultimo_erro: null,
      });
      return { ...entradas.get(fluxoId)! };
    },
    async salvarEntrada(fluxoId, patch) { const e = entradas.get(fluxoId); if (e) entradas.set(fluxoId, { ...e, ...patch }); },
    async novoTokenEntrada(fluxoId) { const e = entradas.get(fluxoId)!; e.token = `novo${Date.now()}`.padEnd(48, "0"); return e.token; },
    async assinaturaEntrada(fluxoId, ligar) { const e = entradas.get(fluxoId)!; e.segredo_assinatura = ligar ? "segredo".padEnd(48, "0") : null; return e.segredo_assinatura; },
    async tags() { return TAGS_DEMO; },
    async criarTag(nome) { const t = normalizarTag(nome); if (!TAGS_DEMO.some((x) => x.tag === t)) TAGS_DEMO.push({ tag: t, uso: 0 }); return t; },
  };
}

const TAGS_DEMO: TagExistente[] = [
  { tag: "lead-qualificado-avaliacao", uso: 812 }, { tag: "comprou-desafio", uso: 340 }, { tag: "carrinho-abandonado", uso: 122 },
  { tag: "lead-qualificado-breno", uso: 70 }, { tag: "vip", uso: 12 },
];
const entradas = new Map<string, EntradaFluxo>();
