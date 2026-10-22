#!/usr/bin/env python3
"""headturbo-react: baixa o vídeo original por link (Reels/post do Instagram; TikTok e YouTube Shorts por tentativa).

Uso (o serviço chama isto num subprocesso com nice 19, um download por vez):
    python3 baixar_link.py <pasta-do-projeto> <url>

- Sem login e sem cookie de ninguém: só o que o Instagram mostra para quem não está logado. Post privado, apagado ou
  bloqueio do Instagram vira erro legível com a sugestão de baixar no celular e usar "Escolher vídeo".
- yt-dlp (no venv do serviço) baixa para original.dl.*; o ffmpeg deixa em MP4 H.264 + AAC com faststart (copia se já
  for, converte se não for) e o arquivo vira original.bin, igual ao upload. Daí em diante o fluxo é o mesmo.
- Andamento e resultado em link.json: {estado: baixando|pronto|erro, progresso, etapa, erro, url, autor, titulo,
  duracao_seg, bytes, plataforma}.
Limites: 10 min de vídeo, 500 MB, 4 min de download.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
from urllib.parse import urlsplit

MAX_SEG = 600
MAX_BYTES = 500 * 1024 * 1024
TETO_DOWNLOAD = 240

# (plataforma, host, caminho) — só estes; qualquer outro link é recusado antes de chamar o yt-dlp
PADROES = (
    ("instagram", re.compile(r"^(www\.)?instagram\.com$"), re.compile(r"^/(?:[A-Za-z0-9_.]+/)?(reel|reels|p|tv)/[A-Za-z0-9_-]{5,40}/?$")),
    ("tiktok", re.compile(r"^(www\.|m\.)?tiktok\.com$"), re.compile(r"^/@[A-Za-z0-9_.]{1,40}/video/\d{8,25}/?$")),
    ("tiktok", re.compile(r"^(vm|vt)\.tiktok\.com$"), re.compile(r"^/[A-Za-z0-9]{5,20}/?$")),
    ("youtube", re.compile(r"^(www\.|m\.)?youtube\.com$"), re.compile(r"^/shorts/[A-Za-z0-9_-]{6,20}/?$")),
)


def validar_url(url) -> tuple:
    """-> (True, url_limpa, plataforma) ou (False, "erro legível", None). Tira rastreio (?igsh=...)."""
    if not isinstance(url, str) or len(url) > 500:
        return False, "cole o link do Reels ou do post", None
    url = url.strip()
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    try:
        u = urlsplit(url)
    except ValueError:
        return False, "esse link não parece válido", None
    host = (u.hostname or "").lower()
    for plat, r_host, r_cam in PADROES:
        if r_host.match(host) and r_cam.match(u.path or "/"):
            return True, f"https://{host}{u.path.rstrip('/')}/", plat
    if "instagram.com" in host:
        return False, "esse link do Instagram não é de um Reels nem de um post (use o link de compartilhar do Reels)", None
    return False, "por enquanto aceito link de Reels/post do Instagram (TikTok e YouTube Shorts em teste)", None


def traduzir_erro(stderr: str, plataforma: str) -> str:
    """Mensagem do yt-dlp -> frase para a tela, sempre com a saída: baixar no celular e subir o arquivo."""
    t = (stderr or "").lower()
    sugestao = " Baixe o vídeo no celular e use \"Escolher vídeo\"."
    if "sign in to confirm" in t or "not a bot" in t:
        return "o YouTube bloqueou o download pelo servidor (pede login)." + sugestao
    if "rate-limit" in t or "rate limit" in t or "429" in t or "too many requests" in t:
        return "o Instagram bloqueou o download agora (limite de acessos). Tente de novo em alguns minutos." + sugestao
    if ("empty media response" in t or "login" in t or "private" in t or "not available" in t or "unavailable" in t
            or "404" in t or "does not exist" in t or "cookies" in t):
        nome = {"instagram": "o Instagram", "tiktok": "o TikTok", "youtube": "o YouTube"}.get(plataforma, "o site")
        return f"não consegui baixar: o post é privado, foi apagado ou {nome} não deixou baixar sem login." + sugestao
    if "max-filesize" in t or "larger than max" in t or "file is larger" in t:
        return "o vídeo passa de 500 MB." + sugestao
    if "unsupported url" in t:
        return "não reconheci esse link." + sugestao
    if "timed out" in t or "timeout" in t or "temporary failure" in t or "name resolution" in t:
        return "o download demorou demais ou a internet da VPS falhou." + sugestao
    return "não consegui baixar esse vídeo." + sugestao


class Estado:
    def __init__(self, pasta: str, url: str, plataforma: str):
        self.pasta, self.base = pasta, {"url": url, "plataforma": plataforma}

    def gravar(self, **e):
        self.base.update({k: v for k, v in e.items() if k in ("url", "plataforma", "autor", "titulo", "duracao_seg", "bytes")})
        tmp = os.path.join(self.pasta, "link.json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({**self.base, **e, "em": int(time.time())}, f, ensure_ascii=False)
        os.replace(tmp, os.path.join(self.pasta, "link.json"))


def sondar(caminho: str) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name",
                        "-of", "json", caminho], capture_output=True, text=True, timeout=120)
    d = json.loads(r.stdout or "{}")
    ss = d.get("streams") or []
    v = next((s.get("codec_name") for s in ss if s.get("codec_type") == "video"), None)
    a = next((s.get("codec_name") for s in ss if s.get("codec_type") == "audio"), None)
    try:
        dur = float(d.get("format", {}).get("duration") or 0)
    except ValueError:
        dur = 0.0
    return {"video": v, "audio": a, "duracao": dur}


def cmd_mp4(entrada: str, saida: str, copiar: bool) -> list:
    """MP4 que o celular toca na hora: copia se já for H.264 + AAC, senão converte (até 1920 px)."""
    nice = (["nice", "-n", "19"] if shutil.which("nice") else [])
    base = nice + ["ffmpeg", "-nostdin", "-hide_banner", "-v", "error", "-y", "-threads", "2", "-i", entrada,
                   "-map", "0:v:0", "-map", "0:a:0?"]
    if copiar:
        return base + ["-c", "copy", "-movflags", "+faststart", saida]
    escala = "scale=w='if(gte(iw,ih),min(1920,iw),-2)':h='if(gte(iw,ih),-2,min(1920,ih))':force_divisible_by=2"
    return base + ["-vf", f"{escala},format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                   "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", saida]


def baixar(pasta: str, url: str) -> int:
    ok, url_l, plat = validar_url(url)
    est = Estado(pasta, url_l if ok else str(url)[:500], plat or "")
    if not ok:
        est.gravar(estado="erro", erro=url_l)
        return 1
    est.gravar(estado="baixando", progresso=0.02, etapa="abrindo o link")
    for f in os.listdir(pasta):
        if f.startswith("original.dl."):
            os.remove(os.path.join(pasta, f))
    saida_tpl = os.path.join(pasta, "original.dl.%(ext)s")
    cmd = [sys.executable, "-m", "yt_dlp", "--no-playlist", "--no-cache-dir", "--no-mtime", "--no-part", "--newline",
           "--no-warnings", "--progress", "--socket-timeout", "20", "--retries", "2", "--max-filesize", str(MAX_BYTES),
           "--match-filter", f"duration <=? {MAX_SEG}",
           "-f", "b[ext=mp4][vcodec^=avc1]/bv*[vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
           "--merge-output-format", "mp4", "-o", saida_tpl,
           "--print", "after_move:INFO\t%(uploader_id|)s\t%(uploader|)s\t%(channel|)s\t%(duration|)s\t%(title|)s",
           "--progress-template", "download:PROG\t%(progress._percent_str)s", url_l]
    info, erros = {}, []
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=pasta)
        limite = time.time() + TETO_DOWNLOAD
        ultimo = 0.0
        for linha in proc.stdout:
            if time.time() > limite:
                proc.kill()
                est.gravar(estado="erro", erro="o download passou de 4 minutos. Baixe o vídeo no celular e use \"Escolher vídeo\".")
                return 1
            linha = linha.rstrip("\n")
            if linha.startswith("PROG\t") and time.time() - ultimo > 1:
                m = re.search(r"([\d.]+)%", linha)
                if m:
                    est.gravar(estado="baixando", progresso=round(0.05 + 0.8 * float(m.group(1)) / 100, 3), etapa="baixando o vídeo")
                    ultimo = time.time()
            elif linha.startswith("INFO\t"):
                p = (linha.split("\t") + [""] * 6)[1:6]
                ident = [x for x in (p[2], p[0]) if x and x not in ("NA", "None") and not x.isdigit()]
                info = {"autor": (ident[0] if ident else p[1])[:80], "nome": p[1][:120], "titulo": p[4][:200]}
                try:
                    info["duracao"] = float(p[3]) if p[3] not in ("", "NA", "None") else None
                except ValueError:
                    info["duracao"] = None
        erros = (proc.stderr.read() or "").strip().splitlines()
        proc.wait(timeout=30)
    except (OSError, subprocess.TimeoutExpired) as e:
        est.gravar(estado="erro", erro="não consegui rodar o downloader na VPS (" + type(e).__name__ + ")")
        return 1
    baixado = next((os.path.join(pasta, f) for f in sorted(os.listdir(pasta)) if f.startswith("original.dl.")), None)
    if proc.returncode != 0 or not baixado or os.path.getsize(baixado) == 0:
        texto = "\n".join(erros[-8:])
        if "does not pass filter" in texto or (proc.returncode == 0 and not baixado):
            est.gravar(estado="erro", erro=f"o vídeo passa de {MAX_SEG // 60} minutos ou não tem vídeo. Baixe no celular e use \"Escolher vídeo\".")
        else:
            est.gravar(estado="erro", erro=traduzir_erro(texto, plat))
        sys.stderr.write(texto[-600:] + "\n")
        return 1
    est.gravar(estado="baixando", progresso=0.88, etapa="preparando o vídeo", autor=info.get("autor"), titulo=info.get("titulo"))
    s = sondar(baixado)
    if not s["video"]:
        est.gravar(estado="erro", erro="o link não trouxe vídeo (é foto ou carrossel?). Baixe no celular e use \"Escolher vídeo\".")
        return 1
    final_tmp = os.path.join(pasta, "original.link.mp4")
    copiar = s["video"] == "h264" and s["audio"] in ("aac", None)
    r = subprocess.run(cmd_mp4(baixado, final_tmp, copiar), capture_output=True, text=True, timeout=1800)
    if r.returncode != 0 and copiar:  # cópia falhou (contêiner estranho): converte
        r = subprocess.run(cmd_mp4(baixado, final_tmp, False), capture_output=True, text=True, timeout=1800)
    os.remove(baixado)
    if r.returncode != 0 or not os.path.exists(final_tmp):
        est.gravar(estado="erro", erro="baixei, mas não consegui converter o vídeo. Baixe no celular e use \"Escolher vídeo\".")
        return 1
    for velho in ("original.part", "original.bin"):
        if os.path.exists(os.path.join(pasta, velho)):
            os.remove(os.path.join(pasta, velho))
    os.replace(final_tmp, os.path.join(pasta, "original.bin"))
    s2 = sondar(os.path.join(pasta, "original.bin"))
    est.gravar(estado="pronto", progresso=1.0, etapa="pronto", autor=info.get("autor"), titulo=info.get("titulo"),
               duracao_seg=round(s2["duracao"], 2) if s2["duracao"] else info.get("duracao"),
               bytes=os.path.getsize(os.path.join(pasta, "original.bin")))
    return 0


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    try:
        return baixar(sys.argv[1], sys.argv[2])
    except Exception as e:  # nunca deixa o estado preso em "baixando"
        sys.stderr.write(f"baixar_link: {type(e).__name__}: {e}\n")
        try:
            Estado(sys.argv[1], sys.argv[2][:500], "").gravar(estado="erro", erro=f"erro interno no download ({type(e).__name__})")
        except OSError:
            pass
        return 1


if __name__ == "__main__":
    sys.exit(main())
