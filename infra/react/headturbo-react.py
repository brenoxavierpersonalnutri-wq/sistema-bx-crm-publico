#!/usr/bin/env python3
"""headturbo-react: Estúdio React do CRM (equipe.brenoxavier.com.br/conteudo/react) — upload e montagem na VPS.

O navegador sobe o vídeo original e a gravação dele em pedaços (retomável), manda a linha do tempo e este serviço
monta o react (montagem.py: ffmpeg + Whisper local), um por vez, com nice 19 e peso de CPU baixo. Nada de edge
function: o código vem do repositório (infra/react/publicar.sh) e o estado de cada projeto mora em disco.

Rotas (prefixo /react no Caddy; todas, menos /saude e /v1/arquivo, com o JWT do Supabase do CRM):
  GET    /saude                             {ok, fila, montando, whisper, assinatura, anon, ia, link}
  HEAD   /v1/up/<id>/<original|reacao>      -> X-Recebido (bytes já gravados: retomar)
  PUT    /v1/up/<id>/<original|reacao>      X-Offset: n, corpo = pedaço (<= 64 MB) -> X-Recebido
  POST   /v1/fim/<id>/<original|reacao>     fecha o arquivo e mede (ffprobe) -> {duracao_seg, video, audio, bytes}
  POST   /v1/montar/<id>                    corpo = pedido (montagem.validar_pedido) -> 202 {estado: "na_fila"}
  GET    /v1/estado/<id>                    {estado, etapa, progresso, erro, resultado, arquivo, baixar, capa}
  GET    /v1/arquivo/<id>/<final.mp4|capa.jpg|original.mp4|previa_original.mp4|previa_reacao.mp4>?t=<assinatura>
                                            (com Range; ?baixar=1 = anexo)
  GET    /v1/modelos                        modelos de edição para o seletor (aberto: só nomes)
  GET    /v1/edicao/<id>                    tela de edição: {base, salva, falas, previas, link}
  PUT    /v1/edicao/<id>                    corpo = {trechos, edicao} -> edicao.json (as escolhas dele, para reabrir)
  POST   /v1/link/<id>                      corpo = {url} -> baixa o original pelo link (baixar_link.py, yt-dlp)
  GET    /v1/link/<id>                      {estado, progresso, etapa, erro, autor, url, arquivo}
  DELETE /v1/projeto/<id>                   cancela e apaga tudo do projeto

Quem pode: usuário aprovado com acesso ao Conteúdo (RPC conteudo_meu_acesso, a mesma do infra/zernio) E que
enxerga a linha do projeto em conteudo_reacts (RLS). O endereço do vídeo pronto é assinado (HMAC, 6 h) porque a
tag <video> não manda cabeçalho de autorização.

Segredos chegam como credenciais do systemd ($CREDENTIALS_DIRECTORY): anon.key (pública, do site) e url.secret.
Nada aqui loga token. Só biblioteca padrão (o Whisper e o numpy são usados pelos subprocessos).
"""
import contextlib
import fcntl
import hashlib
import hmac
import importlib.util
import json
import os
import queue
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import montagem  # noqa: E402

PASTA = os.environ.get("REACT_PASTA", "/var/lib/headturbo-react")
ENDERECO = os.environ.get("REACT_ENDERECO", "172.18.0.1")
PORTA = int(os.environ.get("REACT_PORTA", "7892"))
SUPABASE = os.environ.get("REACT_SUPABASE_URL", "https://SEU_PROJECT_REF.supabase.co").rstrip("/")
CRED = os.environ.get("CREDENTIALS_DIRECTORY", "/etc/headturbo-react")
ORIGENS = {o.strip() for o in os.environ.get("REACT_ORIGENS", "https://equipe.brenoxavier.com.br").split(",") if o.strip()}
MAX_PEDACO = 64 * 1024 * 1024
MAX_ARQUIVO = int(os.environ.get("REACT_MAX_BYTES", str(2 * 1024 ** 3)))   # 2 GB por arquivo
FOLGA_DISCO = int(os.environ.get("REACT_FOLGA_DISCO", str(8 * 1024 ** 3)))  # recusa upload se sobrar menos
DIAS_GUARDA = float(os.environ.get("REACT_DIAS", "15"))
TEMPO_PEDACO = 120
VALIDADE_URL = 6 * 3600
TETO_MONTAGEM = int(os.environ.get("REACT_TETO_MONTAGEM", str(3 * 3600)))
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
R_UP = re.compile(rf"^/v1/(up|fim)/({UUID})/(original|reacao)$")
R_MONTAR = re.compile(rf"^/v1/montar/({UUID})$")
R_ESTADO = re.compile(rf"^/v1/estado/({UUID})$")
R_ARQ = re.compile(rf"^/v1/arquivo/({UUID})/(final\.mp4|capa\.jpg|original\.mp4|previa_original\.mp4|previa_reacao\.mp4)$")
R_EDICAO = re.compile(rf"^/v1/edicao/({UUID})$")
R_LINK = re.compile(rf"^/v1/link/({UUID})$")
ARQ_DISCO = {"original.mp4": "original.bin"}   # nome na URL -> arquivo na pasta
MAX_CORPO = 512 * 1024
R_PROJ = re.compile(rf"^/v1/projeto/({UUID})$")


def log(*partes):
    sys.stderr.write(" ".join(str(p) for p in partes) + "\n")


def cred(nome: str) -> str:
    try:
        with open(os.path.join(CRED, nome), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def pasta_de(pid: str) -> str:
    return os.path.join(PASTA, pid)


def ler_json(caminho: str):
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def gravar_estado(pid: str, **e):
    p = os.path.join(pasta_de(pid), "estado.json")
    tmp = p + ".srv.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({**e, "em": int(time.time())}, f, ensure_ascii=False)
    os.replace(tmp, p)


@contextlib.contextmanager
def trava(pid: str):
    os.makedirs(pasta_de(pid), exist_ok=True)
    fd = os.open(os.path.join(pasta_de(pid), ".lock"), os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


# ------------------------------------------------------------------ endereço assinado do vídeo pronto


def assinar(pid: str, nome: str, exp: int | None = None) -> str:
    exp = int(time.time()) + VALIDADE_URL if exp is None else exp
    sig = hmac.new(cred("url.secret").encode(), f"{pid}/{nome}/{exp}".encode(), hashlib.sha256).hexdigest()[:40]
    return f"{exp}.{sig}"


def assinatura_ok(pid: str, nome: str, t: str) -> bool:
    if not cred("url.secret"):
        return False
    m = re.match(r"^(\d{9,11})\.([0-9a-f]{40})$", t or "")
    if not m or int(m.group(1)) < time.time():
        return False
    return hmac.compare_digest(assinar(pid, nome, int(m.group(1))).split(".", 1)[1], m.group(2))


# ------------------------------------------------------------------ Supabase (com o JWT do usuário)


def supa(caminho: str, token: str, metodo: str = "GET", corpo=None):
    anon = cred("anon.key")
    req = urllib.request.Request(f"{SUPABASE}{caminho}", method=metodo,
                                 data=None if corpo is None else json.dumps(corpo).encode(),
                                 headers={"apikey": anon, "authorization": f"Bearer {token}", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"null")
        except ValueError:
            return e.code, None
    except Exception:
        return 0, None


class Negado(Exception):
    def __init__(self, status: int, msg: str):
        super().__init__(msg)
        self.status, self.msg = status, msg


_cache_auth: dict = {}
_cache_proj: dict = {}
_mx_cache = threading.Lock()


def autenticar(auth_header: str, pid: str | None) -> str:
    """Devolve o uid. Confere sessão, acesso ao Conteúdo e (com pid) se a pessoa enxerga o projeto."""
    m = re.match(r"^Bearer ([A-Za-z0-9._-]{20,4096})$", auth_header or "")
    if not m:
        raise Negado(401, "faça login no CRM")
    token = m.group(1)
    k = hashlib.sha256(token.encode()).hexdigest()
    agora = time.time()
    with _mx_cache:
        c = _cache_auth.get(k)
    if not c or c["ate"] < agora:
        st, u = supa("/auth/v1/user", token)
        if st != 200 or not isinstance(u, dict) or not re.fullmatch(UUID, str(u.get("id", ""))):
            raise Negado(401, "sessão expirada: entre de novo no CRM")
        st, a = supa("/rest/v1/rpc/conteudo_meu_acesso", token, "POST", {})
        if st != 200 or not isinstance(a, dict):
            raise Negado(503, "não consegui conferir seu acesso (a migration do Conteúdo foi aplicada?)")
        if not a.get("aprovado"):
            raise Negado(403, "seu usuário ainda não foi aprovado")
        if not a.get("conteudo"):
            raise Negado(403, "seu usuário não tem acesso ao Conteúdo (peça ao admin o módulo Conteúdo)")
        c = {"uid": u["id"], "ate": agora + 60}
        with _mx_cache:
            if len(_cache_auth) > 500:
                _cache_auth.clear()
            _cache_auth[k] = c
    if pid:
        kp = f"{k}:{pid}"
        with _mx_cache:
            ok = _cache_proj.get(kp, 0) > agora
        if not ok:
            st, linhas = supa(f"/rest/v1/conteudo_reacts?id=eq.{pid}&select=id", token)
            if st != 200:
                raise Negado(503, "não consegui ler o projeto (a migration conteudo_reacts foi aplicada?)")
            if not isinstance(linhas, list) or len(linhas) != 1:
                raise Negado(404, "projeto não encontrado")
            with _mx_cache:
                if len(_cache_proj) > 2000:
                    _cache_proj.clear()
                _cache_proj[kp] = agora + 600
    return c["uid"]


# ------------------------------------------------------------------ fila de montagem (um por vez)


class Fila:
    def __init__(self):
        self.q: queue.Queue = queue.Queue()
        self.na_fila: set = set()
        self.atual: str | None = None
        self.proc: subprocess.Popen | None = None
        self.mx = threading.Lock()

    def ocupado(self, pid: str) -> bool:
        with self.mx:
            return pid in self.na_fila or pid == self.atual

    def tamanho(self) -> int:
        with self.mx:
            return len(self.na_fila) + (1 if self.atual else 0)

    def enfileirar(self, pid: str):
        with self.mx:
            if pid in self.na_fila or pid == self.atual:
                return
            self.na_fila.add(pid)
        self.q.put(pid)

    def cancelar(self, pid: str):
        with self.mx:
            self.na_fila.discard(pid)
            if self.atual == pid and self.proc and self.proc.poll() is None:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(self.proc.pid, signal.SIGKILL)

    def retomar(self):
        """No boot: o que estava na fila ou montando volta pra fila."""
        if not os.path.isdir(PASTA):
            return
        for nome in sorted(os.listdir(PASTA)):
            if not re.fullmatch(UUID, nome):
                continue
            e = ler_json(os.path.join(pasta_de(nome), "estado.json")) or {}
            if e.get("estado") in ("na_fila", "montando"):
                gravar_estado(nome, estado="na_fila", progresso=0, etapa="na fila (o servidor reiniciou)")
                self.enfileirar(nome)

    def rodar(self):
        while True:
            pid = self.q.get()
            with self.mx:
                if pid not in self.na_fila:
                    continue
                self.na_fila.discard(pid)
                self.atual = pid
            try:
                self.montar(pid)
            except Exception as e:  # nunca derruba o worker
                log(f"montagem {pid}: {type(e).__name__}: {e}")
                with contextlib.suppress(Exception):
                    gravar_estado(pid, estado="erro", erro="erro interno na montagem")
            finally:
                with self.mx:
                    self.atual, self.proc = None, None

    def montar(self, pid: str):
        pasta = pasta_de(pid)
        if not os.path.isdir(pasta):
            return
        gravar_estado(pid, estado="montando", etapa="começando", progresso=0)
        inicio = time.time()
        log(f"montagem {pid}: começou")
        with open(os.path.join(pasta, "montagem.log"), "wb") as lg:
            proc = subprocess.Popen(montagem.prefixo_nice() + [sys.executable, os.path.join(AQUI, "montagem.py"), pasta],
                                    stdout=lg, stderr=lg, start_new_session=True)
            with self.mx:
                self.proc = proc
            try:
                proc.wait(timeout=TETO_MONTAGEM)
            except subprocess.TimeoutExpired:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
                gravar_estado(pid, estado="erro", erro="a montagem passou do tempo limite")
        if not os.path.isdir(pasta):  # apagado no meio
            return
        e = ler_json(os.path.join(pasta, "estado.json")) or {}
        if e.get("estado") not in ("pronto", "erro"):
            gravar_estado(pid, estado="erro", erro=f"a montagem parou no meio (código {proc.returncode})")
        log(f"montagem {pid}: {(ler_json(os.path.join(pasta, 'estado.json')) or {}).get('estado')} em {time.time() - inicio:.0f} s")


FILA = Fila()


class Baixador:
    """Download do original por link: um por vez (subprocesso baixar_link.py com nice 19), estado em link.json."""

    def __init__(self):
        self.mx = threading.Lock()
        self.vez = threading.Semaphore(1)
        self.ativos: set = set()

    def ocupado(self, pid: str) -> bool:
        with self.mx:
            return pid in self.ativos

    def comecar(self, pid: str, url: str) -> bool:
        with self.mx:
            if pid in self.ativos:
                return False
            self.ativos.add(pid)
        threading.Thread(target=self._rodar, args=(pid, url), name=f"link-{pid[:8]}", daemon=True).start()
        return True

    def _rodar(self, pid: str, url: str):
        try:
            with self.vez:
                pasta = pasta_de(pid)
                if not os.path.isdir(pasta):
                    return
                with open(os.path.join(pasta, "link.log"), "wb") as lg:
                    proc = subprocess.Popen(montagem.prefixo_nice() + [sys.executable, os.path.join(AQUI, "baixar_link.py"), pasta, url],
                                            stdout=lg, stderr=lg, start_new_session=True)
                    try:
                        proc.wait(timeout=600)
                    except subprocess.TimeoutExpired:
                        with contextlib.suppress(ProcessLookupError):
                            os.killpg(proc.pid, signal.SIGKILL)
                        proc.wait()
                e = ler_json(os.path.join(pasta, "link.json")) or {}
                if e.get("estado") not in ("pronto", "erro"):
                    gravar_link(pid, {**e, "estado": "erro", "erro": "o download parou no meio. Baixe o vídeo no celular e use \"Escolher vídeo\"."})
                log(f"link {pid}: {(ler_json(os.path.join(pasta, 'link.json')) or {}).get('estado')}")
        except Exception as e:
            log(f"link {pid}: {type(e).__name__}: {e}")
        finally:
            with self.mx:
                self.ativos.discard(pid)


BAIXADOR = Baixador()


def gravar_link(pid: str, e: dict):
    p = os.path.join(pasta_de(pid), "link.json")
    with open(p + ".srv.tmp", "w", encoding="utf-8") as f:
        json.dump({**e, "em": int(time.time())}, f, ensure_ascii=False)
    os.replace(p + ".srv.tmp", p)


def falas_do_projeto(pid: str):
    """Intervalos em que ele fala na gravação (para "pausar enquanto eu falo"). Da última montagem, ou medidos agora
    (só o áudio, nice) e guardados em falas.json até a gravação mudar."""
    pasta = pasta_de(pid)
    reacao = os.path.join(pasta, "reacao.bin")
    if not os.path.exists(reacao):
        return None
    proj = montagem.Projeto(pasta)
    assin = montagem._assinatura_gravacao(proj)
    for nome in ("edicao_base.json", "falas.json"):
        j = ler_json(os.path.join(pasta, nome)) or {}
        if j.get("gravacao") == assin and isinstance(j.get("falas"), list):
            return j["falas"]
    try:
        dur = montagem.sondar(reacao)["duracao"] or 3600.0
        sil, _, _ = montagem.detectar_silencios(proj, reacao, dur)
        falas = montagem.falas_de_silencios(sil, dur)
    except Exception as e:
        log(f"falas {pid}: {type(e).__name__}: {e}")
        return None
    with contextlib.suppress(OSError):
        with open(os.path.join(pasta, "falas.json.tmp"), "w", encoding="utf-8") as f:
            json.dump({"gravacao": assin, "falas": falas}, f)
        os.replace(os.path.join(pasta, "falas.json.tmp"), os.path.join(pasta, "falas.json"))
    return falas


def gravar_edicao(pid: str, trechos: list, edicao: dict | None):
    p = os.path.join(pasta_de(pid), "edicao.json")
    with open(p + ".tmp", "w", encoding="utf-8") as f:
        json.dump({"trechos": trechos, "edicao": edicao or {}, "salvo_em": int(time.time())}, f, ensure_ascii=False)
    os.replace(p + ".tmp", p)


def faxina():
    """De hora em hora: apaga projetos sem mexida há DIAS_GUARDA dias e uploads pela metade com mais de 2 dias."""
    while True:
        try:
            agora = time.time()
            for nome in os.listdir(PASTA):
                p = pasta_de(nome)
                if not re.fullmatch(UUID, nome) or not os.path.isdir(p) or FILA.ocupado(nome):
                    continue
                mt = max((os.path.getmtime(os.path.join(p, f)) for f in os.listdir(p)), default=os.path.getmtime(p))
                if agora - mt > DIAS_GUARDA * 86400:
                    shutil.rmtree(p, ignore_errors=True)
                    log(f"faxina: {nome} apagado ({DIAS_GUARDA:g} dias sem uso)")
                    continue
                for f in os.listdir(p):
                    if f.endswith(".part") and agora - os.path.getmtime(os.path.join(p, f)) > 2 * 86400:
                        with contextlib.suppress(FileNotFoundError):
                            os.remove(os.path.join(p, f))
        except Exception as e:
            log(f"faxina: {type(e).__name__}: {e}")
        time.sleep(3600)


# ------------------------------------------------------------------ HTTP


class React(BaseHTTPRequestHandler):
    server_version = "headturbo-react"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # sem query string (assinatura) no log
        sys.stderr.write(f"{self.command} {self.path.split('?', 1)[0]} {args[1] if len(args) > 1 else ''}\n")

    def cors(self):
        origem = self.headers.get("Origin", "")
        if origem in ORIGENS or re.match(r"^https://[a-z0-9-]+\.lovable\.app$", origem or ""):
            self.send_header("Access-Control-Allow-Origin", origem)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "authorization, content-type, x-offset")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, PUT, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Expose-Headers", "X-Recebido, X-Completo, Content-Range, Content-Length")
            self.send_header("Access-Control-Max-Age", "600")

    def resposta(self, status: int, corpo=None, extra: dict | None = None):
        dados = b"" if corpo is None else json.dumps(corpo, ensure_ascii=False).encode()
        self.send_response(status)
        self.cors()
        for k, v in (extra or {}).items():
            self.send_header(k, str(v))
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(dados)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if dados and self.command != "HEAD":
            self.wfile.write(dados)

    def descartar_corpo(self):
        n = int(self.headers.get("Content-Length") or 0)
        while n > 0:
            b = self.rfile.read(min(n, 1 << 20))
            if not b:
                break
            n -= len(b)

    def caminho(self) -> tuple:
        c, _, q = self.path.partition("?")
        params = dict(p.split("=", 1) for p in q.split("&") if "=" in p)
        return c, params

    def quem(self, pid: str | None):
        return autenticar(self.headers.get("Authorization", ""), pid)

    # ---------------------------------------------------------------- métodos
    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        c, _ = self.caminho()
        m = R_UP.match(c)
        if not m or m.group(1) != "up":
            return self.resposta(404)
        try:
            self.quem(m.group(2))
        except Negado as e:
            return self.resposta(e.status)
        pid, arq = m.group(2), m.group(3)
        final, part = os.path.join(pasta_de(pid), f"{arq}.bin"), os.path.join(pasta_de(pid), f"{arq}.part")
        if os.path.exists(final):
            return self.resposta(200, None, {"X-Recebido": os.path.getsize(final), "X-Completo": "1"})
        return self.resposta(200, None, {"X-Recebido": os.path.getsize(part) if os.path.exists(part) else 0})

    def ler_corpo_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_CORPO:
            self.descartar_corpo()
            return None, (413 if n > 0 else 400, "pedido vazio ou grande demais")
        try:
            return json.loads(self.rfile.read(n).decode("utf-8")), None
        except (ValueError, UnicodeDecodeError):
            return None, (400, "pedido não é JSON")

    def put_edicao(self, pid: str):
        try:
            self.quem(pid)
        except Negado as e:
            self.descartar_corpo()
            return self.resposta(e.status, {"erro": e.msg})
        corpo, erro = self.ler_corpo_json()
        if erro:
            return self.resposta(erro[0], {"erro": erro[1]})
        if not isinstance(corpo, dict):
            return self.resposta(400, {"erro": "pedido inválido"})
        ok, limpo = montagem.validar_pedido({"modo": "aqui", "trechos": corpo.get("trechos"), "edicao": corpo.get("edicao") or {}})
        if not ok:
            return self.resposta(400, {"erro": limpo})
        with trava(pid):
            gravar_edicao(pid, limpo["trechos"], limpo.get("edicao"))
        return self.resposta(200, {"ok": True, "trechos": len(limpo["trechos"])})

    def do_PUT(self):
        c, _ = self.caminho()
        me = R_EDICAO.match(c)
        if me:
            return self.put_edicao(me.group(1))
        m = R_UP.match(c)
        if not m or m.group(1) != "up":
            self.descartar_corpo()
            return self.resposta(404, {"erro": "rota inexistente"})
        try:
            self.quem(m.group(2))
        except Negado as e:
            self.descartar_corpo()
            return self.resposta(e.status, {"erro": e.msg})
        pid, arq = m.group(2), m.group(3)
        self.connection.settimeout(TEMPO_PEDACO)
        if FILA.ocupado(pid):
            self.descartar_corpo()
            return self.resposta(409, {"erro": "este react está sendo montado; espere terminar"})
        if arq == "original" and BAIXADOR.ocupado(pid):
            self.descartar_corpo()
            return self.resposta(409, {"erro": "o vídeo original está baixando pelo link; espere ou comece outro react"})
        with trava(pid):
            return self.gravar_pedaco(pid, arq)

    def gravar_pedaco(self, pid: str, arq: str):
        pasta = pasta_de(pid)
        part, final = os.path.join(pasta, f"{arq}.part"), os.path.join(pasta, f"{arq}.bin")
        tam = int(self.headers.get("Content-Length") or -1)
        try:
            offset = int(self.headers.get("X-Offset", "-1"))
        except ValueError:
            offset = -1
        if offset == 0 and os.path.exists(final):  # mandando de novo do zero: troca o arquivo
            os.remove(final)
        if os.path.exists(final):
            self.descartar_corpo()
            return self.resposta(409, {"erro": "já recebido"}, {"X-Recebido": os.path.getsize(final), "X-Completo": "1"})
        atual = os.path.getsize(part) if os.path.exists(part) else 0
        if offset == 0 and atual:
            os.remove(part)
            atual = 0
        if tam <= 0 or tam > MAX_PEDACO:
            self.descartar_corpo()
            return self.resposta(413, {"erro": "pedaço inválido"}, {"X-Recebido": atual})
        if offset != atual:
            self.descartar_corpo()
            return self.resposta(409, {"erro": "offset", "recebido": atual}, {"X-Recebido": atual})
        if atual + tam > MAX_ARQUIVO:
            self.descartar_corpo()
            return self.resposta(413, {"erro": f"arquivo acima de {MAX_ARQUIVO // 1024 ** 3} GB"}, {"X-Recebido": atual})
        if shutil.disk_usage(PASTA).free - tam < FOLGA_DISCO:
            self.descartar_corpo()
            return self.resposta(507, {"erro": "disco da VPS quase cheio"}, {"X-Recebido": atual})
        lidos = 0
        try:
            with open(part, "ab") as f:
                while lidos < tam:
                    b = self.rfile.read(min(tam - lidos, 1 << 20))
                    if not b:
                        break
                    f.write(b)
                    lidos += len(b)
        except OSError:
            pass
        finally:
            if lidos != tam:  # caiu no meio: corta a metade, o navegador refaz o pedaço
                with open(part, "ab") as f:
                    f.truncate(atual)
        if lidos != tam:
            self.close_connection = True
            return self.resposta(400, {"erro": "pedaço incompleto"}, {"X-Recebido": atual})
        return self.resposta(200, {"recebido": atual + tam}, {"X-Recebido": atual + tam})

    def post_link(self, pid: str):
        try:
            self.quem(pid)
        except Negado as e:
            self.descartar_corpo()
            return self.resposta(e.status, {"erro": e.msg})
        corpo, erro = self.ler_corpo_json()
        if erro:
            return self.resposta(erro[0], {"erro": erro[1]})
        import baixar_link
        ok, url, plat = baixar_link.validar_url((corpo or {}).get("url") if isinstance(corpo, dict) else None)
        if not ok:
            return self.resposta(400, {"erro": url})
        if FILA.ocupado(pid):
            return self.resposta(409, {"erro": "este react está sendo montado; espere terminar"})
        if shutil.disk_usage(PASTA).free < FOLGA_DISCO:
            return self.resposta(507, {"erro": "disco da VPS quase cheio"})
        with trava(pid):
            if BAIXADOR.ocupado(pid):
                return self.resposta(409, {"erro": "já estou baixando um vídeo para este react"})
            gravar_link(pid, {"estado": "baixando", "progresso": 0, "etapa": "na fila do download", "url": url, "plataforma": plat})
            BAIXADOR.comecar(pid, url)
        log(f"link {pid}: {plat}")
        return self.resposta(202, {"estado": "baixando", "url": url, "plataforma": plat})

    def do_POST(self):
        c, _ = self.caminho()
        ml = R_LINK.match(c)
        if ml:
            return self.post_link(ml.group(1))
        m_up, m_mon = R_UP.match(c), R_MONTAR.match(c)
        pid = m_up.group(2) if m_up else (m_mon.group(1) if m_mon else None)
        if not pid or (m_up and m_up.group(1) != "fim"):
            self.descartar_corpo()
            return self.resposta(404, {"erro": "rota inexistente"})
        try:
            self.quem(pid)
        except Negado as e:
            self.descartar_corpo()
            return self.resposta(e.status, {"erro": e.msg})
        if m_up:
            self.descartar_corpo()
            with trava(pid):
                return self.fechar(pid, m_up.group(3))
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 512 * 1024:
            self.descartar_corpo()
            return self.resposta(413 if n > 0 else 400, {"erro": "pedido vazio ou grande demais"})
        try:
            pedido = json.loads(self.rfile.read(n).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self.resposta(400, {"erro": "pedido não é JSON"})
        ok, limpo = montagem.validar_pedido(pedido)
        if not ok:
            return self.resposta(400, {"erro": limpo})
        with trava(pid):
            pasta = pasta_de(pid)
            for arq, nome in (("original", "o vídeo original"), ("reacao", "a sua gravação")):
                if not os.path.exists(os.path.join(pasta, f"{arq}.bin")):
                    return self.resposta(409, {"erro": f"falta enviar {nome}"})
            if FILA.ocupado(pid):
                return self.resposta(409, {"erro": "este react já está na fila"})
            if BAIXADOR.ocupado(pid):
                return self.resposta(409, {"erro": "o vídeo original ainda está baixando"})
            with open(os.path.join(pasta, "pedido.json"), "w", encoding="utf-8") as f:
                json.dump(limpo, f, ensure_ascii=False)
            if limpo.get("edicao") is not None:   # montar com as escolhas da tela = também salvar
                gravar_edicao(pid, limpo["trechos"], limpo["edicao"])
            for velho in ("final.mp4", "capa.jpg", "resultado.json"):
                with contextlib.suppress(FileNotFoundError):
                    os.remove(os.path.join(pasta, velho))
            gravar_estado(pid, estado="na_fila", progresso=0, etapa="na fila")
            FILA.enfileirar(pid)
        log(f"montar {pid}: na fila ({limpo['modo']}, {limpo['layout']}, {len(limpo['trechos'])} trechos, "
            f"ia={'sim' if limpo['ia'] else 'não'}, máx {limpo['duracao_max']:.0f} s)")
        return self.resposta(202, {"estado": "na_fila", "fila": FILA.tamanho()})

    def fechar(self, pid: str, arq: str):
        pasta = pasta_de(pid)
        part, final = os.path.join(pasta, f"{arq}.part"), os.path.join(pasta, f"{arq}.bin")
        if not os.path.exists(final):
            if not os.path.exists(part) or os.path.getsize(part) == 0:
                return self.resposta(404, {"erro": "nada recebido"})
            os.replace(part, final)
        try:
            info = montagem.sondar(final)
        except Exception:
            info = {"duracao": None, "video": None, "audio": None}
        if not info["video"]:  # sem duração é normal: o WebM do Chrome não grava duração nem índice
            os.remove(final)
            return self.resposta(422, {"erro": "não é um vídeo que o servidor consiga ler (use MP4, MOV ou WEBM)"})
        if arq == "reacao" and not info["audio"]:
            os.remove(final)
            return self.resposta(422, {"erro": "a gravação chegou sem som (confira o microfone e grave de novo)"})
        return self.resposta(200, {"ok": True, "bytes": os.path.getsize(final), "duracao_seg": round(info["duracao"], 2) if info["duracao"] else None,
                                   "video": info["video"], "audio": bool(info["audio"])})

    def do_GET(self):
        c, q = self.caminho()
        if c == "/saude":
            modelo = os.environ.get("REACT_WHISPER_MODELO", "")
            return self.resposta(200, {"ok": True, "fila": FILA.tamanho(), "montando": bool(FILA.atual),
                                       "whisper": bool(modelo and os.path.exists(os.path.join(modelo, "model.bin"))),
                                       "assinatura": bool(cred("url.secret")), "anon": bool(cred("anon.key")),
                                       "ia": os.path.exists(os.environ.get("REACT_IA_SOCKET", "/run/headturbo-react-ia/ia.sock")),
                                       "link": importlib.util.find_spec("yt_dlp") is not None})
        if c == "/v1/modelos":   # seletor "Modelo de edição" (só nomes e descrições; nada do projeto)
            return self.resposta(200, montagem.listar_modelos())
        m = R_ARQ.match(c)
        if m:
            return self.servir(m.group(1), m.group(2), q)
        m = R_EDICAO.match(c) or R_LINK.match(c)
        if m:
            try:
                self.quem(m.group(1))
            except Negado as e:
                return self.resposta(e.status, {"erro": e.msg})
            return (self.get_edicao if c.startswith("/v1/edicao/") else self.get_link)(m.group(1))
        m = R_ESTADO.match(c)
        if not m:
            return self.resposta(404, {"erro": "rota inexistente"})
        pid = m.group(1)
        try:
            self.quem(pid)
        except Negado as e:
            return self.resposta(e.status, {"erro": e.msg})
        pasta = pasta_de(pid)
        e = ler_json(os.path.join(pasta, "estado.json")) or {"estado": "novo"}
        e["recebidos"] = {a: os.path.exists(os.path.join(pasta, f"{a}.bin")) for a in ("original", "reacao")}
        if FILA.ocupado(pid) and e.get("estado") == "na_fila":
            e["fila"] = FILA.tamanho()
        if e.get("estado") == "pronto" and os.path.exists(os.path.join(pasta, "final.mp4")):
            t = assinar(pid, "final.mp4")
            e["arquivo"] = f"/v1/arquivo/{pid}/final.mp4?t={t}"
            e["baixar"] = f"/v1/arquivo/{pid}/final.mp4?t={t}&baixar=1"
            if os.path.exists(os.path.join(pasta, "capa.jpg")):
                e["capa"] = f"/v1/arquivo/{pid}/capa.jpg?t={assinar(pid, 'capa.jpg')}"
        return self.resposta(200, e)

    def url_arquivo(self, pid: str, nome: str):
        if not os.path.exists(os.path.join(pasta_de(pid), ARQ_DISCO.get(nome, nome))):
            return None
        return f"/v1/arquivo/{pid}/{nome}?t={assinar(pid, nome)}"

    def get_link(self, pid: str):
        e = ler_json(os.path.join(pasta_de(pid), "link.json")) or {"estado": "nenhum"}
        if e.get("estado") == "baixando" and not BAIXADOR.ocupado(pid) and time.time() - e.get("em", 0) > 30:
            e = {**e, "estado": "erro", "erro": "o download parou (o servidor reiniciou). Tente de novo."}
        if e.get("estado") == "pronto":
            e["arquivo"] = self.url_arquivo(pid, "original.mp4")
        return self.resposta(200, e)

    def get_edicao(self, pid: str):
        pasta = pasta_de(pid)
        base = ler_json(os.path.join(pasta, "edicao_base.json"))
        salva = ler_json(os.path.join(pasta, "edicao.json"))
        previas = {"original": self.url_arquivo(pid, "previa_original.mp4"), "reacao": self.url_arquivo(pid, "previa_reacao.mp4")}
        return self.resposta(200, {"base": base, "salva": salva, "falas": falas_do_projeto(pid), "previas": previas,
                                   "montando": FILA.ocupado(pid), "link": ler_json(os.path.join(pasta, "link.json"))})

    def servir(self, pid: str, nome: str, q: dict):
        if not assinatura_ok(pid, nome, q.get("t", "")):
            return self.resposta(401, {"erro": "endereço vencido: abra o react de novo"})
        caminho = os.path.join(pasta_de(pid), ARQ_DISCO.get(nome, nome))
        if not os.path.exists(caminho):
            return self.resposta(404, {"erro": "arquivo não existe mais"})
        total = os.path.getsize(caminho)
        ini, fim, parcial = 0, total - 1, False
        mr = re.match(r"^bytes=(\d*)-(\d*)$", (self.headers.get("Range") or "").strip())
        if mr and (mr.group(1) or mr.group(2)):
            if mr.group(1):
                ini = int(mr.group(1))
                fim = int(mr.group(2)) if mr.group(2) else total - 1
            else:
                ini = max(0, total - int(mr.group(2)))
            fim = min(fim, total - 1)
            if ini > fim:
                return self.resposta(416, None, {"Content-Range": f"bytes */{total}"})
            parcial = True
        self.send_response(206 if parcial else 200)
        self.cors()
        self.send_header("Content-Type", "video/mp4" if nome.endswith(".mp4") else "image/jpeg")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(fim - ini + 1))
        self.send_header("Cache-Control", "private, max-age=3600")
        if q.get("baixar") == "1":
            self.send_header("Content-Disposition", f'attachment; filename="react-{time.strftime("%Y%m%d")}-{pid[:8]}.mp4"')
        if parcial:
            self.send_header("Content-Range", f"bytes {ini}-{fim}/{total}")
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(caminho, "rb") as f:
            f.seek(ini)
            falta = fim - ini + 1
            try:
                while falta > 0:
                    b = f.read(min(falta, 1 << 20))
                    if not b:
                        break
                    self.wfile.write(b)
                    falta -= len(b)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def do_DELETE(self):
        c, _ = self.caminho()
        self.descartar_corpo()
        m = R_PROJ.match(c)
        if not m:
            return self.resposta(404, {"erro": "rota inexistente"})
        pid = m.group(1)
        try:
            self.quem(pid)
        except Negado as e:
            return self.resposta(e.status, {"erro": e.msg})
        FILA.cancelar(pid)
        with trava(pid):
            shutil.rmtree(pasta_de(pid), ignore_errors=True)
        log(f"apagar {pid}")
        return self.resposta(200, {"ok": True})


def main():
    os.makedirs(PASTA, exist_ok=True)
    FILA.retomar()
    threading.Thread(target=FILA.rodar, name="fila", daemon=True).start()
    threading.Thread(target=faxina, name="faxina", daemon=True).start()
    srv = ThreadingHTTPServer((ENDERECO, PORTA), React)
    srv.daemon_threads = True
    log(f"headturbo-react ouvindo em {ENDERECO}:{PORTA}, pasta {PASTA}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
