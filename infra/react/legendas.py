#!/usr/bin/env python3
"""headturbo-react: transcreve a voz dele com o Whisper local (faster-whisper, CPU int8), com tempo por palavra.

Uso (montagem.py chama no Python do venv do serviço, com nice 19):
    python legendas.py voz.wav palavras.json --modelo /caminho/do/modelo [--threads 2]

Saída: {"palavras": [{"w": "olha", "ini": 1.23, "fim": 1.51, "p": 0.93}, ...], "idioma": "pt", "segundos": 12.3}
Sem rede: o modelo vem de uma pasta local (model.bin + tokenizer), HF_HUB_OFFLINE=1. Sem custo.
"""
import argparse
import json
import os
import sys
import time
import wave

os.environ.setdefault("HF_HUB_OFFLINE", "1")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("saida")
    ap.add_argument("--modelo", required=True)
    ap.add_argument("--threads", type=int, default=2)
    a = ap.parse_args()
    import numpy as np
    from faster_whisper import WhisperModel  # só no venv

    # A voz chega em WAV 16 kHz mono (montagem.py): lida aqui, sem o PyAV (o av 17+ quebrou o decode_audio do 1.2.1).
    with wave.open(a.wav, "rb") as w:
        if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise SystemExit("a voz precisa vir em WAV 16 kHz mono 16 bits")
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    inicio = time.time()
    m = WhisperModel(a.modelo, device="cpu", compute_type="int8", cpu_threads=a.threads, num_workers=1)
    segs, info = m.transcribe(
        audio, language="pt", word_timestamps=True, vad_filter=True, beam_size=5,
        condition_on_previous_text=False, vad_parameters={"min_silence_duration_ms": 300},
    )
    palavras = []
    for s in segs:
        if getattr(s, "no_speech_prob", 0) > 0.8 and getattr(s, "avg_logprob", 0) < -1.0:
            continue  # trecho que o próprio Whisper acha que não é fala (alucinação no silêncio)
        for w in s.words or []:
            if w.probability is not None and w.probability < 0.15:
                continue
            palavras.append({"w": w.word.strip(), "ini": round(w.start, 3), "fim": round(w.end, 3),
                             "p": round(w.probability or 0, 3)})
    tmp = a.saida + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"palavras": palavras, "idioma": info.language, "segundos": round(time.time() - inicio, 1)}, f,
                  ensure_ascii=False)
    os.replace(tmp, a.saida)
    return 0


if __name__ == "__main__":
    sys.exit(main())
