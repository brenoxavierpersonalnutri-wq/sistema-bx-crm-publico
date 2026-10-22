// Tipos mínimos do opus-recorder 8.0.5 (o pacote não traz .d.ts). Só o que src/lib/crm/gravadorVoz.ts usa.
declare module "opus-recorder" {
  interface OpcoesRecorder {
    sourceNode?: MediaStreamAudioSourceNode;
    encoderPath?: string;
    numberOfChannels?: number;
    encoderApplication?: 2048 | 2049 | 2051;
    encoderSampleRate?: 8000 | 12000 | 16000 | 24000 | 48000;
    encoderBitRate?: number;
    streamPages?: boolean;
    mediaTrackConstraints?: MediaTrackConstraints | boolean;
  }
  export default class Recorder {
    constructor(opcoes?: OpcoesRecorder);
    static isRecordingSupported(): boolean;
    start(): Promise<void>;
    stop(): Promise<void>;
    close(): void;
    ondataavailable: ((dados: ArrayBuffer | Uint8Array) => void) | null;
    onstop: (() => void) | null;
  }
}

declare module "opus-recorder/dist/encoderWorker.min.js?url" {
  const url: string;
  export default url;
}
