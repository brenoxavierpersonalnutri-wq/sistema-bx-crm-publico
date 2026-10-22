import { describe, expect, it } from "vitest";
import {
  NUMEROS_PADRAO,
  contarPorNumero,
  donoDoRegistro,
  enviosPorNumero,
  formatarTelefone,
  inicioDoDiaBRT,
  interpretarStatusNumero,
  linkModulo,
  montarAlertas,
  numeroPadrao,
  resumirDia,
  validarLimites,
  type StatusNumero,
} from "@/lib/crm/central";
import {
  corpoComSessao,
  decidirSessao,
  sessaoParaEnvio,
} from "../../supabase/functions/_shared/numerosWa";

const nums = NUMEROS_PADRAO;
const closer = nums[0];
const fit = nums[1];
const oficial = nums[4];

describe("seed e número padrão", () => {
  it("tem os 5 números da operação, 4 OpenWA e o oficial (31) 7000-0102", () => {
    expect(nums.map((n) => n.sessao_openwa)).toEqual(["closer", "comercial-fit-2", "suporte-consultoria-1", "comercial-implementacao-1", null]);
    expect(oficial.tipo).toBe("oficial");
    expect(formatarTelefone(oficial.telefone)).toBe("(31) 7000-0102");
  });
  it("numero_id NULL pertence ao closer; id desconhecido também", () => {
    expect(numeroPadrao(nums)?.id).toBe(closer.id);
    expect(donoDoRegistro(null, nums)).toBe(closer.id);
    expect(donoDoRegistro("nao-existe", nums)).toBe(closer.id);
    expect(donoDoRegistro(fit.id, nums)).toBe(fit.id);
  });
  it("formata celular e devolve dígitos quando não reconhece", () => {
    expect(formatarTelefone("5531999998888")).toBe("(31) 99999-8888");
    expect(formatarTelefone("123")).toBe("123");
    expect(formatarTelefone(null)).toBe("");
  });
});

describe("status por número", () => {
  it("closer conectado com a função antiga (sem eco de sessao)", () => {
    expect(interpretarStatusNumero(closer, { connected: true, state: "ready", phone: "553199" }).estado).toBe("conectado");
  });
  it("outra sessão SEM eco = sem ponte (a função antiga devolve o closer pra tudo)", () => {
    const st = interpretarStatusNumero(fit, { connected: true, state: "ready" });
    expect(st.estado).toBe("sem_ponte");
    expect(st.rotulo).toBe("não conectado");
  });
  it("outra sessão com eco certo vale", () => {
    expect(interpretarStatusNumero(fit, { sessao: "comercial-fit-2", connected: false, state: "qr_ready" }).estado).toBe("qr");
    expect(interpretarStatusNumero(fit, { sessao: "comercial-fit-2", connected: false, state: "sem_ponte" }).estado).toBe("sem_ponte");
    expect(interpretarStatusNumero(fit, { sessao: "comercial-fit-2", connected: false, state: "disconnected" }).estado).toBe("desconectado");
  });
  it("ponte fora do ar e resposta vazia não viram 'desconectado'", () => {
    expect(interpretarStatusNumero(closer, { state: "proxy_indisponivel" }).rotulo).toBe("ponte fora do ar");
    expect(interpretarStatusNumero(closer, null).estado).toBe("desconhecido");
  });
  it("oficial não consulta o OpenWA", () => {
    expect(interpretarStatusNumero(oficial, { connected: false }).estado).toBe("oficial");
  });
});

describe("dia e totais", () => {
  it("início do dia em Brasília", () => {
    expect(inicioDoDiaBRT(new Date("2026-10-17T02:59:00Z"))).toBe("2026-10-16T03:00:00.000Z");
    expect(inicioDoDiaBRT(new Date("2026-10-17T03:00:00Z"))).toBe("2026-10-17T03:00:00.000Z");
  });
  const logs = [
    { numero_id: null, contact_phone: "a", canal: "whatsapp", status: "ok", created_at: "2026-10-17T12:00:00Z" },
    { numero_id: fit.id, contact_phone: "b", canal: "whatsapp", status: "ok", created_at: "2026-10-17T13:00:00Z" },
    { numero_id: fit.id, contact_phone: "c", canal: "whatsapp", status: "erro", created_at: "2026-10-17T13:00:00Z" },
    { numero_id: null, contact_phone: "a", canal: "crm", status: "ok", created_at: "2026-10-17T12:00:00Z" },
    { numero_id: oficial.id, contact_phone: "d", canal: "oficial", status: "ok", created_at: "2026-10-17T14:00:00Z" },
  ];
  it("resume enviados, falhas, respondidos (resposta DEPOIS do envio) e pausas", () => {
    const r = resumirDia(logs, [
      { contact_phone: "a", created_at: "2026-10-17T12:30:00Z" }, // respondeu depois
      { contact_phone: "b", created_at: "2026-10-17T12:30:00Z" }, // falou antes do envio
      { contact_phone: "z", created_at: "2026-10-17T12:30:00Z" }, // nunca recebeu
    ], 2);
    expect(r).toEqual({ enviados: 3, falhas: 1, respondidos: 1, pausas: 2 });
  });
  it("conta envios por número (NULL vai pro closer; canal crm não conta)", () => {
    const m = enviosPorNumero(logs, nums);
    expect(m.get(closer.id)).toBe(1);
    expect(m.get(fit.id)).toBe(1);
    expect(m.get(oficial.id)).toBe(1);
  });
  it("conta ligados por número", () => {
    const m = contarPorNumero([{ numero_id: null, ativo: true }, { numero_id: fit.id, ativo: false }, { numero_id: fit.id, ativo: true }], nums, (r) => r.ativo);
    expect(m.get(closer.id)).toBe(1);
    expect(m.get(fit.id)).toBe(1);
  });
});

describe("alertas", () => {
  const status = new Map<string, StatusNumero>([
    [closer.id, { estado: "desconectado", rotulo: "desconectado", telefone: null, aviso: null }],
    [fit.id, { estado: "sem_ponte", rotulo: "não conectado", telefone: null, aviso: null }],
  ]);
  it("pausa automática vem primeiro; desconectado com algo ligado é erro; limite do dia avisa", () => {
    const a = montarAlertas({
      numeros: nums,
      status,
      ligados: new Map([[closer.id, 2], [fit.id, 1]]),
      envioConfig: { ligado: true, pausado: true, pausado_motivo: "3 falhas seguidas" },
      campanhasPausadas: [{ nome: "Black", pausa_motivo: null, numero_id: fit.id }],
      envios: new Map([[closer.id, 200]]),
    });
    expect(a[0].nivel).toBe("erro");
    expect(a.map((x) => x.texto).join("|")).toContain("PAUSADO automaticamente: 3 falhas seguidas");
    expect(a.some((x) => x.texto.startsWith("Closer desconectado com 2"))).toBe(true);
    expect(a.some((x) => x.numeroId === fit.id && x.texto.includes("ponte ainda não envia"))).toBe(true);
    expect(a.some((x) => x.texto.includes("limite do dia (200/200)"))).toBe(true);
    expect(a.some((x) => x.numeroId === fit.id && x.texto.includes('Campanha "Black"'))).toBe(true);
  });
  it("número desconectado sem nada ligado não alerta; envio desligado avisa", () => {
    const a = montarAlertas({ numeros: nums, status, ligados: new Map(), envioConfig: { ligado: false, pausado: false, pausado_motivo: null }, campanhasPausadas: [], envios: new Map() });
    expect(a).toHaveLength(1);
    expect(a[0].texto).toContain("desligado");
  });
});

describe("links e limites", () => {
  it("linkModulo põe ?numero= só para id real", () => {
    expect(linkModulo("/crm/grupos", "abc")).toBe("/crm/grupos?numero=abc");
    expect(linkModulo("/crm/grupos?x=1", "abc")).toBe("/crm/grupos?x=1&numero=abc");
    expect(linkModulo("/crm/grupos", "seed-closer")).toBe("/crm/grupos");
  });
  it("valida limites como os CHECKs da migration", () => {
    expect(validarLimites({ max_hora: 30, max_dia: 200, hora_inicio: 8, hora_fim: 20 })).toBeNull();
    expect(validarLimites({ max_hora: 30, max_dia: 200, hora_inicio: 20, hora_fim: 8 })).toMatch(/antes do fim/);
    expect(validarLimites({ max_hora: 61, max_dia: 200, hora_inicio: 8, hora_fim: 20 })).toMatch(/hora/);
    expect(validarLimites({ max_hora: 30, max_dia: 10, hora_inicio: 8, hora_fim: 20 })).toMatch(/não pode passar/);
    expect(validarLimites({ max_hora: 1.5, max_dia: 10, hora_inicio: 8, hora_fim: 20 })).toMatch(/inteiros/);
  });
});

describe("sessão do envio (numerosWa, usado por waEnvio e whatsapp-qr)", () => {
  it("vazio ou closer = corpo IDÊNTICO ao de antes (a ponte recusa campo extra)", () => {
    const corpo = { phone: "5531999998888", text: "oi" };
    expect(corpoComSessao(corpo, null).corpo).toBe(corpo);
    expect(corpoComSessao(corpo, "closer").corpo).toBe(corpo);
    expect(corpoComSessao(corpo, " Closer ").corpo).toBe(corpo);
  });
  it("outra sessão sem multisessão: não chama a rede, explica o motivo", () => {
    const r = corpoComSessao({ phone: "1" }, "comercial-fit-2");
    expect(r.corpo).toBeNull();
    expect(r.decisao.modo).toBe("indisponivel");
    expect(r.decisao.modo === "indisponivel" && r.decisao.motivo).toContain('sem ponte para a sessão "comercial-fit-2"');
  });
  it("outra sessão com multisessão: vai no corpo", () => {
    expect(corpoComSessao({ phone: "1" }, "comercial-fit-2", { multisessao: true }).corpo).toEqual({ phone: "1", sessao: "comercial-fit-2" });
  });
  it("padrão configurável e nome inválido recusado", () => {
    expect(decidirSessao("suporte", { padrao: "suporte" }).modo).toBe("padrao");
    expect(decidirSessao("../x", { multisessao: true }).modo).toBe("indisponivel");
  });
  it("número oficial ou desativado não envia pelo OpenWA; sem número = padrão", () => {
    expect(sessaoParaEnvio(null)).toEqual({ sessao: null });
    expect(sessaoParaEnvio({ tipo: "openwa", sessao_openwa: "comercial-fit-2", ativo: true })).toEqual({ sessao: "comercial-fit-2" });
    expect("recusa" in sessaoParaEnvio({ tipo: "oficial", sessao_openwa: null, ativo: true })).toBe(true);
    expect("recusa" in sessaoParaEnvio({ tipo: "openwa", sessao_openwa: "closer", ativo: false })).toBe(true);
  });
});
