// Nota de voz no proxy da VPS (21/10/2026): todo áudio com ptt vira Ogg/Opus mono 48 kHz (ffmpeg, cache por hash)
// e sai com "gravando áudio…" antes, proporcional à duração.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  montarPedidoOpenwa, montarPedidoGrupo, montarPedidoGrupoManual,
  argsFfmpegVoz, argsFfprobe, lerFfprobe, vozJaPronta, esperaGravandoMs, MIME_VOZ,
  GRAVANDO_MIN_MS, GRAVANDO_MAX_MS,
} from "../../infra/wa-proxy/lib.mjs";

const sid = "uuid-closer";
const tel = "5531999998888";

describe("send-audio com ptt", () => {
  it("marca voz e gravando (padrão), aceita mp3", () => {
    const p = montarPedidoOpenwa("send-audio", { phone: tel, url: "https://a.com/audio-fisicos.mp3", ptt: true }, sid);
    expect(p).toEqual({
      metodo: "POST", caminho: `/sessions/${sid}/messages/send-audio`,
      corpo: { chatId: `${tel}@c.us`, url: "https://a.com/audio-fisicos.mp3", ptt: true, mimetype: MIME_VOZ },
      voz: true, gravando: `${tel}@c.us`,
    });
  });
  it("gravando: false desliga o indicador; gravando inválido é recusado", () => {
    const p = montarPedidoOpenwa("send-audio", { phone: tel, url: "https://a.com/a.mp3", ptt: true, gravando: false }, sid);
    expect(p.voz).toBe(true);
    expect(p.gravando).toBeUndefined();
    expect(montarPedidoOpenwa("send-audio", { phone: tel, url: "https://a.com/a.mp3", ptt: true, gravando: "sim" }, sid).erro).toBe("gravando");
  });
  it("sem ptt: áudio comum, sem conversão nem gravando", () => {
    const p = montarPedidoOpenwa("send-audio", { phone: tel, url: "https://a.com/a.mp3" }, sid);
    expect(p.voz).toBeUndefined();
    expect(p.gravando).toBeUndefined();
    expect(p.corpo).toEqual({ chatId: `${tel}@c.us`, url: "https://a.com/a.mp3" });
  });
  it("grupo (disparo e manual) com ptt também converte, sem gravando", () => {
    const chat = "120363000000000001@g.us";
    const g = montarPedidoGrupo("send-group-media", { chatId: chat, kind: "audio", url: "https://x/a.mp3", ptt: true }, sid, new Set([chat]));
    expect(g.voz).toBe(true);
    expect(g.gravando).toBeUndefined();
    const m = montarPedidoGrupoManual("send-group-manual-media", { chatId: chat, kind: "audio", url: "https://x/a.mp3", ptt: true }, sid);
    expect(m.voz).toBe(true);
    const doc = montarPedidoGrupoManual("send-group-manual-media", { chatId: chat, kind: "document", url: "https://x/a.mp3" }, sid);
    expect(doc.voz).toBeUndefined();
  });
});

describe("ajudantes da conversão", () => {
  it("argumentos do ffmpeg: mono, 48 kHz, libopus, ogg", () => {
    const a = argsFfmpegVoz("/tmp/i", "/tmp/o.ogg");
    const par = (k: string) => a[a.indexOf(k) + 1];
    expect(par("-ac")).toBe("1");
    expect(par("-ar")).toBe("48000");
    expect(par("-c:a")).toBe("libopus");
    expect(par("-f")).toBe("ogg");
    expect(a.at(-1)).toBe("/tmp/o.ogg");
  });
  it("lerFfprobe e vozJaPronta", () => {
    const opus = lerFfprobe(JSON.stringify({ streams: [{ codec_name: "opus", channels: 1, sample_rate: "48000" }], format: { format_name: "ogg", duration: "12.81" } }));
    expect(opus).toEqual({ formato: "ogg", duracaoS: 12.81, codec: "opus", canais: 1, taxa: 48000 });
    expect(vozJaPronta(opus)).toBe(true);
    const mp3 = lerFfprobe(JSON.stringify({ streams: [{ codec_name: "mp3", channels: 2, sample_rate: "44100" }], format: { format_name: "mp3", duration: "12.8" } }));
    expect(vozJaPronta(mp3)).toBe(false);
    expect(vozJaPronta({ ...opus, canais: 2 })).toBe(false);
    expect(lerFfprobe("{}")).toBeNull();
    expect(lerFfprobe("lixo")).toBeNull();
  });
  it("gravando proporcional à duração, entre 2 s e 12 s", () => {
    expect(esperaGravandoMs(null)).toBe(GRAVANDO_MIN_MS);
    expect(esperaGravandoMs(0.5)).toBe(GRAVANDO_MIN_MS);
    expect(esperaGravandoMs(5.4)).toBe(5400);
    expect(esperaGravandoMs(12.8)).toBe(GRAVANDO_MAX_MS);
    expect(esperaGravandoMs(300)).toBe(GRAVANDO_MAX_MS);
  });
});

// Conversão de verdade (só onde há ffmpeg): o mp3 do agente "Avaliação fitness" vira nota de voz válida.
const temFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
describe.skipIf(!temFfmpeg)("ffmpeg real", () => {
  it("audio-fisicos.mp3 -> Ogg/Opus mono 48 kHz com a mesma duração", () => {
    const origem = path.resolve(__dirname, "../../public/roteiros/sellflux/audio-fisicos.mp3");
    const saida = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "voz-")), "o.ogg");
    execFileSync("ffmpeg", argsFfmpegVoz(origem, saida), { stdio: "ignore" });
    const antes = lerFfprobe(execFileSync("ffprobe", argsFfprobe(origem), { encoding: "utf8" }));
    const depois = lerFfprobe(execFileSync("ffprobe", argsFfprobe(saida), { encoding: "utf8" }));
    expect(vozJaPronta(depois)).toBe(true);
    expect(Math.abs((depois?.duracaoS ?? 0) - (antes?.duracaoS ?? 0))).toBeLessThan(0.2);
  });
});
