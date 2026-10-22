#!/usr/bin/env python3
"""Arnês do Estúdio React: vídeos sintéticos do ffmpeg -> montagem de verdade -> conferência por ffprobe/SSIM.

    python3 infra/react/test/arnes.py --saida /tmp/arnes-react [--vozes DIR] [--frames DIR] [--sem-separado]

- "original": testsrc2 1280x720 (deitado) com o tempo escrito na tela e um tom de 5 kHz (para medir o abaixar);
- "reação": testsrc 720x1280 (em pé, como o celular) com voz falsa: `say -v Luciana` se existir (Mac), WAVs
  prontos de --vozes, ou tons (aí a legenda não é conferida);
- linha do tempo como o navegador manda: atraso no começo, comentário com respiro no começo/fim e silêncio
  interno longo, comentário mudo (tem que sumir), comentário longo (vai em tela cheia no layout cheia_longos);
- modo separado: o som do original "vaza" no microfone (baixo, com eco), e a sincronia tem que achar sozinha
  as pausas e os pontos do original.
Sai com 1 se alguma conferência falhar. Com o Whisper (REACT_WHISPER_MODELO) a legenda também é conferida.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, ".."))
import montagem as M  # noqa: E402

FONTE = os.path.join(AQUI, "..", "fontes", "ArchivoBlack-Regular.ttf")
TOM = 5000
FALAS = {
    "nossa": "Nossa!",
    "c1a": "Olha só esse agachamento, a postura está toda errada.",
    "c1b": "E o pior é que ele nem percebe.",
    "c2": "Repara no joelho dele entrando para dentro.",
    "c3": "Agora presta atenção, porque esse é o erro mais comum que eu vejo na academia: "
          "a pessoa desce rápido demais e perde todo o controle do movimento.",
}
OK, FALHAS = [], []


def conferir(nome: str, cond: bool, detalhe: str = ""):
    (OK if cond else FALHAS).append(nome)
    print(f"{'ok  ' if cond else 'FALHA'} {nome}{('  [' + detalhe + ']') if detalhe else ''}", flush=True)


def ff(*args, timeout=600):
    r = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-v", "error", "-y", *args], capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg: {r.stderr.strip()[-400:]}")
    return r


def duracao(p: str) -> float:
    return M.sondar(p)["duracao"]


def gerar_voz(chave: str, pasta: str, vozes: str | None) -> str:
    saida = os.path.join(pasta, f"voz_{chave}.wav")
    pronto = os.path.join(vozes, f"{chave}.wav") if vozes else None
    if pronto and os.path.exists(pronto):
        ff("-i", pronto, "-ar", "48000", "-ac", "1", saida)
    elif shutil.which("say"):
        aiff = os.path.join(pasta, f"voz_{chave}.aiff")
        subprocess.run(["say", "-v", "Luciana", "-o", aiff, FALAS[chave]], check=True, timeout=60)
        ff("-i", aiff, "-ar", "48000", "-ac", "1", "-af", "volume=2", saida)
    else:  # tom "falado": rajadas de 180-260 Hz
        d = max(0.6, len(FALAS[chave]) * 0.06)
        ff("-f", "lavfi", "-i", f"aevalsrc='0.3*sin(2*PI*(200+60*sin(7*t))*t)*(0.6+0.4*sin(9*t))':s=48000:d={d}", saida)
    return saida


def drawtext(rotulo: str, tam: int) -> str:
    return (f"drawtext=fontfile='{FONTE}':text='{rotulo} %{{pts\\:hms}}':fontsize={tam}:fontcolor=white:"
            f"box=1:boxcolor=black@0.6:x=(w-tw)/2:y=(h-th)/2")


def gerar_original(saida: str, dur: float, fala: str | None = None):
    """testsrc2 deitado com o tempo na tela; áudio = tom de 5 kHz (+ narração opcional)."""
    entradas = ["-f", "lavfi", "-i", f"testsrc2=size=1280x720:rate=30:duration={dur}",
                "-f", "lavfi", "-i", f"sine=frequency={TOM}:sample_rate=48000:duration={dur}"]
    af = "[1:a]volume=0.25[a]"
    if fala:
        entradas += ["-i", fala]
        af = f"[1:a]volume=0.12[t];[2:a]apad,atrim=duration={dur}[n];[t][n]amix=inputs=2:normalize=0[a]"
    ff(*entradas, "-filter_complex", f"[0:v]{drawtext('ORIGINAL', 64)}[v];{af}", "-map", "[v]", "-map", "[a]",
       "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-t", str(dur), saida)


def gerar_reacao(saida: str, dur: float, vozes: list, vazamentos: list | None = None, original: str | None = None):
    """testsrc em pé + áudio: ruído de fundo, voz em (arquivo, instante) e opcional vazamento do original
    [(ini_rec, ini_orig, dur)] baixo e com eco."""
    entradas = ["-f", "lavfi", "-i", f"testsrc=size=720x1280:rate=30:duration={dur}",
                "-f", "lavfi", "-i", f"anoisesrc=color=pink:amplitude=0.002:sample_rate=48000:duration={dur}"]
    g, rot = [], ["[1:a]"]
    idx = 2
    for arq, t in vozes:
        entradas += ["-i", arq]
        g.append(f"[{idx}:a]aresample=48000,adelay={int(t * 1000)}:all=1[v{idx}]")
        rot.append(f"[v{idx}]")
        idx += 1
    for k, (ir, io, d) in enumerate(vazamentos or []):
        entradas += ["-ss", f"{io}", "-t", f"{d}", "-i", original]
        g.append(f"[{idx}:a]aresample=48000,pan=mono|c0=c0,highpass=f=150,lowpass=f=6000,volume=0.35,"
                 f"aecho=0.8:0.5:40:0.3,adelay={int(ir * 1000)}:all=1[l{idx}]")
        rot.append(f"[l{idx}]")
        idx += 1
    g.append(f"{''.join(rot)}amix=inputs={len(rot)}:normalize=0:duration=first,atrim=duration={dur}[a]")
    g.append(f"[0:v]{drawtext('REACAO', 56)}[v]")
    ff(*entradas, "-filter_complex", ";".join(g), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast",
       "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "1", "-t", str(dur), saida)


def quadro_png(video: str, t: float, saida: str, crop: str | None = None):
    vf = [crop] if crop else []
    ff("-ss", f"{t:.3f}", "-i", video, "-frames:v", "1", *(["-vf", ",".join(vf)] if vf else []), "-update", "1", saida)


def ssim(a: str, b: str) -> float:
    r = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-i", a, "-i", b, "-lavfi", "ssim", "-f", "null", "-"],
                       capture_output=True, text=True, timeout=60)
    m = re.search(r"All:([\d.]+)", r.stderr)
    return float(m.group(1)) if m else 0.0


def rms_tom(video: str, ini: float, dur: float) -> float:
    r = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-ss", f"{ini:.3f}", "-t", f"{dur:.3f}", "-i", video, "-vn",
                        "-af", f"bandpass=f={TOM}:width_type=q:w=30,astats=measure_perchannel=none", "-f", "null", "-"],
                       capture_output=True, text=True, timeout=60)
    m = re.findall(r"RMS level dB:\s*(-?[\d.]+|-inf)", r.stderr)
    return float(m[-1]) if m and m[-1] != "-inf" else -120.0


def montar(pasta: str, original: str, reacao: str, pedido: dict) -> dict:
    os.makedirs(pasta, exist_ok=True)
    for fonte, nome in ((original, "original.bin"), (reacao, "reacao.bin")):   # montar de novo na mesma pasta = mesma gravação
        destino = os.path.join(pasta, nome)
        if not (os.path.exists(destino) and os.path.getsize(destino) == os.path.getsize(fonte)):
            shutil.copy(fonte, destino)
    with open(os.path.join(pasta, "pedido.json"), "w") as f:
        json.dump(pedido, f)
    t = time.time()
    sys.argv = ["montagem.py", pasta]
    rc = M.main()
    e = json.load(open(os.path.join(pasta, "estado.json")))
    print(f"     montagem: rc {rc}, {e.get('estado')} em {time.time() - t:.1f} s {e.get('erro') or ''}", flush=True)
    res = json.load(open(os.path.join(pasta, "resultado.json"))) if os.path.exists(os.path.join(pasta, "resultado.json")) else {}
    return {"estado": e, "res": res, "final": os.path.join(pasta, "final.mp4")}


def conferir_formato(rot: str, final: str, dur_plano: float):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "stream=codec_type,codec_name,profile,width,height,avg_frame_rate,sample_rate,channels,pix_fmt:format=duration",
                        "-of", "json", final], capture_output=True, text=True)
    d = json.loads(r.stdout)
    v = next(s for s in d["streams"] if s["codec_type"] == "video")
    a = next((s for s in d["streams"] if s["codec_type"] == "audio"), {})
    conferir(f"{rot}: vídeo H.264 High 1080x1920 30 fps yuv420p",
             v["codec_name"] == "h264" and v.get("profile") == "High" and v["width"] == 1080 and v["height"] == 1920
             and v["avg_frame_rate"] == "30/1" and v.get("pix_fmt") == "yuv420p",
             f"{v['codec_name']} {v.get('profile')} {v['width']}x{v['height']} {v['avg_frame_rate']} {v.get('pix_fmt')}")
    conferir(f"{rot}: áudio AAC 48 kHz estéreo", a.get("codec_name") == "aac" and a.get("sample_rate") == "48000" and a.get("channels") == 2,
             f"{a.get('codec_name')} {a.get('sample_rate')} {a.get('channels')}")
    dur = float(d["format"]["duration"])
    conferir(f"{rot}: duração = soma dos pedaços planejados (±0,15 s)", abs(dur - dur_plano) <= 0.15, f"{dur:.2f} x {dur_plano:.2f}")
    with open(final, "rb") as f:
        cab = f.read(64 * 1024)
    conferir(f"{rot}: faststart (moov antes do mdat)", cab.find(b"moov") != -1 and (cab.find(b"mdat") == -1 or cab.find(b"moov") < cab.find(b"mdat")))


def norm(w: str) -> str:
    return re.sub(r"[^\wáéíóúâêôãõç]", "", w.lower())


def ia_falsa(sistema: str, usuario: str) -> dict:
    """Faz o papel do Claude: lê a transcrição numerada do prompt e devolve um plano fixo pelas palavras."""
    ws = [(int(i), norm(w)) for i, w in re.findall(r"\[(\d+)\](\S+)", usuario)]
    idx = lambda alvo, depois=-1: next((i for i, w in ws if w == alvo and i > depois), None)  # noqa: E731
    comentarios = {}
    atual = None
    for linha in usuario.splitlines():
        m = re.match(r"COMENTÁRIO (\d+)", linha)
        if m:
            atual = int(m.group(1))
        elif linha.startswith("FALA POR CIMA"):
            atual = None
        elif atual is not None:
            comentarios.setdefault(atual, []).extend(norm(w) for w in re.findall(r"\[\d+\](\S+)", linha))
    notas = [{"comentario": k, "nota": 5 if "agachamento" in v else 1 if "joelho" in v else 4} for k, v in comentarios.items()]
    erro, acad = idx("erro"), idx("academia")
    plano = {
        "titulo": "O erro do agachamento",
        "palavras_chave": [i for i in (idx("agachamento"), idx("joelho"), idx("academia"), idx("postura")) if i is not None],
        "gancho": {"de": (erro - 2) if erro else 0, "ate": acad if acad else 0},
        "cortar": [{"de": idx("só"), "ate": idx("só")}] if idx("só") is not None else [],
        "remover": [],
        "enfase": [{"de": idx("postura"), "ate": idx("errada")}] if idx("postura") is not None and idx("errada") is not None else [],
        "notas": notas,
    }
    IA_FALSA_CHAMADAS.append(plano)
    return {"conteudo": plano, "modelo": "ia-falsa", "tokens_entrada": len(usuario) // 4, "tokens_saida": 300,
            "custo_lista_usd": 0.0, "fonte": "teste"}


IA_FALSA_CHAMADAS: list = []


def proibido_arnes(s, u):
    raise RuntimeError("o arnês tentou chamar o Claude de verdade")


def palavras_sinteticas(voz_em: list, vz: dict, dv: dict) -> list:
    """Sem Whisper: as palavras de cada fala espalhadas pela duração da voz (para a IA falsa ter o que ler)."""
    out = []
    por_arq = {v: k for k, v in vz.items()}
    for arq, t in voz_em:
        ws = FALAS[por_arq[arq]].split()
        passo = dv[por_arq[arq]] / len(ws)
        for j, w in enumerate(ws):
            out.append({"w": w, "ini": round(t + j * passo, 3), "fim": round(t + (j + 0.85) * passo, 3), "p": 0.9})
    return sorted(out, key=lambda w: w["ini"])


def brilho(video: str, t: float, crop: str) -> float:
    r = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-ss", f"{t:.3f}", "-i", video, "-frames:v", "1",
                        "-vf", f"{crop},signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"],
                       capture_output=True, text=True, timeout=60)
    m = re.findall(r"YAVG=([\d.]+)", r.stderr)
    return float(m[-1]) if m else -1.0


def edicao_com_ia(S, original, reacao, T, voz_em, vz, dv, r_base, whisper_real):
    """Edição com IA: gancho, corte de palavra, zoom, título, chave, duração alvo; e a IA falhando."""
    transcrever_real = M.transcrever
    if not whisper_real:  # sem Whisper: palavras sintéticas no lugar da transcrição
        M.transcrever = lambda proj, wav, dur: (palavras_sinteticas(voz_em, vz, dv), None)
    M._CHAMAR_IA = ia_falsa
    base = r_base["res"]["duracao_seg"] if r_base["estado"].get("estado") == "pronto" else 40.0
    maximo = round(base - 8, 1)
    try:
        r = montar(os.path.join(S, "ia"), original, reacao, {"modo": "aqui", "layout": "dividido", "legenda": True,
                                                              "cortar_silencio": True, "ia": True, "duracao_max": maximo,
                                                              "trechos": T})
        conferir("ia: montagem terminou pronta", r["estado"].get("estado") == "pronto", r["estado"].get("erro", ""))
        if r["estado"].get("estado") != "pronto":
            return None
        res, P = r["res"], r["res"]["pecas_plano"]
        ia = res.get("ia") or {}
        conferir("ia: aplicada, 1 chamada só", ia.get("aplicada") and len(IA_FALSA_CHAMADAS) == 1 and (ia.get("uso") or {}).get("chamadas") == 1,
                 f"{ia.get('aplicada')} {len(IA_FALSA_CHAMADAS)} {res.get('avisos')}")
        conferir_formato("ia", r["final"], sum(p["dur"] for p in P))
        g = P[0]
        conferir("ia: o vídeo abre com o gancho (2 a 4 s, do comentário longo)", bool(g.get("gancho")) and M.GANCHO_MIN <= g["dur"] <= M.GANCHO_MAX
                 and abs(g["orig"] - 15.0) < 0.01, f"{g.get('gancho')} {g['dur']:.2f} s orig {g['orig']}")
        conferir("ia: duração alvo respeitada", res["duracao_seg"] <= maximo + 0.5, f"{res['duracao_seg']:.2f} x máx {maximo}")
        conferir("ia: comentário de nota 1 (joelho) saiu ou o tocando encurtou",
                 not any(p["tipo"] == "comentario" and abs(p["orig"] - 11.0) < 0.01 for p in P) or ia.get("tocando_encurtado_seg", 0) > 0,
                 f"tirados {ia.get('comentarios_tirados_pela_duracao')} · tocando -{ia.get('tocando_encurtado_seg')} s")
        conferir("ia: corte da palavra 'só' aplicado", ia.get("cortes", 0) >= 1, str(ia.get("cortes")))
        ass = os.path.join(S, "ia", "legendas.ass")
        txt = open(ass, encoding="utf-8").read() if os.path.exists(ass) else ""
        conferir("ia: título no topo do ASS", ",T,," in txt and "o erro do" in txt.lower())
        linhas_ev = [l for l in txt.splitlines() if l.startswith("Dialogue: 0,")]
        ev = [l.split(",", 9)[9] for l in linhas_ev]
        limpos = [re.sub(r"\{[^}]*\}", "", x) for x in ev]
        seg = lambda h: sum(float(x) * m for x, m in zip(h.split(":"), (3600, 60, 1)))  # noqa: E731
        tempos = [(seg(l.split(",")[1]), seg(l.split(",")[2])) for l in linhas_ev]
        # 1 palavra só vale para fala isolada (sem outra frase a menos de 0,8 s): juntar mostraria texto fora do tempo
        n = [len(x.split()) for x in limpos]

        def junta_com(a, b):  # dava para juntar as frases a e b (perto e cabendo em 5)?
            return tempos[b][0] - tempos[a][1] < 0.8 and n[a] + n[b] <= 5

        sozinhas_ruins = [limpos[i] for i in range(len(limpos)) if n[i] < 2
                          and ((i > 0 and junta_com(i - 1, i)) or (i + 1 < len(limpos) and junta_com(i, i + 1)))]
        conferir("legenda nativa (padrão): DM Sans branca, sem cor por palavra nem karaokê, frases de até 5 palavras (1 só se isolada)",
                 "Style: R,DM Sans,60,&H00FFFFFF" in txt and "&H0060FF3C&" not in txt and "&H0000E5FF&" not in txt
                 and ev and all(len(x.split()) <= 5 for x in limpos) and not sozinhas_ruins and all("pos(540,1420)" in x for x in ev)
                 and r["res"].get("modelo") == "nativo", f"{len(ev)} frases · sozinhas fora da regra {sozinhas_ruins} · ex.: {limpos[:4]}")
        y = brilho(r["final"], 1.0, "crop=300:8:390:52")
        conferir("ia: caixa branca do título aparece no quadro (brilho do topo)", y > 170, f"YAVG {y:.0f}")
        t_zoom = None
        pz = next((p for p in P if p.get("zoom")), None)
        if pz:
            a, b = pz["zoom"][0]
            if a >= 0.35:
                t_zoom = pz["t0"] + a + 0.2
                f_antes, f_zoom, f_antes2 = (os.path.join(S, x) for x in ("z_antes.png", "z_zoom.png", "z_antes2.png"))
                quadro_png(r["final"], pz["t0"] + a - 0.3, f_antes, "crop=1080:960:0:960")
                quadro_png(r["final"], pz["t0"] + a - 0.1, f_antes2, "crop=1080:960:0:960")
                quadro_png(r["final"], t_zoom, f_zoom, "crop=1080:960:0:960")
                s_sem, s_com = ssim(f_antes, f_antes2), ssim(f_antes, f_zoom)
                conferir("ia: zoom na câmera dele na ênfase (metade de baixo muda de escala)", s_com < s_sem - 0.1,
                         f"SSIM sem zoom {s_sem:.3f} · com zoom {s_com:.3f}")
            else:
                conferir("ia: zoom planejado (janela no começo do pedaço)", True, str(pz["zoom"]))
        else:
            conferir("ia: zoom planejado em algum pedaço", False)
        rz = {"final": r["final"], "t_zoom": t_zoom}

        # a IA falhando: monta sem ela e avisa
        def ia_quebrada(s, u):
            import edicao_ia
            raise edicao_ia.FalhaIA("o Claude da VPS pediu login (teste)")
        M._CHAMAR_IA = ia_quebrada
        r2 = montar(os.path.join(S, "ia-falha"), original, reacao, {"modo": "aqui", "layout": "dividido", "legenda": True,
                                                                     "cortar_silencio": True, "ia": True, "duracao_max": maximo,
                                                                     "trechos": T})
        av = (r2["res"].get("avisos") or [])
        conferir("ia falhando: monta sem IA e avisa na tela", r2["estado"].get("estado") == "pronto" and any("edição com IA desligada" in x for x in av)
                 and not (r2["res"].get("ia") or {}).get("aplicada") and not r2["res"]["pecas_plano"][0].get("gancho"), str(av))
        return rz
    finally:
        M.transcrever = transcrever_real
        M._CHAMAR_IA = proibido_arnes


def rms_faixa(video: str, ini: float, dur: float, af: str = "") -> float:
    """RMS (dB) do áudio do vídeo final numa janela; af = filtro antes de medir (ex.: só a voz, sem o tom)."""
    filtro = (af + "," if af else "") + "astats=measure_perchannel=none"
    r = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-ss", f"{ini:.3f}", "-t", f"{dur:.3f}", "-i", video, "-vn",
                        "-af", filtro, "-f", "null", "-"], capture_output=True, text=True, timeout=60)
    m = re.findall(r"RMS level dB:\s*(-?[\d.]+|-inf)", r.stderr)
    return float(m[-1]) if m and m[-1] != "-inf" else -120.0


def ref_quadro(video: str, t: float, filtro: str, saida: str, crop: str | None = None):
    """Quadro de referência: o vídeo de entrada no instante t passado pelo filtro da montagem (rótulo [x])."""
    g = filtro + (f";[x]{crop}[y]" if crop else "")
    ff("-ss", f"{t:.3f}", "-i", video, "-frames:v", "1", "-filter_complex", g, "-map", "[y]" if crop else "[x]", "-update", "1", saida)


def peca_de(P: list, k: int, tipo: str | None = None):
    return next((p for p in P if p.get("k") == k and (tipo is None or p["tipo"] == tipo) and not p.get("gancho")), None)


def edicao_manual(S, original, reacao, T, idx, frames_dir=None):
    """Tela de edição: 3 layouts, pausa nova num ponto do original tocando, volume 30 %, mudo, trecho removido e
    volume geral, conferidos no vídeo final (SSIM contra o quadro de referência e nível do tom de 5 kHz)."""
    E = [dict(t) for t in T]
    kA, kB, kC, kD, kE, kF, kG = idx
    E[kA].update(layout="original_pip", volume=0.3)
    E[kB].update(layout="ele")
    E[kC].update(layout="original", mudo=True)
    E[kD].update(removido=True)
    e = E[kE]
    t_p, d_p = e["ini"] + 1.5, 1.5                       # pausa nova: 1,5 s depois do começo do trecho, por 1,5 s
    orig_p = e["orig"] + 1.5
    novos = [{**e, "fim": t_p},
             {"tipo": "tocando", "ini": t_p, "fim": t_p + d_p, "orig": orig_p, "congelar": True, "pausa": True},
             {"tipo": "tocando", "ini": t_p + d_p, "fim": e["fim"], "orig": orig_p}]   # retoma de onde parou
    E = E[:kE] + novos + E[kE + 1:]
    sh = 2                                               # os trechos depois de E andam 2 posições
    kF2, kG2, kP, kR = kF + sh, kG + sh, kE + 1, kE + 2
    ped = {"modo": "aqui", "layout": "dividido", "legenda": True, "cortar_silencio": True, "ia": False,
           "trechos": E, "edicao": {"volume_geral": 1.0}}
    r = montar(os.path.join(S, "edicao"), original, reacao, ped)
    conferir("edição: montagem terminou pronta", r["estado"].get("estado") == "pronto", r["estado"].get("erro", ""))
    if r["estado"].get("estado") != "pronto":
        return None
    P, final = r["res"]["pecas_plano"], r["final"]
    conferir_formato("edição", final, sum(p["dur"] for p in P))
    pA, pB, pC, pP, pR, pG = (peca_de(P, k) for k in (kA, kB, kC, kP, kR, kG2))
    conferir("edição: pedaços planejados com as escolhas", all((pA, pB, pC, pP, pR, pG)) and pA["layout"] == "original_pip"
             and pB["layout"] == "ele" and pC["layout"] == "original" and pC["vol"] == 0 and pA["vol"] == 0.3,
             str([(p and (p["k"], p["layout"], p["vol"])) for p in (pA, pB, pC, pP, pR, pG)]))
    if not all((pA, pB, pC, pP, pR, pG)):
        return None
    tmp = lambda n: os.path.join(S, f"ed_{n}.png")  # noqa: E731

    # 1) só o original em tela cheia (trecho C, tocando): quadro final = original "cheio" no ponto certo
    off = 1.5
    quadro_png(final, pC["t0"] + off, tmp("c"))
    ref_quadro(original, pC["orig"] + off, M.filtro_cheio("0:v", "x"), tmp("c_ref"))
    ref_quadro(original, pC["orig"] + off, M.filtro_topo("0:v", "t") + f";[t]pad={M.L}:{M.A}:0:0[x]", tmp("c_div"))
    s_ok, s_div = ssim(tmp("c"), tmp("c_ref")), ssim(tmp("c"), tmp("c_div"))
    conferir("layout só o original (tela cheia)", s_ok >= 0.85 and s_ok > s_div + 0.1, f"SSIM cheio {s_ok:.3f} · dividido {s_div:.3f}")

    # 2) só ele em tela cheia (comentário B): quadro final = câmera dele preenchendo 1080x1920
    off = min(1.0, pB["dur"] / 2)
    quadro_png(final, pB["t0"] + off, tmp("b"))
    ref_quadro(reacao, pB["ini"] + off, M.filtro_ele("0:v", "x", M.L, M.A), tmp("b_ref"))
    s_ok = ssim(tmp("b"), tmp("b_ref"))
    conferir("layout só você (tela cheia)", s_ok >= 0.85, f"SSIM {s_ok:.3f}")

    # 3) original na tela toda + ele no canto (trecho A)
    off = 1.0
    caixa = f"crop={M.PIP_ELE_L}:{M.PIP_ELE_A}:{M.L - 48 - M.PIP_ELE_L - 6}:{M.PIP_Y + 6}"
    quadro_png(final, pA["t0"] + off, tmp("a_pip"), caixa)
    ref_quadro(reacao, pA["ini"] + off, M.filtro_ele("0:v", "x", M.PIP_ELE_L, M.PIP_ELE_A), tmp("a_pip_ref"))
    fundo = "crop=1080:700:0:1100"
    quadro_png(final, pA["t0"] + off, tmp("a_fundo"), fundo)
    ref_quadro(original, pA["orig"] + off, M.filtro_cheio("0:v", "x"), tmp("a_fundo_ref"), fundo)
    s_pip, s_fundo = ssim(tmp("a_pip"), tmp("a_pip_ref")), ssim(tmp("a_fundo"), tmp("a_fundo_ref"))
    conferir("layout original + você no canto", s_pip >= 0.75 and s_fundo >= 0.85, f"SSIM canto {s_pip:.3f} · fundo {s_fundo:.3f}")

    # 4) pausa nova: original congelado no ponto escolhido, e depois retoma desse ponto
    topo = "crop=1080:960:0:0"
    conferir("pausa nova: pedaço congelado de 1,5 s sem corte de silêncio", pP["tipo"] == "comentario" and abs(pP["dur"] - d_p) < 0.05
             and abs(pP["orig"] - orig_p) < 0.01, f"{pP['tipo']} {pP['dur']} s orig {pP['orig']}")
    quadro_png(final, pP["t0"] + 0.15, tmp("p1"), topo)
    quadro_png(final, pP["t0"] + pP["dur"] - 0.15, tmp("p2"), topo)
    subprocess.run(M.cmd_topo_congelado(original, orig_p, tmp("p_ref")), check=True, capture_output=True)
    subprocess.run(M.cmd_topo_congelado(original, orig_p - 1.5, tmp("p_ref0")), check=True, capture_output=True)
    s_par, s_ref, s_0 = ssim(tmp("p1"), tmp("p2")), ssim(tmp("p1"), tmp("p_ref")), ssim(tmp("p1"), tmp("p_ref0"))
    conferir("pausa nova: quadro parado (SSIM entre começo e fim >= 0,97)", s_par >= 0.97, f"{s_par:.4f}")
    # piso 0,85 (era 0,9 com o original encaixado sobre fundo borrado; em cover a área toda é o padrão nítido e o ruído
    # do x264 pesa mais). O que prova o quadro certo é a separação para o quadro 1,5 s antes.
    conferir(f"pausa nova: é o quadro do original em {orig_p:.1f} s", s_ref >= 0.85 and s_ref > s_0 + 0.05, f"{s_ref:.3f} x {s_0:.3f}")
    quadro_png(final, pR["t0"] + 0.5, tmp("r1"), topo)
    candidatos = [orig_p - 1.0, orig_p - 0.5, orig_p, orig_p + 0.5, orig_p + 1.0, orig_p + 0.5 + d_p]   # +0,5 = retomou de onde parou
    notas = {}
    for o in candidatos:
        subprocess.run(M.cmd_topo_congelado(original, o, tmp(f"r_{o:.1f}")), check=True, capture_output=True)
        notas[round(o, 2)] = round(ssim(tmp("r1"), tmp(f"r_{o:.1f}")), 3)
    melhor = max(notas, key=notas.get)
    conferir("pausa nova: retoma de onde parou (o quadro casa com o original em pausa + 0,5 s)", abs(melhor - (orig_p + 0.5)) < 0.01,
             f"melhor {melhor} · {notas}")

    # 5) som do original: 30 % no A, mudo no C, 100 % no G (janelas sem a voz dele)
    nivel_a, nivel_c, nivel_g = rms_tom(final, pA["t0"] + 0.5, 1.2), rms_tom(final, pC["t0"] + 0.5, 2.0), rms_tom(final, pG["t0"] + 0.5, 1.5)
    queda = nivel_g - nivel_a
    conferir("volume 30 %: original ~10,5 dB abaixo do trecho a 100 % (±2 dB)", abs(queda - 10.46) <= 2.0,
             f"100 %: {nivel_g:.1f} dB · 30 %: {nivel_a:.1f} dB · diferença {queda:.1f} dB")
    conferir("mudo: o original some (>= 40 dB abaixo do trecho a 100 %)", nivel_g - nivel_c >= 40, f"{nivel_g:.1f} -> {nivel_c:.1f} dB")

    # 6) trecho removido: não aparece no plano e o vídeo encolhe
    conferir("trecho removido: o comentário do joelho (orig 11) não entra", not any(p.get("k") == kD for p in P)
             and not any(p["tipo"] == "comentario" and abs(p["orig"] - T[kD]["orig"]) < 0.01 for p in P))
    base = json.load(open(os.path.join(S, "edicao", "edicao_base.json")))
    conferir("edição: edicao_base.json com trechos e falas para a tela", len(base["trechos"]) >= len(E) and len(base["falas"]) >= 3
             and base["trechos"][kA].get("layout") == "original_pip", f"{len(base['trechos'])} trechos · {len(base['falas'])} falas")
    conferir("edição: prévias leves geradas", all(os.path.getsize(os.path.join(S, "edicao", f)) > 10_000
                                                  for f in ("previa_original.mp4", "previa_reacao.mp4")))
    if frames_dir:
        os.makedirs(frames_dir, exist_ok=True)
        quadro_png(final, pA["t0"] + 1.0, os.path.join(frames_dir, "6-edicao-original-com-voce-no-canto.png"))
        quadro_png(final, pB["t0"] + min(1.0, pB["dur"] / 2), os.path.join(frames_dir, "7-edicao-so-voce.png"))
        quadro_png(final, pC["t0"] + 1.5, os.path.join(frames_dir, "8-edicao-so-o-original.png"))
        quadro_png(final, pP["t0"] + 0.7, os.path.join(frames_dir, "9-edicao-pausa-nova.png"))
        shutil.copy(final, os.path.join(frames_dir, "exemplo-react-edicao.mp4"))

    # 7) volume geral 50 %: o original cai ~6 dB em relação à voz dele (mesma montagem, só o ajuste geral)
    ped2 = {**ped, "trechos": [{k: v for k, v in t.items() if k not in ("volume", "mudo", "layout", "removido")} for t in T],
            "edicao": {"volume_geral": 0.5}}
    r2 = montar(os.path.join(S, "edicao-geral"), original, reacao, ped2)
    r1 = montar(os.path.join(S, "edicao-geral-100"), original, reacao, {**ped2, "edicao": {"volume_geral": 1.0}})
    if r2["estado"].get("estado") == "pronto" and r1["estado"].get("estado") == "pronto":
        def rel(rr):
            PP = rr["res"]["pecas_plano"]
            g, f = peca_de(PP, kG, "tocando"), peca_de(PP, kF, "comentario")
            voz = rms_faixa(rr["final"], f["t0"] + 0.3, min(3.0, f["dur"] - 0.4), "lowpass=f=3000")
            return rms_tom(rr["final"], g["t0"] + 0.5, 1.5) - voz
        d = rel(r1) - rel(r2)
        conferir("volume geral 50 %: original ~6 dB mais baixo em relação à voz (±2 dB)", abs(d - 6.02) <= 2.0, f"{d:.1f} dB")
    else:
        conferir("volume geral: montagens prontas", False, f"{r2['estado'].get('erro')} {r1['estado'].get('erro')}")
    return {"E": E, "kD": kD}


def ia_falsa_tira_joelho(sistema: str, usuario: str) -> dict:
    """IA falsa que, além do plano fixo, manda tirar o comentário do joelho inteiro (para a escolha do Breno vencer)."""
    r = ia_falsa(sistema, usuario)
    comentarios, atual = {}, None
    for linha in usuario.splitlines():
        m = re.match(r"COMENTÁRIO (\d+)", linha)
        if m:
            atual = int(m.group(1))
        elif linha.startswith("FALA POR CIMA"):
            atual = None
        elif atual is not None:
            comentarios.setdefault(atual, []).extend(norm(w) for w in re.findall(r"\[\d+\](\S+)", linha))
    r["conteudo"]["remover"] = [k for k, v in comentarios.items() if "joelho" in v]
    return r


def breno_vence_ia(S, original, reacao, T, kD, voz_em, vz, dv, whisper_real):
    """1ª montagem com a IA (falsa) tira o comentário do joelho, corta "só", põe gancho e título; 2ª montagem com as
    escolhas dele (fica o joelho, restaura o corte, sem gancho, sem título): ele vence e a IA não é chamada de novo."""
    transcrever_real = M.transcrever
    if not whisper_real:
        M.transcrever = lambda proj, wav, dur: (palavras_sinteticas(voz_em, vz, dv), None)
    M._CHAMAR_IA = ia_falsa_tira_joelho
    pasta = os.path.join(S, "ia-breno")
    try:
        antes = len(IA_FALSA_CHAMADAS)
        ped = {"modo": "aqui", "layout": "dividido", "legenda": True, "cortar_silencio": True, "ia": True, "duracao_max": 600, "trechos": T}
        r = montar(pasta, original, reacao, ped)
        if r["estado"].get("estado") != "pronto":
            conferir("breno x ia: 1ª montagem (IA) pronta", False, r["estado"].get("erro", ""))
            return
        P, ia = r["res"]["pecas_plano"], r["res"]["ia"]
        txt = open(os.path.join(pasta, "legendas.ass"), encoding="utf-8").read()
        base = json.load(open(os.path.join(pasta, "edicao_base.json")))
        corte = next((c for c in base["ia"]["cortes"] if "só" in c["texto"].lower()), None)
        conferir("breno x ia: a IA tirou o joelho, cortou 'só', pôs gancho e título",
                 not any(p["tipo"] == "comentario" and not p.get("gancho") and abs(p["orig"] - T[kD]["orig"]) < 0.01 for p in P)
                 and ia.get("cortes", 0) >= 1 and P[0].get("gancho") and ",T,," in txt and corte is not None
                 and base["ia"]["removidos"] == [[T[kD]["ini"], T[kD]["fim"]]],
                 f"cortes {ia.get('cortes')} · gancho {P[0].get('gancho')} · removidos {base['ia']['removidos']} · corte {corte}")
        if corte is None:
            return
        E = [dict(t) for t in T]
        E[kD]["removido"] = False
        ped2 = {**ped, "trechos": E, "edicao": {"ia_gancho": False, "ia_titulo": False, "cortes_ia_restaurados": [corte["id"]]}}
        chamadas = len(IA_FALSA_CHAMADAS)
        r2 = montar(pasta, original, reacao, ped2)
        if r2["estado"].get("estado") != "pronto":
            conferir("breno x ia: 2ª montagem (escolhas) pronta", False, r2["estado"].get("erro", ""))
            return
        P2, ia2 = r2["res"]["pecas_plano"], r2["res"]["ia"]
        txt2 = open(os.path.join(pasta, "legendas.ass"), encoding="utf-8").read() if os.path.exists(os.path.join(pasta, "legendas.ass")) else ""
        conferir("breno x ia: a IA não foi chamada de novo (plano reaproveitado)", len(IA_FALSA_CHAMADAS) == chamadas
                 and ia2.get("reaproveitada") and chamadas == antes + 1, f"chamadas {antes}->{chamadas}->{len(IA_FALSA_CHAMADAS)}")
        conferir("breno x ia: o comentário que a IA tirou voltou (ele mandou ficar)",
                 any(p["tipo"] == "comentario" and abs(p["orig"] - T[kD]["orig"]) < 0.01 for p in P2))
        conferir("breno x ia: corte restaurado (0 cortes) e sem gancho", ia2.get("cortes") == 0 and not P2[0].get("gancho"),
                 f"cortes {ia2.get('cortes')} · 1º pedaço gancho={P2[0].get('gancho')}")
        conferir("breno x ia: título da IA desligado", ",T,," not in txt2 and not ia2.get("titulo"))
        conferir_formato("breno x ia", r2["final"], sum(p["dur"] for p in P2))
    finally:
        M.transcrever = transcrever_real
        M._CHAMAR_IA = proibido_arnes


def lufs(video: str) -> float:
    r = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-i", video, "-vn", "-af", "ebur128=framelog=quiet", "-f", "null", "-"],
                       capture_output=True, text=True, timeout=120)
    m = re.findall(r"I:\s*(-?[\d.]+) LUFS", r.stderr)
    return float(m[-1]) if m else 0.0


def pausas_nos_comentarios(final: str, P: list, minimo: float = 0.42) -> list:
    """Pausas (silêncio > minimo s) na voz dele dentro dos comentários do vídeo final (limiar como o da montagem)."""
    r = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-i", final, "-vn", "-af", "volumedetect", "-f", "null", "-"],
                       capture_output=True, text=True, timeout=120)
    m = re.search(r"mean_volume:\s*(-?[\d.]+) dB", r.stderr)
    lim = M.limiar_silencio(float(m.group(1)) if m else None)
    r = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-i", final, "-vn", "-af", f"silencedetect=noise={lim:.1f}dB:d={minimo}",
                        "-f", "null", "-"], capture_output=True, text=True, timeout=120)
    sil = M.ler_silencedetect(r.stderr, sum(p["dur"] for p in P))
    janelas = [(p["t0"] + 0.05, p["t0"] + p["dur"] - 0.05) for p in P if p["tipo"] == "comentario"]
    return [(round(a, 2), round(b, 2)) for a, b in sil if any(x <= a and b <= y for x, y in janelas)]


def modelos_edicao(S, original, reacao, T, voz_em, vz, dv, whisper_real, frames_dir=None):
    """Os dois presets do seletor: Nativo (padrão) e Edu Esteves (corte de pausa > 0,4 s, gancho central 3-5 s, sem
    legenda, punch-in a cada 3,5 s, -14 LUFS, final seco). IA falsa para ter título; quadros de prova em frames_dir."""
    transcrever_real = M.transcrever
    if not whisper_real:
        M.transcrever = lambda proj, wav, dur: (palavras_sinteticas(voz_em, vz, dv), None)
    M._CHAMAR_IA = ia_falsa
    try:
        base = {"modo": "aqui", "layout": "dividido", "legenda": True, "cortar_silencio": True, "ia": True, "duracao_max": 600, "trechos": T}
        rn = montar(os.path.join(S, "modelo-nativo"), original, reacao, {**base, "modelo": "nativo"})
        re_ = montar(os.path.join(S, "modelo-edu"), original, reacao, {**base, "modelo": "eduestevesfitness"})
        if rn["estado"].get("estado") != "pronto" or re_["estado"].get("estado") != "pronto":
            conferir("modelos: as duas montagens prontas", False, f"{rn['estado'].get('erro')} {re_['estado'].get('erro')}")
            return
        Pn, Pe = rn["res"]["pecas_plano"], re_["res"]["pecas_plano"]
        conferir_formato("modelo Edu Esteves", re_["final"], sum(p["dur"] for p in Pe))
        for rot, rr in (("Nativo", rn), ("Edu Esteves", re_)):
            v = lufs(rr["final"])
            conferir(f"modelo {rot}: áudio em -14 LUFS (±1)", abs(v + 14) <= 1.0, f"{v:.1f} LUFS")
        ass = open(os.path.join(S, "modelo-edu", "legendas.ass"), encoding="utf-8").read()
        g = [l for l in ass.splitlines() if l.startswith("Dialogue: 1,") and ",G," in l]
        ate = re_["res"].get("titulo_ate_seg") or 0
        conferir("Edu Esteves: título de gancho no quadro zero, 2 linhas, centro (y 768), por 3 a 5 s, caixa alta",
                 len(g) == 1 and g[0].split(",")[1] == "0:00:00.00" and 3.0 <= ate <= 5.0 and "pos(540,768)" in g[0]
                 and g[0].count("\\N") == 1 and "O ERRO DO" in g[0] and "Style: G,Archivo Black" in ass,
                 f"{g[0].split(',', 9)[9] if g else 'sem título'} · até {ate} s")
        conferir("Edu Esteves: sem legenda palavra por palavra", not [l for l in ass.splitlines() if l.startswith("Dialogue: 0,")])
        conferir("Nativo: legenda branca limpa continua (frases no centro-baixo)",
                 bool([l for l in open(os.path.join(S, "modelo-nativo", "legendas.ass"), encoding="utf-8") if l.startswith("Dialogue: 0,") and "pos(540,1420)" in l]))
        pn, pe = pausas_nos_comentarios(rn["final"], Pn), pausas_nos_comentarios(re_["final"], Pe)
        conferir("Edu Esteves: nenhuma pausa > 0,42 s na fala dos comentários (o Nativo deixa até 0,7 s)", not pe,
                 f"Edu: {pe} · Nativo: {len(pn)} pausa(s) {pn[:4]} · duração {re_['res']['duracao_seg']:.1f} x {rn['res']['duracao_seg']:.1f} s")
        conferir("Edu Esteves: punch-in planejado a cada 3,5 s nos takes longos", (re_["res"].get("punch_in") or 0) >= 1,
                 f"{re_['res'].get('punch_in')} janela(s)")
        # zoom aparece no quadro: na metade de baixo, a escala muda ao cruzar 3,5 s do take
        pz = next((p for p in Pe if any(abs(a - 3.5) < 0.01 for a, b in p.get("zoom", []))), None)
        if pz:
            q = lambda t, n: (quadro_png(re_["final"], pz["t0"] + t, os.path.join(S, n), "crop=1080:960:0:960"), os.path.join(S, n))[1]  # noqa: E731
            s_sem, s_com = ssim(q(3.0, "pz_a.png"), q(3.3, "pz_b.png")), ssim(q(3.0, "pz_a.png"), q(3.8, "pz_c.png"))
            conferir("Edu Esteves: punch-in visível (a câmera dele muda de escala aos 3,5 s do take)", s_com < s_sem - 0.1,
                     f"SSIM sem zoom {s_sem:.3f} · com zoom {s_com:.3f}")
        else:
            conferir("Edu Esteves: punch-in visível", False, "nenhum pedaço com janela em 3,5 s")
        # o título está no quadro: mesma montagem sem o título (cache da IA, ia_titulo desligado), faixa central comparada
        com_titulo = os.path.join(S, "modelo-edu-com-titulo.mp4")
        shutil.copy(re_["final"], com_titulo)        # a montagem sem título usa a mesma pasta e troca o final.mp4
        re_ = {**re_, "final": com_titulo}
        rs = montar(os.path.join(S, "modelo-edu"), original, reacao, {**base, "modelo": "eduestevesfitness", "trechos": T,
                                                                      "edicao": {"ia_titulo": False}})
        if rs["estado"].get("estado") == "pronto":
            faixa = "crop=1080:300:0:618"
            t_dentro, t_fora = 1.0, ate + 0.6
            for nome, t in (("dentro", t_dentro), ("fora", t_fora)):
                quadro_png(re_["final"], t, os.path.join(S, f"g_com_{nome}.png"), faixa)
                quadro_png(rs["final"], t, os.path.join(S, f"g_sem_{nome}.png"), faixa)
            s_dentro = ssim(os.path.join(S, "g_com_dentro.png"), os.path.join(S, "g_sem_dentro.png"))
            s_fora = ssim(os.path.join(S, "g_com_fora.png"), os.path.join(S, "g_sem_fora.png"))
            conferir(f"Edu Esteves: título queimado no centro até {ate:.1f} s e some depois (com x sem título)",
                     s_dentro < 0.9 and s_fora > 0.97, f"SSIM da faixa central: aos 1,0 s {s_dentro:.3f} · aos {t_fora:.1f} s {s_fora:.3f}")
        # final seco: o último quadro é o vídeo (sem cartela preta ou fixa)
        dur_e = sum(p["dur"] for p in Pe)
        y = brilho(re_["final"], dur_e - 0.1, "crop=1080:1920:0:0")
        conferir("Edu Esteves: final seco (último quadro é o próprio vídeo, sem cartela)", y > 40 and Pe[-1]["tipo"] in ("tocando", "comentario"),
                 f"YAVG do último quadro {y:.0f}")
        if frames_dir:
            os.makedirs(frames_dir, exist_ok=True)
            quadro_png(re_["final"], 1.0, os.path.join(frames_dir, "10-edu-esteves-gancho-no-quadro-zero.png"))
            if pz:
                quadro_png(re_["final"], pz["t0"] + 3.0, os.path.join(frames_dir, "11-edu-esteves-take-normal.png"))
                quadro_png(re_["final"], pz["t0"] + 3.8, os.path.join(frames_dir, "12-edu-esteves-punch-in.png"))
            nat = next((p for p in Pn if p["tipo"] == "comentario" and not p.get("gancho")), Pn[0])
            quadro_png(rn["final"], nat["t0"] + min(1.0, nat["dur"] / 2), os.path.join(frames_dir, "13-nativo-legenda-limpa.png"))
            shutil.copy(re_["final"], os.path.join(frames_dir, "exemplo-modelo-edu-esteves.mp4"))
            shutil.copy(rn["final"], os.path.join(frames_dir, "exemplo-modelo-nativo.mp4"))
    finally:
        M.transcrever = transcrever_real
        M._CHAMAR_IA = proibido_arnes


def main():
    # os cenários antigos pedem ia=False; os de IA trocam a chamada por ia_falsa. Nenhum cenário chama o Claude de verdade:
    # se algo escapar, esta trava falha em vez de gastar cota.
    M._CHAMAR_IA = proibido_arnes
    ap = argparse.ArgumentParser()
    ap.add_argument("--saida", required=True)
    ap.add_argument("--vozes")
    ap.add_argument("--frames")
    ap.add_argument("--sem-separado", action="store_true")
    ap.add_argument("--so-edicao", action="store_true", help="só os cenários da tela de edição e dos modelos (e o dividido de base)")
    a = ap.parse_args()
    S = os.path.abspath(a.saida)
    if os.path.exists(S) and os.listdir(S):  # nunca apaga: usa uma pasta nova ao lado
        S = f"{S}-{int(time.time())}"
    os.makedirs(S, exist_ok=True)
    whisper = bool(os.environ.get("REACT_WHISPER_MODELO")) and os.path.exists(os.path.join(os.environ.get("REACT_WHISPER_MODELO", ""), "model.bin"))
    voz_real = bool(a.vozes) or bool(shutil.which("say"))
    print(f"== arnês: whisper={'sim' if whisper else 'não'}, voz={'TTS' if voz_real else 'tom'}, ffmpeg={M.sondar.__module__}", flush=True)

    vz = {k: gerar_voz(k, S, a.vozes) for k in FALAS}
    dv = {k: duracao(p) for k, p in vz.items()}
    print("     vozes:", {k: round(v, 2) for k, v in dv.items()}, flush=True)

    # ------------------------------------------------------------------ linha do tempo (como o navegador manda)
    T, voz_em = [], []
    t = 0.0
    T.append({"tipo": "comentario", "ini": 0.0, "fim": 0.4, "orig": 0.0}); t = 0.4           # atraso do play
    T.append({"tipo": "tocando", "ini": t, "fim": t + 6, "orig": 0.0}); voz_em.append((vz["nossa"], t + 2.6)); A_ini = t; t += 6
    B_ini = t
    voz_em.append((vz["c1a"], t + 0.8)); c1b_t = t + 0.8 + dv["c1a"] + 1.6; voz_em.append((vz["c1b"], c1b_t))
    t = c1b_t + dv["c1b"] + 0.7
    T.append({"tipo": "comentario", "ini": B_ini, "fim": t, "orig": 6.0})
    T.append({"tipo": "tocando", "ini": t, "fim": t + 5, "orig": 6.0}); t += 5
    D_ini = t; voz_em.append((vz["c2"], t + 1.0)); t += 1.0 + dv["c2"] + 1.0
    T.append({"tipo": "comentario", "ini": D_ini, "fim": t, "orig": 11.0})
    T.append({"tipo": "tocando", "ini": t, "fim": t + 4, "orig": 11.0}); t += 4
    F_ini = t; voz_em.append((vz["c3"], t + 0.5)); t += 0.5 + dv["c3"] + 2.5
    T.append({"tipo": "comentario", "ini": F_ini, "fim": t, "orig": 15.0})
    T.append({"tipo": "tocando", "ini": t, "fim": t + 3, "orig": 15.0}); t += 3
    T.append({"tipo": "comentario", "ini": t, "fim": t + 1.5, "orig": 18.0}); t += 1.5      # pausa muda
    T.append({"tipo": "tocando", "ini": t, "fim": t + 4, "orig": 18.0}); t += 4
    dur_rec = round(t + 0.3, 2)

    original, reacao = os.path.join(S, "original.mp4"), os.path.join(S, "reacao.mp4")
    gerar_original(original, 30)
    gerar_reacao(reacao, dur_rec, voz_em)
    print(f"     gravação sintética: {dur_rec:.2f} s, {len(T)} trechos", flush=True)

    # ------------------------------------------------------------------ 1) layout dividido
    r = montar(os.path.join(S, "dividido"), original, reacao, {"modo": "aqui", "layout": "dividido", "legenda": True,
                                                                 "cortar_silencio": True, "ia": False, "trechos": T})
    conferir("dividido: montagem terminou pronta", r["estado"].get("estado") == "pronto", r["estado"].get("erro", ""))
    if r["estado"].get("estado") != "pronto":
        return fim()
    P = r["res"]["pecas_plano"]
    final = r["final"]
    conferir_formato("dividido", final, sum(p["dur"] for p in P))
    com = [p for p in P if p["tipo"] == "comentario"]
    conferir("cortes: comentário mudo (pausa sem fala) sumiu", not any(abs(p["orig"] - 18.0) < 0.01 for p in com),
             str([p["orig"] for p in com]))
    conferir("cortes: o atraso inicial mudo sumiu (começa tocando)", P[0]["tipo"] == "tocando")
    b = [p for p in com if abs(p["orig"] - 6.0) < 0.01]
    conferir("cortes: silêncio interno de 1,6 s dividiu o comentário em 2", len(b) == 2, str(len(b)))
    if b:
        esperado = B_ini + 0.8 - M.PAD_ANTES
        conferir("cortes: respiro do começo do comentário cortado (±0,1 s)", abs(b[0]["ini"] - esperado) <= 0.1,
                 f"{b[0]['ini']:.2f} x {esperado:.2f}")
        fim_b = b[-1]["ini"] + b[-1]["dur"]
        esperado_fim = c1b_t + dv["c1b"] + M.PAD_DEPOIS
        conferir("cortes: respiro do fim do comentário cortado (±0,15 s)", abs(fim_b - esperado_fim) <= 0.15,
                 f"{fim_b:.2f} x {esperado_fim:.2f}")
    d = [p for p in com if abs(p["orig"] - 11.0) < 0.01]
    conferir("cortes: comentário com 1 s antes e 1 s depois ficou com a fala + folgas (±0,15 s)",
             len(d) == 1 and abs(d[0]["dur"] - (dv["c2"] + M.PAD_ANTES + M.PAD_DEPOIS)) <= 0.15,
             f"{d[0]['dur']:.2f} x {dv['c2'] + M.PAD_ANTES + M.PAD_DEPOIS:.2f}" if d else "sem pedaço")
    cort = r["res"]["segundos_cortados"]
    conferir("cortes: gravação encolheu pelo menos 7 s", cort >= 7.0, f"{cort:.2f} s cortados de {dur_rec:.2f}")
    conferir("cortes: tocando não foi cortado (6+5+4+3+4 s)", abs(sum(p["dur"] for p in P if p["tipo"] == "tocando") - 22.0) < 0.1)

    # congelado: duas imagens do mesmo comentário iguais em cima; e iguais ao original no ponto da pausa
    pb = next(p for p in P if p["tipo"] == "comentario" and abs(p["orig"] - 6.0) < 0.01)
    topo = "crop=1080:960:0:0"
    f1, f2 = os.path.join(S, "q_b1.png"), os.path.join(S, "q_b2.png")
    quadro_png(final, pb["t0"] + 0.15, f1, topo)
    quadro_png(final, pb["t0"] + pb["dur"] - 0.15, f2, topo)
    s = ssim(f1, f2)
    conferir("congelado: original parado durante o comentário (SSIM do topo >= 0,97)", s >= 0.97, f"{s:.4f}")
    ref6, ref3 = os.path.join(S, "ref6.png"), os.path.join(S, "ref3.png")
    subprocess.run(M.cmd_topo_congelado(original, 6.0, ref6), check=True, capture_output=True)
    subprocess.run(M.cmd_topo_congelado(original, 3.0, ref3), check=True, capture_output=True)
    s6, s3 = ssim(f1, ref6), ssim(f1, ref3)
    conferir("congelado: é o quadro do original no instante da pausa (6,0 s)", s6 >= 0.85 and s6 > s3 + 0.05, f"6,0 s: {s6:.3f} · 3,0 s: {s3:.3f}")
    pa = P[0]
    g1, g2 = os.path.join(S, "q_a1.png"), os.path.join(S, "q_a2.png")
    quadro_png(final, pa["t0"] + 1.0, g1, topo)
    quadro_png(final, pa["t0"] + 2.0, g2, topo)
    s = ssim(g1, g2)
    conferir("tocando: original se mexe (SSIM do topo entre 1 s e 2 s < 0,95)", s < 0.95, f"{s:.4f}")

    # áudio: original abaixa quando ele fala no tocando (tom de 5 kHz), some no comentário
    t_nossa = pa["t0"] + (A_ini + 2.6 - pa["ini"])
    alto, baixo = rms_tom(final, pa["t0"] + 0.8, 0.8), rms_tom(final, t_nossa + 0.1, min(0.4, dv["nossa"] - 0.15))
    conferir("volume: original abaixa >= 6 dB quando ele fala no tocando", alto - baixo >= 6, f"{alto:.1f} -> {baixo:.1f} dB")
    mudo = rms_tom(final, pb["t0"] + 0.3, 0.5)
    # no comentário o original está congelado: o que sobra na faixa de 5 kHz é só o chiado da voz dele
    conferir("volume: original some no comentário (>= 20 dB abaixo, chão = voz dele)", alto - mudo >= 20, f"{alto:.1f} -> {mudo:.1f} dB")

    # legenda
    ass = os.path.join(r["final"].rsplit("/", 1)[0], "legendas.ass")
    if whisper and voz_real:
        pal = json.load(open(os.path.join(os.path.dirname(final), "palavras.json")))["palavras"]
        texto = " ".join(w["w"].lower() for w in pal)
        acertos = [w for w in ("agachamento", "postura", "joelho", "academia", "movimento", "controle") if w in texto]
        conferir("legenda: Whisper local reconheceu a fala (>= 4 de 6 palavras-chave)", len(acertos) >= 4, f"{acertos} | {texto[:160]}")
        ev = [l for l in open(ass, encoding="utf-8") if l.startswith("Dialogue:")] if os.path.exists(ass) else []
        maximo = M.carregar_modelo(r["res"].get("modelo"))["legenda"]["max_palavras"]   # nativo (padrão): até 5
        conferir(f"legenda: ASS com eventos e no máximo {maximo} palavras por frase (modelo {r['res'].get('modelo')})", len(ev) >= 8 and all(
            len(re.sub(r"\{[^}]*\}", "", l.split(",", 9)[9]).split()) <= maximo for l in ev), f"{len(ev)} eventos")
        conferir("legenda: queimada no vídeo (resultado conta os blocos)", r["res"]["legendas"] >= 5, str(r["res"]["legendas"]))
    else:
        conferir("legenda: sem Whisper/voz real a montagem segue e avisa", bool(r["res"]["avisos"]) or not whisper, str(r["res"]["avisos"]))

    if a.so_edicao:
        edicao_manual(S, original, reacao, T, (1, 2, 3, 4, 5, 6, 7), a.frames)
        breno_vence_ia(S, original, reacao, T, 4, voz_em, vz, dv, whisper and voz_real)
        modelos_edicao(S, original, reacao, T, voz_em, vz, dv, whisper and voz_real, a.frames)
        return fim()

    # ------------------------------------------------------------------ 2) layout cheia_longos
    r2 = montar(os.path.join(S, "cheia"), original, reacao, {"modo": "aqui", "layout": "cheia_longos", "legenda": True,
                                                              "cortar_silencio": True, "ia": False, "trechos": T})
    conferir("cheia: montagem terminou pronta", r2["estado"].get("estado") == "pronto", r2["estado"].get("erro", ""))
    pf = None
    if r2["estado"].get("estado") == "pronto":
        P2 = r2["res"]["pecas_plano"]
        conferir_formato("cheia", r2["final"], sum(p["dur"] for p in P2))
        pf = next((p for p in P2 if p["tipo"] == "comentario" and abs(p["orig"] - 15.0) < 0.01), None)
        conferir("cheia: comentário longo (>= 5 s) em tela cheia; curto continua dividido",
                 pf is not None and pf["cheia"] and not any(p["cheia"] for p in P2 if p["tipo"] == "comentario" and abs(p["orig"] - 11.0) < 0.01))

    # ------------------------------------------------------------------ 3) edição com IA (IA falsa, determinística)
    rz = edicao_com_ia(S, original, reacao, T, voz_em, vz, dv, r, whisper and voz_real)

    # ------------------------------------------------------------------ 4) tela de edição (escolhas do Breno)
    idx = (1, 2, 3, 4, 5, 6, 7)   # A tocando, B comentário, C tocando, D comentário (joelho), E tocando, F comentário longo, G tocando
    edicao_manual(S, original, reacao, T, idx, a.frames)
    breno_vence_ia(S, original, reacao, T, 4, voz_em, vz, dv, whisper and voz_real)
    modelos_edicao(S, original, reacao, T, voz_em, vz, dv, whisper and voz_real, a.frames)

    # ------------------------------------------------------------------ frames de exemplo
    if a.frames:
        os.makedirs(a.frames, exist_ok=True)
        quadro_png(final, pa["t0"] + 2.7, os.path.join(a.frames, "1-tocando-tela-dividida.png"))
        quadro_png(final, pb["t0"] + min(1.6, pb["dur"] / 2), os.path.join(a.frames, "2-comentario-congelado-legenda.png"))
        if pf:
            quadro_png(r2["final"], pf["t0"] + min(3.0, pf["dur"] / 2), os.path.join(a.frames, "3-comentario-longo-tela-cheia.png"))
        shutil.copy(final, os.path.join(a.frames, "exemplo-react-dividido.mp4"))
        if rz:
            quadro_png(rz["final"], 1.0, os.path.join(a.frames, "4-ia-gancho-titulo.png"))
            if rz.get("t_zoom") is not None:
                quadro_png(rz["final"], rz["t_zoom"], os.path.join(a.frames, "5-ia-zoom-enfase-chave.png"))
            shutil.copy(rz["final"], os.path.join(a.frames, "exemplo-react-ia.mp4"))
        print(f"     frames em {a.frames}", flush=True)

    # ------------------------------------------------------------------ 3) separado: sincronia pelo áudio
    if not a.sem_separado:
        try:
            import sincronia  # noqa: F401
            tem_numpy = True
        except ImportError:
            tem_numpy = False
        if not tem_numpy:
            conferir("separado: numpy disponível", False)
        else:
            separado(S, vz, dv, voz_real, a.vozes)
    return fim()


def separado(S: str, vz: dict, dv: dict, voz_real: bool, vozes: str | None = None):
    import sincronia
    narr = os.path.join(S, "narracao.wav")
    if vozes and os.path.exists(os.path.join(vozes, "narracao.wav")):
        ff("-i", os.path.join(vozes, "narracao.wav"), "-ar", "48000", "-ac", "1", narr)
    elif shutil.which("say"):
        texto = ("Neste vídeo eu vou mostrar como fazer o agachamento livre do jeito certo. Primeiro, posicione os pés "
                 "na largura dos ombros. Depois, desça controlando o movimento, mantendo a coluna neutra e o peito aberto. "
                 "Suba empurrando o chão com o calcanhar. Repita doze vezes, descanse um minuto e faça mais três séries. "
                 "Cuidado com o joelho, ele deve acompanhar a ponta do pé durante todo o movimento.")
        aiff = os.path.join(S, "narracao.aiff")
        subprocess.run(["say", "-v", "Reed (Português (Brasil))", "-r", "170", "-o", aiff, texto], check=True, timeout=120)
        ff("-i", aiff, "-ar", "48000", "-ac", "1", narr)
    else:
        narr = None
    orig2 = os.path.join(S, "original2.mp4")
    gerar_original(orig2, 26, narr)
    # verdade: tocando 0,5-8,5 (orig 0-8), comentário c2, tocando (orig 8-16), comentário c1a, tocando (orig 16-24)
    V, voz_em, vaz = [], [], []
    t = 0.5
    for io, prox in ((0.0, "c2"), (8.0, "c1a"), (16.0, None)):
        V.append(("tocando", t, t + 8, io)); vaz.append((t, io, 8.0)); t += 8
        if prox:
            ini = t; voz_em.append((vz[prox], t + 0.4)); t += 0.4 + dv[prox] + 0.6
            V.append(("comentario", ini, t, io + 8))
    dur = round(t + 0.5, 2)
    reac2 = os.path.join(S, "reacao2.mp4")
    gerar_reacao(reac2, dur, voz_em, vaz, orig2)
    t0 = time.time()
    res = sincronia.detectar(orig2, reac2)
    seg = time.time() - t0
    toc = [x for x in res["trechos"] if x["tipo"] == "tocando"]
    ver = [v for v in V if v[0] == "tocando"]
    conferir("separado: achou os 3 trechos do original tocando", len(toc) == 3, f"{len(toc)} em {seg:.1f} s · {res['deslocamentos_seg']}")
    if len(toc) == 3:
        erro_borda = max(max(abs(a["ini"] - b[1]), abs(a["fim"] - b[2])) for a, b in zip(toc, ver))
        erro_orig = max(abs(a["orig"] - (b[3] + (a["ini"] - b[1]))) for a, b in zip(toc, ver))
        conferir("separado: bordas das pausas (±0,35 s)", erro_borda <= 0.35, f"pior {erro_borda:.2f} s")
        conferir("separado: ponto do original sincronizado (±0,05 s)", erro_orig <= 0.05, f"pior {erro_orig:.3f} s")
    r = montar(os.path.join(S, "separado"), orig2, reac2, {"modo": "separado", "layout": "dividido", "legenda": True, "cortar_silencio": True, "ia": False})
    conferir("separado: montagem terminou pronta", r["estado"].get("estado") == "pronto", r["estado"].get("erro", ""))
    if r["estado"].get("estado") == "pronto":
        conferir_formato("separado", r["final"], sum(p["dur"] for p in r["res"]["pecas_plano"]))


def fim():
    print(f"== resultado: {len(OK)} ok / {len(FALHAS)} falha", flush=True)
    for f in FALHAS:
        print(f"   FALHA: {f}")
    return 0 if not FALHAS else 1


if __name__ == "__main__":
    sys.exit(main())
