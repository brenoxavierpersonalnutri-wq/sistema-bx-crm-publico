// Regras do painel /lives: abas, sala ligada a webinário e detecção de backend não publicado.
import { describe, expect, it } from "vitest";
import { backendAusente, filtrarAba, formatarDuracao, itensDoPainel, type LiveRoomExtra } from "@/lib/lives/painel";
import { linkGravacaoCf } from "@/components/lives/estudio/PainelGravacoes";

const sala = (id: string, status: LiveRoomExtra["status"], extra: Partial<LiveRoomExtra> = {}): LiveRoomExtra => ({
  id, titulo: id, livekit_room: id, layout: "grade", cor: null, status, egress_id: null, gravacao_egress_id: null,
  cf_live_input_uid: null, cf_hls_url: null, cf_conectado: false, ultimo_erro: null, iniciada_em: null, created_at: "2026-10-01T00:00:00Z", ...extra,
});

describe("painel de lives", () => {
  it("rascunho e ao vivo em Próximas, encerrada em Anteriores, com gravação em Gravações", () => {
    const itens = itensDoPainel([sala("a", "rascunho"), sala("b", "ao_vivo"), sala("c", "encerrada", { cf_ultima_gravacao: "v" })], [], []);
    expect(filtrarAba(itens, "proximas").map((i) => i.id).sort()).toEqual(["a", "b"]);
    expect(filtrarAba(itens, "anteriores").map((i) => i.id)).toEqual(["c"]);
    expect(filtrarAba(itens, "gravacoes").map((i) => i.id)).toEqual(["c"]);
  });

  it("reprise cancelada some do painel (fica só na lista de reprises da origem)", () => {
    const itens = itensDoPainel([sala("a", "rascunho", { reprise_de: "o" }), sala("b", "rascunho", { reprise_de: "o", reprise_cancelada_em: "2026-10-21T12:00:00Z" })], [], []);
    expect(filtrarAba(itens, "proximas").map((i) => i.id)).toEqual(["a"]);
  });

  it("sala ligada a webinário vira uma linha só, com destinos e status da sala", () => {
    const w = { id: "w", slug: "x", titulo: "W", descricao: null, capa_url: null, live_room_id: "a", hls_offset_seg: 0, chat_ativo: true, mostrar_presentes: true, lembretes_ativos: true, lembretes: {}, status: "publicado" as const };
    const d = [{ id: "d", room_id: "a", tipo: "youtube" as const, nome: "Y", rtmp_url: "rtmp://", chave_final: "•", ativo: true, no_ar: true }];
    const itens = itensDoPainel([sala("a", "ao_vivo")], [w], d);
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ tipo: "webinar", salaId: "a", aoVivo: true, destinos: ["cloudflare", "youtube"] });
  });

  it("reconhece função não publicada sem confundir com erro de negócio", () => {
    expect(backendAusente("Requested function was not found")).toBe(true);
    expect(backendAusente("Failed to send a request to the Edge Function")).toBe(true);
    expect(backendAusente("já está ao vivo")).toBe(false);
  });

  it("cronômetro e link da gravação", () => {
    expect(formatarDuracao(65)).toBe("01:05");
    expect(formatarDuracao(3725)).toBe("1:02:05");
    expect(linkGravacaoCf({ cf_hls_url: "https://customer-z.cloudflarestream.com/in/manifest/video.m3u8", cf_ultima_gravacao: "vid" })).toBe("https://customer-z.cloudflarestream.com/vid/watch");
    expect(linkGravacaoCf({ cf_hls_url: null, cf_ultima_gravacao: "vid" })).toBeNull();
  });
});
