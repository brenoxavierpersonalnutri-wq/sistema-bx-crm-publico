#!/usr/bin/env python3
"""headturbo-react (modo "já gravei no celular separado"): acha a linha do tempo pelo áudio.

Ele gravou a reação no celular enquanto o original tocava em outro aparelho, pausando para comentar. O som do
original vaza no microfone dele, então dá para saber, em cada instante da gravação dele, QUAL momento do original
estava tocando (correlação cruzada) e onde o original estava parado (ele falando, sem o som do original).

Como (numpy, CPU, sem rede):
  1. os dois áudios em 8 kHz mono; características = derivada da energia em 12 faixas de frequência (200-3800 Hz)
     a cada 10 ms, normalizada por faixa (robusta a volume, cor do alto-falante e eco da sala);
  2. janelas de 3 s da gravação dele, a cada 0,5 s: semelhança (cosseno) com TODAS as posições do original de uma
     vez (FFT); a melhor posição dá o deslocamento d = tempo_original - tempo_gravação;
  3. janelas boas seguidas com o mesmo d viram um trecho "tocando"; d igual em dois trechos = ele não pausou entre
     eles (o original só ficou baixo), então os dois se juntam; a borda é refinada com janelas de 0,3 s no d fixo;
  4. o que sobra entre os trechos tocando é comentário, com o original congelado onde o trecho anterior parou.

Uso: python sincronia.py original.mp4 reacao.mp4  -> imprime o JSON {"trechos": [...], ...}
"""
import json
import subprocess
import sys

import numpy as np

TAXA = 8000
HOP = 80            # 10 ms por quadro de característica
NFFT = 512
FAIXAS = 12
JAN = 300           # janela de busca: 3 s
PASSO = 50          # a cada 0,5 s
LIMIAR = 0.30       # semelhança mínima de uma janela para entrar num trecho
LIMIAR_FORTE = 0.45  # o trecho precisa de pelo menos uma janela forte (voz dele parecida com o original dá até ~0,37)
TOL_D = 4           # 40 ms: mesmo deslocamento
JAN_FINA = 30       # 0,3 s para achar a borda
LIMIAR_FINO = 0.15  # piso; a borda usa metade da semelhança típica do próprio trecho
MIN_TOCANDO = 1.0   # s


def ler_audio(caminho: str) -> np.ndarray:
    r = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-v", "error", "-i", caminho, "-map", "0:a:0", "-vn",
         "-ac", "1", "-ar", str(TAXA), "-f", "s16le", "-"], capture_output=True, timeout=1800)
    if r.returncode != 0:
        raise RuntimeError("não consegui ler o áudio")
    return np.frombuffer(r.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def caracteristicas(x: np.ndarray) -> np.ndarray:
    """(quadros x FAIXAS): derivada do log da energia por faixa, z-normalizada por faixa."""
    if len(x) < NFFT + HOP:
        return np.zeros((0, FAIXAS), dtype=np.float32)
    bordas = np.logspace(np.log10(200), np.log10(3800), FAIXAS + 1)
    freqs = np.fft.rfftfreq(NFFT, 1.0 / TAXA)
    M = np.zeros((len(freqs), FAIXAS), dtype=np.float32)
    for b in range(FAIXAS):
        M[(freqs >= bordas[b]) & (freqs < bordas[b + 1]), b] = 1.0
    jan = np.hanning(NFFT).astype(np.float32)
    n = (len(x) - NFFT) // HOP + 1
    out = np.empty((n, FAIXAS), dtype=np.float32)
    bloco = 20000
    for i in range(0, n, bloco):
        k = min(bloco, n - i)
        idx = (np.arange(k)[:, None] + i) * HOP + np.arange(NFFT)[None, :]
        quadros = x[idx] * jan
        pot = np.abs(np.fft.rfft(quadros, axis=1)) ** 2
        out[i:i + k] = pot.astype(np.float32) @ M
    E = np.log(out + 1e-8)
    D = np.diff(E, axis=0, prepend=E[:1])
    D -= D.mean(axis=0)
    D /= D.std(axis=0) + 1e-6
    return D.astype(np.float32)


def _prox_pot2(n: int) -> int:
    return 1 << (int(n) - 1).bit_length()


def melhores_desvios(Fo: np.ndarray, Fr: np.ndarray, jan: int = JAN, passo: int = PASSO) -> list:
    """Para cada janela da reação: (inicio, d, semelhança)."""
    To, Tr = len(Fo), len(Fr)
    if To < jan or Tr < jan:
        return []
    N = _prox_pot2(To + jan)
    FoF = np.fft.rfft(Fo, N, axis=0)
    # norma de cada pedaço do original de tamanho jan (soma das faixas)
    q = np.concatenate([[0.0], np.cumsum((Fo.astype(np.float64) ** 2).sum(axis=1))])
    normas_o = np.sqrt(np.maximum(q[jan:] - q[:-jan], 1e-9))  # tamanho To - jan + 1
    out = []
    for s in range(0, Tr - jan + 1, passo):
        W = Fr[s:s + jan]
        nw = float(np.sqrt((W.astype(np.float64) ** 2).sum()))
        if nw < 1e-6:
            out.append((s, 0, 0.0))
            continue
        WF = np.fft.rfft(W[::-1], N, axis=0)  # correlação = convolução com a janela invertida
        c = np.fft.irfft((FoF * WF).sum(axis=1), N)[jan - 1:jan - 1 + To - jan + 1]
        sim = c / (normas_o * nw)
        l = int(np.argmax(sim))
        out.append((s, l - s, float(sim[l])))
    return out


def semelhanca_fixa(Fo: np.ndarray, Fr: np.ndarray, d: int, ini: int, fim: int, m: int = JAN_FINA) -> np.ndarray:
    """Semelhança em janelas de m quadros, no deslocamento d fixo, para cada quadro k de [ini, fim) (centro da janela)."""
    vals = np.zeros(max(0, fim - ini), dtype=np.float32)
    meia = m // 2
    for i, k in enumerate(range(ini, fim)):
        a, b = k - meia, k - meia + m
        if a < 0 or b > len(Fr) or a + d < 0 or b + d > len(Fo):
            continue
        x, y = Fr[a:b], Fo[a + d:b + d]
        nx, ny = np.linalg.norm(x), np.linalg.norm(y)
        if nx > 1e-6 and ny > 1e-6:
            vals[i] = float((x * y).sum() / (nx * ny))
    return vals


def ajustar_pausas(regioes: list, Fo: np.ndarray, Fr: np.ndarray):
    """Pausa sem mexer na posição do vídeo dura EXATAMENTE d_antes - d_depois (em quadros). A borda achada pela
    semelhança erra quando o original está quieto perto dela (o buraco fica maior que a pausa) ou quando o eco e a
    janela invadem a pausa (fica menor). Aqui a pausa de tamanho certo é encaixada onde os dois lados concordam
    mais: cada quadro conta (semelhança - piso) para o lado de que faz parte; empate = meio."""
    for i in range(len(regioes) - 1):
        a, b = regioes[i], regioes[i + 1]
        P = a[2] - b[2]
        G = b[0] - a[1]
        if P <= 0 or abs(P - G) > 150:  # avançou/voltou o vídeo: fica como achou
            continue
        lo = max(a[0] + 50, min(a[1], b[0] - P) - 30)
        hi = min(b[1] - 50 - P, max(a[1], b[0] - P) + 30)
        if hi < lo:
            continue
        ini, fim = lo, hi + P
        s1 = semelhanca_fixa(Fo, Fr, a[2], ini, fim) - LIMIAR_FINO
        s2 = semelhanca_fixa(Fo, Fr, b[2], ini, fim) - LIMIAR_FINO
        c1 = np.concatenate([[0.0], np.cumsum(s1)])
        c2 = np.concatenate([[0.0], np.cumsum(s2)])
        n = fim - ini
        meio = ((a[1] + b[0] - P) / 2) - ini
        melhor, x_melhor = None, None
        for x in range(0, hi - lo + 1):  # pausa = [ini + x, ini + x + P)
            nota = c1[x] + (c2[n] - c2[x + P]) - 1e-3 * abs(x - meio)
            if melhor is None or nota > melhor:
                melhor, x_melhor = nota, x
        a[1] = ini + x_melhor
        b[0] = a[1] + P


def detectar(original: str, reacao: str) -> dict:
    Fo = caracteristicas(ler_audio(original))
    Fr = caracteristicas(ler_audio(reacao))
    janelas = melhores_desvios(Fo, Fr)
    boas = [(s, d, v) for s, d, v in janelas if v >= LIMIAR]
    # grupos de janelas seguidas com o mesmo d
    grupos = []
    for s, d, v in boas:
        if grupos and abs(d - grupos[-1]["d"]) <= TOL_D and s - grupos[-1]["fim_s"] <= PASSO * 2:
            g = grupos[-1]
            g["fim_s"] = s
            g["ds"].append(d)
            g["vs"].append(v)
            g["d"] = int(np.median(g["ds"]))
        else:
            grupos.append({"ini_s": s, "fim_s": s, "ds": [d], "vs": [v], "d": d})
    grupos = [g for g in grupos if max(g["vs"]) >= LIMIAR_FORTE]
    # mesmo d = ele não pausou entre os dois: junta (o original só ficou baixo no meio)
    juntos = []
    for g in grupos:
        if juntos and abs(g["d"] - juntos[-1]["d"]) <= TOL_D:
            juntos[-1]["fim_s"] = g["fim_s"]
            juntos[-1]["ds"] += g["ds"]
            juntos[-1]["vs"] += g["vs"]
        else:
            juntos.append(g)
    Tr = len(Fr)
    regioes = []
    for g in juntos:
        d = g["d"]
        lo, hi = max(0, g["ini_s"] - JAN), min(Tr, g["fim_s"] + 2 * JAN)
        sim = semelhanca_fixa(Fo, Fr, d, lo, hi)
        nucleo_a, nucleo_b = g["ini_s"] + JAN // 2 - lo, g["fim_s"] + JAN // 2 - lo
        nucleo = sim[max(0, nucleo_a):max(nucleo_a + 1, nucleo_b + 1)]
        tipico = float(np.median(nucleo)) if len(nucleo) else LIMIAR
        bom = sim >= max(LIMIAR_FINO, 0.5 * tipico)
        # expande a partir do núcleo até a semelhança cair por mais de 0,3 s seguidos
        a = nucleo_a
        ruins = 0
        while a > 0:
            ruins = 0 if bom[a - 1] else ruins + 1
            if ruins > JAN_FINA:
                a += ruins - 1
                break
            a -= 1
        b = min(nucleo_b, len(bom) - 1)
        ruins = 0
        while b < len(bom) - 1:
            ruins = 0 if bom[b + 1] else ruins + 1
            if ruins > JAN_FINA:
                b -= ruins - 1
                break
            b += 1
        ini, fim = lo + max(0, a), lo + b + 1
        ini = max(ini, -d)                    # o original não começa antes do zero
        fim = min(fim, len(Fo) - d, Tr)       # nem passa do fim
        if fim - ini >= MIN_TOCANDO * 100:
            regioes.append([ini, fim, d])
    # sem sobreposição
    regioes.sort()
    for i in range(1, len(regioes)):
        if regioes[i][0] < regioes[i - 1][1]:
            regioes[i][0] = regioes[i - 1][1]
    regioes = [r for r in regioes if r[1] - r[0] >= MIN_TOCANDO * 100]
    ajustar_pausas(regioes, Fo, Fr)
    trechos = []
    cursor, pos_orig = 0, (regioes[0][0] + regioes[0][2]) if regioes else 0
    for ini, fim, d in regioes:
        if ini > cursor:
            trechos.append({"tipo": "comentario", "ini": cursor / 100, "fim": ini / 100, "orig": max(0, pos_orig) / 100})
        trechos.append({"tipo": "tocando", "ini": ini / 100, "fim": fim / 100, "orig": (ini + d) / 100})
        cursor, pos_orig = fim, fim + d
    if regioes and cursor < Tr:
        trechos.append({"tipo": "comentario", "ini": cursor / 100, "fim": Tr / 100, "orig": max(0, pos_orig - 1) / 100})
    tocando = sum(r[1] - r[0] for r in regioes) / 100
    aviso = None
    if regioes and tocando < 0.25 * (len(Fo) / 100):
        aviso = "achei pouco do original na sua gravação: confira a prévia (o som do original estava alto o bastante?)"
    return {
        "trechos": trechos,
        "deslocamentos_seg": [round(r[2] / 100, 3) for r in regioes],
        "segundos_tocando": round(tocando, 2),
        "janelas": len(janelas),
        "janelas_boas": len(boas),
        "aviso": aviso,
    }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    print(json.dumps(detectar(sys.argv[1], sys.argv[2]), ensure_ascii=False, indent=1))
