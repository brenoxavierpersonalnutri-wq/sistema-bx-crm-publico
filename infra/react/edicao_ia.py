#!/usr/bin/env python3
"""headturbo-react: "Edição com IA" do Estúdio React (montagem.py chama depois da transcrição do Whisper).

O Claude da assinatura do Breno (`claude -p` como o usuário turbo, pelo ajudante ia_ponte.py) lê a transcrição dele (palavras numeradas, agrupadas por comentário) e devolve, em JSON validado:
  titulo            título curto e forte (até ~6 palavras), fixo no topo do vídeo
  palavras_chave    1 ou 2 palavras por frase que a legenda destaca
  gancho            trecho de 2 a 4 s com o melhor comentário, que abre o vídeo
  cortar            repetições, erros, "é... então...", começos falsos (faixas de palavras dentro de um comentário)
  remover           comentários inteiros que não agregam
  enfase            momentos de ênfase: a câmera dele dá um zoom
  notas             nota 1-5 de cada comentário (a duração alvo tira primeiro os de nota menor)
Este módulo só monta o pedido, chama e VALIDA: nenhum índice ou tempo da IA entra na montagem sem passar por aqui.
Quem converte em cortes de vídeo é montagem.py (aplicar_edicao).

Sem chave de API e sem custo por chamada: consome a cota da assinatura. O registro de uso (tokens de entrada e saída,
e o preço de lista que o Claude Code informa, só como referência) vai para o resultado do projeto e para
custos-ia.jsonl na pasta do serviço. Ajudante parado, login vencido, tempo esgotado ou resposta inválida: FalhaIA,
e a montagem segue sem IA, com aviso na tela. O OpenRouter existe só como reserva desligada (REACT_IA_OPENROUTER=1).
Só biblioteca padrão.
"""
import json
import os
import re
import time
import urllib.error
import urllib.request

TEMPO_CLAUDE = float(os.environ.get("REACT_IA_TEMPO", "120"))
MAX_PALAVRAS_IA = 4000          # gravação muito longa: a IA vê só as primeiras (o resto segue sem edição)
PAUSA_FRASE = 0.6               # pausa que separa frases (s)
MAX_ENFASE = 6
MAX_ENFASE_SEG = 3.5
TITULO_PALAVRAS = 7
TITULO_LETRAS = 48


class FalhaIA(Exception):
    """Erro com texto que vai para a tela (a montagem segue sem IA)."""


# ======================================================================== entrada (puro)


def montar_frases(palavras: list, trechos: list) -> list:
    """Palavras (tempo da gravação dele, já filtradas) -> frases dentro de cada trecho.

    frase = {"id", "trecho", "tipo", "de", "ate"} (de/ate = índices em `palavras`, inclusive).
    Quebra em pausa > PAUSA_FRASE, em ponto final/interrogação/exclamação e na troca de trecho.
    """
    def trecho_de(w):
        meio = (w["ini"] + w["fim"]) / 2
        for k, t in enumerate(trechos):
            if t["ini"] <= meio < t["fim"]:
                return k
        return None

    frases, atual = [], None
    for i, w in enumerate(palavras):
        k = trecho_de(w)
        if k is None:
            atual = None
            continue
        quebra = (atual is None or atual["trecho"] != k or w["ini"] - palavras[i - 1]["fim"] > PAUSA_FRASE
                  or re.search(r"[.!?…]$", palavras[i - 1]["w"].strip()))
        if quebra:
            atual = {"id": len(frases), "trecho": k, "tipo": trechos[k]["tipo"], "de": i, "ate": i}
            frases.append(atual)
        else:
            atual["ate"] = i
    return frases


def texto_prompt(palavras: list, frases: list, trechos: list, dur_max: float, dur_estimada: float) -> str:
    """A transcrição numerada que vai para a IA (só texto; nada de nome de arquivo, usuário ou segredo)."""
    linhas = [
        f"Duração estimada do vídeo montado: {dur_estimada:.0f} s. Duração máxima pedida: {dur_max:.0f} s.",
        "Transcrição da fala do criador, palavra por palavra, com o índice de cada palavra entre colchetes.",
        "",
    ]
    por_trecho: dict = {}
    for f in frases:
        por_trecho.setdefault(f["trecho"], []).append(f)
    for k in sorted(por_trecho):
        t = trechos[k]
        if t["tipo"] == "comentario":
            cab = f"COMENTÁRIO {k} (o vídeo original está pausado em {t['orig']:.1f} s; fala de {t['ini']:.1f} s a {t['fim']:.1f} s)"
        else:
            cab = f"FALA POR CIMA DO VÍDEO TOCANDO, trecho {k} (não pode ser cortada nem removida)"
        linhas.append(cab + ":")
        for f in por_trecho[k]:
            ws = " ".join(f"[{i}]{palavras[i]['w'].strip()}" for i in range(f["de"], f["ate"] + 1))
            linhas.append(f"  frase {f['id']} ({palavras[f['de']]['ini']:.1f}-{palavras[f['ate']]['fim']:.1f} s): {ws}")
        linhas.append("")
    return "\n".join(linhas)


SISTEMA = """Você é editor de vídeos curtos (Reels/TikTok) de react em português do Brasil. O criador assiste a um vídeo, \
pausa e comenta. Você recebe a transcrição numerada da fala dele e decide a edição. Responda SÓ com o JSON do esquema.

Regras:
- titulo: curto e forte, no máximo 6 palavras, em português, sem emoji, sem hashtag, sem aspas. É o gancho escrito que \
fica fixo no topo do vídeo. Use o assunto real da fala, nada inventado.
- palavras_chave: índices de 1 ou 2 palavras por frase que carregam o sentido (substantivo, número, verbo forte). \
Nunca artigo, preposição ou muleta.
- gancho: faixa de palavras (de, ate) de UM comentário, a frase mais forte/curiosa/polêmica, que dure de 2 a 4 \
segundos falada. Ela abre o vídeo antes do começo normal. Tem que fazer sentido sozinha.
- cortar: faixas de palavras a tirar DENTRO de comentários: repetições (ele disse a mesma coisa duas vezes: fica a \
melhor), erros e recomeços ("o agachamento, não, o levantamento"), muletas e enrolação ("é...", "então...", "tipo", \
"né", "assim", "enfim" quando não somam). Corte só o que deixa a frase igual ou melhor; nunca mude o sentido. Não \
corte fala por cima do vídeo tocando.
- remover: números dos COMENTÁRIOS inteiros que não agregam (vazios, sem conteúdo, repetem outro comentário).
- enfase: até 6 faixas curtas (1 a 3 s) nos momentos de ênfase da fala (a frase mais forte, o número, a virada). \
A câmera dele dá um zoom nelas. No máximo uma por comentário.
- notas: nota de 1 (fraco) a 5 (excelente) para cada COMENTÁRIO. Se a duração estimada passar da máxima, os de \
nota menor saem primeiro.
"""

ESQUEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["titulo", "palavras_chave", "gancho", "cortar", "remover", "enfase", "notas"],
    "properties": {
        "titulo": {"type": "string"},
        "palavras_chave": {"type": "array", "items": {"type": "integer"}},
        "gancho": {"type": "object", "additionalProperties": False, "required": ["de", "ate"],
                   "properties": {"de": {"type": "integer"}, "ate": {"type": "integer"}}},
        "cortar": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["de", "ate"],
                                               "properties": {"de": {"type": "integer"}, "ate": {"type": "integer"}}}},
        "remover": {"type": "array", "items": {"type": "integer"}},
        "enfase": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["de", "ate"],
                                               "properties": {"de": {"type": "integer"}, "ate": {"type": "integer"}}}},
        "notas": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["comentario", "nota"],
                                              "properties": {"comentario": {"type": "integer"}, "nota": {"type": "integer"}}}},
    },
}


# ======================================================================== saída (puro): nada da IA passa sem isto


def _faixa(x, n: int):
    try:
        de, ate = int(x["de"]), int(x["ate"])
    except (KeyError, TypeError, ValueError):
        return None
    if de > ate:
        de, ate = ate, de
    if de < 0 or ate >= n:
        return None
    return de, ate


def limpar_titulo(t) -> str:
    t = str(t or "")
    t = re.sub(r"[^\w\s!?.,:%$\-–—'’ÁÉÍÓÚÂÊÔÃÕÇÀáéíóúâêôãõçà]", "", t)   # sem emoji, aspas, hashtag
    t = re.sub(r"\s+", " ", t).strip(" .,:-–—")
    ws = t.split(" ")[:TITULO_PALAVRAS]
    while ws and len(" ".join(ws)) > TITULO_LETRAS:
        ws.pop()
    return " ".join(ws).upper()


def validar_resposta(r, palavras: list, frases: list, trechos: list) -> dict:
    """JSON da IA -> plano seguro. Índice fora da faixa, faixa atravessando comentário e excesso são descartados."""
    if not isinstance(r, dict):
        raise FalhaIA("a IA não devolveu um objeto JSON")
    n = len(palavras)
    trecho_da = {}
    frase_da = {}
    for f in frases:
        for i in range(f["de"], f["ate"] + 1):
            trecho_da[i] = f["trecho"]
            frase_da[i] = f["id"]
    comentarios = {k for k, t in enumerate(trechos) if t["tipo"] == "comentario"}

    def mesmo_comentario(de, ate):
        k = trecho_da.get(de)
        return k is not None and k in comentarios and all(trecho_da.get(i) == k for i in range(de, ate + 1))

    titulo = limpar_titulo(r.get("titulo"))

    chaves, por_frase = [], {}
    for i in r.get("palavras_chave") or []:
        try:
            i = int(i)
        except (TypeError, ValueError):
            continue
        if 0 <= i < n and i in frase_da and i not in chaves and len(re.sub(r"\W", "", palavras[i]["w"])) >= 2:
            f = frase_da[i]
            if por_frase.get(f, 0) < 2:
                por_frase[f] = por_frase.get(f, 0) + 1
                chaves.append(i)

    gancho = None
    g = _faixa(r.get("gancho") or {}, n)
    if g and mesmo_comentario(*g):
        gancho = g

    cortar = []
    for x in r.get("cortar") or []:
        c = _faixa(x, n)
        if c and mesmo_comentario(*c) and not (gancho and c[0] <= gancho[1] and gancho[0] <= c[1]):
            cortar.append(c)
    cortar.sort()

    remover = []
    for k in r.get("remover") or []:
        try:
            k = int(k)
        except (TypeError, ValueError):
            continue
        if k in comentarios and k not in remover and not (gancho and trecho_da.get(gancho[0]) == k):
            remover.append(k)
    if comentarios and set(remover) >= comentarios:     # nunca tira todos os comentários
        remover = remover[:-1]

    enfase, usados = [], set()
    for x in r.get("enfase") or []:
        e = _faixa(x, n)
        if not e or not mesmo_comentario(*e):
            continue
        k = trecho_da[e[0]]
        if k in usados or k in remover:
            continue
        de, ate = e
        while ate > de and palavras[ate]["fim"] - palavras[de]["ini"] > MAX_ENFASE_SEG:
            ate -= 1
        enfase.append((de, ate))
        usados.add(k)
        if len(enfase) >= MAX_ENFASE:
            break

    notas = {}
    for x in r.get("notas") or []:
        try:
            k, nota = int(x["comentario"]), int(x["nota"])
        except (KeyError, TypeError, ValueError):
            continue
        if k in comentarios:
            notas[k] = max(1, min(5, nota))
    return {"titulo": titulo, "chaves": chaves, "gancho": gancho, "cortar": cortar, "remover": remover,
            "enfase": enfase, "notas": notas}


def extrair_json(texto: str):
    """O conteúdo da mensagem -> objeto. Aceita cerca ```json e texto em volta (alguns modelos insistem)."""
    texto = (texto or "").strip()
    try:
        return json.loads(texto)
    except ValueError:
        pass
    m = re.search(r"\{.*\}", texto, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except ValueError:
            pass
    raise FalhaIA("a resposta da IA não era JSON")


# ======================================================================== chamada


SOCKET = os.environ.get("REACT_IA_SOCKET", "/run/headturbo-react-ia/ia.sock")
CONTEXTO = os.environ.get("REACT_IA_CONTEXTO", os.path.join(os.path.dirname(os.path.abspath(__file__)), "contexto-head.md"))


def contexto_head() -> str:
    """Resumo curto da doutrina de conteúdo do Breno (contexto-head.md, tirado das memórias do Head na VPS)."""
    try:
        with open(CONTEXTO, encoding="utf-8") as f:
            return f.read().strip()[:6000]
    except OSError:
        return ""


def sistema_completo() -> str:
    ctx = contexto_head()
    return SISTEMA + (("\nContexto do criador (doutrina de conteúdo dele; use para julgar o que é forte):\n" + ctx + "\n") if ctx else "")


def chamar_claude(sistema: str, usuario: str) -> dict:
    """Pede ao ajudante headturbo-react-ia (usuário turbo, `claude -p` da assinatura do Breno) pelo socket Unix.

    Protocolo: uma linha JSON {"sistema", "usuario", "esquema"} -> uma linha JSON {"ok", "saida"|"erro", uso...}.
    """
    import socket
    pedido = json.dumps({"sistema": sistema, "usuario": usuario, "esquema": ESQUEMA}, ensure_ascii=False).encode() + b"\n"
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(TEMPO_CLAUDE + 30)
    try:
        s.connect(SOCKET)
        s.sendall(pedido)
        s.shutdown(socket.SHUT_WR)
        buf = b""
        while True:
            b = s.recv(65536)
            if not b:
                break
            buf += b
            if len(buf) > 4 * 1024 * 1024:
                raise FalhaIA("resposta grande demais do ajudante da IA")
    except FalhaIA:
        raise
    except FileNotFoundError:
        raise FalhaIA("o ajudante da IA (headturbo-react-ia) não está rodando na VPS")
    except PermissionError:
        raise FalhaIA("sem permissão no socket do ajudante da IA")
    except Exception as e:
        raise FalhaIA(f"o ajudante da IA não respondeu ({type(e).__name__})")
    finally:
        s.close()
    try:
        r = json.loads(buf.decode("utf-8") or "{}")
    except ValueError:
        raise FalhaIA("o ajudante da IA devolveu algo que não é JSON")
    if not r.get("ok"):
        raise FalhaIA(str(r.get("erro") or "o Claude falhou")[:200])
    return {"conteudo": r.get("saida"), "modelo": r.get("modelo") or "claude (assinatura)",
            "tokens_entrada": int(r.get("tokens_entrada") or 0), "tokens_saida": int(r.get("tokens_saida") or 0),
            "custo_usd": 0.0, "custo_lista_usd": float(r.get("custo_lista_usd") or 0.0), "fonte": "claude-assinatura"}


# ---- reserva opcional, DESLIGADA por padrão: só com REACT_IA_OPENROUTER=1 e a credencial openrouter.key num drop-in
URL_OPENROUTER = os.environ.get("REACT_IA_URL", "https://openrouter.ai/api/v1/chat/completions")
MODELO_OPENROUTER = os.environ.get("REACT_IA_MODELO_OPENROUTER", "anthropic/claude-sonnet-5.5")


def ler_chave_openrouter() -> str:
    pasta = os.environ.get("CREDENTIALS_DIRECTORY", "/etc/headturbo-react")
    try:
        with open(os.path.join(pasta, "openrouter.key"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def chamar_openrouter(sistema: str, usuario: str, chave: str) -> dict:
    corpo = {
        "model": MODELO_OPENROUTER,
        "messages": [{"role": "system", "content": sistema}, {"role": "user", "content": usuario}],
        "temperature": 0.3, "max_tokens": 4000,
        "response_format": {"type": "json_schema", "json_schema": {"name": "edicao_react", "strict": True, "schema": ESQUEMA}},
        "usage": {"include": True},
    }
    req = urllib.request.Request(URL_OPENROUTER, data=json.dumps(corpo).encode(), method="POST", headers={
        "authorization": f"Bearer {chave}", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TEMPO_CLAUDE) as r:
            d = json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise FalhaIA(f"o OpenRouter recusou (HTTP {e.code})")
    except Exception as e:
        raise FalhaIA(f"o OpenRouter não respondeu ({type(e).__name__})")
    u = d.get("usage") or {}
    try:
        conteudo = d["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        conteudo = ""
    return {"conteudo": conteudo, "modelo": d.get("model") or MODELO_OPENROUTER, "fonte": "openrouter",
            "tokens_entrada": int(u.get("prompt_tokens") or 0), "tokens_saida": int(u.get("completion_tokens") or 0),
            "custo_usd": float(u.get("cost") or 0.0)}


def chamada_padrao():
    if os.environ.get("REACT_IA_OPENROUTER") == "1":
        chave = ler_chave_openrouter()
        if not chave:
            raise FalhaIA("REACT_IA_OPENROUTER=1, mas falta a credencial openrouter.key")
        return lambda s, u: chamar_openrouter(s, u, chave)
    return chamar_claude


def editar(palavras: list, trechos: list, dur_max: float, dur_estimada: float, chamar=None) -> tuple:
    """Transcrição + linha do tempo -> (plano validado, custo). `chamar` troca a chamada real (testes).

    custo = {"modelo", "chamadas", "tokens_entrada", "tokens_saida", "custo_usd", "segundos"}
    """
    palavras = palavras[:MAX_PALAVRAS_IA]
    frases = montar_frases(palavras, trechos)
    if not any(f["tipo"] == "comentario" for f in frases):
        raise FalhaIA("não achei fala sua nos comentários para a IA editar")
    usuario = texto_prompt(palavras, frases, trechos, dur_max, dur_estimada)
    if chamar is None:
        chamar = chamada_padrao()
    custo = {"modelo": "", "fonte": "", "chamadas": 0, "tokens_entrada": 0, "tokens_saida": 0, "custo_usd": 0.0,
             "custo_lista_usd": 0.0, "segundos": 0.0}
    inicio = time.time()
    ultimo_erro = None
    sistema = sistema_completo()
    for _ in range(1):  # 1 chamada por vídeo (cota da assinatura): resposta quebrada = monta sem IA
        try:
            r = chamar(sistema, usuario)
        except FalhaIA as e:
            ultimo_erro = e
            break
        custo["chamadas"] += 1
        custo["modelo"] = r.get("modelo") or custo["modelo"]
        custo["tokens_entrada"] += int(r.get("tokens_entrada") or 0)
        custo["tokens_saida"] += int(r.get("tokens_saida") or 0)
        custo["fonte"] = r.get("fonte") or custo["fonte"]
        custo["custo_usd"] = round(custo["custo_usd"] + float(r.get("custo_usd") or 0.0), 6)
        custo["custo_lista_usd"] = round(custo["custo_lista_usd"] + float(r.get("custo_lista_usd") or 0.0), 6)
        try:
            c = r.get("conteudo")
            plano = validar_resposta(c if isinstance(c, dict) else extrair_json(c or ""), palavras, frases, trechos)
            custo["segundos"] = round(time.time() - inicio, 1)
            return plano, custo
        except FalhaIA as e:
            ultimo_erro = e
    custo["segundos"] = round(time.time() - inicio, 1)
    err = ultimo_erro or FalhaIA("a IA falhou")
    err.custo = custo  # o que já foi gasto aparece mesmo na falha
    raise err


def registrar_custo(pasta_servico: str, projeto: str, custo: dict):
    """Uma linha por montagem com IA em <pasta do serviço>/custos-ia.jsonl (sem texto da fala, só números)."""
    try:
        with open(os.path.join(pasta_servico, "custos-ia.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps({"em": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "projeto": projeto,
                                **{k: custo.get(k) for k in ("modelo", "fonte", "chamadas", "tokens_entrada", "tokens_saida",
                                                             "custo_usd", "custo_lista_usd")}},
                               ensure_ascii=False) + "\n")
    except OSError:
        pass
