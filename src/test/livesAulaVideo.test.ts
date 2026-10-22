// Vídeo da aula e live programada: token do servidor de aulas (mesma conta do headturbo-aulas.py), corpo do
// CreateIngress, decisão do tick, validações da programação, upload em pedaços (retomada) e estado do vídeo.
import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  ATRASO_VIDEO_MS, chaveAulas, corpoCriarIngress, decidirTick, ehParticipanteAula, haHumanoNoEstudio, identityAula, lerFimAula, lerMiniatura, ORFA_MS, quandoProgramavel,
  type SalaAgenda, tokenAula, urlArquivoLocal,
} from "../../supabase/functions/_shared/aulaVideo";
import { avisoComecaAgora, enviarEmPedacos, estadoVideo, paraDatetimeLocal, textoVideoPendente, type Transporte, validarArquivo } from "@/lib/lives/aula";

const SEGREDO_LK = "segredo-do-livekit-de-teste-0123456789abcdef0123";
const VID = "0af4b51c-4410-4beb-b32d-a706f316b30b";
const b64d = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

describe("token do servidor de aulas", () => {
  it("chave = hex(HMAC-SHA256(api_secret, 'headturbo-aulas-v1')), igual ao Python", async () => {
    const esperado = createHmac("sha256", SEGREDO_LK).update("headturbo-aulas-v1").digest("hex");
    expect(await chaveAulas(SEGREDO_LK)).toBe(esperado);
  });

  it("HS256 com aud/v/s/exp/max e assinatura conferível com a chave derivada", async () => {
    const t = await tokenAula({ apiSecret: SEGREDO_LK, videoId: VID, escopo: "ler", ttlSeg: 60, maxBytes: 1000, agoraSeg: 1_000 });
    const [h, c, a] = t.split(".");
    expect(JSON.parse(b64d(h).toString())).toEqual({ alg: "HS256", typ: "JWT" });
    expect(JSON.parse(b64d(c).toString())).toEqual({ aud: "aulas", v: VID, s: "ler", exp: 1_060, max: 1000 });
    const chave = createHmac("sha256", SEGREDO_LK).update("headturbo-aulas-v1").digest("hex");
    const sig = createHmac("sha256", chave).update(`${h}.${c}`).digest("base64url");
    expect(a).toBe(sig);
  });

  it("recusa id que não é uuid (vira caminho no disco da VPS)", async () => {
    await expect(tokenAula({ apiSecret: SEGREDO_LK, videoId: "../../etc/passwd", escopo: "up", ttlSeg: 60 })).rejects.toThrow(/inválido/);
  });

  it("URL local do arquivo (o Caddy não encaminha /aulas/arquivo)", () => {
    expect(urlArquivoLocal(VID, "a.b.c")).toBe(`http://172.18.0.1:7890/aulas/arquivo/${VID}?t=a.b.c`);
  });
});

describe("CreateIngress do vídeo da aula", () => {
  it("URL_INPUT, participante 'Vídeo da aula' como câmera + microfone, 720p de uma camada", () => {
    const c = corpoCriarIngress({ sala: "live_abc", videoId: VID, url: "http://x/y", nomeArquivo: "Aula 1.mp4" });
    expect(c).toMatchObject({
      input_type: "URL_INPUT",
      room_name: "live_abc",
      participant_identity: "aula-video-0af4b51c4410",
      participant_name: "Vídeo da aula",
      url: "http://x/y",
      video: { source: "CAMERA", preset: "H264_720P_30FPS_1_LAYER" },
      audio: { source: "MICROPHONE", preset: "OPUS_STEREO_96KBPS" },
    });
    expect(ehParticipanteAula(c.participant_identity)).toBe(true);
    expect(ehParticipanteAula("produtor_123")).toBe(false);
    expect(identityAula(VID)).toBe("aula-video-0af4b51c4410");
  });
});

describe("tick da agenda", () => {
  const base: SalaAgenda = {
    id: "s1", status: "rascunho", agendada_em: "2026-11-01T22:00:00.000Z", auto_iniciar: false, aula_video_id: null,
    agenda_processada_em: null, aula_tocando_desde: null, aula_encerrar_ao_fim: false,
  };
  const em = (iso: string) => new Date(iso);

  it("antes da hora: nada; 30 s antes já vale", () => {
    expect(decidirTick(base, em("2026-11-01T21:58:00Z")).acao).toBe("nada");
    expect(decidirTick(base, em("2026-11-01T21:59:40Z")).acao).toBe("avisar");
  });
  it("na hora, sem vídeo: só avisa no painel (não inicia sozinho)", () => {
    expect(decidirTick({ ...base, auto_iniciar: true }, em("2026-11-01T22:00:10Z")).acao).toBe("avisar");
  });
  it("na hora, com vídeo e iniciar sozinho: inicia", () => {
    expect(decidirTick({ ...base, auto_iniciar: true, aula_video_id: VID }, em("2026-11-01T22:00:10Z")).acao).toBe("iniciar");
  });
  it("com vídeo mas sem 'iniciar sozinho': avisa", () => {
    expect(decidirTick({ ...base, aula_video_id: VID }, em("2026-11-01T22:00:10Z")).acao).toBe("avisar");
  });
  it("já processada: nada (não inicia duas vezes)", () => {
    expect(decidirTick({ ...base, auto_iniciar: true, aula_video_id: VID, agenda_processada_em: "2026-11-01T22:00:05Z" }, em("2026-11-01T22:01:00Z")).acao).toBe("nada");
  });
  it("passou 15 min sem processar: marca perdida, não começa atrasada", () => {
    expect(decidirTick({ ...base, auto_iniciar: true, aula_video_id: VID }, em("2026-11-01T22:16:00Z")).acao).toBe("atrasada");
  });
  it("já está ao vivo (entrou na mão antes): nada", () => {
    expect(decidirTick({ ...base, status: "ao_vivo", auto_iniciar: true, aula_video_id: VID }, em("2026-11-01T22:00:10Z")).acao).toBe("nada");
  });
  it("vídeo acabou (duração + 90 s) com 'encerrar ao fim': encerra (rede de segurança do webhook)", () => {
    const s = { ...base, status: "ao_vivo", agenda_processada_em: "x", aula_encerrar_ao_fim: true, aula_tocando_desde: "2026-11-01T22:00:20Z", aula_duracao_seg: 600 };
    expect(decidirTick(s, em("2026-11-01T22:11:00Z")).acao).toBe("nada");
    expect(decidirTick(s, em("2026-11-01T22:11:51Z")).acao).toBe("encerrar");
    expect(decidirTick({ ...s, aula_encerrar_ao_fim: false }, em("2026-11-01T23:00:00Z")).acao).toBe("nada");
  });
  describe("live programada que ficou no ar sem vídeo (conferir-orfa)", () => {
    // tick iniciou às 22:00:05 (ir-ao-vivo ok às 22:00:12) e o vídeo não tocou
    const orfa: SalaAgenda = {
      ...base, status: "ao_vivo", auto_iniciar: true, aula_video_id: VID,
      agenda_processada_em: "2026-11-01T22:00:05Z", iniciada_em: "2026-11-01T22:00:12Z", aula_tocando_desde: null,
    };
    it("antes de 10 min: nada; depois: conferir-orfa (o tick olha o estúdio)", () => {
      expect(ORFA_MS).toBe(10 * 60_000);
      expect(decidirTick(orfa, em("2026-11-01T22:05:00Z")).acao).toBe("nada");
      expect(decidirTick(orfa, em("2026-11-01T22:10:12Z")).acao).toBe("conferir-orfa");
      expect(decidirTick(orfa, em("2026-11-02T04:00:00Z")).acao).toBe("conferir-orfa"); // 6 h depois continua pegando
    });
    it("webhook do fim limpou o estado e o encerrar falhou: também cai na regra", () => {
      expect(decidirTick({ ...orfa, aula_encerrar_ao_fim: false }, em("2026-11-02T03:00:00Z")).acao).toBe("conferir-orfa");
    });
    it("vídeo tocando: não é órfã (quem encerra é o fim do vídeo)", () => {
      expect(decidirTick({ ...orfa, aula_tocando_desde: "2026-11-01T22:00:40Z", aula_encerrar_ao_fim: true, aula_duracao_seg: 3600 }, em("2026-11-01T22:30:00Z")).acao).toBe("nada");
    });
    it("live posta no ar na mão depois (iniciada longe da hora processada) ou sem iniciar sozinho: fora da regra", () => {
      expect(decidirTick({ ...orfa, iniciada_em: "2026-11-01T23:00:00Z" }, em("2026-11-02T01:00:00Z")).acao).toBe("nada");
      expect(decidirTick({ ...orfa, auto_iniciar: false }, em("2026-11-01T23:00:00Z")).acao).toBe("nada");
      expect(decidirTick({ ...orfa, iniciada_em: null }, em("2026-11-01T23:00:00Z")).acao).toBe("nada");
      expect(decidirTick({ ...orfa, status: "encerrada" }, em("2026-11-01T23:00:00Z")).acao).toBe("nada");
    });
    it("humano no estúdio: só conta gente (não o vídeo da aula, nem Egress/Ingress/agente, nem oculto)", () => {
      expect(haHumanoNoEstudio([])).toBe(false);
      expect(haHumanoNoEstudio(undefined)).toBe(false);
      expect(haHumanoNoEstudio([{ identity: identityAula(VID), kind: "INGRESS" }])).toBe(false);
      expect(haHumanoNoEstudio([{ identity: "EG_abc", kind: "EGRESS", permission: { hidden: true, recorder: true } }])).toBe(false);
      expect(haHumanoNoEstudio([{ identity: "gravador", kind: 2 }, { identity: "bot", kind: "AGENT" }])).toBe(false);
      expect(haHumanoNoEstudio([{ identity: "oculto", permission: { hidden: true } }])).toBe(false);
      expect(haHumanoNoEstudio([{ identity: "host-breno" }])).toBe(true); // STANDARD vem omitido no JSON
      expect(haHumanoNoEstudio([{ identity: identityAula(VID) }, { identity: "convidada", kind: 0 }])).toBe(true);
    });
  });
  it("o vídeo espera o Egress subir antes de tocar", () => {
    expect(ATRASO_VIDEO_MS).toBeGreaterThanOrEqual(15_000);
  });
});

describe("validações da programação", () => {
  const agora = new Date("2026-11-01T12:00:00Z");
  it("data futura (2 min de folga) e até 1 ano", () => {
    expect(quandoProgramavel("2026-11-01T12:01:00Z", agora).ok).toBe(false);
    expect(quandoProgramavel("2026-11-01T12:05:00Z", agora).ok).toBe(true);
    expect(quandoProgramavel("2028-01-01T00:00:00Z", agora).ok).toBe(false);
    expect(quandoProgramavel("lixo", agora).ok).toBe(false);
    expect(quandoProgramavel(undefined, agora).ok).toBe(false);
  });
  it("miniatura: JPG/PNG até 2 MB; sem miniatura = null", () => {
    expect(lerMiniatura(null)).toBeNull();
    const ok = lerMiniatura({ base64: Buffer.from("abc").toString("base64"), mime: "image/png" });
    expect(ok && ok.ok && ok.bytes.length).toBe(3);
    expect(lerMiniatura({ base64: "AAAA", mime: "image/gif" })).toMatchObject({ ok: false });
    const grande = Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64");
    expect(lerMiniatura({ base64: grande, mime: "image/jpeg" })).toMatchObject({ ok: false, motivo: expect.stringMatching(/2 MB/) });
    expect(lerMiniatura({ base64: "data:image/png;base64," + Buffer.from("x").toString("base64"), mime: "image/png" })).toMatchObject({ ok: true });
  });
});

// ------------------------------------------------------------------ upload em pedaços (transporte falso)

function servidorFalso(o: { quebrarNoPedaco?: number; offsetErradoUmaVez?: boolean; status401?: boolean } = {}) {
  const recebido: number[] = [];
  let tem = 0;
  let pedidos = 0;
  let desalinhou = false;
  const t: Transporte = {
    async consultar() {
      return tem;
    },
    async enviar(_url, _token, offset, pedaco, onBytes) {
      pedidos += 1;
      if (o.status401) return { status: 401, recebido: tem };
      if (o.offsetErradoUmaVez && !desalinhou && offset > 0) {
        desalinhou = true;
        return { status: 409, recebido: tem };
      }
      if (offset !== tem) return { status: 409, recebido: tem };
      if (o.quebrarNoPedaco === pedidos) {
        tem += Math.floor(pedaco.size / 2); // metade chegou antes de cair (o servidor real corta, este simula pior)
        tem = offset; // servidor real trunca de volta
        throw new Error("conexão caiu");
      }
      onBytes(pedaco.size);
      tem += pedaco.size;
      recebido.push(pedaco.size);
      return { status: 200, recebido: tem };
    },
  };
  return { t, recebido, total: () => tem, pedidos: () => pedidos };
}

describe("upload em pedaços", () => {
  const arquivo = new Blob([new Uint8Array(10_000)]);

  it("sobe tudo em pedaços e reporta progresso até 1", async () => {
    const s = servidorFalso();
    const prog: number[] = [];
    await enviarEmPedacos({ arquivo, base: "https://lk/aulas", videoId: VID, token: "t", transporte: s.t, pedaco: 3000, onProgresso: (f) => prog.push(f), esperaMs: 0 });
    expect(s.total()).toBe(10_000);
    expect(s.recebido).toEqual([3000, 3000, 3000, 1000]);
    expect(prog.at(-1)).toBe(1);
  });

  it("conexão cai num pedaço: pergunta ao servidor e continua de onde parou", async () => {
    const s = servidorFalso({ quebrarNoPedaco: 2 });
    await enviarEmPedacos({ arquivo, base: "b", videoId: VID, token: "t", transporte: s.t, pedaco: 3000, esperaMs: 0 });
    expect(s.total()).toBe(10_000);
  });

  it("409 (offset diferente): realinha com o X-Recebido", async () => {
    const s = servidorFalso({ offsetErradoUmaVez: true });
    await enviarEmPedacos({ arquivo, base: "b", videoId: VID, token: "t", transporte: s.t, pedaco: 3000, esperaMs: 0 });
    expect(s.total()).toBe(10_000);
  });

  it("token expirado: para na hora com mensagem clara (não insiste)", async () => {
    const s = servidorFalso({ status401: true });
    await expect(enviarEmPedacos({ arquivo, base: "b", videoId: VID, token: "t", transporte: s.t, pedaco: 3000, esperaMs: 0 })).rejects.toThrow(/expirou/);
    expect(s.pedidos()).toBe(1);
  });

  it("retoma um envio anterior (HEAD diz que já tem metade)", async () => {
    const s = servidorFalso();
    const enviar = vi.spyOn(s.t, "enviar");
    vi.spyOn(s.t, "consultar").mockResolvedValueOnce(6000);
    // servidor "já tinha" 6000: o falso começa em 0, então alinha pelo 409
    await enviarEmPedacos({ arquivo, base: "b", videoId: VID, token: "t", transporte: s.t, pedaco: 3000, esperaMs: 0 });
    expect(enviar.mock.calls[0][2]).toBe(6000);
  });

  it("valida tipo e tamanho antes de subir", () => {
    expect(validarArquivo({ name: "aula.mp4", size: 10, type: "video/mp4" })).toBeNull();
    expect(validarArquivo({ name: "aula.MOV", size: 10, type: "" })).toBeNull();
    expect(validarArquivo({ name: "aula.avi", size: 10, type: "video/x-msvideo" })).toMatch(/MP4 ou MOV/);
    expect(validarArquivo({ name: "a.mp4", size: 9 * 1024 ** 3, type: "video/mp4" })).toMatch(/8 GB/);
  });
});

describe("estado do vídeo no palco", () => {
  const desde = "2026-11-01T22:00:00.000Z";
  const t0 = new Date(desde).getTime();
  it("parado sem início", () => {
    expect(estadoVideo({ tocandoDesde: null, duracaoSeg: 100, agora: t0 })).toMatchObject({ fase: "parado", restante: null });
  });
  it("tocando: decorrido, restante e progresso", () => {
    expect(estadoVideo({ tocandoDesde: desde, duracaoSeg: 100, agora: t0 + 25_000 })).toEqual({ fase: "tocando", decorrido: 25, restante: 75, progresso: 0.25 });
  });
  it("chegou ao fim: terminando (a tela recarrega e o webhook limpa)", () => {
    expect(estadoVideo({ tocandoDesde: desde, duracaoSeg: 100, agora: t0 + 130_000 })).toMatchObject({ fase: "terminando", restante: 0, progresso: 1 });
  });
  it("sem duração medida: só decorrido", () => {
    expect(estadoVideo({ tocandoDesde: desde, duracaoSeg: null, agora: t0 + 5_000 })).toMatchObject({ fase: "tocando", restante: null });
  });
});

describe("aviso 'começa agora' no painel", () => {
  const agora = new Date("2026-11-01T22:05:00Z").getTime();
  it("aparece por 30 min depois da hora, fora do ar e sem início automático", () => {
    expect(avisoComecaAgora({ status: "rascunho", agenda_aviso_em: "2026-11-01T22:00:00Z" }, agora)).toBe(true);
    expect(avisoComecaAgora({ status: "ao_vivo", agenda_aviso_em: "2026-11-01T22:00:00Z" }, agora)).toBe(false);
    expect(avisoComecaAgora({ status: "rascunho", agenda_aviso_em: "2026-11-01T22:00:00Z", auto_iniciar: true }, agora)).toBe(false);
    expect(avisoComecaAgora({ status: "rascunho", agenda_aviso_em: "2026-11-01T21:00:00Z" }, agora)).toBe(false);
    expect(avisoComecaAgora({ status: "rascunho", agenda_aviso_em: null }, agora)).toBe(false);
  });
  it("datetime-local a partir do ISO (hora do navegador)", () => {
    const iso = new Date(2026, 10, 1, 19, 5).toISOString();
    expect(paraDatetimeLocal(iso)).toBe("2026-11-01T19:05");
    expect(paraDatetimeLocal(null)).toBe("");
  });
});

describe("fim do envio e conversão na VPS", () => {
  const medido = { bytes: 2335784, duracao_seg: 20, video: { codec: "h264", largura: 590, altura: 1280 }, audio: true };
  it("200 pronto (e servidor antigo sem estado) = pode tocar, com as medidas", () => {
    for (const d of [{ ok: true, estado: "pronto", convertido: true, ...medido }, { ok: true, ...medido }]) {
      expect(lerFimAula(200, d)).toEqual({ status: "pronto", erro: null, progresso: null, campos: { bytes: 2335784, duracao_seg: 20, largura: 590, altura: 1280, tem_audio: true } });
    }
  });
  it("202 = convertendo, com progresso limitado a 0..1 e sem trocar o tamanho declarado", () => {
    const f = lerFimAula(202, { estado: "convertendo", progresso: 0.42, bytes: 8688304, duracao_seg: 19.97, video: { largura: 1320, altura: 2868 }, audio: true });
    expect(f.status).toBe("convertendo");
    expect(f.progresso).toBe(0.42);
    expect(f.campos).not.toHaveProperty("bytes");
    expect(lerFimAula(202, { progresso: 7 }).progresso).toBe(1);
    expect(lerFimAula(202, {}).progresso).toBe(0);
  });
  it("200 com estado erro = a conversão falhou: erro legível, não toca", () => {
    const f = lerFimAula(200, { ok: false, estado: "erro", erro: "não consegui converter o vídeo para tocar no palco: o ffmpeg falhou", ...medido });
    expect(f.status).toBe("erro");
    expect(f.erro).toMatch(/não consegui converter/);
  });
  it("outros status = erro com a mensagem do servidor", () => {
    expect(lerFimAula(422, { erro: "não é um vídeo" })).toMatchObject({ status: "erro", erro: "não é um vídeo", campos: {} });
    expect(lerFimAula(507, {}).erro).toBe("servidor de aulas respondeu 507");
  });
  it("texto do vídeo que ainda não está pronto", () => {
    expect(textoVideoPendente({ status: "convertendo", erro: null }, 0.427)).toBe("convertendo para tocar no palco 42%");
    expect(textoVideoPendente({ status: "convertendo", erro: null }, 1)).toBe("convertendo para tocar no palco 99%");
    expect(textoVideoPendente({ status: "convertendo", erro: null })).toBe("convertendo para tocar no palco…");
    expect(textoVideoPendente({ status: "enviando", erro: null })).toBe("envio não terminou");
    expect(textoVideoPendente({ status: "erro", erro: "x" })).toBe("erro: x");
  });
});
