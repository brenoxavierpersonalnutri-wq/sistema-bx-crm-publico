// Lotou, cria grupo (21/10/2026): travas anti-ban e o fluxo de criação com banco FALSO e proxy FALSO em memória.
// Nada aqui fala com Supabase nem com o WhatsApp.
import { describe, it, expect } from "vitest";
import {
  inicioDoDiaSP, nomeGrupoDaCampanha, travaCriacao, MSG_NUMERO_NAO_CRIA, PAUSA_ENTRE_CRIACOES_MS, TETO_CRIACOES_DIA_POR_NUMERO,
  type GrupoDaCampanha,
} from "../../supabase/functions/_shared/grupos.ts";
import {
  criarProximoGrupo, type CampanhaFluxo, type Criacao, type EstadoCriacaoCampanha, type PortaCriacao,
  aplicarAdmins,
} from "../../supabase/functions/_shared/grupoCriacao.ts";
import { textoResultadoAdmins, erroProxyLegivel } from "../../supabase/functions/_shared/grupos.ts";

const AGORA = new Date("2026-10-21T15:00:00Z"); // 12:00 em Brasília
const base = { agora: AGORA, numeroCria: true, admins: 1, gruposNaCampanha: 1, maxGrupos: 20, ultimaCriacaoNumero: null, criadasHojeNumero: 0 };

describe("travas anti-ban (travaCriacao)", () => {
  it("valores sugeridos: 2 min de pausa e 10 grupos por dia por número", () => {
    expect(PAUSA_ENTRE_CRIACOES_MS).toBe(120_000);
    expect(TETO_CRIACOES_DIA_POR_NUMERO).toBe(10);
  });
  it("livre quando nada segura", () => {
    expect(travaCriacao(base)).toEqual({ pode: true });
  });
  it("só o número de grupos (Grupos 1) cria", () => {
    expect(travaCriacao({ ...base, numeroCria: false })).toMatchObject({ pode: false, codigo: "numero_nao_cria", mensagem: MSG_NUMERO_NAO_CRIA, alerta: true });
  });
  it("sem admin não cria (WhatsApp exige outro participante) e alerta", () => {
    expect(travaCriacao({ ...base, admins: 0 })).toMatchObject({ pode: false, codigo: "sem_admin", alerta: true });
  });
  it("máximo de grupos da campanha alerta", () => {
    expect(travaCriacao({ ...base, gruposNaCampanha: 20 })).toMatchObject({ pode: false, codigo: "teto_campanha", alerta: true });
  });
  it("teto diário: 10 no dia de Brasília trava até a meia-noite e alerta", () => {
    const d = travaCriacao({ ...base, criadasHojeNumero: 10 });
    expect(d).toMatchObject({ pode: false, codigo: "teto_dia", alerta: true, retomarEm: "2026-10-22T03:00:00.000Z" });
    expect(travaCriacao({ ...base, criadasHojeNumero: 9 })).toEqual({ pode: true });
  });
  it("pausa de 2 min entre criações do número: passageira, não alerta", () => {
    const d = travaCriacao({ ...base, ultimaCriacaoNumero: new Date(AGORA.getTime() - 60_000).toISOString() });
    expect(d).toMatchObject({ pode: false, codigo: "pausa", alerta: false, retomarEm: new Date(AGORA.getTime() + 60_000).toISOString() });
    expect(travaCriacao({ ...base, ultimaCriacaoNumero: new Date(AGORA.getTime() - 121_000).toISOString() })).toEqual({ pode: true });
  });
  it("dia de Brasília: 02:59Z ainda é ontem, 03:00Z é hoje", () => {
    expect(inicioDoDiaSP(new Date("2026-10-21T02:59:00Z")).toISOString()).toBe("2026-10-20T03:00:00.000Z");
    expect(inicioDoDiaSP(new Date("2026-10-21T03:00:00Z")).toISOString()).toBe("2026-10-21T03:00:00.000Z");
  });
  it("nome numerado: prefixo ou, sem prefixo, o nome da campanha", () => {
    expect(nomeGrupoDaCampanha("Desafio 21D", "Campanha X", 3)).toBe("Desafio 21D 03");
    expect(nomeGrupoDaCampanha("  ", "Turma de Novembro", 12)).toBe("Turma de Novembro 12");
  });
});

// ------------------------------------------------------------------ banco e proxy falsos

type LinhaCriacao = Criacao & { campanha_id: string; created_at: string; grupo_id?: string | null };

function montar(opcoes: { falhar?: Record<string, number>; campanha?: Partial<CampanhaFluxo>; grupos?: GrupoDaCampanha[]; sessao?: string } = {}) {
  let relogio = AGORA.getTime();
  const camp: CampanhaFluxo = {
    id: "c1", nome: "Desafio", numero_id: "n1", limite_por_grupo: 100, prefixo_nome: "Desafio", proximo_numero: 2,
    descricao_grupo: "Regras do grupo", foto_path: "c1/foto.png", admins_telefones: ["5511999998888"],
    so_admins_enviam: true, so_admins_editam: true, folga_vagas: 10, max_grupos: 20, encerrada: false, link_pausado: false,
    criacao_falhas_seguidas: 0, criacao_bloqueio: null, ...opcoes.campanha,
  };
  const campanhaDoNumero: Record<string, string> = { c1: camp.numero_id ?? "", outra: "n1" };
  const db = {
    grupos: [...(opcoes.grupos ?? [{ id: "g1", ordem: 0, link_convite: "https://chat.whatsapp.com/AAAAAAAAAAAAAAAAAAAA", chat_id: "120363000000000001@g.us", ativo: true, cheio: false, cliques: 95, cliques_na_contagem: 0, participantes: 0 }])] as (GrupoDaCampanha & { campanha_id?: string })[],
    criacoes: [] as LinhaCriacao[],
    estado: [] as EstadoCriacaoCampanha[],
    proximo: camp.proximo_numero,
  };
  const chamadas: { rota: string; corpo: Record<string, unknown> }[] = [];
  const falhas = { ...(opcoes.falhar ?? {}) };
  let seq = 0;
  const porta: PortaCriacao = {
    agora: () => new Date(relogio),
    grupos: async () => db.grupos.filter((g) => !g.campanha_id || g.campanha_id === "c1"),
    numeroCria: async (id) => id === "n1" && (opcoes.sessao ?? "grupos-1").startsWith("grupos-"),
    pendente: async (cid) => [...db.criacoes].reverse().find((c) => c.campanha_id === cid && ["criando", "erro"].includes(c.status)) ?? null,
    abandonadas24h: async (cid) => db.criacoes.filter((c) => c.campanha_id === cid && c.status === "abandonada").length,
    historicoNumero: async (numeroId, desde, inicioDia, excluir) => {
      const doNumero = db.criacoes.filter((c) => campanhaDoNumero[c.campanha_id] === numeroId && c.id !== excluir && Date.parse(c.created_at) >= desde.getTime());
      doNumero.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return { ultima: doNumero[0]?.created_at ?? null, hoje: doNumero.filter((c) => Date.parse(c.created_at) >= inicioDia.getTime()).length };
    },
    // a edge relê a campanha a cada tick: o falso espelha proximo_numero na campanha
    reservarNumero: async (_c, n) => { if (db.proximo !== n) return false; db.proximo = n + 1; camp.proximo_numero = n + 1; return true; },
    devolverNumero: async (_c, n) => { if (db.proximo === n + 1) { db.proximo = n; camp.proximo_numero = n; } },
    inserirCriacao: async (cid, numero, nome) => {
      // o índice único grupos_criacoes_uma_em_andamento
      if (db.criacoes.some((c) => c.campanha_id === cid && ["criando", "erro"].includes(c.status))) return { duplicada: true, erro: "duplicate key" };
      const linha: LinhaCriacao = { id: `cr${++seq}`, campanha_id: cid, numero, nome, chat_id: null, etapa: "criar", status: "criando", tentativas: 0, avisos: [], updated_at: new Date(relogio).toISOString(), created_at: new Date(relogio).toISOString() };
      db.criacoes.push(linha);
      return { criacao: { ...linha } };
    },
    atualizarCriacao: async (id, patch) => {
      const l = db.criacoes.find((c) => c.id === id)!;
      Object.assign(l, patch, { updated_at: new Date(relogio).toISOString() });
    },
    gravarGrupo: async (linha) => { db.grupos.push({ id: `gnovo${db.grupos.length}`, ...linha, ativo: true, cheio: false }); return `gnovo${db.grupos.length - 1}`; },
    estadoCampanha: async (_c, patch) => { db.estado.push(patch); Object.assign(camp, patch); },
    proxy: async (rota, corpo) => {
      chamadas.push({ rota, corpo });
      if (falhas[rota]) { falhas[rota]--; throw new Error(`proxy 502 em ${rota}`); }
      if (rota === "group-create") return { chatId: `1203630000000000${10 + chamadas.length}@g.us` };
      if (rota === "group-admins") {
        const ps = (corpo.participants as string[]) ?? [];
        return { ok: true, conferido: true, resultados: ps.map((t) => ({ telefone: t, numero: t, membro: true, admin: true })) };
      }
      if (rota === "group-invite") return { inviteLink: `https://chat.whatsapp.com/NOVO${String(chamadas.length).padStart(16, "0")}` };
      return { ok: true };
    },
    sessao: async () => "grupos-1",
    allowlist: async () => 1,
    urlAssinada: async (p) => `https://assinado.exemplo/${p}`,
    erroLegivel: (e) => (e instanceof Error ? e.message : String(e)),
  };
  return { porta, camp, db, chamadas, andar: (ms: number) => { relogio += ms; } };
}

describe("criarProximoGrupo (banco e proxy falsos)", () => {
  it("lotou (vagas < folga): cria com a configuração da campanha — nome numerado, ajustes, descrição, foto, admins, convite", async () => {
    const t = montar();
    const r = await criarProximoGrupo(t.porta, t.camp);
    expect(r).toBe("grupo criado: Desafio 02");
    expect(t.chamadas.map((c) => c.rota)).toEqual(["group-create", "group-settings", "group-description", "group-picture", "group-admins", "group-invite"]);
    expect(t.chamadas[0].corpo).toMatchObject({ name: "Desafio 02", participants: ["5511999998888"], sessao: "grupos-1" });
    expect(t.chamadas[1].corpo).toMatchObject({ announce: true, locked: true });
    expect(t.chamadas[2].corpo).toMatchObject({ description: "Regras do grupo" });
    expect(t.chamadas[3].corpo).toMatchObject({ url: "https://assinado.exemplo/c1/foto.png" });
    expect(t.chamadas[4].corpo).toMatchObject({ participants: ["5511999998888"] });
    const novo = t.db.grupos.at(-1)!;
    expect(novo).toMatchObject({ nome: "Desafio 02", ordem: 1, criado_pelo_crm: true, travado: true });
    expect(novo.link_convite).toMatch(/^https:\/\/chat\.whatsapp\.com\//);
    expect(t.db.criacoes[0]).toMatchObject({ status: "ok", etapa: "pronto" });
    expect(t.db.proximo).toBe(3);
    expect(t.camp).toMatchObject({ criacao_falhas_seguidas: 0, criacao_bloqueio: null });
  });

  it("vale para campanha antiga com auto_criar desligado e sem prefixo (usa o nome da campanha)", async () => {
    const t = montar({ campanha: { prefixo_nome: "", nome: "Turma Antiga" } as Partial<CampanhaFluxo> & { auto_criar: boolean } });
    (t.camp as unknown as { auto_criar: boolean }).auto_criar = false;
    expect(await criarProximoGrupo(t.porta, t.camp)).toBe("grupo criado: Turma Antiga 02");
  });

  it("com vaga sobrando não cria (e limpa bloqueio antigo)", async () => {
    const t = montar({ campanha: { criacao_bloqueio: "velho" }, grupos: [{ id: "g1", ordem: 0, link_convite: "https://chat.whatsapp.com/AAAAAAAAAAAAAAAAAAAA", chat_id: null, ativo: true, cheio: false, cliques: 10, cliques_na_contagem: 0, participantes: 0 }] });
    expect(await criarProximoGrupo(t.porta, t.camp)).toBe("vagas suficientes");
    expect(t.chamadas).toEqual([]);
    expect(t.camp.criacao_bloqueio).toBeNull();
  });

  it("todos os grupos cheios (marcados cheio) também pede grupo", async () => {
    const t = montar({ grupos: [{ id: "g1", ordem: 0, link_convite: "https://chat.whatsapp.com/AAAAAAAAAAAAAAAAAAAA", chat_id: null, ativo: true, cheio: true, cliques: 0, cliques_na_contagem: 0, participantes: 0 }] });
    expect(await criarProximoGrupo(t.porta, t.camp)).toMatch(/^grupo criado/);
  });

  it("número que não é de grupos: não chama o proxy e o painel recebe o motivo", async () => {
    const t = montar({ sessao: "pessoal" });
    expect(await criarProximoGrupo(t.porta, t.camp)).toMatch(/^trava \(numero_nao_cria\)/);
    expect(t.chamadas).toEqual([]);
    expect(t.camp.criacao_bloqueio).toBe(MSG_NUMERO_NAO_CRIA);
  });

  it("1 criação em andamento por campanha: com pendente, retoma a mesma e nunca abre outra", async () => {
    const t = montar({ falhar: { "group-invite": 1 } });
    expect(await criarProximoGrupo(t.porta, t.camp)).toMatch(/^erro na criação \(convite\)/);
    expect(t.db.criacoes).toHaveLength(1);
    // botão "criar agora" (forçar) durante a espera da retentativa: não abre segunda
    t.andar(PAUSA_ENTRE_CRIACOES_MS + 1000);
    expect(await criarProximoGrupo(t.porta, t.camp, true)).toBe("aguardando nova tentativa");
    t.andar(5 * 60_000);
    expect(await criarProximoGrupo(t.porta, t.camp)).toBe("grupo criado: Desafio 02");
    expect(t.db.criacoes).toHaveLength(1);
    // retomada não recria o grupo no WhatsApp: só 1 group-create no total
    expect(t.chamadas.filter((c) => c.rota === "group-create")).toHaveLength(1);
  });

  it("o banco recusa a segunda criação (índice único): devolve o número reservado", async () => {
    const t = montar();
    t.db.criacoes.push({ id: "x", campanha_id: "c1", numero: 1, nome: "Desafio 01", chat_id: null, etapa: "criar", status: "criando", tentativas: 0, avisos: [], updated_at: AGORA.toISOString(), created_at: new Date(AGORA.getTime() - 10 * 60_000).toISOString() });
    const pend = t.porta.pendente;
    t.porta.pendente = async () => null; // corrida: outro processo criou entre a leitura e o insert
    expect(await criarProximoGrupo(t.porta, t.camp)).toBe("já tem uma criação em andamento nesta campanha");
    expect(t.db.proximo).toBe(2);
    expect(t.chamadas).toEqual([]);
    t.porta.pendente = pend;
  });

  it("pausa de 2 min entre criações do mesmo número (outra campanha conta)", async () => {
    const t = montar();
    t.db.criacoes.push({ id: "y", campanha_id: "outra", numero: 1, nome: "Outra 01", chat_id: "1@g.us", etapa: "pronto", status: "ok", tentativas: 0, avisos: [], updated_at: AGORA.toISOString(), created_at: new Date(AGORA.getTime() - 30_000).toISOString() });
    expect(await criarProximoGrupo(t.porta, t.camp)).toMatch(/^trava \(pausa\)/);
    expect(t.chamadas).toEqual([]);
    expect(t.camp.criacao_bloqueio).toBeNull(); // passageira: não alerta
    t.andar(PAUSA_ENTRE_CRIACOES_MS);
    expect(await criarProximoGrupo(t.porta, t.camp)).toMatch(/^grupo criado/);
  });

  it("teto diário por número: o 11º espera, o painel acusa e cria assim que vira o dia", async () => {
    const t = montar();
    for (let i = 0; i < 10; i++) {
      t.db.criacoes.push({ id: `h${i}`, campanha_id: i % 2 ? "outra" : "c1", numero: i, nome: `G ${i}`, chat_id: `${i}@g.us`, etapa: "pronto", status: "ok", tentativas: 0, avisos: [], updated_at: AGORA.toISOString(), created_at: new Date(AGORA.getTime() - (i + 3) * 60 * 60_000 / 4).toISOString() });
    }
    // forçar (botão) também respeita o teto
    expect(await criarProximoGrupo(t.porta, t.camp, true)).toMatch(/^trava \(teto_dia\)/);
    expect(t.chamadas).toEqual([]);
    expect(t.camp.criacao_bloqueio).toMatch(/teto diário de 10/);
    expect(t.db.estado.at(-1)?.criacao_retomar_em).toBe("2026-10-22T03:00:00.000Z");
    t.andar(12 * 3600_000 + 60_000); // 00:01 em Brasília
    expect(await criarProximoGrupo(t.porta, t.camp)).toMatch(/^grupo criado/);
    expect(t.camp.criacao_bloqueio).toBeNull();
  });

  it("3 falhas seguidas: contador sobe a cada erro (alerta no painel com o erro legível) e zera no sucesso", async () => {
    const t = montar({ falhar: { "group-create": 3 } });
    for (let i = 0; i < 3; i++) {
      expect(await criarProximoGrupo(t.porta, t.camp)).toMatch(/^erro na criação \(criar\): proxy 502 em group-create/);
      t.andar(5 * 60_000 + 1000);
    }
    expect(t.camp.criacao_falhas_seguidas).toBe(3);
    expect(t.camp.criacao_ultimo_erro).toBe("proxy 502 em group-create");
    // 3 tentativas na mesma criação: abandona, e a próxima nasce no tick seguinte
    expect(await criarProximoGrupo(t.porta, t.camp)).toMatch(/abandonada/);
    expect(await criarProximoGrupo(t.porta, t.camp)).toMatch(/^grupo criado/);
    expect(t.camp.criacao_falhas_seguidas).toBe(0);
    expect(t.camp.criacao_ultimo_erro).toBeNull();
  });

  it("etapa opcional que falha vira aviso e o grupo nasce assim mesmo", async () => {
    const t = montar({ falhar: { "group-picture": 1 } });
    expect(await criarProximoGrupo(t.porta, t.camp)).toBe("grupo criado: Desafio 02 (1 aviso(s))");
    expect(t.db.criacoes[0].avisos[0]).toMatch(/^foto: /);
  });
});

describe("admins: adicionar + promover com erro legível (21/10/2026)", () => {
  it("textoResultadoAdmins: falha por número com o número que o WhatsApp conhece", () => {
    const r = textoResultadoAdmins({ ok: false, resultados: [
      { telefone: "5531990000103", numero: "553190000103", membro: true, admin: true },
      { telefone: "5531990000104", numero: "553190000104", membro: false, admin: false, erro: "adicionar: a privacidade do número não deixa adicionar em grupo (mande o link de convite para ele)" },
    ] });
    expect(r.ok).toBe(false);
    expect(r.texto).toBe("5531990000104 (WhatsApp 553190000104): adicionar: a privacidade do número não deixa adicionar em grupo (mande o link de convite para ele)");
  });
  it("textoResultadoAdmins: proxy velho (sem resultados) não vira sucesso", () => {
    expect(textoResultadoAdmins({ ok: true }).ok).toBe(false);
  });
  it("aplicarAdmins lança o texto legível quando alguém não virou admin; sem admins não chama o proxy", async () => {
    const rotas: string[] = [];
    const p = { proxy: async (rota: string) => { rotas.push(rota); return { ok: false, resultados: [{ telefone: "5531990000103", numero: null, membro: false, admin: false, erro: "não tem WhatsApp (testei 553190000103 e 5531990000103)" }] }; } };
    await expect(aplicarAdmins(p, "120363000000000102@g.us", ["5531990000103"], { sessao: "grupos-1" })).rejects.toThrow(/não tem WhatsApp/);
    expect(await aplicarAdmins(p, "120363000000000102@g.us", [], {})).toBe("campanha sem admins");
    expect(rotas).toEqual(["group-admins"]);
  });
  it("erroProxyLegivel mostra o status do OpenWA e a mensagem, nunca só 'proxy 502'", () => {
    expect(erroProxyLegivel(502, { error: "openwa", status: 500, message: "Internal server error" })).toBe("proxy 502 (OpenWA 500): Internal server error");
  });
});
