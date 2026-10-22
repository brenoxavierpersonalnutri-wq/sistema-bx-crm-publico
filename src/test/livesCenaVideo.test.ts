// O vídeo do bloco: câmera/tela pela fonte; o "Vídeo da aula" (Ingress) aceita o vídeo dele em qualquer fonte.
import { describe, expect, it } from "vitest";
import { Track } from "livekit-client";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { acharVideo } from "@/components/lives/CenaLive";

const ref = (identity: string, source: Track.Source, o: { muted?: boolean; kind?: Track.Kind } = {}) =>
  ({
    participant: { identity },
    source,
    publication: { isMuted: !!o.muted, kind: o.kind ?? Track.Kind.Video, trackSid: `${identity}-${source}` },
  }) as unknown as TrackReferenceOrPlaceholder;
const AULA = "aula-video-abc123def456";

describe("acharVideo", () => {
  it("câmera e tela pela fonte exata", () => {
    const ts = [ref("ana", Track.Source.Camera), ref("ana", Track.Source.ScreenShare)];
    expect(acharVideo(ts, { identity: "ana", fonte: "camera" })?.source).toBe(Track.Source.Camera);
    expect(acharVideo(ts, { identity: "ana", fonte: "tela" })?.source).toBe(Track.Source.ScreenShare);
  });

  it("vídeo da aula publicado como unknown ou screen_share ainda aparece no bloco de câmera", () => {
    expect(acharVideo([ref(AULA, Track.Source.Unknown)], { identity: AULA, fonte: "camera" })?.source).toBe(Track.Source.Unknown);
    expect(acharVideo([ref(AULA, Track.Source.ScreenShare)], { identity: AULA, fonte: "camera" })?.source).toBe(Track.Source.ScreenShare);
  });

  it("pessoa sem câmera não pega a tela no lugar da câmera; câmera desligada (muted) = avatar", () => {
    expect(acharVideo([ref("ana", Track.Source.ScreenShare)], { identity: "ana", fonte: "camera" })).toBeNull();
    expect(acharVideo([ref("ana", Track.Source.Camera, { muted: true })], { identity: "ana", fonte: "camera" })).toBeNull();
  });

  it("placeholder (sem publicação) não conta", () => {
    const ph = { participant: { identity: "ana" }, source: Track.Source.Camera } as unknown as TrackReferenceOrPlaceholder;
    expect(acharVideo([ph], { identity: "ana", fonte: "camera" })).toBeNull();
  });
});
