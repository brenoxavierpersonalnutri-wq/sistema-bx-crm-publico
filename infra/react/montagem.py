#!/usr/bin/env python3
"""headturbo-react: montagem automática do react (vídeo vertical 1080x1920 pronto para Reels).

Uso (o serviço chama isto num subprocesso com nice 19 + ionice idle, um por vez):
    python3 montagem.py <pasta-do-projeto>

A pasta tem:
    original.bin   o vídeo que ele reagiu (qualquer formato que o ffmpeg leia)
    reacao.bin     a gravação dele (câmera + microfone)
    pedido.json    {"modo": "aqui"|"separado", "layout": "dividido"|"cheia_longos",
                    "legenda": true, "cortar_silencio": true, "ia": true, "duracao_max": 90, "trechos": [...],
                    "edicao": {...}}   (opcional: tela de edição, ver abaixo)
O resultado sai em final.mp4 + capa.jpg, e o andamento em estado.json (lido pelo serviço).

Linha do tempo (trechos, em segundos da gravação dele):
    {"tipo": "tocando",    "ini": 0.0, "fim": 5.2, "orig": 0.0}   o original tocando a partir de `orig`
    {"tipo": "comentario", "ini": 5.2, "fim": 12,  "orig": 5.1}   ele falando, original congelado em `orig`
No modo "separado" os trechos saem de sincronia.py (correlação do áudio do original que vaza no microfone dele).

Tela de edição (escolhas do Breno, sempre vencem a IA). Cada trecho pode trazer:
    "layout": "dividido"|"ele"|"original"|"original_pip"   (ausente = automático, pelo layout geral)
    "volume": 0..1 (som do original no trecho), "mudo": true, "removido": true|false (false = "fica", a IA não tira),
    "congelar": true (trecho tocando com o original parado no quadro `orig`), "pausa": true (pausa criada na edição)
e o pedido traz "edicao": {"volume_geral": 0..1, "ia_gancho": bool, "ia_titulo": bool, "cortes_ia_restaurados": ["c12-14"]}.
Trecho congelado/pausa escolhido por ele não tem silêncio cortado (sai como ele viu na prévia). Com "edicao", a IA
não é chamada de novo: o plano da primeira montagem (ia_plano.json) é reaproveitado e remapeado para os trechos novos.

A montagem:
  1. silêncio: volumedetect + silencedetect no áudio dele; nos comentários corta o respiro do começo e do fim e
     encurta silêncio interno longo (os trechos tocando não são cortados);
  2. cada pedaço vira um clipe intermediário 1080x1920/30 fps (original em cima preenchendo o painel, ele embaixo;
     ou, na opção "cheia_longos", ele em tela cheia com o original congelado num quadrinho nos comentários longos);
     o áudio do original abaixa sozinho quando ele fala (sidechaincompress) e some nos comentários (congelado);
  3. legenda: a voz dele (só ela) vai para o Whisper local (legendas.py, faster-whisper) com tempo por palavra;
     as palavras viram blocos de 2 a 4, estilo Reels, com a palavra da vez em amarelo (ASS queimado no vídeo);
  4. junta tudo, normaliza o volume (ganho fixo até -14 LUFS medido antes + limitador de pico) e exporta MP4 H.264 (high) + AAC 48 kHz, faststart.
"Edição com IA" (ia=true, edicao_ia.py): antes de renderizar, a gravação inteira passa no Whisper e um LLM pelo
OpenRouter decide cortes (repetição, erro, muleta, comentário fraco), gancho no começo, zoom nos momentos de ênfase,
título no topo, palavras-chave da legenda e notas para a duração alvo. aplicar_edicao converte em pedaços. Se a IA
falhar, monta sem ela e avisa.
Só biblioteca padrão; o Whisper roda no venv do serviço (legendas.py) e a sincronia usa numpy (sincronia.py).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import wave

L, A = 1080, 1920          # quadro final (vertical)
METADE = A // 2             # 960: original em cima, ele embaixo
FPS = 30
TAXA = 48000                # áudio final
TAXA_VOZ = 16000            # áudio para o Whisper
MAX_TRECHOS = 1000
LAYOUTS_TRECHO = ("dividido", "ele", "original", "original_pip")
EXTRAS = ("layout", "volume", "mudo", "removido", "congelar", "pausa")   # escolhas do Breno por trecho
MAX_RESTAURADOS = 500
PIP_ELE_L, PIP_ELE_A = 360, 480      # ele pequeno no canto (layout original_pip)

# silêncio (segundos)
MIN_SILENCIO = 0.25         # silencedetect d=
MIN_FALA = 0.12             # fala mais curta que isto é estalo/ruído
SIL_LONGO = 0.70            # silêncio interno maior que isto é cortado
PAD_ANTES = 0.12            # folga antes da fala
PAD_DEPOIS = 0.22           # folga depois da fala
COMENTARIO_LONGO = 5.0      # "cheia_longos": comentário com pelo menos isto de fala vai em tela cheia

# edição com IA
DURACAO_MAX_PADRAO = 90.0
DURACAO_MAX_MIN, DURACAO_MAX_MAX = 15.0, 600.0
GANCHO_MIN, GANCHO_MAX = 2.0, 4.0
TOCANDO_PISO_1, TOCANDO_PISO_2 = 3.0, 1.5   # encurtar o original tocando: primeiro até 3 s, depois até 1,5 s
ZOOM = 1.2                                   # zoom na câmera dele nos momentos de ênfase
Y_TITULO = 64
PIP_Y, PIP_Y_COM_TITULO = 110, 330

# legenda
MAX_PALAVRAS = 4
MAX_LETRAS = 16
PAUSA_QUEBRA = 0.45
Y_LEGENDA_DIVIDIDO = METADE      # na emenda das duas metades (o estilo clássico de react)
Y_LEGENDA_CHEIA = 1380

THREADS = os.environ.get("REACT_FFMPEG_THREADS", "2")
FONTES = os.environ.get("REACT_FONTES", os.path.join(os.path.dirname(os.path.abspath(__file__)), "fontes"))
FONTE_NOME = "Archivo Black"


# ======================================================================== utilidades


def quadro(t: float) -> float:
    """Arredonda para o quadro (1/30 s): todo pedaço tem número inteiro de quadros e de amostras."""
    return round(t * FPS) / FPS


def prefixo_nice() -> list:
    """nice 19 + ionice idle (quando existir): a montagem nunca disputa CPU/disco com as lives e o WhatsApp."""
    pre = []
    if shutil.which("nice"):
        pre += ["nice", "-n", "19"]
    if shutil.which("ionice"):
        pre += ["ionice", "-c", "3"]
    return pre


def prefixo_ffmpeg() -> list:
    return prefixo_nice() + ["ffmpeg", "-nostdin", "-hide_banner", "-v", "error", "-y", "-threads", THREADS]


def esc_filtro(caminho: str) -> str:
    """Caminho dentro de um filtro do ffmpeg (ass=...:fontsdir=...)."""
    return caminho.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace(",", "\\,")


def sondar(caminho: str) -> dict:
    """Duração, vídeo (largura, altura, fps) e se tem áudio."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,duration",
         "-of", "json", caminho], capture_output=True, text=True, timeout=120)
    d = json.loads(out.stdout or "{}")
    streams = d.get("streams") or []
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    dur = None
    for cand in (d.get("format", {}).get("duration"), (v or {}).get("duration"), (a or {}).get("duration")):
        try:
            if cand is not None and float(cand) > 0:
                dur = float(cand)
                break
        except ValueError:
            pass
    fps = None
    if v and v.get("avg_frame_rate"):
        n, _, den = str(v["avg_frame_rate"]).partition("/")
        try:
            fps = float(n) / float(den or 1)
        except (ValueError, ZeroDivisionError):
            fps = None
    return {
        "duracao": dur,
        "video": {"codec": v.get("codec_name"), "largura": v.get("width"), "altura": v.get("height"), "fps": fps} if v else None,
        "audio": {"codec": a.get("codec_name")} if a else None,
    }


# ======================================================================== pedido e linha do tempo (puro)


def extras_trecho(t: dict, i: int) -> tuple:
    """Escolhas do Breno num trecho (tela de edição) -> (dict limpo, None) ou (None, "erro legível")."""
    ex = {}
    lay = t.get("layout")
    if lay not in (None, "", "auto"):
        if lay not in LAYOUTS_TRECHO:
            return None, f"trecho {i + 1}: layout inválido"
        ex["layout"] = lay
    if t.get("volume") is not None:
        try:
            vol = float(t["volume"])
        except (TypeError, ValueError):
            return None, f"trecho {i + 1}: volume precisa ser número de 0 a 1"
        if vol != vol:
            return None, f"trecho {i + 1}: volume inválido"
        ex["volume"] = round(max(0.0, min(1.0, vol)), 3)
    for chave in ("mudo", "pausa"):
        if t.get(chave) is True:
            ex[chave] = True
    if t.get("congelar") is True and t.get("tipo") == "tocando":
        ex["congelar"] = True
    if isinstance(t.get("removido"), bool):
        ex["removido"] = t["removido"]
    return ex, None


def validar_edicao(e) -> tuple:
    """Ajustes gerais da tela de edição -> (True, limpo|None) ou (False, "erro")."""
    if e is None:
        return True, None
    if not isinstance(e, dict):
        return False, "edicao inválida"
    try:
        geral = float(e.get("volume_geral", 1.0))
    except (TypeError, ValueError):
        return False, "volume_geral precisa ser número de 0 a 1"
    if geral != geral:
        return False, "volume_geral inválido"
    rest = e.get("cortes_ia_restaurados") or []
    if not isinstance(rest, list) or len(rest) > MAX_RESTAURADOS:
        return False, "cortes_ia_restaurados inválido"
    rest = sorted({x for x in rest if isinstance(x, str) and re.fullmatch(r"c\d{1,5}-\d{1,5}", x)})
    return True, {"volume_geral": round(max(0.0, min(1.0, geral)), 3), "ia_gancho": e.get("ia_gancho", True) is not False,
                  "ia_titulo": e.get("ia_titulo", True) is not False, "cortes_ia_restaurados": rest}


def validar_pedido(p) -> tuple:
    """Confere o JSON que veio do navegador. Devolve (True, pedido_limpo) ou (False, "erro legível")."""
    if not isinstance(p, dict):
        return False, "pedido inválido"
    modo = p.get("modo", "aqui")
    if modo not in ("aqui", "separado"):
        return False, "modo precisa ser 'aqui' ou 'separado'"
    layout = p.get("layout", "dividido")
    if layout not in ("dividido", "cheia_longos"):
        return False, "layout precisa ser 'dividido' ou 'cheia_longos'"
    limpo = {
        "modo": modo,
        "layout": layout,
        "legenda": bool(p.get("legenda", True)),
        "cortar_silencio": bool(p.get("cortar_silencio", True)),
        "ia": bool(p.get("ia", True)),
        "duracao_max": DURACAO_MAX_PADRAO,
        "modelo": MODELO_PADRAO,
        "trechos": [],
    }
    mod = p.get("modelo", MODELO_PADRAO)
    if mod is not None and not (isinstance(mod, str) and re.fullmatch(r"[a-z0-9_-]{1,40}", mod)):
        return False, "modelo de edição inválido"
    if mod and os.path.exists(os.path.join(MODELOS, f"{mod}.json")):
        limpo["modelo"] = mod
    try:
        dm = float(p.get("duracao_max", DURACAO_MAX_PADRAO))
    except (TypeError, ValueError):
        return False, "duracao_max precisa ser número (segundos)"
    if not dm == dm:
        return False, "duracao_max inválida"
    limpo["duracao_max"] = max(DURACAO_MAX_MIN, min(DURACAO_MAX_MAX, dm))
    ok, ed = validar_edicao(p.get("edicao"))
    if not ok:
        return False, ed
    if ed is not None:
        limpo["edicao"] = ed
    tr = p.get("trechos")
    if modo == "separado" and not tr:
        return True, limpo  # a linha do tempo sai da sincronia (com trechos = editados na tela, usa os dele)
    if not isinstance(tr, list) or not tr:
        return False, "falta a linha do tempo (trechos)"
    if len(tr) > MAX_TRECHOS:
        return False, f"no máximo {MAX_TRECHOS} trechos"
    for i, t in enumerate(tr):
        if not isinstance(t, dict) or t.get("tipo") not in ("tocando", "comentario"):
            return False, f"trecho {i + 1} inválido"
        try:
            ini, fim, orig = float(t["ini"]), float(t["fim"]), float(t.get("orig", 0))
        except (KeyError, TypeError, ValueError):
            return False, f"trecho {i + 1}: ini/fim/orig precisam ser números"
        if not all(x == x and abs(x) < 1e6 for x in (ini, fim, orig)):  # NaN/infinito
            return False, f"trecho {i + 1}: número inválido"
        ex, erro = extras_trecho(t, i)
        if erro:
            return False, erro
        limpo["trechos"].append({"tipo": t["tipo"], "ini": ini, "fim": fim, "orig": orig, **ex})
    return True, limpo


def normalizar_trechos(trechos: list, dur_reacao: float, dur_original: float) -> list:
    """Ordena, tira sobreposição, limita às durações reais e preenche buracos.

    - nada antes de 0 nem depois do fim da gravação dele;
    - buraco sem trecho vira comentário congelado no ponto em que o original estava;
    - trecho tocando que passaria do fim do original acaba no fim; o resto vira comentário no último quadro;
    - tempo do original sempre dentro do vídeo (último quadro = dur - 1 quadro).
    """
    ultimo_q = max(0.0, dur_original - 1.0 / FPS)
    ts = sorted((dict(t) for t in trechos), key=lambda t: (t["ini"], t["fim"]))
    out = []
    cursor = 0.0
    pos_orig = min(max(ts[0]["orig"], 0.0), ultimo_q) if ts else 0.0  # onde o original "está" no cursor

    def empurrar(tipo, ini, fim, orig, ex=None):
        ex = ex or {}
        if fim - ini < 1e-3:
            return
        if out and out[-1]["tipo"] == tipo == "comentario" and abs(out[-1]["orig"] - orig) < 1e-3 and abs(out[-1]["fim"] - ini) < 1e-3 \
                and {k: out[-1][k] for k in EXTRAS if k in out[-1]} == ex:
            out[-1]["fim"] = fim
            return
        out.append({"tipo": tipo, "ini": ini, "fim": fim, "orig": orig, **ex})

    for t in ts:
        ini, fim = max(t["ini"], cursor, 0.0), min(t["fim"], dur_reacao)
        if fim - ini < 1e-3:
            continue
        if ini - cursor > 1e-3:  # buraco: congela onde estava
            empurrar("comentario", cursor, ini, pos_orig)
        orig = min(max(t["orig"], 0.0), ultimo_q)
        ex = {k: t[k] for k in EXTRAS if k in t}
        if t["tipo"] == "tocando" and ex.get("congelar"):   # congelado por ele: o original não anda
            empurrar("tocando", ini, fim, orig, ex)
            pos_orig = orig
        elif t["tipo"] == "tocando":
            cabe = max(0.0, dur_original - orig)
            if fim - ini > cabe:
                corte = ini + cabe
                empurrar("tocando", ini, corte, orig, ex)
                empurrar("comentario", corte, fim, ultimo_q, {k: v for k, v in ex.items() if k not in ("congelar", "pausa")})
                pos_orig = ultimo_q
            else:
                empurrar("tocando", ini, fim, orig, ex)
                pos_orig = min(orig + (fim - ini), ultimo_q)
        else:
            empurrar("comentario", ini, fim, orig, ex)
            pos_orig = orig
        cursor = fim
    if dur_reacao - cursor > 1e-3 and out:
        empurrar("comentario", cursor, dur_reacao, pos_orig)
    return out


def ler_silencedetect(texto: str, duracao: float) -> list:
    """Saída do silencedetect -> [(ini, fim)]. Silêncio aberto no fim do arquivo fecha na duração."""
    out, aberto = [], None
    for linha in texto.splitlines():
        m = re.search(r"silence_start:\s*(-?[\d.]+)", linha)
        if m:
            aberto = max(0.0, float(m.group(1)))
            continue
        m = re.search(r"silence_end:\s*([\d.]+)", linha)
        if m and aberto is not None:
            out.append((aberto, float(m.group(1))))
            aberto = None
    if aberto is not None:
        out.append((aberto, duracao))
    return out


def limiar_silencio(volume_medio_db) -> float:
    """Limiar do silencedetect a partir do volume médio da gravação (dB): 14 dB abaixo, entre -50 e -28."""
    if volume_medio_db is None:
        return -38.0
    return max(-50.0, min(-28.0, volume_medio_db - 14.0))


def falas_no_intervalo(a: float, b: float, silencios: list) -> list:
    """Complemento dos silêncios dentro de [a, b]."""
    falas, cur = [], a
    for s, e in sorted(silencios):
        if e <= a or s >= b:
            continue
        if s > cur:
            falas.append((cur, min(s, b)))
        cur = max(cur, e)
        if cur >= b:
            break
    if cur < b:
        falas.append((cur, b))
    return [f for f in falas if f[1] - f[0] > 1e-3]


def volume_trecho(tr: dict, geral: float = 1.0) -> float:
    """Som do original no trecho: mudo = 0; senão o volume do trecho (ou 100%) vezes o ajuste geral."""
    if tr.get("mudo"):
        return 0.0
    v = tr.get("volume")
    return round((1.0 if v is None else float(v)) * geral, 3)


def planejar(trechos: list, silencios: list, layout: str = "dividido", cortar: bool = True, geral: float = 1.0,
             corte: dict | None = None) -> list:
    """Linha do tempo + silêncios -> lista de pedaços a renderizar, na ordem.

    pedaço = {"tipo", "ini", "dur", "orig", "cheia", "layout", "vol", "fixo", "k"} (ini/dur em segundos da gravação
    dele, dur em quadros inteiros). layout do pedaço: dividido | cheia (ele + original no quadrinho, o automático dos
    comentários longos) | ele | original | original_pip. Trecho removido por ele não entra; "fixo" = ele mandou ficar.
    corte = {"silencio_longo", "folga_antes", "folga_depois"} do modelo de edição (sem = 0,7 / 0,12 / 0,22 s).
    """
    corte = corte or {}
    sil_longo = corte.get("silencio_longo", SIL_LONGO)
    pad_a, pad_d = corte.get("folga_antes", PAD_ANTES), corte.get("folga_depois", PAD_DEPOIS)
    pecas = []
    for k, tr in enumerate(trechos):
        if tr.get("removido") is True:
            continue
        a, b = tr["ini"], tr["fim"]
        base = {"orig": tr["orig"], "k": k, "vol": volume_trecho(tr, geral), "fixo": tr.get("removido") is False}
        if tr["tipo"] == "tocando" and not tr.get("congelar"):
            lay = tr.get("layout") or "dividido"
            pecas.append({"tipo": "tocando", "ini": a, "fim": b, "cheia": lay != "dividido", "layout": lay, **base})
            continue
        if cortar and tr["tipo"] == "comentario":
            falas = [f for f in falas_no_intervalo(a, b, silencios) if f[1] - f[0] >= MIN_FALA]
            if not falas:
                continue  # pausou e não falou nada: o congelado mudo sai
            juntas = [list(falas[0])]
            for s, e in falas[1:]:
                if s - juntas[-1][1] < sil_longo:
                    juntas[-1][1] = e
                else:
                    juntas.append([s, e])
            blocos = []
            for s, e in juntas:
                s2, e2 = max(a, s - pad_a), min(b, e + pad_d)
                if blocos and s2 < blocos[-1][1]:
                    s2 = blocos[-1][1]
                if e2 - s2 > 1e-3:
                    blocos.append([s2, e2])
        else:
            blocos = [[a, b]]
        total = sum(e - s for s, e in blocos)
        lay = tr.get("layout") or ("cheia" if layout == "cheia_longos" and total >= COMENTARIO_LONGO else "dividido")
        for s, e in blocos:
            pecas.append({"tipo": "comentario", "ini": s, "fim": e, "cheia": lay != "dividido", "layout": lay, **base})
    final = []
    for p in pecas:
        dur = quadro(p["fim"] - p["ini"])
        if dur < 2.0 / FPS:
            continue
        final.append({"tipo": p["tipo"], "ini": round(p["ini"], 4), "dur": dur, "orig": round(p["orig"], 4), "cheia": p["cheia"],
                      "layout": p["layout"], "vol": p["vol"], "fixo": p["fixo"], "k": p["k"]})
    return final


def linha_final(pecas: list) -> list:
    """Onde cada pedaço começa no vídeo final."""
    t, out = 0.0, []
    for p in pecas:
        out.append({**p, "t0": round(t, 4)})
        t += p["dur"]
    return out


# ======================================================================== edição com IA (puro)


def _durs(pecas: list) -> float:
    return round(sum(p["dur"] for p in pecas), 4)


def _peca(base: dict, ini: float, fim: float, **extra) -> dict | None:
    dur = quadro(fim - ini)
    if dur < 3.0 / FPS:
        return None
    orig = base["orig"] + (ini - base["ini"] if base["tipo"] == "tocando" else 0.0)
    return {**{k: v for k, v in base.items() if k not in ("ini", "dur", "orig", "t0")}, "ini": round(ini, 4), "dur": dur,
            "orig": round(orig, 4), **extra}


def intervalo_corte(palavras: list, de: int, ate: int, trecho: dict) -> tuple:
    """Faixa de palavras a cortar -> (ini, fim) na gravação dele: do fim da palavra anterior (deixa um respiro) ao
    começo da próxima, dentro do comentário. Nunca come a palavra vizinha."""
    a, b = palavras[de]["ini"], palavras[ate]["fim"]
    dentro = lambda w: trecho["ini"] <= (w["ini"] + w["fim"]) / 2 < trecho["fim"]  # noqa: E731
    ant = palavras[de - 1] if de > 0 and dentro(palavras[de - 1]) else None
    prox = palavras[ate + 1] if ate + 1 < len(palavras) and dentro(palavras[ate + 1]) else None
    ini = min(a, ant["fim"] + 0.08) if ant else trecho["ini"]
    fim = max(b, prox["ini"] - 0.05) if prox else trecho["fim"]
    return ini, fim


def subtrair(pecas: list, k: int, ini: float, fim: float) -> list:
    """Tira [ini, fim) dos pedaços de comentário do trecho k (pode partir um pedaço em dois)."""
    out = []
    for p in pecas:
        a, b = p["ini"], p["ini"] + p["dur"]
        if p.get("k") != k or p["tipo"] != "comentario" or p.get("gancho") or fim <= a or ini >= b:
            out.append(p)
            continue
        for x, y in ((a, min(ini, b)), (max(fim, a), b)):
            if y - x > 0.1:
                q = _peca(p, x, y)
                if q:
                    out.append(q)
    return out


def falas_intervalos(palavras: list, pausa: float = 0.6) -> list:
    """Palavras -> intervalos de fala contínua [(ini, fim)] (uma 'fala' não é partida no meio)."""
    out = []
    for w in palavras:
        if out and w["ini"] - out[-1][1] <= pausa:
            out[-1][1] = max(out[-1][1], w["fim"])
        else:
            out.append([w["ini"], w["fim"]])
    return [tuple(x) for x in out]


def encurtar_tocando(pecas: list, excesso: float, piso: float, falas: list) -> tuple:
    """Encurta os trechos do original tocando em até `excesso` s, cada um com no mínimo `piso` s.

    Corta do começo do trecho (o fim leva à pausa dele, que é o ponto do react); o último pedaço do vídeo, se for
    tocando, é cortado no fim. Nunca corta no meio de uma fala dele: o corte para antes da primeira fala.
    Devolve (pedaços, segundos tirados)."""
    if excesso <= 0:
        return pecas, 0.0
    idx = [i for i, p in enumerate(pecas) if p["tipo"] == "tocando" and not p.get("gancho") and not p.get("fixo")]
    idx.sort(key=lambda i: -pecas[i]["dur"])
    tirado = 0.0
    pecas = list(pecas)
    for i in idx:
        if tirado >= excesso - 1e-3:
            break
        p = pecas[i]
        a, b = p["ini"], p["ini"] + p["dur"]
        quer = min(p["dur"] - piso, excesso - tirado)
        if quer < 0.3:
            continue
        ultimo = i == len(pecas) - 1 and i > 0
        dentro = [f for f in falas if f[1] > a and f[0] < b]
        if ultimo:  # corta o fim, sem passar da última fala
            novo_fim = b - quer
            if dentro:
                novo_fim = max(novo_fim, max(f[1] for f in dentro) + 0.25)
            novo_fim = min(novo_fim, b)
            q = _peca(p, a, novo_fim) if b - novo_fim >= 0.3 else None
        else:       # corta o começo, sem passar da primeira fala
            novo_ini = a + quer
            if dentro:
                novo_ini = min(novo_ini, min(f[0] for f in dentro) - 0.15)
            novo_ini = max(novo_ini, a)
            q = _peca(p, novo_ini, b) if novo_ini - a >= 0.3 else None
        if q:
            tirado += p["dur"] - q["dur"]
            pecas[i] = q
    return pecas, round(tirado, 3)


def intervalo_gancho(palavras: list, de: int, ate: int, trecho: dict) -> tuple:
    """Faixa do gancho -> (ini, fim) de GANCHO_MIN a GANCHO_MAX s, terminando no fim de uma palavra."""
    a = max(trecho["ini"], palavras[de]["ini"] - 0.08)
    dentro = lambda j: trecho["ini"] <= (palavras[j]["ini"] + palavras[j]["fim"]) / 2 < trecho["fim"]  # noqa: E731
    while ate > de and palavras[ate]["fim"] + 0.2 - a > GANCHO_MAX:
        ate -= 1
    while palavras[ate]["fim"] + 0.2 - a < GANCHO_MIN and ate + 1 < len(palavras) and dentro(ate + 1) \
            and palavras[ate + 1]["fim"] + 0.2 - a <= GANCHO_MAX:
        ate += 1
    b = min(trecho["fim"], palavras[ate]["fim"] + 0.2, a + GANCHO_MAX)
    if b - a < GANCHO_MIN:
        b = min(trecho["fim"], a + GANCHO_MIN)
    return a, b


def id_corte(de: int, ate: int) -> str:
    """Nome estável de um corte da IA (índices de palavra): a tela de edição restaura por ele."""
    return f"c{de}-{ate}"


def aplicar_edicao(pecas: list, trechos: list, palavras: list, plano: dict, dur_max: float,
                   restaurados=(), sem_gancho: bool = False) -> tuple:
    """Plano validado da IA (edicao_ia.validar_resposta) -> (pedaços editados, resumo).

    Ordem: comentários que não agregam saem, cortes de repetição/erro/muleta, gancho no começo, duração alvo (original
    tocando até 3 s, comentários de nota até 3, original até 1,5 s, e só então os comentários bons), zoom nas ênfases.
    Escolha do Breno vence: trecho "fixo" (ele mandou ficar) não sai nem encurta, corte restaurado não é aplicado,
    trecho que ele removeu não volta (nem como gancho) e sem_gancho desliga o gancho.
    resumo["detalhe"] (para a tela de edição; quem chama tira antes de gravar o resumo) = cortes, removidos, tirados.
    """
    dur_antes = _durs(pecas)
    fixos = {p["k"] for p in pecas if p.get("fixo")}
    presentes = {p.get("k") for p in pecas}
    restaurados = set(restaurados or ())
    removidos = [k for k in plano.get("remover", []) if k in presentes and k not in fixos]
    pecas = [p for p in pecas if p.get("k") not in removidos or p["tipo"] != "comentario"]
    n_cortes, seg_cortes, cortes_info = 0, 0.0, []
    for de, ate in plano.get("cortar", []):
        k = next((j for j, t in enumerate(trechos) if t["tipo"] == "comentario"
                  and t["ini"] <= (palavras[de]["ini"] + palavras[de]["fim"]) / 2 < t["fim"]), None)
        if k is None or k in removidos or k not in presentes:
            continue
        ini, fim = intervalo_corte(palavras, de, ate, trechos[k])
        info = {"id": id_corte(de, ate), "ini": round(ini, 3), "fim": round(fim, 3),
                "texto": " ".join(w.get("w", "") for w in palavras[de:ate + 1])[:80], "restaurado": id_corte(de, ate) in restaurados}
        cortes_info.append(info)
        if info["restaurado"]:
            continue
        antes = _durs(pecas)
        pecas = subtrair(pecas, k, ini, fim)
        if _durs(pecas) < antes - 1e-3:
            n_cortes += 1
            seg_cortes += antes - _durs(pecas)

    gancho = None
    if plano.get("gancho") and not sem_gancho:
        de, ate = plano["gancho"]
        k = next((j for j, t in enumerate(trechos) if t["ini"] <= (palavras[de]["ini"] + palavras[de]["fim"]) / 2 < t["fim"]), None)
        if k is not None and k in presentes:
            t = trechos[k]
            a, b = intervalo_gancho(palavras, de, ate, t)
            irmao = next((p for p in pecas if p.get("k") == k), None) or {}
            congela = t["tipo"] == "comentario" or t.get("congelar")
            base = {"tipo": "comentario" if congela else "tocando", "ini": t["ini"], "orig": t["orig"],
                    "cheia": irmao.get("cheia", False), "layout": irmao.get("layout", "dividido"),
                    "vol": irmao.get("vol", 1.0), "fixo": irmao.get("fixo", False), "k": k}
            gancho = _peca(base, a, b, gancho=True)
            if gancho:
                pecas = [gancho] + pecas

    # duração alvo
    falas = falas_intervalos(palavras)
    encurtado, tirados = 0.0, []
    if _durs(pecas) > dur_max:          # 1) original tocando até 3 s
        pecas, x = encurtar_tocando(pecas, _durs(pecas) - dur_max, TOCANDO_PISO_1, falas)
        encurtado += x
    notas = plano.get("notas", {})
    protegido = gancho["k"] if gancho else None

    def tirar_comentarios(nota_max: int):
        nonlocal pecas
        ks = sorted({p["k"] for p in pecas if p["tipo"] == "comentario" and not p.get("gancho")})
        ordem = sorted((k for k in ks if k != protegido and k not in fixos and notas.get(k, 3) <= nota_max),
                       key=lambda k: (notas.get(k, 3), -sum(p["dur"] for p in pecas if p.get("k") == k and p["tipo"] == "comentario")))
        for k in ordem:
            if _durs(pecas) <= dur_max:
                return
            if len({p["k"] for p in pecas if p["tipo"] == "comentario" and not p.get("gancho")}) <= 1:
                return
            pecas = [p for p in pecas if not (p.get("k") == k and p["tipo"] == "comentario" and not p.get("gancho"))]
            tirados.append(k)

    if _durs(pecas) > dur_max:          # 2) comentários fracos (nota até 3), do pior para o melhor
        tirar_comentarios(3)
    if _durs(pecas) > dur_max:          # 3) original tocando até 1,5 s
        pecas, x = encurtar_tocando(pecas, _durs(pecas) - dur_max, TOCANDO_PISO_2, falas)
        encurtado += x
    if _durs(pecas) > dur_max:          # 4) por último, comentários bons
        tirar_comentarios(5)

    # zoom nas ênfases (janelas locais de cada pedaço)
    janelas = []
    for de, ate in plano.get("enfase", []):
        a, b = palavras[de]["ini"] - 0.05, palavras[ate]["fim"] + 0.25
        if b - a < 0.8:
            b = a + 0.8
        janelas.append((a, b))
    n_zoom = 0
    for p in pecas:
        loc = []
        for a, b in janelas:
            x, y = max(a, p["ini"]) - p["ini"], min(b, p["ini"] + p["dur"]) - p["ini"]
            if y - x >= 0.3:
                loc.append([round(x, 3), round(y, 3)])
        if loc:
            p["zoom"] = loc
            n_zoom += len(loc)
    resumo = {
        "titulo": plano.get("titulo") or "",
        "gancho_seg": gancho["dur"] if gancho else 0,
        "cortes": n_cortes,
        "segundos_cortados_ia": round(seg_cortes, 2),
        "comentarios_removidos": len(removidos),
        "comentarios_tirados_pela_duracao": len(tirados),
        "tocando_encurtado_seg": round(encurtado, 2),
        "zooms": n_zoom,
        "duracao_antes_seg": round(dur_antes, 2),
        "duracao_depois_seg": round(_durs(pecas), 2),
        "duracao_max_seg": dur_max,
        "detalhe": {"cortes": cortes_info, "removidos": removidos, "tirados": tirados,
                    "gancho": {"ini": gancho["ini"], "fim": round(gancho["ini"] + gancho["dur"], 3)} if gancho else None},
    }
    return pecas, resumo


def palavras_no_final(pecas: list, palavras: list) -> list:
    """Palavras na gravação dele -> tempo do vídeo final (pedaços com t0). Palavra que aparece em dois pedaços (o
    gancho repete um trecho) sai duas vezes."""
    out = []
    for p in pecas:
        a, b = p["ini"], p["ini"] + p["dur"]
        for w in palavras:
            m = (w["ini"] + w["fim"]) / 2
            if a <= m < b:
                out.append({**w, "ini": round(p["t0"] + max(0.0, w["ini"] - a), 3),
                            "fim": round(p["t0"] + min(p["dur"], w["fim"] - a), 3)})
    out.sort(key=lambda w: w["ini"])
    return out


def plano_para_json(plano: dict) -> dict:
    """Plano validado -> JSON (tuplas viram listas; notas vira lista de pares, a chave int não sobrevive ao JSON)."""
    return {**plano, "notas": [[int(k), int(v)] for k, v in (plano.get("notas") or {}).items()],
            "cortar": [list(x) for x in plano.get("cortar", [])], "enfase": [list(x) for x in plano.get("enfase", [])],
            "gancho": list(plano["gancho"]) if plano.get("gancho") else None}


def plano_de_json(j: dict) -> dict:
    return {**j, "notas": {int(k): int(v) for k, v in j.get("notas", [])},
            "cortar": [tuple(x) for x in j.get("cortar", [])], "enfase": [tuple(x) for x in j.get("enfase", [])],
            "gancho": tuple(j["gancho"]) if j.get("gancho") else None}


def _trecho_em(trechos: list, t: float):
    return next((j for j, x in enumerate(trechos) if x["ini"] <= t < x["fim"]), None)


def remapear_plano(plano: dict, trechos_ia: list, trechos_novos: list) -> dict:
    """O plano da IA foi feito sobre `trechos_ia`; a tela de edição mudou os trechos (partiu, congelou, tirou).
    O que é por palavra (cortes, gancho, ênfase, chaves) vale como está; o que é por número de comentário
    (remover, notas) passa para os trechos novos pelo meio de cada trecho."""
    remover, notas = set(plano.get("remover", [])), plano.get("notas", {})
    novo_rem, novo_notas = [], {}
    for k, t in enumerate(trechos_novos):
        j = _trecho_em(trechos_ia, (t["ini"] + t["fim"]) / 2)
        if j is None:
            continue
        if j in remover and t["tipo"] == "comentario":
            novo_rem.append(k)
        if j in notas:
            novo_notas[k] = notas[j]
    return {**plano, "remover": novo_rem, "notas": novo_notas}


def falas_de_silencios(silencios: list, dur: float) -> list:
    """Silêncios da gravação inteira -> intervalos em que ele fala (a tela usa no "pausar enquanto eu falo")."""
    return [[round(a, 3), round(b, 3)] for a, b in falas_no_intervalo(0.0, dur, silencios) if b - a >= MIN_FALA]


# ======================================================================== legenda (puro)




# Modelos de edição (modelos/<id>.json): hoje mexem na legenda e no título. "nativo" é o padrão (legenda limpa como
# a do Instagram); "classico" é a da primeira versão (maiúsculas, palavra da vez amarela, chaves verdes).
MODELOS = os.environ.get("REACT_MODELOS", os.path.join(os.path.dirname(os.path.abspath(__file__)), "modelos"))
MODELO_PADRAO = "nativo"
_LEG_NATIVO = {"fonte": "DM Sans", "negrito": True, "tamanho": 60, "cor": "FFFFFF", "cor_contorno": "000000", "contorno": 3,
               "sombra": 2, "maiusculas": False, "karaoke": False, "destacar_chaves": False, "min_palavras": 2,
               "max_palavras": 5, "max_letras": 26, "y": 1420}
_LEG_CLASSICO = {"fonte": FONTE_NOME, "negrito": False, "tamanho": 84, "cor": "FFFFFF", "cor_contorno": "000000", "contorno": 7,
                 "sombra": 3, "maiusculas": True, "karaoke": True, "destacar_chaves": True, "min_palavras": 1,
                 "max_palavras": MAX_PALAVRAS, "max_letras": MAX_LETRAS, "y": None}
_TIT_NATIVO = {"fonte": "DM Sans", "tamanho": 64, "maiusculas": False, "estilo": "caixa", "y": Y_TITULO,
               "duracao_min": None, "duracao_max": None, "sombra": 4}
_CORTE_PADRAO = {"silencio_longo": SIL_LONGO, "folga_antes": PAD_ANTES, "folga_depois": PAD_DEPOIS}


def _cor(x, padrao: str) -> str:
    return x.upper() if isinstance(x, str) and re.fullmatch(r"[0-9A-Fa-f]{6}", x) else padrao


def carregar_modelo(mid: str | None) -> dict:
    """modelos/<id>.json -> modelo limpo (o que faltar ou vier errado fica com o do nativo). Desconhecido = nativo."""
    mid = mid if isinstance(mid, str) and re.fullmatch(r"[a-z0-9_-]{1,40}", mid or "") else MODELO_PADRAO
    try:
        with open(os.path.join(MODELOS, f"{mid}.json"), encoding="utf-8") as f:
            j = json.load(f)
    except (OSError, ValueError):
        j, mid = {}, (MODELO_PADRAO if mid != MODELO_PADRAO else mid)
    leg_in, tit_in = j.get("legenda") or {}, j.get("titulo") or {}
    leg = dict(_LEG_NATIVO, mostrar=True)
    if isinstance(leg_in.get("mostrar"), bool):
        leg["mostrar"] = leg_in["mostrar"]
    for k in ("fonte",):
        if isinstance(leg_in.get(k), str) and re.fullmatch(r"[\w .-]{1,60}", leg_in[k]):
            leg[k] = leg_in[k]
    for k in ("negrito", "maiusculas", "karaoke", "destacar_chaves"):
        if isinstance(leg_in.get(k), bool):
            leg[k] = leg_in[k]
    for k, lo, hi in (("tamanho", 24, 140), ("contorno", 0, 12), ("sombra", 0, 12), ("min_palavras", 1, 8),
                      ("max_palavras", 1, 10), ("max_letras", 6, 60)):
        if isinstance(leg_in.get(k), (int, float)) and not isinstance(leg_in.get(k), bool):
            leg[k] = max(lo, min(hi, leg_in[k]))
    if "y" in leg_in:
        leg["y"] = max(200, min(1800, int(leg_in["y"]))) if isinstance(leg_in["y"], (int, float)) else None
    leg["cor"], leg["cor_contorno"] = _cor(leg_in.get("cor"), leg["cor"]), _cor(leg_in.get("cor_contorno"), leg["cor_contorno"])
    leg["min_palavras"] = min(leg["min_palavras"], leg["max_palavras"])
    tit = dict(_TIT_NATIVO)
    if isinstance(tit_in.get("fonte"), str) and re.fullmatch(r"[\w .-]{1,60}", tit_in["fonte"]):
        tit["fonte"] = tit_in["fonte"]
    if isinstance(tit_in.get("tamanho"), (int, float)):
        tit["tamanho"] = max(30, min(120, tit_in["tamanho"]))
    if isinstance(tit_in.get("maiusculas"), bool):
        tit["maiusculas"] = tit_in["maiusculas"]
    if tit_in.get("estilo") in ("caixa", "gancho"):
        tit["estilo"] = tit_in["estilo"]
    if isinstance(tit_in.get("y"), (int, float)):
        tit["y"] = max(40, min(1700, int(tit_in["y"])))
    for k in ("duracao_min", "duracao_max"):
        if isinstance(tit_in.get(k), (int, float)) and tit_in[k] > 0:
            tit[k] = max(0.5, min(60.0, float(tit_in[k])))
    if isinstance(tit_in.get("sombra"), (int, float)):
        tit["sombra"] = max(0, min(12, tit_in["sombra"]))
    corte_in, zoom_in = j.get("corte") or {}, j.get("zoom") or {}
    corte = dict(_CORTE_PADRAO)
    for k, lo, hi in (("silencio_longo", 0.2, 3.0), ("folga_antes", 0.0, 0.5), ("folga_depois", 0.0, 0.8)):
        if isinstance(corte_in.get(k), (int, float)) and not isinstance(corte_in.get(k), bool):
            corte[k] = max(lo, min(hi, float(corte_in[k])))
    punch = zoom_in.get("punch_in_seg")
    zoom = {"punch_in_seg": max(1.5, min(15.0, float(punch))) if isinstance(punch, (int, float)) and punch > 0 else None}
    return {"id": mid, "nome": j.get("nome") or mid, "legenda": leg, "titulo": tit, "corte": corte, "zoom": zoom}


def punch_in(pecas: list, seg: float) -> int:
    """Punch-in (zoom da câmera dele) a cada `seg` s dentro de um take único: no pedaço longo, alterna normal e
    zoom a cada `seg` s (o 2º, 4º... intervalo com zoom). Junta com o zoom da IA. Devolve quantas janelas pôs."""
    n = 0
    for p in pecas:
        if layout_peca(p) not in ("dividido", "cheia", "ele") or p["dur"] < seg * 1.5:
            continue
        janelas = [list(x) for x in p.get("zoom", [])]
        k = 1
        while k * seg < p["dur"] - 0.5:
            a, b = round(k * seg, 3), round(min(p["dur"], (k + 1) * seg), 3)
            if not any(x < b and a < y for x, y in janelas):
                janelas.append([a, b])
                n += 1
            k += 2
        p["zoom"] = sorted(janelas)
    return n


def listar_modelos() -> dict:
    """Para o seletor da tela: os modelos que existem e os planejados (desligados, com o motivo)."""
    disp = []
    try:
        nomes = sorted(os.listdir(MODELOS))
    except OSError:
        nomes = []
    for n in nomes:
        m = re.fullmatch(r"([a-z0-9_-]{1,40})\.json", n)
        if not m or m.group(1) == "planejados":
            continue
        try:
            with open(os.path.join(MODELOS, n), encoding="utf-8") as f:
                j = json.load(f)
        except (OSError, ValueError):
            continue
        disp.append({"id": m.group(1), "nome": str(j.get("nome") or m.group(1))[:60], "descricao": str(j.get("descricao") or "")[:300],
                     "ordem": j.get("ordem", 50) if isinstance(j.get("ordem"), (int, float)) else 50})
    disp.sort(key=lambda x: (x["ordem"], x["nome"]))
    ids = {x["id"] for x in disp}
    try:
        with open(os.path.join(MODELOS, "planejados.json"), encoding="utf-8") as f:
            plan = [{"id": str(x.get("id"))[:40], "nome": str(x.get("nome") or x.get("id"))[:60], "aguardando": str(x.get("aguardando") or "")[:300]}
                    for x in json.load(f) if isinstance(x, dict) and x.get("id") not in ids]
    except (OSError, ValueError, AttributeError):
        plan = []
    return {"padrao": MODELO_PADRAO, "modelos": disp, "planejados": plan}


_PONTA = re.compile(r"^[\s\"'“”‘’«»()\[\]{}…\-–—:;]+|[\s\"'“”‘’«»()\[\]{}…\-–—:;]+$")
_EMOJI = re.compile("[\U00010000-\U0010FFFF\u2600-\u27BF\uFE0F\u200D]")


def limpar_palavra(w: str, maiusculas: bool = True) -> str:
    w = _EMOJI.sub("", (w or "").replace("{", "").replace("}", "").replace("\\", "")).strip()
    w = _PONTA.sub("", w)
    return w.upper() if maiusculas else w


def agrupar_palavras(palavras: list, est: dict | None = None) -> list:
    """[{"w", "ini", "fim"}] (tempo do vídeo final) -> frases curtas na tela. `est` = legenda do modelo (sem = clássico:
    2 a 4 palavras em maiúsculas). No nativo: 2 a 5 palavras, como foram faladas, sem vírgula/ponto no fim."""
    est = est or _LEG_CLASSICO
    max_p, max_l, min_p = est["max_palavras"], est["max_letras"], est["min_palavras"]
    ps = []
    for p in palavras:
        t = limpar_palavra(p.get("w", ""), est["maiusculas"])
        if not t or not re.search(r"\w", t):
            continue
        ini, fim = float(p["ini"]), float(p["fim"])
        if fim <= ini:
            fim = ini + 0.15
        ps.append({"t": t, "ini": ini, "fim": fim, "fecha": bool(re.search(r"[.!?,]$", t)), "k": bool(p.get("k"))})
    grupos, cur = [], []
    for p in ps:
        if cur:
            letras = sum(len(x["t"].rstrip(".,")) + 1 for x in cur) + len(p["t"].rstrip(".,"))
            quebra = (
                len(cur) >= max_p
                or letras > max_l
                or p["ini"] - cur[-1]["fim"] > PAUSA_QUEBRA
                or (cur[-1]["fecha"] and len(cur) >= 2)
            )
            if quebra:
                grupos.append(cur)
                cur = []
        cur.append(p)
    if cur:
        grupos.append(cur)
    if min_p > 1:  # palavra sozinha na tela pisca: junta com a vizinha se couber
        juntos = []
        for g in grupos:
            if juntos and (len(g) < min_p or len(juntos[-1]) < min_p) and len(juntos[-1]) + len(g) <= max_p \
                    and g[0]["ini"] - juntos[-1][-1]["fim"] <= 0.8 \
                    and sum(len(x["t"]) + 1 for x in juntos[-1] + g) <= max_l + 4:
                juntos[-1] = juntos[-1] + g
            else:
                juntos.append(g)
        grupos = juntos
    out = []
    for g in grupos:
        palavras_g = [{"t": x["t"].rstrip(".,") or x["t"], "ini": x["ini"], "fim": x["fim"], "k": x["k"]} for x in g]
        out.append({"ini": g[0]["ini"], "fim": max(g[-1]["fim"], g[0]["ini"] + 0.4), "palavras": palavras_g})
    for i in range(len(out) - 1):  # sem sobreposição; buraco pequeno é emendado (não pisca)
        prox = out[i + 1]["ini"]
        if out[i]["fim"] > prox or prox - out[i]["fim"] < 0.25:
            out[i]["fim"] = prox
    return out


def tempo_ass(t: float) -> str:
    cs = max(0, int(round(t * 100)))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def linhas_titulo(titulo: str, max_letras: int = 18) -> list:
    """Título em até 2 linhas equilibradas (o ASS aqui não quebra sozinho: WrapStyle 2)."""
    ws = titulo.split()
    if len(titulo) <= max_letras or len(ws) < 2:
        return [titulo]
    melhor = None
    for i in range(1, len(ws)):
        a, b = " ".join(ws[:i]), " ".join(ws[i:])
        custo = max(len(a), len(b))
        if melhor is None or custo < melhor[0]:
            melhor = (custo, [a, b])
    return melhor[1]


def _ass_cor(rrggbb: str) -> str:
    return f"&H00{rrggbb[4:6]}{rrggbb[2:4]}{rrggbb[0:2]}"


def gerar_ass(grupos: list, y_em, titulo: str = "", dur_total: float = 0.0, modelo: dict | None = None,
              titulo_ate: float | None = None) -> str:
    """Blocos -> ASS. `y_em(t)` diz a altura da legenda no instante t (muda entre dividido e tela cheia); o modelo pode
    fixar a altura (legenda.y). Sem modelo = clássico. Karaokê (palavra da vez amarela) e chaves verdes só se o
    modelo pedir; no nativo cada frase é um evento só, branca, com contorno e sombra leves."""
    leg = (modelo or {}).get("legenda") or _LEG_CLASSICO
    tit = (modelo or {}).get("titulo") or {"fonte": FONTE_NOME, "tamanho": 72, "maiusculas": True}
    negrito = -1 if leg["negrito"] else 0
    sombra_cor = "&H64000000" if not leg["karaoke"] else "&H96000000"
    cab = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {L}",
        f"PlayResY: {A}",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: R,{leg['fonte']},{leg['tamanho']},{_ass_cor(leg['cor'])},{_ass_cor(leg['cor'])},{_ass_cor(leg['cor_contorno'])},"
        f"{sombra_cor},{negrito},0,0,0,100,100,{1 if leg['karaoke'] else 0},0,1,{leg['contorno']},{leg['sombra']},5,60,60,0,1",
        # título: letra preta numa caixa branca (BorderStyle 3: a "borda" vira caixa), no topo
        f"Style: T,{tit['fonte']},{tit['tamanho']},&H00111111,&H00111111,&H00FFFFFF,&H00FFFFFF,-1,0,0,0,100,100,0,0,3,18,0,8,60,60,0,1",
        # título de gancho (modelo Edu Esteves): branco, caixa alta pesada, sombra preta suave, centralizado, sem caixa
        f"Style: G,{tit['fonte']},{tit['tamanho']},&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,-1,0,0,0,100,100,0,0,1,"
        f"{1 if tit.get('sombra', 4) else 0},{tit.get('sombra', 4)},5,60,60,0,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    ev = []
    amarelo, branco, verde = r"{\c&H0000E5FF&}", r"{\c&H00FFFFFF&}", r"{\c&H0060FF3C&\fscx112\fscy112}"
    volta = r"{\c&H00FFFFFF&\fscx100\fscy100}"
    if titulo and dur_total > 0 and tit.get("estilo") == "gancho":
        t_txt = titulo.upper() if tit["maiusculas"] else titulo
        ate = min(dur_total, titulo_ate or dur_total)
        ev.append(f"Dialogue: 1,{tempo_ass(0)},{tempo_ass(ate)},G,,0,0,0,,{{\\an5\\pos(540,{tit.get('y', 768)})}}"
                  + "\\N".join(linhas_titulo(t_txt, 16)[:2]))
    elif titulo and dur_total > 0:
        t_txt = titulo if tit["maiusculas"] else titulo[:1] + titulo[1:].lower()
        ev.append(f"Dialogue: 1,{tempo_ass(0)},{tempo_ass(dur_total)},T,,0,0,0,,{{\\an8\\pos(540,{Y_TITULO})}}"
                  + "\\N".join(linhas_titulo(t_txt, 18 if tit["maiusculas"] else 24)))
    y_fixo = leg.get("y")
    for g in grupos:
        ws = g["palavras"]
        y = int(y_fixo if y_fixo else y_em(g["ini"]))
        if not leg["karaoke"]:
            partes = [(verde + x["t"] + volta) if (x.get("k") and leg["destacar_chaves"]) else x["t"] for x in ws]
            ev.append(f"Dialogue: 0,{tempo_ass(g['ini'])},{tempo_ass(g['fim'])},R,,0,0,0,,{{\\pos(540,{y})}}" + " ".join(partes))
            continue
        for i, w in enumerate(ws):
            ini = g["ini"] if i == 0 else w["ini"]
            fim = ws[i + 1]["ini"] if i + 1 < len(ws) else g["fim"]
            if fim - ini < 0.01:
                continue
            partes = [(amarelo + x["t"] + branco) if j == i else (verde + x["t"] + volta) if (x.get("k") and leg["destacar_chaves"]) else x["t"]
                      for j, x in enumerate(ws)]
            pop = r"\fscx86\fscy86\t(0,90,\fscx100\fscy100)" if i == 0 else ""
            ev.append(f"Dialogue: 0,{tempo_ass(ini)},{tempo_ass(fim)},R,,0,0,0,,{{\\pos(540,{y}){pop}}}" + " ".join(partes))
    return "\n".join(cab + ev) + "\n"


# ======================================================================== comandos do ffmpeg (puro)


def filtro_topo(entrada: str, saida: str) -> str:
    """Original no painel de cima (1080x960): preenche o painel inteiro (como object-fit: cover), cortando o excesso
    pelo centro. Nunca sobra faixa (nem preta nem desfocada) dos lados ou em cima e embaixo, venha o vídeo em 9:16
    (Reels/TikTok baixado pelo link), 16:9 ou quadrado."""
    return (
        f"[{entrada}]fps={FPS},scale={L}:{METADE}:force_original_aspect_ratio=increase,"
        f"crop={L}:{METADE}:(iw-ow)/2:(ih-oh)/2,setsar=1[{saida}]"
    )


def filtro_ele(entrada: str, saida: str, w: int, h: int, zoom: list | None = None) -> str:
    """Ele (câmera) preenchendo w x h, corte um pouco acima do centro (o rosto fica mais no alto).
    `zoom` = janelas [[a, b], ...] em segundos do pedaço: nelas a câmera dá um zoom seco (ênfase)."""
    base = (f"[{entrada}]fps={FPS},scale={w}:{h}:force_original_aspect_ratio=increase,"
            f"crop={w}:{h}:(iw-ow)/2:(ih-oh)*0.35,setsar=1")
    if not zoom:
        return f"{base}[{saida}]"
    zw, zh = int(w * ZOOM) // 2 * 2, int(h * ZOOM) // 2 * 2
    quando = "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b in zoom)
    return (f"{base},split=2[{saida}n][{saida}z0];"
            f"[{saida}z0]scale={zw}:{zh},crop={w}:{h}:(iw-ow)/2:(ih-oh)*0.4,setsar=1[{saida}z];"
            f"[{saida}n][{saida}z]overlay=0:0:enable='{quando}'[{saida}]")


def cmd_normalizar(entrada: str, saida: str, lado_max: int, com_audio: bool) -> list:
    """Uma passada no começo: 30 fps constantes, H.264 com GOP curto (busca exata e rápida), PCM 48 kHz estéreo,
    carimbos refeitos do zero. Resolve o WebM do Chrome (sem índice nem duração, carimbos irregulares), o vídeo de
    taxa variável do iPhone, rotação e 4K/HEVC pesado de decodificar a cada pedaço."""
    escala = (f"scale=w='if(gte(iw,ih),min({lado_max},iw),-2)':h='if(gte(iw,ih),-2,min({lado_max},ih))'"
              f":force_divisible_by=2")
    cmd = prefixo_ffmpeg() + ["-fflags", "+genpts", "-i", entrada, "-map", "0:v:0"]
    if com_audio:
        cmd += ["-map", "0:a:0"]
    cmd += ["-vf", f"setpts=PTS-STARTPTS,fps={FPS},{escala},setsar=1,format=yuv420p", "-fps_mode", "cfr",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-g", "15", "-pix_fmt", "yuv420p"]
    if com_audio:
        cmd += ["-af", "asetpts=PTS-STARTPTS,aresample=async=1:first_pts=0", "-c:a", "pcm_s16le", "-ar", str(TAXA), "-ac", "2"]
    return cmd + [saida]


def filtro_cheio(entrada: str, saida: str) -> str:
    """Original na tela toda (1080x1920): preenche a tela (cover), cortando o excesso pelo centro. O vertical 9:16
    ocupa a tela cheia sem corte nenhum; o horizontal perde as laterais, nunca ganha faixa."""
    return (
        f"[{entrada}]fps={FPS},scale={L}:{A}:force_original_aspect_ratio=increase,"
        f"crop={L}:{A}:(iw-ow)/2:(ih-oh)/2,setsar=1[{saida}]"
    )


def cmd_topo_congelado(original: str, t: float, saida: str, cheio: bool = False) -> list:
    """PNG do original congelado no instante t: painel de cima (1080x960) ou a tela toda (cheio, 1080x1920)."""
    filtro = filtro_cheio("0:v", "topo") if cheio else filtro_topo("0:v", "topo")
    return prefixo_ffmpeg() + [
        "-ss", f"{max(0.0, t):.3f}", "-i", original, "-frames:v", "1",
        "-filter_complex", filtro, "-map", "[topo]", "-update", "1", saida,
    ]


def layout_peca(p: dict) -> str:
    return p.get("layout") or ("cheia" if p.get("cheia") else "dividido")


def precisa_cheio(p: dict) -> bool:
    """O quadro congelado deste pedaço é o da tela toda (layouts com o original grande)?"""
    return layout_peca(p) in ("original", "original_pip")


ALVO_VOZ_LUFS, ALVO_ORIGINAL_LUFS = -16.0, -19.0   # a voz dele um pouco acima do original (react = ele é o centro)


def ganhos_fontes(lufs_voz, lufs_original) -> dict:
    """Nivelamento das duas fontes ANTES de misturar (ganho fixo, dB): era o que o loudnorm dinâmico fazia sozinho no
    fim, mas ele também desfazia o volume por trecho. Sem medida, ganho 0."""
    g = lambda medido, alvo: 0.0 if medido is None else round(max(-20.0, min(20.0, alvo - medido)), 2)  # noqa: E731
    return {"voz": g(lufs_voz, ALVO_VOZ_LUFS), "original": g(lufs_original, ALVO_ORIGINAL_LUFS)}


def cmd_peca(p: dict, reacao: str, original: str, topo_png: str | None, orig_tem_audio: bool,
             saida: str, saida_voz: str, pip_y: int = PIP_Y, ganhos: dict | None = None) -> list:
    """Um pedaço -> clipe intermediário (MKV, x264 ultrafast + PCM) e a voz dele em WAV 16 kHz mono.

    Layouts (p["layout"]): dividido (original em cima, ele embaixo) · cheia (ele na tela toda, original congelado
    num quadrinho) · ele (só ele, tela toda) · original (só o original, tela toda) · original_pip (original na tela
    toda e ele pequeno no canto). No comentário o original vem do PNG congelado (topo_png: painel ou tela toda,
    conforme precisa_cheio). p["vol"] = som do original nos trechos tocando (0 = mudo)."""
    dur = p["dur"]
    lay = layout_peca(p)
    congelado = p["tipo"] != "tocando"
    margem = f"{dur + 0.6:.3f}"
    entradas = ["-ss", f"{p['ini']:.3f}", "-t", margem, "-i", reacao]
    if congelado:
        entradas += ["-loop", "1", "-framerate", str(FPS), "-t", margem, "-i", topo_png]
    else:
        entradas += ["-ss", f"{p['orig']:.3f}", "-t", margem, "-i", original]
    g = []
    voz = (f"[0:a]aresample={TAXA},aformat=sample_fmts=fltp:channel_layouts=stereo,apad,"
           f"atrim=duration={dur:.6f},asetpts=PTS-STARTPTS")
    fim_v = f"tpad=stop_mode=clone:stop_duration=3,trim=duration={dur:.6f},setpts=PTS-STARTPTS,format=yuv420p[v]"
    png = f"[1:v]fps={FPS},format=yuv420p,setsar=1"

    def original_em(nome: str, cheio: bool):
        if congelado:
            g.append(f"{png}[{nome}]")
        else:
            g.append(filtro_cheio("1:v", nome) if cheio else filtro_topo("1:v", nome))

    if lay == "dividido":
        original_em("top", False)
        g.append(filtro_ele("0:v", "bot", L, METADE, p.get("zoom")))
        g.append(f"[top][bot]vstack=inputs=2:shortest=1,{fim_v}")
    elif lay == "cheia":
        g.append(filtro_ele("0:v", "base", L, A, p.get("zoom")))
        original_em("pp", False)
        g.append(f"[pp]scale=432:384,pad=444:396:6:6:white,setsar=1[pip]")
        g.append(f"[base][pip]overlay=48:{pip_y}:shortest=1,{fim_v}")
    elif lay == "ele":
        g.append(filtro_ele("0:v", "base", L, A, p.get("zoom")))
        g.append(f"[base]{fim_v}")
    elif lay == "original":
        original_em("base", True)
        g.append(f"[base]{fim_v}")
    else:  # original_pip
        original_em("base", True)
        g.append(filtro_ele("0:v", "pe", PIP_ELE_L, PIP_ELE_A))
        g.append(f"[pe]pad={PIP_ELE_L + 12}:{PIP_ELE_A + 12}:6:6:white,setsar=1[pip]")
        g.append(f"[base][pip]overlay={L - 48 - PIP_ELE_L - 12}:{pip_y}:shortest=1,{fim_v}")

    ganhos = ganhos or {}
    gv = f",volume={ganhos['voz']:.2f}dB" if abs(ganhos.get("voz", 0.0)) >= 0.01 else ""
    if not congelado:
        vol = float(p.get("vol", 1.0)) * 10 ** (ganhos.get("original", 0.0) / 20)
        # voz com portão leve (o som do original que vaza no microfone não passa) e o original abaixando quando ele fala;
        # o portão e o sidechain olham a voz crua (os limiares são absolutos); o ganho da voz entra só na mistura
        g.append(f"{voz},agate=threshold=0.02:ratio=3:attack=10:release=250:range=0.06,asplit=3[r0][rsc][rv]")
        g.append(f"[r0]anull{gv}[r1]")
        if orig_tem_audio and float(p.get("vol", 1.0)) > 0.001:
            ganho = "" if abs(vol - 1.0) < 0.001 else f",volume={vol:.4f}"
            g.append(f"[1:a]aresample={TAXA},aformat=sample_fmts=fltp:channel_layouts=stereo,apad,"
                     f"atrim=duration={dur:.6f},asetpts=PTS-STARTPTS{ganho}[o]")
        else:  # sem áudio no original ou mudo: silêncio de verdade
            g.append(f"anullsrc=r={TAXA}:cl=stereo,atrim=duration={dur:.6f},aformat=sample_fmts=fltp[o]")
        g.append("[o][rsc]sidechaincompress=threshold=0.015:ratio=10:attack=15:release=350[od]")
        g.append("[od][r1]amix=inputs=2:duration=first:normalize=0[a]")
    else:
        g.append(f"{voz},asplit=2[a0][rv]")
        g.append(f"[a0]anull{gv}[a]")
    g.append(f"[rv]aresample={TAXA_VOZ},pan=mono|c0=0.5*c0+0.5*c1[vz]")
    return prefixo_ffmpeg() + entradas + [
        "-filter_complex", ";".join(g),
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "17", "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-c:a", "pcm_s16le", "-ar", str(TAXA), "-ac", "2", saida,
        "-map", "[vz]", "-c:a", "pcm_s16le", "-ar", str(TAXA_VOZ), "-ac", "1", saida_voz,
    ]


def cmd_previa(entrada: str, saida: str, lado_max: int = 640) -> list:
    """Cópia leve para a prévia da tela de edição no celular (mesma linha do tempo da normalizada)."""
    escala = (f"scale=w='if(gte(iw,ih),min({lado_max},iw),-2)':h='if(gte(iw,ih),-2,min({lado_max},ih))'"
              f":force_divisible_by=2")
    return prefixo_ffmpeg() + ["-i", entrada, "-map", "0:v:0", "-map", "0:a:0?", "-vf", f"{escala},format=yuv420p",
                               "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-profile:v", "main", "-g", "30",
                               "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", saida]


ALVO_LUFS, TETO_PICO_DB = -14.0, -1.5


def filtro_volume_final(lufs_medido) -> str:
    """Volume do vídeo final: ganho FIXO até -14 LUFS (medido numa 1ª passada) + limitador de pico em -1,5 dB.
    Ganho fixo e não o loudnorm dinâmico: o dinâmico sobe os trechos baixos e desfaz o volume que ele escolheu por
    trecho (medido no arnês: 30 % virava só -4,7 dB). Sem medida (falhou), cai no loudnorm de antes."""
    if lufs_medido is None:
        return f"loudnorm=I={ALVO_LUFS}:TP={TETO_PICO_DB}:LRA=11,aresample={TAXA}"
    ganho = max(-30.0, min(30.0, ALVO_LUFS - lufs_medido))
    teto = 10 ** (TETO_PICO_DB / 20)
    return (f"volume={ganho:.2f}dB,aresample={TAXA * 4},alimiter=limit={teto:.4f}:attack=5:release=50:level=disabled,"
            f"aresample={TAXA}")


def medir_lufs(arquivo: str, dur: float):
    """Loudness integrada (LUFS) do áudio inteiro de um arquivo (só áudio, nice). None se não deu para medir."""
    try:
        r = subprocess.run(prefixo_nice() + ["ffmpeg", "-nostdin", "-hide_banner", "-i", arquivo, "-map", "0:a:0", "-vn",
                                             "-af", "ebur128=framelog=quiet", "-f", "null", "-"],
                           capture_output=True, text=True, timeout=max(300, dur * 4))
    except subprocess.TimeoutExpired:
        return None
    return ler_lufs(r.stderr)


def cmd_medir_volume(lista: str) -> list:
    """1ª passada (só o áudio dos pedaços juntos): loudness integrada (ebur128)."""
    return prefixo_nice() + ["ffmpeg", "-nostdin", "-hide_banner", "-f", "concat", "-safe", "0", "-i", lista, "-vn",
                             "-af", "ebur128=framelog=quiet", "-f", "null", "-"]


def ler_lufs(stderr: str):
    m = re.findall(r"I:\s*(-?[\d.]+) LUFS", stderr or "")
    try:
        v = float(m[-1]) if m else None
    except ValueError:
        return None
    return v if v is not None and -70.0 < v < 0.0 else None


def cmd_final(lista: str, ass: str | None, saida: str, lufs_medido=None) -> list:
    vf = [f"ass={esc_filtro(ass)}:fontsdir={esc_filtro(FONTES)}"] if ass else []
    vf.append("format=yuv420p")
    return prefixo_ffmpeg() + [
        "-f", "concat", "-safe", "0", "-i", lista,
        "-vf", ",".join(vf),
        "-af", filtro_volume_final(lufs_medido),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-maxrate", "8M", "-bufsize", "16M",
        "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p", "-r", str(FPS), "-g", str(FPS * 2),
        "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-c:a", "aac", "-b:a", "160k", "-ar", str(TAXA), "-ac", "2",
        "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", saida,
    ]


# ======================================================================== execução


class Falha(Exception):
    """Erro com texto que vai para a tela."""


_CHAMAR_IA = None   # None = a chamada real (edicao_ia.chamada_padrao); o arnês troca por uma IA falsa


class Projeto:
    def __init__(self, pasta: str):
        self.pasta = pasta
        self.inicio = time.time()

    def p(self, nome: str) -> str:
        return os.path.join(self.pasta, nome)

    def estado(self, **e):
        tmp = self.p("estado.json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({**e, "em": int(time.time())}, f, ensure_ascii=False)
        os.replace(tmp, self.p("estado.json"))

    def andamento(self, etapa: str, progresso: float):
        self.estado(estado="montando", etapa=etapa, progresso=round(min(0.99, max(0.0, progresso)), 3))

    def ff(self, cmd: list, teto: float, aoProgredir=None, dur_total: float = 0.0):
        """Roda o ffmpeg; erro vira Falha com a última linha do stderr."""
        if aoProgredir is None:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=teto, cwd=self.pasta)
            if r.returncode != 0:
                cauda = (r.stderr or "").strip().splitlines()
                raise Falha(f"o ffmpeg falhou ({cauda[-1][:200] if cauda else 'código ' + str(r.returncode)})")
            return r
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=self.pasta)
        limite = time.time() + teto
        ultimo = 0.0
        for linha in proc.stdout:
            if time.time() > limite:
                proc.kill()
                raise Falha("a exportação passou do tempo limite")
            if linha.startswith("out_time_us=") and dur_total > 0 and time.time() - ultimo > 2:
                try:
                    aoProgredir(int(linha.split("=", 1)[1]) / 1e6 / dur_total)
                    ultimo = time.time()
                except ValueError:
                    pass
        err = proc.stderr.read()
        proc.wait()
        if proc.returncode != 0:
            cauda = (err or "").strip().splitlines()
            raise Falha(f"o ffmpeg falhou ({cauda[-1][:200] if cauda else 'código ' + str(proc.returncode)})")


def detectar_silencios(proj: Projeto, reacao: str, dur: float) -> tuple:
    teto = max(300, dur * 4)
    r = subprocess.run(prefixo_nice() + ["ffmpeg", "-nostdin", "-hide_banner", "-i", reacao, "-map", "0:a:0", "-vn",
                                                "-af", "volumedetect", "-f", "null", "-"],
                       capture_output=True, text=True, timeout=teto)
    m = re.search(r"mean_volume:\s*(-?[\d.]+) dB", r.stderr or "")
    medio = float(m.group(1)) if m else None
    lim = limiar_silencio(medio)
    r = subprocess.run(prefixo_nice() + ["ffmpeg", "-nostdin", "-hide_banner", "-i", reacao, "-map", "0:a:0", "-vn",
                                                "-af", f"silencedetect=noise={lim:.1f}dB:d={MIN_SILENCIO}", "-f", "null", "-"],
                       capture_output=True, text=True, timeout=teto)
    return ler_silencedetect(r.stderr or "", dur), medio, lim


def juntar_wavs(arquivos: list, saida: str):
    with wave.open(saida, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(TAXA_VOZ)
        for a in arquivos:
            with wave.open(a, "rb") as w:
                out.writeframes(w.readframes(w.getnframes()))


def transcrever(proj: Projeto, wav: str, dur: float) -> tuple:
    """Whisper local (legendas.py no mesmo Python do serviço). Devolve (palavras, aviso)."""
    modelo = os.environ.get("REACT_WHISPER_MODELO", "")
    if not modelo or not os.path.exists(os.path.join(modelo, "model.bin")):
        return [], "legenda desligada: o modelo do Whisper não está instalado na VPS"
    saida = proj.p("palavras.json")
    cmd = prefixo_nice() + [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "legendas.py"), wav, saida,
            "--modelo", modelo, "--threads", THREADS]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=max(600, dur * 6))
    except subprocess.TimeoutExpired:
        return [], "legenda desligada: a transcrição passou do tempo limite"
    if r.returncode != 0 or not os.path.exists(saida):
        cauda = (r.stderr or "").strip().splitlines()
        return [], f"legenda desligada: a transcrição falhou ({cauda[-1][:160] if cauda else r.returncode})"
    with open(saida, encoding="utf-8") as f:
        return json.load(f).get("palavras", []), None


def _assinatura_gravacao(proj: Projeto) -> str:
    """Muda se a gravação dele for trocada (o plano da IA e as falas valem só para a mesma gravação)."""
    try:
        st = os.stat(proj.p("reacao.bin"))
        return f"{st.st_size}:{int(st.st_mtime)}"
    except OSError:
        return ""


def gravar_cache_ia(proj: Projeto, plano: dict, palavras: list, trechos: list):
    tmp = proj.p("ia_plano.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"gravacao": _assinatura_gravacao(proj), "plano": plano_para_json(plano), "palavras": palavras,
                   "trechos": [{k: t[k] for k in ("tipo", "ini", "fim", "orig")} for t in trechos]}, f, ensure_ascii=False)
    os.replace(tmp, proj.p("ia_plano.json"))


def ler_cache_ia(proj: Projeto):
    try:
        with open(proj.p("ia_plano.json"), encoding="utf-8") as f:
            c = json.load(f)
    except (OSError, ValueError):
        return None
    if c.get("gravacao") != _assinatura_gravacao(proj) or not isinstance(c.get("palavras"), list) or not c.get("trechos"):
        return None
    return c


def gerar_previas(proj: Projeto, original_n: str, reacao_n: str):
    """Cópias leves (640 px) para a tela de edição reabrir o projeto sem os arquivos do celular. Falhar aqui não
    derruba a montagem: a tela avisa que a prévia não está disponível."""
    for fonte, nome, cru in ((original_n, "previa_original.mp4", "original.bin"), (reacao_n, "previa_reacao.mp4", "reacao.bin")):
        destino = proj.p(nome)
        try:
            if os.path.exists(destino) and os.path.getmtime(destino) >= os.path.getmtime(proj.p(cru)):
                continue
            proj.ff(cmd_previa(fonte, destino + ".tmp.mp4"), 1800)
            os.replace(destino + ".tmp.mp4", destino)
        except (Falha, OSError, subprocess.TimeoutExpired) as e:
            sys.stderr.write(f"prévia {nome}: {e}\n")


def gravar_base_edicao(proj: Projeto, trechos: list, pecas: list, dur_r: float, dur_o: float, silencios: list,
                       detalhe_ia, titulo_ia: str, edicao):
    """edicao_base.json: o que a tela de edição precisa para mostrar os trechos e o que a IA fez em cada um.
    Removidos/tirados da IA vão como intervalos da gravação (a tela casa com trechos partidos depois)."""
    com_peca = {p["k"] for p in pecas}
    d = detalhe_ia or {}
    faixa = lambda ks: [[trechos[k]["ini"], trechos[k]["fim"]] for k in ks if 0 <= k < len(trechos)]  # noqa: E731
    base = {
        "v": 1,
        "gravacao": _assinatura_gravacao(proj),
        "dur_reacao": round(dur_r, 3),
        "dur_original": round(dur_o, 3),
        "trechos": trechos,
        "falas": falas_de_silencios(silencios, dur_r),
        "sem_fala": faixa([k for k, t in enumerate(trechos) if k not in com_peca and t.get("removido") is not True
                           and k not in d.get("removidos", []) and k not in d.get("tirados", [])]),
        "ia": {"aplicada": edicao is not None, "titulo": titulo_ia or "", "cortes": d.get("cortes", []),
               "removidos": faixa(d.get("removidos", [])), "tirados": faixa(d.get("tirados", [])), "gancho": d.get("gancho")},
        "em": int(time.time()),
    }
    tmp = proj.p("edicao_base.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(base, f, ensure_ascii=False)
    os.replace(tmp, proj.p("edicao_base.json"))


def montar(pasta: str) -> dict:
    proj = Projeto(pasta)
    with open(proj.p("pedido.json"), encoding="utf-8") as f:
        ok, ped = validar_pedido(json.load(f))
    if not ok:
        raise Falha(ped)
    original, reacao = proj.p("original.bin"), proj.p("reacao.bin")
    for arq, nome in ((original, "o vídeo original"), (reacao, "a sua gravação")):
        if not os.path.exists(arq):
            raise Falha(f"falta {nome} no servidor (envie de novo)")
    modelo = carregar_modelo(ped.get("modelo"))
    proj.andamento("preparando os vídeos", 0.01)
    so_cru, sr_cru = sondar(original), sondar(reacao)
    if not so_cru["video"]:
        raise Falha("não consegui ler o vídeo original (use MP4 ou MOV)")
    if not sr_cru["video"] or not sr_cru["audio"]:
        raise Falha("a sua gravação veio sem imagem ou sem som")
    original_cru, reacao_cru = original, reacao
    original, reacao = proj.p("original_n.mkv"), proj.p("reacao_n.mkv")
    teto_n = max(1800, (so_cru["duracao"] or 0) * 4, (sr_cru["duracao"] or 0) * 4)
    proj.ff(cmd_normalizar(original_cru, original, 1920, bool(so_cru["audio"])), teto_n)
    proj.andamento("preparando os vídeos", 0.025)
    proj.ff(cmd_normalizar(reacao_cru, reacao, 1280, True), teto_n)
    so, sr = sondar(original), sondar(reacao)
    if not so["duracao"] or not sr["duracao"]:
        raise Falha("não consegui medir a duração dos vídeos")
    dur_o, dur_r = so["duracao"], sr["duracao"]
    gerar_previas(proj, original, reacao)
    ganhos = ganhos_fontes(medir_lufs(reacao, dur_r), medir_lufs(original, dur_o) if so["audio"] else None)

    aviso_sinc = None
    ed = ped.get("edicao")
    if ped["modo"] == "separado" and not ped["trechos"]:
        proj.andamento("sincronizando pelo áudio", 0.02)
        import sincronia  # numpy, só no modo separado
        res = sincronia.detectar(original_cru, reacao_cru)
        if not res["trechos"]:
            raise Falha("não achei o som do original na sua gravação: grave com o original tocando em voz alta perto do celular")
        trechos = res["trechos"]
        aviso_sinc = res.get("aviso")
        with open(proj.p("sincronia.json"), "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False)
    else:
        trechos = ped["trechos"]
    trechos = normalizar_trechos(trechos, dur_r, dur_o)
    if not trechos:
        raise Falha("a linha do tempo ficou vazia")

    proj.andamento("procurando silêncios", 0.04)
    # sempre mede (é só o áudio): além do corte, as falas vão para a tela de edição ("pausar enquanto eu falo")
    silencios, vol_medio, limiar = detectar_silencios(proj, reacao, dur_r)
    if not ped["cortar_silencio"]:
        vol_medio, limiar = None, None
    geral = (ed or {}).get("volume_geral", 1.0)
    pecas = planejar(trechos, silencios if ped["cortar_silencio"] else [], ped["layout"], ped["cortar_silencio"], geral,
                     modelo["corte"])
    if not pecas:
        if any(t.get("removido") is True for t in trechos):
            raise Falha("nada para montar: todos os trechos foram removidos na edição")
        raise Falha("nada para montar: a gravação ficou toda em silêncio")

    # edição com IA: transcreve a gravação inteira antes, a IA decide, e os pedaços mudam antes de renderizar.
    # Com a tela de edição (ed), o plano da primeira montagem é reaproveitado: nada de chamar o Claude de novo.
    aviso_ia, edicao, uso_ia, palavras_ia, detalhe_ia, titulo_ia = None, None, None, None, None, ""
    if ped["ia"]:
        import edicao_ia
        cache = ler_cache_ia(proj) if ed is not None else None
        plano, palavras_r = None, None
        if cache:
            palavras_r = cache["palavras"]
            plano = remapear_plano(plano_de_json(cache["plano"]), cache["trechos"], trechos)
        else:
            proj.andamento("transcrevendo para a edição com IA", 0.045)
            wav = proj.p("voz_total.wav")
            proj.ff(prefixo_ffmpeg() + ["-i", reacao, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", str(TAXA_VOZ),
                                        "-c:a", "pcm_s16le", wav], max(300, dur_r * 4))
            palavras_r, aviso_t = transcrever(proj, wav, dur_r)
            if ped["modo"] == "separado":  # no separado o som do original vaza: só a fala dos comentários conta
                palavras_r = [w for w in palavras_r if any(t["tipo"] == "comentario" and t["ini"] <= (w["ini"] + w["fim"]) / 2 < t["fim"]
                                                           for t in trechos)]
            if aviso_t:
                aviso_ia = "edição com IA desligada: " + aviso_t.split(": ", 1)[-1]
            elif not palavras_r:
                aviso_ia = "edição com IA desligada: não achei fala na gravação"
            else:
                proj.andamento("editando com IA (Claude)", 0.07)
                try:
                    plano, uso_ia = edicao_ia.editar(palavras_r, trechos, ped["duracao_max"], sum(p["dur"] for p in pecas),
                                                     chamar=_CHAMAR_IA)
                    gravar_cache_ia(proj, plano, palavras_r, trechos)
                except edicao_ia.FalhaIA as e:
                    uso_ia = getattr(e, "custo", None)
                    aviso_ia = f"edição com IA desligada nesta montagem: {e}"
                    palavras_ia = palavras_r  # a transcrição já feita serve para a legenda
                if uso_ia and uso_ia.get("chamadas"):
                    edicao_ia.registrar_custo(os.path.dirname(os.path.abspath(proj.pasta)), os.path.basename(proj.pasta), uso_ia)
        if plano is not None:
            pecas, edicao = aplicar_edicao(pecas, trechos, palavras_r, plano, ped["duracao_max"],
                                           restaurados=(ed or {}).get("cortes_ia_restaurados", ()),
                                           sem_gancho=bool(ed) and not ed.get("ia_gancho", True))
            detalhe_ia = edicao.pop("detalhe", None)
            titulo_ia = edicao.get("titulo", "")
            if ed is not None and not ed.get("ia_titulo", True):
                edicao["titulo"] = ""
            edicao["reaproveitada"] = bool(cache)
            chaves = set(plano.get("chaves", []))
            palavras_ia = [{**w, "k": i in chaves} for i, w in enumerate(palavras_r)]
            if edicao["duracao_depois_seg"] > ped["duracao_max"] + 0.5:
                aviso_ia = (f"o vídeo ficou com {edicao['duracao_depois_seg']:.0f} s (máximo {ped['duracao_max']:.0f} s): "
                            "não deu para encurtar mais sem cortar a sua fala")
        if not pecas:
            raise Falha("a edição deixou o vídeo vazio")
    n_punch = punch_in(pecas, modelo["zoom"]["punch_in_seg"]) if modelo["zoom"].get("punch_in_seg") else 0
    pecas = linha_final(pecas)
    dur_final = round(sum(p["dur"] for p in pecas), 3)
    titulo = (edicao or {}).get("titulo", "")
    gancho_central = modelo["titulo"].get("estilo") == "gancho"
    pip_y = PIP_Y_COM_TITULO if titulo and not gancho_central else PIP_Y
    titulo_ate = None
    aviso_modelo = None
    if gancho_central:   # título de gancho: do quadro zero até o fim do 1º bloco, dentro dos limites do modelo
        lo, hi = modelo["titulo"].get("duracao_min") or 3.0, modelo["titulo"].get("duracao_max") or 5.0
        titulo_ate = round(max(lo, min(hi, pecas[0]["dur"] if pecas else hi)), 3)
        if not titulo:
            aviso_modelo = f"o modelo {modelo['nome']} abre com um título de gancho escrito pela Edição com IA: ligue a IA para ele aparecer"

    # quadros congelados (um por instante distinto do original e por tamanho: painel de cima ou tela toda)
    topos = {}

    def chave_topo(p):
        return f"{quadro(p['orig']):.3f}{'c' if precisa_cheio(p) else 't'}"

    for p in pecas:
        if p["tipo"] == "comentario":
            k = chave_topo(p)
            if k not in topos:
                cheio = precisa_cheio(p)
                topos[k] = proj.p(f"topo_{len(topos):03d}.png")
                t = min(quadro(p["orig"]), max(0.0, dur_o - 0.1))
                try:
                    proj.ff(cmd_topo_congelado(original, t, topos[k], cheio), 120)
                except Falha:
                    pass
                if not os.path.exists(topos[k]):  # fim do vídeo: pega o último quadro que existir
                    proj.ff(prefixo_ffmpeg() + ["-sseof", "-0.6", "-i", original, "-frames:v", "1", "-filter_complex",
                                                (filtro_cheio if cheio else filtro_topo)("0:v", "topo"), "-map", "[topo]",
                                                "-update", "1", topos[k]], 120)
    # pedaços
    feitos, vozes = [], []
    acumulado = 0.0
    for i, p in enumerate(pecas):
        proj.andamento(f"montando trecho {i + 1} de {len(pecas)}", 0.06 + 0.54 * (acumulado / dur_final))
        saida, voz = proj.p(f"peca_{i:04d}.mkv"), proj.p(f"voz_{i:04d}.wav")
        topo = topos.get(chave_topo(p)) if p["tipo"] == "comentario" else None
        proj.ff(cmd_peca(p, reacao, original, topo, bool(so["audio"]), saida, voz, pip_y, ganhos), max(300, p["dur"] * 30))
        feitos.append(saida)
        vozes.append(voz)
        acumulado += p["dur"]
    with open(proj.p("lista.txt"), "w", encoding="utf-8") as f:
        for a in feitos:
            f.write(f"file '{os.path.basename(a)}'\n")

    # legenda
    aviso_leg, grupos = None, []
    legenda_ligada = ped["legenda"] and modelo["legenda"].get("mostrar", True)
    if legenda_ligada:
        if palavras_ia is not None:  # a gravação já foi transcrita para a IA: só leva as palavras para o tempo final
            palavras = palavras_no_final(pecas, palavras_ia)
        else:
            proj.andamento("transcrevendo a sua fala", 0.62)
            juntar_wavs(vozes, proj.p("voz.wav"))
            palavras, aviso_leg = transcrever(proj, proj.p("voz.wav"), dur_final)
        if ped["modo"] == "separado":  # no separado o som do original vaza: legenda só onde ele comenta
            janelas = [(p["t0"], p["t0"] + p["dur"]) for p in pecas if p["tipo"] == "comentario"]
            palavras = [w for w in palavras if any(a <= (w["ini"] + w["fim"]) / 2 < b for a, b in janelas)]
        grupos = agrupar_palavras(palavras, modelo["legenda"])

        def y_em(t):
            for p in pecas:
                if p["t0"] <= t < p["t0"] + p["dur"]:
                    return Y_LEGENDA_CHEIA if p["cheia"] else Y_LEGENDA_DIVIDIDO
            return Y_LEGENDA_DIVIDIDO

    if grupos or titulo:
        with open(proj.p("legendas.ass"), "w", encoding="utf-8") as f:
            f.write(gerar_ass(grupos, lambda t: Y_LEGENDA_DIVIDIDO, titulo, dur_final, modelo, titulo_ate) if not legenda_ligada
                    else gerar_ass(grupos, y_em, titulo, dur_final, modelo, titulo_ate))

    # final
    proj.andamento("medindo o volume", 0.77)
    try:
        r_vol = subprocess.run(cmd_medir_volume("lista.txt"), capture_output=True, text=True, timeout=max(300, dur_final * 4), cwd=proj.pasta)
        lufs = ler_lufs(r_vol.stderr)
    except subprocess.TimeoutExpired:
        lufs = None
    proj.andamento("exportando o vídeo", 0.78)
    tmp = proj.p("final.tmp.mp4")
    proj.ff(cmd_final("lista.txt", "legendas.ass" if (grupos or titulo) else None, "final.tmp.mp4", lufs), max(900, dur_final * 30),
            aoProgredir=lambda x: proj.andamento("exportando o vídeo", 0.78 + 0.2 * x), dur_total=dur_final)
    info = sondar(tmp)
    v = info.get("video") or {}
    if v.get("codec") != "h264" or v.get("largura") != L or v.get("altura") != A or not info.get("audio"):
        raise Falha("o vídeo final não ficou no formato esperado (1080x1920 H.264 + AAC)")
    if abs((info["duracao"] or 0) - dur_final) > 0.5:
        raise Falha(f"o vídeo final ficou com {info['duracao']:.1f} s e o planejado era {dur_final:.1f} s")
    os.replace(tmp, proj.p("final.mp4"))
    subprocess.run(prefixo_ffmpeg() + ["-ss", f"{min(1.0, dur_final / 2):.2f}", "-i", proj.p("final.mp4"), "-frames:v", "1",
                                       "-vf", "scale=360:-2", "-q:v", "4", "-update", "1", proj.p("capa.jpg")],
                   capture_output=True, timeout=60)
    for a in feitos + vozes + list(topos.values()) + [proj.p("voz.wav"), proj.p("voz_total.wav"), proj.p("lista.txt"), original, reacao]:
        try:
            os.remove(a)
        except FileNotFoundError:
            pass
    n_coment = sum(1 for t in trechos if t["tipo"] == "comentario")
    gravar_base_edicao(proj, trechos, pecas, dur_r, dur_o, silencios, detalhe_ia, titulo_ia, edicao)
    return {
        "duracao_seg": round(info["duracao"], 2),
        "duracao_gravacao_seg": round(dur_r, 2),
        "segundos_cortados": round(max(0.0, dur_r - dur_final), 2),
        "pecas": len(pecas),
        "comentarios": n_coment,
        "legendas": len(grupos),
        "volume_medio_db": vol_medio,
        "limiar_silencio_db": limiar,
        "avisos": [a for a in (aviso_ia, aviso_leg, aviso_sinc, aviso_modelo) if a],
        "punch_in": n_punch,
        "titulo_ate_seg": titulo_ate,
        "ia": ({"ligada": True, "aplicada": edicao is not None, **(edicao or {}), "uso": uso_ia} if ped["ia"]
               else {"ligada": False}),
        "modelo": modelo["id"],
        "bytes": os.path.getsize(proj.p("final.mp4")),
        "segundos_montagem": round(time.time() - proj.inicio),
        "pecas_plano": pecas,
    }


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    pasta = sys.argv[1]
    proj = Projeto(pasta)
    try:
        res = montar(pasta)
        with open(proj.p("resultado.json"), "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False)
        proj.estado(estado="pronto", progresso=1.0, resultado={k: v for k, v in res.items() if k != "pecas_plano"})
        return 0
    except Falha as e:
        proj.estado(estado="erro", erro=str(e))
        return 1
    except subprocess.TimeoutExpired:
        proj.estado(estado="erro", erro="a montagem passou do tempo limite")
        return 1
    except Exception as e:  # nunca deixa o estado preso em "montando"
        sys.stderr.write(f"montagem: {type(e).__name__}: {e}\n")
        proj.estado(estado="erro", erro=f"erro interno na montagem ({type(e).__name__})")
        return 1


if __name__ == "__main__":
    sys.exit(main())
