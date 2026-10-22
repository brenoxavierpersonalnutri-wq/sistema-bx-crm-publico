#!/usr/bin/env python3
"""headturbo-aulas: recebe o vídeo da aula (MP4/MOV, até alguns GB) e entrega pro LiveKit Ingress.

Por que na VPS e não no Storage: o arquivo é grande, a reprise toca o mesmo arquivo por semanas e o
Ingress lê do disco local (sem depender da internet no meio da live, sem custo de transferência).

Rotas (todas com token HS256 emitido pela edge function live-aula; chave = hex(HMAC-SHA256(api_secret do
LiveKit, "headturbo-aulas-v1")), então ninguém cola segredo novo):
  HEAD   /aulas/up/<id>      Authorization: Bearer <t, escopo up>  -> X-Recebido: bytes já gravados (retomar)
  PUT    /aulas/up/<id>      X-Offset: n, corpo = pedaço (<= 64 MB)  -> X-Recebido
  POST   /aulas/fim/<id>     escopo up ou fim: fecha o arquivo e mede com ffprobe -> JSON
         200 {"estado": "pronto"} = pode tocar. 202 {"estado": "convertendo", "progresso"} = o arquivo precisa
         virar H.264 720p/30 fps constantes (HEVC, taxa variável, acima de 720p...: o Ingress engasga e fica sem
         imagem) e está na fila de conversão; chamar de novo até 200. 200 {"estado": "erro", "erro"} = a conversão
         falhou: o original fica guardado, mas o vídeo não deve ir pro palco.
  DELETE /aulas/up/<id>      escopo del: apaga (e cancela a conversão, se for este)
  GET    /aulas/arquivo/<id>?t=<escopo ler>  com Range (o Ingress/souphttpsrc pede pedaços).
         Só de dentro da VPS: o Caddy NÃO encaminha /aulas/arquivo, e pedido com X-Forwarded-For é recusado.
  GET    /aulas/saude

Escuta em 172.18.0.1:7890 (gateway da rede docker do Caddy; o ufw só deixa 172.18.0.0/16).
Nada aqui loga token. Só stdlib.
"""
import base64
import contextlib
import fcntl
import hashlib
import hmac
import json
import os
import re
import shutil
import queue
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PASTA = os.environ.get("AULAS_PASTA", "/var/lib/headturbo-aulas")
ENDERECO = os.environ.get("AULAS_ENDERECO", "172.18.0.1")
PORTA = int(os.environ.get("AULAS_PORTA", "7890"))
ARQ_SEGREDO = os.environ.get("AULAS_SEGREDO_ARQ", "")  # egress.yaml (LoadCredential) com api_secret
MAX_PEDACO = 64 * 1024 * 1024
MAX_ARQUIVO = int(os.environ.get("AULAS_MAX_BYTES", str(8 * 1024 ** 3)))  # 8 GB
FOLGA_DISCO = 5 * 1024 ** 3  # recusa upload se sobrar menos que isto
ORIGENS = {o for o in os.environ.get("AULAS_ORIGENS", "https://equipe.brenoxavier.com.br").split(",") if o}
ID_OK = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
ROTA = re.compile(r"^/aulas/(up|fim|arquivo)/([0-9a-f-]{36})$")
TEMPO_PEDACO = 120  # s sem receber byte nenhum do pedaço = conexão morta (solta a trava do vídeo)


def ler_api_secret(caminho: str) -> str:
    with open(caminho, encoding="utf-8") as f:
        for linha in f:
            m = re.match(r"^\s*api_secret\s*:\s*['\"]?([^'\"\s#]+)", linha)
            if m:
                return m.group(1)
    raise SystemExit("api_secret não encontrado no arquivo de credencial")


def chave_de(api_secret: str) -> bytes:
    # hex do HMAC, como texto: é o mesmo "segredo" que a edge function passa para assinarJwt
    return hmac.new(api_secret.encode(), b"headturbo-aulas-v1", hashlib.sha256).hexdigest().encode()


def b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def conferir_token(token: str, chave: bytes, video_id: str, escopos: tuple, agora: float | None = None):
    """Devolve as claims se o token vale para este vídeo e escopo; senão None."""
    try:
        h, c, a = token.split(".")
        esperado = base64.urlsafe_b64encode(hmac.new(chave, f"{h}.{c}".encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
        if not hmac.compare_digest(esperado, a):
            return None
        if json.loads(b64d(h)).get("alg") != "HS256":
            return None
        claims = json.loads(b64d(c))
    except Exception:
        return None
    agora = time.time() if agora is None else agora
    if claims.get("aud") != "aulas" or claims.get("v") != video_id or claims.get("s") not in escopos:
        return None
    if not isinstance(claims.get("exp"), (int, float)) or agora > claims["exp"]:
        return None
    return claims


# ------------------------------------------------------------------ conversão (H.264 720p, 30 fps constantes)
# Uma de cada vez, com nice 19 + ionice idle e 2 threads: a VPS tem 4 vCPU e o LiveKit (Ingress/Egress) vem primeiro.
# A unit ainda dá CPUWeight/IOWeight baixos ao serviço inteiro, então na disputa os containers ganham.
CAIXA_DEITADO = (1280, 720)   # vídeo deitado cabe em 1280x720
CAIXA_EM_PE = (720, 1280)     # vídeo em pé (gravação de tela do celular) cabe em 720x1280
FPS_ALVO = 30
FFMPEG_THREADS = os.environ.get("AULAS_FFMPEG_THREADS", "2")
FOLGA_CONVERSAO = 2 * 1024 ** 3


def _fracao(txt) -> float | None:
    try:
        n, _, d = str(txt).partition("/")
        v = float(n) / float(d or 1)
        return v if v > 0 else None
    except (ValueError, ZeroDivisionError):
        return None


def sondar(caminho: str) -> dict:
    """ffprobe com o que decide a conversão (codec, taxa nominal x média, pixel, áudio)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,pix_fmt,color_range",
         "-of", "json", caminho], capture_output=True, text=True, timeout=60)
    return json.loads(out.stdout or "{}")


def motivos_conversao(d: dict) -> list:
    """Por que este arquivo precisa ser convertido antes de ir pro Ingress (lista vazia = toca como está)."""
    streams = d.get("streams") or []
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not v:
        return []
    m = []
    if v.get("codec_name") != "h264":
        m.append(f"codec {v.get('codec_name')}")
    # faixa de cor cheia (yuvj420p / color_range pc, padrão da gravação do iPhone) vira a faixa padrão de vídeo (tv)
    if v.get("pix_fmt") == "yuvj420p" or v.get("color_range") == "pc":
        m.append("faixa de cor cheia")
    elif v.get("pix_fmt") not in (None, "yuv420p"):
        m.append(f"pixel {v.get('pix_fmt')}")
    w, h = int(v.get("width") or 0), int(v.get("height") or 0)
    if min(w, h) > 720 or max(w, h) > 1280:
        m.append(f"resolução {w}x{h}")
    nominal, media = _fracao(v.get("r_frame_rate")), _fracao(v.get("avg_frame_rate"))
    if media and media > FPS_ALVO + 1:
        m.append(f"{media:.0f} fps")
    if nominal and media and abs(nominal - media) / nominal > 0.02:
        m.append(f"taxa de quadros variável ({media:.1f} de média, {nominal:.0f} nominal)")
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if a and a.get("codec_name") not in ("aac", "opus", "mp3"):
        m.append(f"áudio {a.get('codec_name')}")
    return m


def comando_ffmpeg(origem: str, destino: str) -> list:
    """Comando da conversão. Escala só pra baixo, cabe na caixa (em pé ou deitado), dimensões pares."""
    (wd, hd), (we, he) = CAIXA_DEITADO, CAIXA_EM_PE
    escala = (f"scale=w='if(gte(iw,ih),min({wd},iw),min({we},iw))':h='if(gte(iw,ih),min({hd},ih),min({he},ih))'"
              f":force_original_aspect_ratio=decrease:force_divisible_by=2:out_range=tv:out_color_matrix=bt709")
    return [
        "nice", "-n", "19", "ionice", "-c", "3",
        "ffmpeg", "-nostdin", "-hide_banner", "-v", "error", "-y", "-threads", FFMPEG_THREADS, "-i", origem,
        "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
        "-vf", f"{escala},setsar=1,fps={FPS_ALVO},format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709", "-fps_mode", "cfr", "-r", str(FPS_ALVO),
        # faixa padrão de vídeo (tv) e BT.709 explícitos: sem as cores marcadas o x264 nem grava a faixa no arquivo
        "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", "4M", "-bufsize", "8M",
        "-profile:v", "high", "-level", "4.1", "-g", str(FPS_ALVO * 2), "-threads", FFMPEG_THREADS, "-filter_threads", "1",
        "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000",
        "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", destino,
    ]


def caminhos(vid: str) -> dict:
    b = os.path.join(PASTA, vid)
    return {"part": b + ".part", "orig": b + ".orig", "conv": b + ".conv.mp4", "final": b + ".mp4",
            "estado": b + ".estado.json", "log": b + ".ffmpeg.log", "lock": b + ".lock"}


def ler_estado(vid: str) -> dict | None:
    try:
        with open(caminhos(vid)["estado"], encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def gravar_estado(vid: str, **e):
    p = caminhos(vid)["estado"]
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({**e, "em": int(time.time())}, f, ensure_ascii=False)
    os.replace(tmp, p)


def apagar_se_existe(*ps):
    for p in ps:
        with contextlib.suppress(FileNotFoundError):
            os.remove(p)


@contextlib.contextmanager
def trava_video(vid: str):
    """Um pedido por vídeo de cada vez (PUT, fim, DELETE e a troca de arquivo da conversão)."""
    fd = os.open(caminhos(vid)["lock"], os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


class Conversor:
    """Fila de uma conversão por vez. Estado em <id>.estado.json, sobrevive a restart (o .orig volta pra fila)."""

    def __init__(self):
        self.fila: queue.Queue = queue.Queue()
        self.na_fila: set = set()
        self.atual: str | None = None
        self.proc: subprocess.Popen | None = None
        self.mx = threading.Lock()

    def enfileirar(self, vid: str):
        with self.mx:
            if vid in self.na_fila or vid == self.atual:
                return
            self.na_fila.add(vid)
        self.fila.put(vid)

    def tamanho(self) -> int:
        with self.mx:
            return len(self.na_fila) + (1 if self.atual else 0)

    def cancelar(self, vid: str):
        with self.mx:
            self.na_fila.discard(vid)
            if self.atual == vid and self.proc and self.proc.poll() is None:
                self.proc.kill()

    def retomar(self):
        """No boot: sobras de conversão interrompida voltam pra fila (o .conv.mp4 pela metade é descartado)."""
        orig = sorted((os.path.getmtime(os.path.join(PASTA, n)), n[:-5]) for n in os.listdir(PASTA) if n.endswith(".orig"))
        for _, vid in orig:
            if ID_OK.match(vid):
                apagar_se_existe(caminhos(vid)["conv"])
                gravar_estado(vid, estado="convertendo", progresso=0, motivo=(ler_estado(vid) or {}).get("motivo"))
                self.enfileirar(vid)

    def rodar(self):
        while True:
            vid = self.fila.get()
            with self.mx:
                if vid not in self.na_fila:
                    continue
                self.na_fila.discard(vid)
                self.atual = vid
            try:
                self.converter(vid)
            except Exception as e:  # nunca derruba o worker
                sys.stderr.write(f"conversão {vid}: {type(e).__name__}: {e}\n")
                self.falhou(vid, "erro interno na conversão")
            finally:
                with self.mx:
                    self.atual, self.proc = None, None

    def converter(self, vid: str):
        c = caminhos(vid)
        if not os.path.exists(c["orig"]):
            return
        anterior = ler_estado(vid) or {}
        motivo = anterior.get("motivo")
        try:
            dur = float(sondar(c["orig"]).get("format", {}).get("duration") or 0)
        except Exception:
            dur = 0.0
        apagar_se_existe(c["conv"])
        inicio = time.time()
        sys.stderr.write(f"conversão {vid}: começou ({motivo})\n")
        with open(c["log"], "wb") as log:
            proc = subprocess.Popen(comando_ffmpeg(c["orig"], c["conv"]), stdout=subprocess.PIPE, stderr=log, text=True)
            with self.mx:
                self.proc = proc
            estourou = threading.Event()
            relogio = threading.Timer(max(900, dur * 8), lambda: (estourou.set(), proc.kill()))
            relogio.daemon = True
            relogio.start()
            ultimo = 0.0
            for linha in proc.stdout:
                if linha.startswith("out_time_us=") and dur > 0:
                    try:
                        feito = int(linha.split("=", 1)[1]) / 1e6
                    except ValueError:
                        continue
                    if time.time() - ultimo >= 3:
                        ultimo = time.time()
                        gravar_estado(vid, estado="convertendo", progresso=round(min(0.99, max(0.0, feito / dur)), 3), motivo=motivo)
            proc.wait()
            relogio.cancel()
        if not os.path.exists(c["orig"]):  # apagado (DELETE) no meio
            apagar_se_existe(c["conv"], c["log"], c["estado"])
            return
        if estourou.is_set():
            return self.falhou(vid, "a conversão passou do tempo limite")
        if proc.returncode != 0:
            with open(c["log"], "rb") as f:
                cauda = f.read()[-300:].decode("utf-8", "replace").strip().splitlines()
            return self.falhou(vid, f"o ffmpeg falhou ({cauda[-1][:160] if cauda else 'código ' + str(proc.returncode)})")
        info = medir(c["conv"])
        if not info["video"] or info["video"].get("codec") != "h264" or not info["duracao_seg"]:
            return self.falhou(vid, "o arquivo convertido não ficou legível")
        if dur and abs(info["duracao_seg"] - dur) > max(3.0, dur * 0.02):
            return self.falhou(vid, f"o convertido ficou com {info['duracao_seg']:.0f} s e o original tem {dur:.0f} s")
        with trava_video(vid):
            if not os.path.exists(c["orig"]):
                apagar_se_existe(c["conv"], c["log"], c["estado"])
                return
            os.replace(c["conv"], c["final"])
            apagar_se_existe(c["orig"], c["log"])
            gravar_estado(vid, estado="pronto", convertido=True, motivo=motivo, segundos=round(time.time() - inicio))
        sys.stderr.write(f"conversão {vid}: pronta em {time.time() - inicio:.0f} s\n")

    def falhou(self, vid: str, erro: str):
        c = caminhos(vid)
        sys.stderr.write(f"conversão {vid}: {erro}\n")
        with trava_video(vid):
            apagar_se_existe(c["conv"])
            if not os.path.exists(c["orig"]) and not os.path.exists(c["final"]):  # apagado (DELETE) no meio
                apagar_se_existe(c["log"], c["estado"])
                return
            if os.path.exists(c["orig"]):
                os.replace(c["orig"], c["final"])  # o original fica guardado; o estado "erro" segura o palco
            gravar_estado(vid, estado="erro", erro=f"não consegui converter o vídeo para tocar no palco: {erro}. "
                                                    "O original ficou guardado; exporte em MP4 H.264 720p e envie de novo.",
                          motivo=(ler_estado(vid) or {}).get("motivo"))


CONVERSOR = Conversor()


def medir(caminho: str) -> dict:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height",
             "-of", "json", caminho], capture_output=True, text=True, timeout=60)
        d = json.loads(out.stdout or "{}")
    except Exception:
        return {"duracao_seg": None, "video": None, "audio": False}
    streams = d.get("streams") or []
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = any(s.get("codec_type") == "audio" for s in streams)
    dur = d.get("format", {}).get("duration")
    return {
        "duracao_seg": round(float(dur), 2) if dur else None,
        "video": {"codec": v.get("codec_name"), "largura": v.get("width"), "altura": v.get("height")} if v else None,
        "audio": a,
    }


class Aulas(BaseHTTPRequestHandler):
    server_version = "headturbo-aulas"
    sys_version = ""
    protocol_version = "HTTP/1.1"
    chave = b""

    def log_message(self, fmt, *args):  # sem query string (token) no log
        caminho = self.path.split("?", 1)[0]
        sys.stderr.write(f"{self.address_string()} {self.command} {caminho} {args[1] if len(args) > 1 else ''}\n")

    # ---------------------------------------------------------------- utilidades
    def cors(self):
        origem = self.headers.get("Origin", "")
        if origem in ORIGENS or re.match(r"^https://[a-z0-9-]+\.lovable\.app$", origem or ""):
            self.send_header("Access-Control-Allow-Origin", origem)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "authorization, content-type, x-offset")
            self.send_header("Access-Control-Allow-Methods", "HEAD, PUT, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Expose-Headers", "X-Recebido")
            self.send_header("Access-Control-Max-Age", "600")

    def resposta(self, status: int, corpo=None, extra: dict | None = None):
        dados = b"" if corpo is None else json.dumps(corpo).encode()
        self.send_response(status)
        self.cors()
        for k, v in (extra or {}).items():
            self.send_header(k, str(v))
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(dados)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if dados and self.command != "HEAD":
            self.wfile.write(dados)

    def rota(self):
        caminho, _, query = self.path.partition("?")
        m = ROTA.match(caminho)
        if not m or not ID_OK.match(m.group(2)):
            return None, None, None
        token = ""
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:].strip()
        else:
            q = dict(p.split("=", 1) for p in query.split("&") if "=" in p)
            token = q.get("t", "")
        return m.group(1), m.group(2), token

    def arquivos(self, vid: str):
        return os.path.join(PASTA, f"{vid}.part"), os.path.join(PASTA, f"{vid}.mp4")

    def trava(self, vid: str):
        """Um pedido por vídeo de cada vez (PUT, fim e DELETE): conferir offset + gravar + truncar é um passo só.
        Sem isto, dois PUT com o mesmo X-Offset passavam juntos pela conferência e os dois gravavam (arquivo dobrado).
        A conversão usa a mesma trava pra trocar o .orig pelo .mp4."""
        return trava_video(vid)

    def descartar_corpo(self):
        n = int(self.headers.get("Content-Length") or 0)
        while n > 0:
            b = self.rfile.read(min(n, 1 << 20))
            if not b:
                break
            n -= len(b)

    # ---------------------------------------------------------------- métodos
    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        tipo, vid, token = self.rota()
        if tipo != "up":
            return self.resposta(404)
        if not conferir_token(token, self.chave, vid, ("up",)):
            return self.resposta(401)
        part, final = self.arquivos(vid)
        orig = caminhos(vid)["orig"]
        if os.path.exists(orig):  # já recebido, convertendo
            return self.resposta(200, None, {"X-Recebido": os.path.getsize(orig), "X-Completo": "1", "X-Estado": "convertendo"})
        if os.path.exists(final):
            return self.resposta(200, None, {"X-Recebido": os.path.getsize(final), "X-Completo": "1"})
        return self.resposta(200, None, {"X-Recebido": os.path.getsize(part) if os.path.exists(part) else 0})

    def do_PUT(self):
        tipo, vid, token = self.rota()
        if tipo != "up":
            self.descartar_corpo()
            return self.resposta(404, {"erro": "rota"})
        claims = conferir_token(token, self.chave, vid, ("up",))
        if not claims:
            self.descartar_corpo()
            return self.resposta(401, {"erro": "token"})
        self.connection.settimeout(TEMPO_PEDACO)
        with self.trava(vid):
            return self.gravar_pedaco(vid, claims)

    def gravar_pedaco(self, vid: str, claims: dict):
        part, final = self.arquivos(vid)
        if os.path.exists(final) or os.path.exists(caminhos(vid)["orig"]):
            self.descartar_corpo()
            return self.resposta(409, {"erro": "já concluído"})
        tam = int(self.headers.get("Content-Length") or -1)
        try:
            offset = int(self.headers.get("X-Offset", "-1"))
        except ValueError:
            offset = -1
        atual = os.path.getsize(part) if os.path.exists(part) else 0
        limite = min(int(claims.get("max") or MAX_ARQUIVO), MAX_ARQUIVO)
        if tam <= 0 or tam > MAX_PEDACO:
            self.descartar_corpo()
            return self.resposta(413, {"erro": "pedaço inválido"}, {"X-Recebido": atual})
        if offset != atual:
            self.descartar_corpo()
            return self.resposta(409, {"erro": "offset", "recebido": atual}, {"X-Recebido": atual})
        if atual + tam > limite:
            self.descartar_corpo()
            return self.resposta(413, {"erro": "arquivo maior que o permitido"}, {"X-Recebido": atual})
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
        except OSError:  # inclui o timeout do socket
            pass
        finally:
            if lidos != tam:  # conexão caiu no meio: corta o que veio pela metade, o cliente refaz o pedaço
                with open(part, "ab") as f:
                    f.truncate(atual)
        if lidos != tam:
            self.close_connection = True
            return self.resposta(400, {"erro": "pedaço incompleto"}, {"X-Recebido": atual})
        return self.resposta(200, {"recebido": atual + tam}, {"X-Recebido": atual + tam})

    def do_POST(self):
        tipo, vid, token = self.rota()
        self.descartar_corpo()
        if tipo != "fim":
            return self.resposta(404, {"erro": "rota"})
        if not conferir_token(token, self.chave, vid, ("up", "fim")):
            return self.resposta(401, {"erro": "token"})
        with self.trava(vid):
            return self.fechar(vid)

    def convertendo(self, vid: str):
        orig = caminhos(vid)["orig"]
        e = ler_estado(vid) or {}
        CONVERSOR.enfileirar(vid)  # idempotente; cobre a fila perdida num restart
        return self.resposta(202, {"ok": True, "estado": "convertendo", "progresso": e.get("progresso", 0),
                                   "motivo": e.get("motivo"), "bytes": os.path.getsize(orig), **medir(orig)})

    def fechar(self, vid: str):
        part, final = self.arquivos(vid)
        if os.path.exists(caminhos(vid)["orig"]):
            return self.convertendo(vid)
        if not os.path.exists(final):
            if not os.path.exists(part) or os.path.getsize(part) == 0:
                return self.resposta(404, {"erro": "nada recebido"})
            try:
                sonda = sondar(part)
            except Exception:
                sonda = {}
            info = medir(part)
            if not info["video"] or not info["duracao_seg"]:
                return self.resposta(422, {"erro": "não é um vídeo que o servidor consiga ler (use MP4 H.264 ou MOV)", **info})
            motivos = motivos_conversao(sonda)
            if motivos:
                if shutil.disk_usage(PASTA).free - os.path.getsize(part) < FOLGA_CONVERSAO:
                    return self.resposta(507, {"erro": "disco da VPS quase cheio: sem espaço para converter o vídeo"})
                os.replace(part, caminhos(vid)["orig"])
                gravar_estado(vid, estado="convertendo", progresso=0, motivo=", ".join(motivos))
                return self.convertendo(vid)
            os.replace(part, final)
            gravar_estado(vid, estado="pronto", convertido=False)
        e = ler_estado(vid) or {}
        info = medir(final)
        if e.get("estado") == "erro":
            return self.resposta(200, {"ok": False, "estado": "erro", "erro": e.get("erro"), "bytes": os.path.getsize(final), **info})
        return self.resposta(200, {"ok": True, "estado": "pronto", "convertido": bool(e.get("convertido")),
                                   "bytes": os.path.getsize(final), **info})

    def do_DELETE(self):
        tipo, vid, token = self.rota()
        self.descartar_corpo()
        if tipo != "up":
            return self.resposta(404, {"erro": "rota"})
        if not conferir_token(token, self.chave, vid, ("del",)):
            return self.resposta(401, {"erro": "token"})
        CONVERSOR.cancelar(vid)
        with self.trava(vid):
            c = caminhos(vid)
            apagar_se_existe(c["part"], c["final"], c["orig"], c["conv"], c["estado"], c["log"])
        return self.resposta(200, {"ok": True})

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/aulas/saude":
            return self.resposta(200, {"ok": True, "conversoes": CONVERSOR.tamanho()})
        tipo, vid, token = self.rota()
        if tipo != "arquivo":
            return self.resposta(404, {"erro": "rota"})
        if self.headers.get("X-Forwarded-For") or self.headers.get("Via"):
            return self.resposta(403, {"erro": "só de dentro da VPS"})
        if not conferir_token(token, self.chave, vid, ("ler",)):
            return self.resposta(401, {"erro": "token"})
        _, final = self.arquivos(vid)
        if not os.path.exists(final):
            return self.resposta(404, {"erro": "arquivo"})
        total = os.path.getsize(final)
        ini, fim = 0, total - 1
        rng = self.headers.get("Range", "")
        m = re.match(r"^bytes=(\d*)-(\d*)$", rng.strip())
        parcial = False
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                ini = int(m.group(1))
                fim = int(m.group(2)) if m.group(2) else total - 1
            else:
                ini = max(0, total - int(m.group(2)))
            fim = min(fim, total - 1)
            if ini > fim:
                return self.resposta(416, None, {"Content-Range": f"bytes */{total}"})
            parcial = True
        self.send_response(206 if parcial else 200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(fim - ini + 1))
        if parcial:
            self.send_header("Content-Range", f"bytes {ini}-{fim}/{total}")
        self.end_headers()
        with open(final, "rb") as f:
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


def main():
    if not ARQ_SEGREDO:
        raise SystemExit("AULAS_SEGREDO_ARQ ausente")
    Aulas.chave = chave_de(ler_api_secret(ARQ_SEGREDO))
    os.makedirs(PASTA, exist_ok=True)
    CONVERSOR.retomar()
    threading.Thread(target=CONVERSOR.rodar, name="conversor", daemon=True).start()
    srv = ThreadingHTTPServer((ENDERECO, PORTA), Aulas)
    srv.daemon_threads = True
    sys.stderr.write(f"headturbo-aulas ouvindo em {ENDERECO}:{PORTA}, pasta {PASTA}\n")
    srv.serve_forever()


if __name__ == "__main__":
    main()
