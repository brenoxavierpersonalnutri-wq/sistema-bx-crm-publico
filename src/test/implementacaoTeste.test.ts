import { describe, it, expect, vi } from "vitest";
import {
  buscarTesteImplementacao,
  comTaxas,
  corpoDaChamada,
  FuncaoAusenteError,
  IMPLEMENTACAO_PUBLISHABLE_KEY,
  IMPLEMENTACAO_SUPABASE_URL,
  lerLinha,
  melhorVersao,
  periodoDoPreset,
  totaisDe,
} from "@/lib/implementacaoTeste";
import { getModuleByPath, podeAbrirRota } from "@/lib/modules";

// Linhas no formato que a RPC implementacao_teste_publico devolve
// (os números são os do teste no Postgres local, sem período).
const RPC = [
  { versao: "v1", pagina: "/v1", peso: 20, ordem: 1, visitas: 10, leads: 4, qualificados: 2, agendamentos: 1 },
  { versao: "v2", pagina: "/v2", peso: 20, ordem: 2, visitas: "4", leads: "1", qualificados: "1", agendamentos: "1" },
  { versao: "v3", pagina: "/implementacao/v3/", peso: 20, ordem: 3, visitas: 2, leads: 0, qualificados: 0, agendamentos: 0 },
  { versao: "v4", pagina: "/", peso: 20, ordem: 4, visitas: 0, leads: 0, qualificados: 0, agendamentos: 0 },
  { versao: "v5", pagina: "/v5", peso: 20, ordem: 5, visitas: 1, leads: 0, qualificados: 0, agendamentos: 0 },
];

const resposta = (status: number, corpo: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => corpo }) as unknown as Response;

describe("chave do projeto da implementação", () => {
  it("é a publishable (role anon) do projeto ensap…, nunca service role", () => {
    const payload = JSON.parse(atob(IMPLEMENTACAO_PUBLISHABLE_KEY.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    expect(payload.role).toBe("anon");
    expect(payload.ref).toBe("SEU_PROJECT_REF_3");
    expect(IMPLEMENTACAO_SUPABASE_URL).toBe(`https://${payload.ref}.supabase.co`);
  });
});

describe("cálculo por versão", () => {
  const versoes = RPC.map((l, i) => lerLinha(l, i));

  it("normaliza bigint em string e calcula as taxas sobre visitas", () => {
    const v2 = comTaxas(versoes[1]);
    expect(v2.visitas).toBe(4);
    expect(v2.taxa_lead).toBe(25);
    expect(v2.taxa_agendamento).toBe(25);
    expect(v2.agendamento_por_lead).toBe(100);
    expect(comTaxas(versoes[3]).taxa_lead).toBe(0); // 0 visitas não vira NaN
  });

  it("totais somam as versões", () => {
    const t = totaisDe(versoes);
    expect(t).toMatchObject({ visitas: 17, leads: 5, qualificados: 3, agendamentos: 2 });
    expect(t.taxa_agendamento).toBeCloseTo((2 / 17) * 100);
  });

  it("melhor = maior agendamento ÷ visita (v2: 25% contra 10% da v1)", () => {
    expect(melhorVersao(versoes.map(comTaxas))).toBe("v2");
  });

  it("empate em agendamento decide por qualificado, sem conversão não há melhor", () => {
    const a = comTaxas(lerLinha({ versao: "a", visitas: 10, leads: 5, qualificados: 1, agendamentos: 1 }, 0));
    const b = comTaxas(lerLinha({ versao: "b", visitas: 10, leads: 5, qualificados: 3, agendamentos: 1 }, 1));
    expect(melhorVersao([a, b])).toBe("b");
    const z = comTaxas(lerLinha({ versao: "z", visitas: 10 }, 0));
    expect(melhorVersao([z, comTaxas(lerLinha({ versao: "y", visitas: 3 }, 1))])).toBeNull();
    const igual = comTaxas(lerLinha({ versao: "c", visitas: 10, leads: 5, qualificados: 3, agendamentos: 1 }, 2));
    expect(melhorVersao([b, igual])).toBeNull(); // empate total: ninguém é destacado
  });

  it("versão sem rótulo vira vN pela posição", () => {
    expect(lerLinha({ versao: "  ", visitas: 1 }, 3).versao).toBe("v4");
  });
});

describe("período", () => {
  // 13/10/2026 01:30 em UTC = 12/10 22:30 em Brasília.
  const agora = new Date("2026-10-13T01:30:00Z");
  it("usa o dia de Brasília, não o UTC", () => {
    expect(periodoDoPreset("hoje", agora)).toEqual({ desde: "2026-10-12", ate: "2026-10-12" });
    expect(periodoDoPreset("ontem", agora)).toEqual({ desde: "2026-10-11", ate: "2026-10-11" });
    expect(periodoDoPreset("7d", agora)).toEqual({ desde: "2026-10-06", ate: "2026-10-12" });
    expect(periodoDoPreset("30d", agora)).toEqual({ desde: "2026-09-13", ate: "2026-10-12" });
    expect(periodoDoPreset("tudo", agora)).toEqual({});
  });
  it("só manda data válida para a RPC", () => {
    expect(corpoDaChamada({ desde: "2026-10-01", ate: "lixo'; drop" })).toEqual({
      p_slug: "implementacao", p_desde: "2026-10-01", p_ate: null,
    });
  });
});

describe("buscarTesteImplementacao", () => {
  it("chama a RPC do banco da implementação com a chave publishable e o período", async () => {
    const f = vi.fn(async () => resposta(200, RPC));
    const v = await buscarTesteImplementacao({ desde: "2026-10-10", ate: "2026-10-12" }, f);
    expect(v.map((x) => x.versao)).toEqual(["v1", "v2", "v3", "v4", "v5"]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://SEU_PROJECT_REF_3.supabase.co/rest/v1/rpc/implementacao_teste_publico");
    expect((init.headers as Record<string, string>).apikey).toBe(IMPLEMENTACAO_PUBLISHABLE_KEY);
    expect(JSON.parse(String(init.body))).toEqual({ p_slug: "implementacao", p_desde: "2026-10-10", p_ate: "2026-10-12" });
  });

  it("função ainda não criada (SQL não rodou) vira FuncaoAusenteError", async () => {
    await expect(buscarTesteImplementacao({}, async () => resposta(404, { code: "PGRST202", message: "Could not find the function" })))
      .rejects.toBeInstanceOf(FuncaoAusenteError);
  });

  it("outro erro sobe com a mensagem do banco", async () => {
    await expect(buscarTesteImplementacao({}, async () => resposta(401, { code: "42501", message: "permission denied" })))
      .rejects.toThrow("permission denied");
  });
});

describe("acesso à tela /teste/implementacao", () => {
  it("segue a liberação do Teste de Página (/teste)", () => {
    expect(getModuleByPath("/teste/implementacao")).toBe("teste");
    expect(podeAbrirRota("/teste/implementacao", false, ["alunas"])).toBe(false);
    expect(podeAbrirRota("/teste/implementacao", false, ["teste"])).toBe(true);
    expect(getModuleByPath("/teste-agendamento")).toBeNull(); // página pública continua pública
  });
});
