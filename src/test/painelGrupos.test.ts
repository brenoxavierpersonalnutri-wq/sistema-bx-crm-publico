// Painel "Disparo em grupo" (estilo SendFlow): métricas, saúde, diagnóstico, filtros, calendário e CSV.
import { describe, it, expect } from "vitest";
import {
  alertasSaude, copiaDeCampanha, desdeDe, diagnosticoNumero, duracao, gradeDoMes, metricasCampanha, noFiltro, paraCsv,
  pct, porDia, recursosDaCampanha, serieCompleta, somarMetricas,
} from "@/lib/painelGrupos";
import type { CampanhaGrupos, GrupoLinha } from "@/lib/grupos";

const camp = (extra: Partial<CampanhaGrupos> = {}): CampanhaGrupos => ({
  id: "c1", nome: "Desafio", slug: "desafio", numero_id: "n1", limite_por_grupo: 100, tag: "", link_pausado: false, disparos_pausados: false,
  encerrada: false, url_lotado: null, intervalo_min_s: 20, intervalo_max_s: 60, created_at: "2026-10-01T00:00:00Z", ...extra,
});
const grupo = (extra: Partial<GrupoLinha> = {}) => ({
  id: "g", campanha_id: "c1", ordem: 0, nome: "G", link_convite: "https://chat.whatsapp.com/x", chat_id: "1203630001@g.us", ativo: true, cheio: false,
  cliques: 10, cliques_na_contagem: 0, participantes: 40, participantes_em: null, created_at: "2026-10-01T00:00:00Z", entradas: 8, saidas: 2, ...extra,
}) as GrupoLinha;

describe("métricas por campanha", () => {
  it("sem RPC do período usa os acumulados dos grupos; % de entrada = entradas/cliques", () => {
    const m = metricasCampanha(camp(), [grupo(), grupo({ id: "g2", cheio: true, participantes: 100, cliques: 30, entradas: 12, saidas: 0 }), grupo({ id: "x", campanha_id: "outra" })]);
    expect(m).toMatchObject({ cliques: 40, entradas: 20, saidas: 2, pctEntrada: 50, participantes: 140, grupos: 2, cheios: 1, disponiveis: 1, vagas: 60 });
  });
  it("com a RPC, cliques/entradas/saídas vêm do período", () => {
    const m = metricasCampanha(camp(), [grupo()], { campanha_id: "c1", cliques: 4, cliques_grupo: 3, entradas: 3, saidas: 1 });
    expect(m).toMatchObject({ cliques: 4, entradas: 3, saidas: 1, pctEntrada: 75, participantes: 40 });
  });
  it("soma e percentual sem divisão por zero", () => {
    expect(pct(1, 0)).toBe(0);
    const t = somarMetricas([metricasCampanha(camp(), [grupo()]), metricasCampanha(camp({ id: "c2" }), [grupo({ campanha_id: "c2", cliques: 30, entradas: 2 })])]);
    expect(t.cliques).toBe(40);
    expect(t.pctEntrada).toBe(25);
  });
  it("desdeDe = meia-noite de N-1 dias atrás", () => {
    const d = new Date(desdeDe(7, new Date(2026, 9, 21, 15, 30)));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 15, 0]);
  });
});

describe("o que precisa de atenção", () => {
  const ADM = { admins_telefones: ["5511999998888"] };
  const NUMS = [{ id: "n1", rotulo: "Grupos 1", sessao: "grupos-1" }, { id: "n2", rotulo: "Pessoal", sessao: "pessoal" }];
  it("aponta número desconectado, link pausado, sem grupos, sem permissão e erro", () => {
    const a = alertasSaude({
      campanhas: [
        camp(ADM), camp({ ...ADM, id: "c2", nome: "Vazia" }), camp({ ...ADM, id: "c3", nome: "Pausada", link_pausado: true }),
        camp({ id: "c4", nome: "Encerrada", encerrada: true }), camp({ ...ADM, id: "c5", nome: "Cheia que cria" }),
      ],
      grupos: [
        grupo({ cheio: true }), grupo({ id: "g3", campanha_id: "c3" }), grupo({ id: "g3b", campanha_id: "c3", sou_admin: false, anuncio: true }),
        grupo({ id: "g5", campanha_id: "c5", cheio: true }),
      ],
      numeros: NUMS,
      conectado: { n1: false },
      mensagensComErro: [{ campanha_id: "c1" }, { campanha_id: "c1" }],
    });
    const chaves = a.map((x) => x.chave);
    expect(chaves).toEqual(expect.arrayContaining(["desc-n1", "vazia-c2", "pausa-c3", "perm-c3", "erro-c1"]));
    expect(chaves.filter((k) => k.endsWith("-c5"))).toEqual([]); // cheia, mas cria sozinha: nada a fazer
    expect(chaves.some((k) => k.endsWith("c4"))).toBe(false); // encerrada não alerta
    expect(a[0].gravidade).toBe("alta");
    expect(a.find((x) => x.chave === "erro-c1")?.titulo).toMatch(/^2 disparo/);
    expect(a.find((x) => x.chave === "vazia-c2")?.detalhe).toMatch(/cria o primeiro grupo sozinho/);
  });
  it("não consegue criar: número que não é de grupos ou sem admin (alta quando já lotou)", () => {
    const a = alertasSaude({
      campanhas: [camp({ ...ADM, numero_id: "n2" }), camp({ id: "c2", nome: "Sem admin" })],
      grupos: [grupo({ cheio: true }), grupo({ id: "g2", campanha_id: "c2" })],
      numeros: NUMS, conectado: {},
    });
    expect(a.find((x) => x.chave === "naocria-c1")).toMatchObject({ gravidade: "alta", detalhe: expect.stringMatching(/só o Grupos 1 cria/) });
    expect(a.find((x) => x.chave === "naocria-c2")).toMatchObject({ gravidade: "media", detalhe: expect.stringMatching(/Sem admin/) });
  });
  it("criação travada (teto diário) e 3 falhas seguidas com o erro legível", () => {
    const a = alertasSaude({
      campanhas: [
        camp({ ...ADM, criacao_bloqueio: "O número já criou 10 grupos hoje (teto diário de 10)." }),
        camp({ ...ADM, id: "c2", nome: "Falhando", criacao_falhas_seguidas: 3, criacao_ultimo_erro: "proxy 502 (OpenWA 500): sessão caiu" }),
        camp({ ...ADM, id: "c3", nome: "Duas falhas", criacao_falhas_seguidas: 2, criacao_ultimo_erro: "x" }),
      ],
      grupos: [grupo(), grupo({ id: "g2", campanha_id: "c2" }), grupo({ id: "g3", campanha_id: "c3" })],
      numeros: NUMS, conectado: {},
    });
    expect(a.find((x) => x.chave === "bloqueio-c1")).toMatchObject({ gravidade: "alta", detalhe: expect.stringMatching(/teto diário/) });
    expect(a.find((x) => x.chave === "falha-c2")).toMatchObject({ gravidade: "alta", titulo: expect.stringMatching(/falhou 3 vezes seguidas/), detalhe: "Último erro: proxy 502 (OpenWA 500): sessão caiu" });
    expect(a.find((x) => x.chave === "falha-c3")).toBeUndefined();
  });
  it("número conectado ou sem status não alerta", () => {
    expect(alertasSaude({ campanhas: [camp(ADM)], grupos: [grupo()], numeros: NUMS, conectado: {} })).toEqual([]);
  });
});

describe("diagnóstico do número", () => {
  it("conta admin, só envio, sem permissão, não lidos e grupos sem id", () => {
    const d = diagnosticoNumero([
      grupo({ sou_admin: true }), grupo({ sou_admin: false, anuncio: false }), grupo({ sou_admin: false, anuncio: true }),
      grupo({ sou_admin: null }), grupo({ chat_id: null }), grupo({ sou_admin: true, ativo: false }),
    ]);
    expect(d).toEqual({ total: 4, admin: 1, soEnvio: 1, semPermissao: 1, naoVerificado: 1, semId: 1, pctCompat: 67 });
  });
});

describe("filtros de mensagens (Ações)", () => {
  const agora = Date.parse("2026-10-21T12:00:00Z");
  const m = (status: string, quando: string, falhas = 0) => ({ status, agendado_para: quando, falhas }) as never;
  it("na fila = agendada vencida; agendado = futura; falhas inclui concluída com falha", () => {
    expect(noFiltro(m("agendada", "2026-10-21T11:00:00Z"), "fila", agora)).toBe(true);
    expect(noFiltro(m("agendada", "2026-10-21T13:00:00Z"), "fila", agora)).toBe(false);
    expect(noFiltro(m("agendada", "2026-10-21T13:00:00Z"), "agendada", agora)).toBe(true);
    expect(noFiltro(m("concluida", "x", 2), "falhas", agora)).toBe(true);
    expect(noFiltro(m("concluida", "x", 2), "concluida", agora)).toBe(false);
    expect(noFiltro(m("erro", "x"), "falhas", agora)).toBe(true);
  });
  it("duração legível", () => {
    expect(duracao("2026-10-21T10:00:00Z", "2026-10-21T10:03:21Z")).toBe("3m 21s");
    expect(duracao("2026-10-21T10:00:00Z", "2026-10-21T12:05:00Z")).toBe("2h 5m");
    expect(duracao(null, "2026-10-21T10:00:00Z")).toBeNull();
  });
});

describe("calendário e série diária", () => {
  it("grade de 42 dias começando no domingo", () => {
    const g = gradeDoMes(2026, 9); // outubro/2026 começa numa quinta
    expect(g).toHaveLength(42);
    expect(g[0].getDay()).toBe(0);
    expect(g[0].getDate()).toBe(27);
    expect(g[4].getDate()).toBe(1);
  });
  it("agrupa por dia local, em ordem de horário", () => {
    const d = porDia([{ agendado_para: new Date(2026, 9, 5, 20).toISOString() }, { agendado_para: new Date(2026, 9, 5, 9).toISOString() }]);
    expect([...d.keys()]).toEqual(["2026-10-05"]);
    expect(new Date(d.get("2026-10-05")![0].agendado_para).getHours()).toBe(9);
  });
  it("série completa preenche dias vazios com zero", () => {
    const s = serieCompleta([{ dia: "2026-10-20", cliques: 5, entradas: 3, saidas: 1 }], 3, new Date(2026, 9, 21, 10));
    expect(s.map((p) => [p.dia, p.cliques])).toEqual([["2026-10-19", 0], ["2026-10-20", 5], ["2026-10-21", 0]]);
    expect(s[1].rotulo).toBe("20/10");
  });
});

describe("CSV, duplicar e recursos", () => {
  it("CSV com ; e aspas quando precisa", () => {
    expect(paraCsv(["a", "b"], [["x;y", 'diz "oi"'], [1, null]])).toBe('﻿a;b\r\n"x;y";"diz ""oi"""\r\n1;');
  });
  it("duplicar: slug novo válido, link pausado, sem boas-vindas; criação não é mais desligada (sempre ligada)", () => {
    const c = copiaDeCampanha(camp({ auto_criar: true, boas_vindas_ligada: true }), ["desafio-copia"]);
    expect(c).toMatchObject({ slug: "desafio-copia-2", link_pausado: true, boas_vindas_ligada: false, proximo_numero: 1, numero_id: "n1" });
    expect(c).not.toHaveProperty("auto_criar");
    const longo = copiaDeCampanha(camp({ slug: "a".repeat(49) + "-" + "b".repeat(10) }), []);
    expect(String(longo.slug)).toMatch(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/);
  });
  it("recursos: o que existe mostra ligado/desligado; o resto é em breve", () => {
    const r = recursosDaCampanha(camp({ auto_criar: false }));
    expect(r.find((x) => x.chave === "criacao")).toMatchObject({ ligado: true, aba: "criacao" }); // sempre ligada
    expect(recursosDaCampanha(camp({ avulsa: true })).find((x) => x.chave === "criacao")?.ligado).toBe(false);
    expect(r.find((x) => x.chave === "pausado")?.descricao).toMatch(/Lotado não usa/);
    expect(r.find((x) => x.chave === "lotado")).toBeUndefined();
    expect(r.find((x) => x.chave === "antihacker")?.emBreve).toBe(true);
  });
});
