// Disparo em grupo (/crm/disparo-grupos, 20/10/2026): montagem do disparo, validações (enquete 2-12, grupo
// fora da allowlist, limite diário, permissão), modo split do link, permissão no grupo e as rotas novas do proxy.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } } }));

import {
  montarDisparo, duracaoEstimadaMin, statusDoDisparo, problemasConfiguracao, problemasAgendarCriacao,
  LIMITE_GRUPO_POR_DIA, type AlvoDisparo, type EntradaDisparo,
} from "@/lib/disparoGrupos";
import { destinoGruposAntigo } from "@/lib/crm/rotasGrupos";
import {
  escolherGrupo, escolherGrupoSplit, escolherGrupoModo, simularCliques, ocupacaoPct, pesoValido, numeroCriaGrupo,
  permissaoGrupo, podeConfigurar, podeDisparar, planejarEnvios, MSG_NUMERO_NAO_CRIA, type GrupoDaCampanha,
} from "../../supabase/functions/_shared/grupos";
import { montarPedidoAdminGrupo, resumoGrupo, souAdminDe, ROTAS_ADMIN_GRUPO, ROTAS_COM_SESSAO } from "../../infra/wa-proxy/lib.mjs";

const AGORA = new Date("2026-10-20T15:00:00.000Z");
const chat = (n: number) => `12036300000000000${n}@g.us`;
const alvo = (n: number, extra: Partial<AlvoDisparo> = {}): AlvoDisparo => ({
  grupo_id: `g${n}`, campanha_id: "c1", numero_id: "n1", chat_id: chat(n), nome: `Turma ${n}`, ativo: true, permissao: "admin", ...extra,
});
const entrada = (extra: Partial<EntradaDisparo> = {}): EntradaDisparo => ({
  numero_id: "n1",
  alvos: [alvo(1), alvo(2)],
  allowlist: new Set([chat(1), chat(2), chat(3)]),
  mensagem: { tipo: "texto", texto: "Aula hoje às 20h https://x.com", midia_path: null },
  quando: "agora",
  enviosHoje: 0,
  disparoId: "d-1",
  agora: AGORA,
  ...extra,
});

describe("montarDisparo", () => {
  it("texto agora: uma linha por campanha, com grupos_alvo e disparo_id", () => {
    const r = montarDisparo(entrada());
    expect(r.problemas).toEqual([]);
    expect(r.linhas).toEqual([{
      campanha_id: "c1", agendado_para: AGORA.toISOString(), tipo: "texto", texto: "Aula hoje às 20h https://x.com",
      midia_path: null, nome_arquivo: null, link_preview: true, grupos_alvo: ["g1", "g2"], disparo_id: "d-1",
    }]);
    expect(r.total).toBe(2);
  });

  it("grupos de duas campanhas do mesmo número viram duas linhas com o mesmo disparo_id", () => {
    const r = montarDisparo(entrada({ alvos: [alvo(1), alvo(2, { campanha_id: "c2" }), alvo(3, { campanha_id: "c2" })] }));
    expect(r.problemas).toEqual([]);
    expect(r.linhas.map((l) => [l.campanha_id, l.grupos_alvo])).toEqual([["c1", ["g1"]], ["c2", ["g2", "g3"]]]);
    expect(new Set(r.linhas.map((l) => l.disparo_id))).toEqual(new Set(["d-1"]));
  });

  it("mesmo grupo escolhido duas vezes sai uma vez só", () => {
    const r = montarDisparo(entrada({ alvos: [alvo(1), alvo(1, { grupo_id: "g1-copia", campanha_id: "c2" })] }));
    expect(r.total).toBe(1);
    expect(r.linhas[0].grupos_alvo).toEqual(["g1"]);
  });

  it("enquete: 2 a 12 opções, sem repetidas, pergunta obrigatória", () => {
    const enquete = (opcoes: string[], texto = "Qual horário?") => montarDisparo(entrada({ mensagem: { tipo: "enquete", texto, midia_path: null, enquete_opcoes: opcoes } }));
    expect(enquete(["19h"]).problemas).toContain("Enquete precisa de 2 a 12 opções.");
    expect(enquete(Array.from({ length: 13 }, (_, i) => `op${i}`)).problemas).toContain("Enquete precisa de 2 a 12 opções.");
    expect(enquete(["19h", "19h"]).problemas).toContain("Opções repetidas.");
    expect(enquete(["19h", "20h"], "").problemas).toContain("Escreva a pergunta da enquete.");
    const ok = enquete([" 19h ", "20h", ""], "Qual horário?");
    expect(ok.problemas).toEqual([]);
    expect(ok.linhas[0]).toMatchObject({ tipo: "enquete", enquete_opcoes: ["19h", "20h"], enquete_multipla: false, midia_path: null });
  });

  it("grupo fora da allowlist do proxy é recusado", () => {
    const r = montarDisparo(entrada({ alvos: [alvo(1), alvo(9)] }));
    expect(r.linhas).toEqual([]);
    expect(r.problemas.some((p) => p.includes("Turma 9") && p.includes("allowlist"))).toBe(true);
  });

  it("limite de 200 envios a grupo por dia no número", () => {
    expect(montarDisparo(entrada({ enviosHoje: LIMITE_GRUPO_POR_DIA - 2 })).problemas).toEqual([]);
    const r = montarDisparo(entrada({ enviosHoje: LIMITE_GRUPO_POR_DIA - 1 }));
    expect(r.problemas.some((p) => p.includes("200 envios"))).toBe(true);
  });

  it("no máximo 200 grupos por disparo", () => {
    const muitos = Array.from({ length: 201 }, (_, i) => alvo(1, { grupo_id: `x${i}`, chat_id: `1203630000000${String(i).padStart(5, "0")}@g.us` }));
    const r = montarDisparo(entrada({ alvos: muitos, allowlist: new Set(muitos.map((a) => a.chat_id!)) }));
    expect(r.problemas).toContain("No máximo 200 grupos por disparo.");
  });

  it("permissão: só admins enviam e número não é admin = recusa; não lida = só aviso", () => {
    const sem = montarDisparo(entrada({ alvos: [alvo(1, { permissao: "sem_permissao" })] }));
    expect(sem.problemas.some((p) => p.includes("só admins enviam"))).toBe(true);
    const so = montarDisparo(entrada({ alvos: [alvo(1, { permissao: "so_envio" })] }));
    expect(so.problemas).toEqual([]);
    const nao = montarDisparo(entrada({ alvos: [alvo(1, { permissao: "desconhecida" })] }));
    expect(nao.problemas).toEqual([]);
    expect(nao.avisos.some((a) => a.includes("permissão não lida"))).toBe(true);
  });

  it("sem número, sem grupo, grupo de outro número, sem id, desativado ou campanha encerrada", () => {
    expect(montarDisparo(entrada({ numero_id: null })).problemas).toContain("Escolha o número que dispara.");
    expect(montarDisparo(entrada({ alvos: [] })).problemas).toContain("Escolha pelo menos 1 grupo.");
    expect(montarDisparo(entrada({ alvos: [alvo(1, { numero_id: "n2" })] })).problemas.some((p) => p.includes("outro número"))).toBe(true);
    expect(montarDisparo(entrada({ alvos: [alvo(1, { chat_id: null })] })).problemas.some((p) => p.includes("não tem id"))).toBe(true);
    expect(montarDisparo(entrada({ alvos: [alvo(1, { ativo: false })] })).problemas.some((p) => p.includes("desativado"))).toBe(true);
    expect(montarDisparo(entrada({ alvos: [alvo(1, { campanha_encerrada: true })] })).problemas.some((p) => p.includes("encerrada"))).toBe(true);
  });

  it("travar/destravar não são disparo", () => {
    expect(montarDisparo(entrada({ mensagem: { tipo: "travar", texto: null, midia_path: null } })).problemas).toContain("Tipo de mensagem não vale para disparo.");
  });

  it("mídia: precisa do arquivo; áudio gravado (ptt) sem legenda; documento leva o nome; mencionar todos", () => {
    expect(montarDisparo(entrada({ mensagem: { tipo: "imagem", texto: "legenda", midia_path: null } })).problemas).toContain("Envie o arquivo da mídia.");
    const audio = montarDisparo(entrada({ mensagem: { tipo: "audio", texto: null, midia_path: "x/a.ogg", ptt: true, mencionar_todos: true } }));
    expect(audio.problemas).toEqual([]);
    expect(audio.linhas[0]).toMatchObject({ tipo: "audio", texto: null, midia_path: "x/a.ogg", ptt: true, mencionar_todos: true });
    const doc = montarDisparo(entrada({ mensagem: { tipo: "documento", texto: "Material", midia_path: "x/a.pdf", nome_arquivo: "aula.pdf" } }));
    expect(doc.linhas[0]).toMatchObject({ nome_arquivo: "aula.pdf", midia_path: "x/a.pdf" });
    const img = montarDisparo(entrada({ mensagem: { tipo: "imagem", texto: "oi", midia_path: "x/a.jpg", nome_arquivo: "a.jpg", ptt: true } }));
    expect(img.problemas).toEqual([]); // ptt de imagem é ignorado na montagem (só áudio vira nota de voz)
    expect(img.linhas[0].ptt).toBeUndefined();
    expect(img.linhas[0].nome_arquivo).toBeNull();
  });

  it("agendado: no passado recusa; até 60 dias aceita; mais que isso recusa", () => {
    expect(montarDisparo(entrada({ quando: "2026-10-20T14:00:00.000Z" })).problemas).toContain("Data/hora já passou.");
    const ok = montarDisparo(entrada({ quando: "2026-10-21T23:00:00.000Z" }));
    expect(ok.problemas).toEqual([]);
    expect(ok.linhas[0].agendado_para).toBe("2026-10-21T23:00:00.000Z");
    expect(montarDisparo(entrada({ quando: "2027-01-30T00:00:00.000Z" })).problemas).toContain("Agende no máximo 60 dias à frente.");
    expect(montarDisparo(entrada({ quando: "x" })).problemas).toContain("Data/hora inválida.");
  });

  it("duração estimada com 6/min e 8 s", () => {
    expect(duracaoEstimadaMin(1)).toBe(0);
    expect(duracaoEstimadaMin(7)).toBe(1);
    expect(duracaoEstimadaMin(60)).toBe(10);
  });

  it("status agregado do disparo", () => {
    expect(statusDoDisparo([{ status: "concluida" }, { status: "enviando" }])).toBe("enviando");
    expect(statusDoDisparo([{ status: "agendada" }, { status: "agendada" }])).toBe("agendada");
    expect(statusDoDisparo([{ status: "concluida" }, { status: "concluida" }])).toBe("concluida");
    expect(statusDoDisparo([{ status: "concluida" }, { status: "erro" }])).toBe("parcial");
  });
});

describe("tick: grupos_alvo filtra os grupos da campanha", () => {
  const G = (id: string, ordem: number): GrupoDaCampanha => ({
    id, ordem, link_convite: null, chat_id: chat(ordem), ativo: true, cheio: false, cliques: 0, cliques_na_contagem: 0, participantes: null,
  });
  it("só os escolhidos; sem alvo, todos (comportamento antigo)", () => {
    const gs = [G("a", 1), G("b", 2), G("c", 3)];
    expect(planejarEnvios(gs, AGORA, 20, 20, () => 0, ["c", "a"]).map((p) => p.grupo_id)).toEqual(["a", "c"]);
    expect(planejarEnvios(gs, AGORA, 20, 20, () => 0, null).map((p) => p.grupo_id)).toEqual(["a", "b", "c"]);
    expect(planejarEnvios(gs, AGORA, 20, 20, () => 0, []).map((p) => p.grupo_id)).toEqual(["a", "b", "c"]);
  });
});

describe("link /g/: encher x split", () => {
  const G = (id: string, ordem: number, extra: Partial<GrupoDaCampanha> = {}): GrupoDaCampanha => ({
    id, ordem, link_convite: `https://chat.whatsapp.com/ABCDEFGHIJKLMNOP${ordem}`, chat_id: chat(ordem),
    ativo: true, cheio: false, cliques: 0, cliques_na_contagem: 0, participantes: null, ...extra,
  });
  it("encher manda tudo para o primeiro até lotar", () => {
    expect(simularCliques([G("a", 1), G("b", 2)], 3, 5)).toEqual(["a", "a", "a", "b", "b"]);
  });
  it("split 50/50 alterna antes de qualquer um lotar", () => {
    expect(simularCliques([G("a", 1), G("b", 2)], 100, 6, "split")).toEqual(["a", "b", "a", "b", "a", "b"]);
  });
  it("split ponderado 70/30", () => {
    const r = simularCliques([G("a", 1, { peso: 70 }), G("b", 2, { peso: 30 })], 1000, 100, "split");
    expect(r.filter((x) => x === "a").length).toBe(70);
  });
  it("split começa pelo menos cheio (grupo importado com membros fica para depois)", () => {
    const r = simularCliques([G("velho", 1, { participantes: 50 }), G("novo", 2)], 1000, 3, "split");
    expect(r).toEqual(["novo", "novo", "novo"]);
  });
  it("pula cheio, inativo, sem convite e lotado; nada elegível = null", () => {
    const gs = [G("cheio", 1, { cheio: true }), G("off", 2, { ativo: false }), G("semlink", 3, { link_convite: null }), G("lotado", 4, { participantes: 10 })];
    expect(escolherGrupoSplit(gs, 10)).toBeNull();
    expect(escolherGrupo(gs, 10)).toBeNull();
    expect(escolherGrupoModo([...gs, G("ok", 5)], 10, "split")?.id).toBe("ok");
    expect(escolherGrupoModo([...gs, G("ok", 5)], 10, undefined)?.id).toBe("ok");
  });
  it("ocupação % e peso", () => {
    expect(ocupacaoPct({ participantes: 450, cliques: 10, cliques_na_contagem: 10 }, 900)).toBe(50);
    expect(ocupacaoPct({ participantes: 2000, cliques: 0, cliques_na_contagem: 0 }, 900)).toBe(100);
    expect(pesoValido(0)).toBe(1);
    expect(pesoValido(500)).toBe(100);
    expect(pesoValido("x")).toBe(1);
  });
});

describe("número e permissão", () => {
  it("só o número grupos-N cria grupo", () => {
    expect(numeroCriaGrupo("grupos-1")).toBe(true);
    expect(numeroCriaGrupo("closer")).toBe(false);
    expect(numeroCriaGrupo(null)).toBe(false);
    expect(numeroCriaGrupo("grupos-1; drop")).toBe(false);
    expect(MSG_NUMERO_NAO_CRIA).toMatch(/não cria grupo automaticamente/);
  });
  it("admin / só envio / sem permissão / não lida", () => {
    expect(permissaoGrupo({ sou_admin: true, anuncio: true })).toBe("admin");
    expect(permissaoGrupo({ sou_admin: false, anuncio: false })).toBe("so_envio");
    expect(permissaoGrupo({ sou_admin: false, anuncio: true })).toBe("sem_permissao");
    expect(permissaoGrupo({ sou_admin: null, anuncio: true })).toBe("desconhecida");
    expect(permissaoGrupo({ sou_admin: false, anuncio: null })).toBe("desconhecida");
    expect(podeConfigurar("admin")).toBe(true);
    expect(podeConfigurar("so_envio")).toBe(false);
    expect(podeDisparar("so_envio")).toBe(true);
    expect(podeDisparar("sem_permissao")).toBe(false);
  });
  it("configuração e agendamento de criação", () => {
    expect(problemasConfiguracao({})).toContain("Escolha pelo menos uma alteração.");
    expect(problemasConfiguracao({ so_admins_enviam: false })).toEqual([]);
    expect(problemasConfiguracao({ nome: "x".repeat(101) })).toContain("Nome passa de 100 caracteres.");
    expect(problemasConfiguracao({ promover: Array.from({ length: 11 }, () => "5511999998888") })).toContain("No máximo 10 admins por vez.");
    const camp = { prefixo_nome: "Turma", admins_telefones: ["5511999998888"] };
    expect(problemasAgendarCriacao("2026-10-21T10:00", false, camp, AGORA)).toContain(MSG_NUMERO_NAO_CRIA);
    expect(problemasAgendarCriacao("2026-10-21T10:00", true, camp, AGORA)).toEqual([]);
    // sem prefixo usa o nome da campanha: só falta o admin
    expect(problemasAgendarCriacao("2026-10-21T10:00", true, { prefixo_nome: "", admins_telefones: [] }, AGORA)).toEqual([
      "Cadastre pelo menos 1 admin na aba Campanhas (o WhatsApp não cria grupo só com o número).",
    ]);
  });
  it("/crm/grupos antigo abre a aba Campanhas da seção nova, mantendo ?numero=", () => {
    expect(destinoGruposAntigo("")).toBe("/crm/disparo-grupos?aba=campanhas");
    expect(destinoGruposAntigo("?numero=abc")).toBe("/crm/disparo-grupos?numero=abc&aba=campanhas");
  });
});

describe("proxy da VPS: permissão no grupo e nome do grupo", () => {
  const info = {
    id: chat(1), name: "Turma", announce: true, locked: false,
    participants: [
      { id: "5511999998888@c.us", number: "5511999998888", isAdmin: true, isSuperAdmin: false },
      { id: "5521988887777@c.us", number: "5521988887777", isAdmin: false, isSuperAdmin: false },
      { id: "123456789012345@lid", isAdmin: true },
    ],
  };
  it("souAdminDe acha o próprio número; sem telefone ou não achado = null", () => {
    expect(souAdminDe(info, "5511999998888")).toBe(true);
    expect(souAdminDe(info, "+55 21 98888-7777")).toBe(false);
    expect(souAdminDe(info, "5531900000000")).toBeNull();
    expect(souAdminDe(info, null)).toBeNull();
    expect(souAdminDe({ participants: [{ id: "5511999998888@c.us", isSuperAdmin: true }] }, "5511999998888")).toBe(true);
  });
  it("resumoGrupo leva admin/announce/locked e nunca a lista de participantes", () => {
    const r = resumoGrupo(info, "5521988887777");
    expect(r).toEqual({ chatId: chat(1), name: "Turma", participants: 3, souAdmin: false, announce: true, locked: false });
    expect(JSON.stringify(r)).not.toContain("5511999998888");
  });
  it("group-subject: rota de admin, valida o nome e exige allowlist", () => {
    expect(ROTAS_ADMIN_GRUPO.has("group-subject")).toBe(true);
    expect(ROTAS_COM_SESSAO.has("group-subject")).toBe(true);
    const lista = new Set([chat(1)]);
    expect(montarPedidoAdminGrupo("group-subject", { chatId: chat(1), subject: " Turma 02 " }, "sid", lista))
      .toEqual({ metodo: "PUT", caminho: `/sessions/sid/groups/${encodeURIComponent(chat(1))}/subject`, corpo: { subject: "Turma 02" } });
    expect(montarPedidoAdminGrupo("group-subject", { chatId: chat(1), subject: "" }, "sid", lista).erro).toBeTruthy();
    expect(montarPedidoAdminGrupo("group-subject", { chatId: chat(1), subject: "x".repeat(101) }, "sid", lista).erro).toBeTruthy();
    expect(montarPedidoAdminGrupo("group-subject", { chatId: chat(1), subject: "ok", extra: 1 }, "sid", lista).erro).toBe("campos");
    expect(montarPedidoAdminGrupo("group-subject", { chatId: chat(2), subject: "ok" }, "sid", lista)).toEqual({ erro: "grupo fora da allowlist", status: 403 });
  });
});
