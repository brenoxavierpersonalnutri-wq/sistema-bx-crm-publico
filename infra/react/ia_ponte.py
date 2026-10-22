#!/usr/bin/env python3
"""headturbo-react-ia: ajudante que roda o `claude -p` da assinatura do Breno para a "Edição com IA" do Estúdio React.

Por que existe: o headturbo-react roda como DynamicUser, sem home e sem login do Claude. Este ajudante roda como o
usuário turbo (o mesmo do Claude Code da Turbo e do closer), escuta num socket Unix que só o grupo headturbo-ia
alcança, e faz UMA chamada por vez:

    claude -p --output-format json --model <sonnet> --tools "" --setting-sources "" --strict-mcp-config
           --no-session-persistence --system-prompt <sistema> --json-schema <esquema>      (prompt pelo stdin)

Sem ferramentas, sem hooks, sem MCP, sem CLAUDE.md da pasta (roda numa pasta vazia fora do kit), sem sessão salva.
Teto de REACT_IA_TEMPO (120 s) por chamada; passou, mata o grupo de processos. Pedido de login ou resposta de erro
voltam como {"ok": false} e a montagem segue sem IA. Nunca faz login, nunca lê credencial, não loga o texto da fala.

Protocolo: o cliente manda uma linha JSON {"sistema", "usuario", "esquema"} e fecha a escrita; recebe uma linha JSON
{"ok": true, "saida": {...}, "modelo", "tokens_entrada", "tokens_saida", "custo_lista_usd", "segundos"} ou
{"ok": false, "erro": "..."}. Só biblioteca padrão.
"""
import grp
import json
import os
import signal
import socket
import socketserver
import subprocess
import sys
import threading
import time

SOCKET = os.environ.get("REACT_IA_SOCKET", "/run/headturbo-react-ia/ia.sock")
GRUPO = os.environ.get("REACT_IA_GRUPO", "headturbo-ia")
CLAUDE = os.environ.get("REACT_IA_CLAUDE", "claude")
MODELO = os.environ.get("REACT_IA_MODELO", "sonnet")
TEMPO = float(os.environ.get("REACT_IA_TEMPO", "120"))
PASTA = os.environ.get("REACT_IA_PASTA", os.path.expanduser("~/.cache/headturbo-react-ia"))
MAX_PEDIDO = 512 * 1024
UMA_POR_VEZ = threading.Lock()


def log(*p):
    sys.stderr.write(" ".join(str(x) for x in p) + "\n")
    sys.stderr.flush()


def comando(sistema: str, esquema: dict) -> list:
    return [CLAUDE, "-p", "--output-format", "json", "--model", MODELO, "--tools", "", "--setting-sources", "",
            "--strict-mcp-config", "--no-session-persistence", "--system-prompt", sistema,
            "--json-schema", json.dumps(esquema, ensure_ascii=False)]


def interpretar(saida: str, rc: int) -> dict:
    """stdout do `claude -p --output-format json` -> resposta do protocolo (puro, testável)."""
    try:
        d = json.loads(saida or "{}")
    except ValueError:
        texto = (saida or "").strip().splitlines()
        cauda = texto[-1][:160] if texto else f"código {rc}"
        if "login" in (saida or "").lower():
            return {"ok": False, "erro": "o Claude da VPS pediu login (alguém precisa rodar /login no tmux da Turbo)"}
        return {"ok": False, "erro": f"o Claude não devolveu JSON ({cauda})"}
    if d.get("is_error") or d.get("subtype") not in (None, "success"):
        msg = str(d.get("result") or d.get("subtype") or "erro")
        if "login" in msg.lower() or "auth" in msg.lower():
            msg = "o Claude da VPS pediu login (alguém precisa rodar /login no tmux da Turbo)"
        return {"ok": False, "erro": msg[:200]}
    saida_estr = d.get("structured_output")
    if saida_estr is None:
        try:
            saida_estr = json.loads(d.get("result") or "")
        except ValueError:
            return {"ok": False, "erro": "o Claude respondeu fora do esquema"}
    u = d.get("usage") or {}
    entrada = sum(int(u.get(k) or 0) for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
    modelo = next(iter(d.get("modelUsage") or {}), MODELO)
    return {"ok": True, "saida": saida_estr, "modelo": modelo, "tokens_entrada": entrada,
            "tokens_saida": int(u.get("output_tokens") or 0), "custo_lista_usd": float(d.get("total_cost_usd") or 0.0)}


def rodar(sistema: str, usuario: str, esquema: dict) -> dict:
    os.makedirs(PASTA, exist_ok=True)
    inicio = time.time()
    try:
        proc = subprocess.Popen(comando(sistema, esquema), cwd=PASTA, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, start_new_session=True)
    except FileNotFoundError:
        return {"ok": False, "erro": "o comando claude não existe na VPS"}
    try:
        out, err = proc.communicate(usuario, timeout=TEMPO)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.communicate()
        return {"ok": False, "erro": f"o Claude passou de {TEMPO:.0f} s"}
    r = interpretar(out if out.strip() else err, proc.returncode)
    r["segundos"] = round(time.time() - inicio, 1)
    return r


class Atende(socketserver.StreamRequestHandler):
    def handle(self):
        dados = self.rfile.read(MAX_PEDIDO + 1)
        if len(dados) > MAX_PEDIDO:
            return self.responder({"ok": False, "erro": "pedido grande demais"})
        try:
            p = json.loads(dados.decode("utf-8"))
            sistema, usuario, esquema = str(p["sistema"]), str(p["usuario"]), dict(p["esquema"])
        except (ValueError, KeyError, TypeError, UnicodeDecodeError):
            return self.responder({"ok": False, "erro": "pedido inválido"})
        if not UMA_POR_VEZ.acquire(timeout=TEMPO + 30):
            return self.responder({"ok": False, "erro": "a IA está ocupada com outro vídeo"})
        try:
            r = rodar(sistema, usuario, esquema)
        finally:
            UMA_POR_VEZ.release()
        log(f"chamada: ok={r.get('ok')} {r.get('segundos')} s tokens={r.get('tokens_entrada')}+{r.get('tokens_saida')}"
            f"{'' if r.get('ok') else ' erro=' + str(r.get('erro'))[:120]}")
        self.responder(r)

    def responder(self, r: dict):
        try:
            self.wfile.write(json.dumps(r, ensure_ascii=False).encode() + b"\n")
        except (BrokenPipeError, ConnectionResetError):
            pass


class Servidor(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def main():
    if "--teste" in sys.argv:  # diagnóstico manual: uma chamada mínima
        print(json.dumps(rodar("Responda só no esquema.", "Responda ok.", {
            "type": "object", "additionalProperties": False, "required": ["ok"], "properties": {"ok": {"type": "string"}}}),
            ensure_ascii=False))
        return 0
    try:
        os.unlink(SOCKET)
    except FileNotFoundError:
        pass
    srv = Servidor(SOCKET, Atende)
    try:
        os.chown(SOCKET, -1, grp.getgrnam(GRUPO).gr_gid)
    except (KeyError, PermissionError) as e:
        log(f"aviso: não consegui pôr o socket no grupo {GRUPO} ({type(e).__name__})")
    os.chmod(SOCKET, 0o660)
    log(f"headturbo-react-ia ouvindo em {SOCKET} (grupo {GRUPO}, modelo {MODELO}, teto {TEMPO:.0f} s)")
    srv.serve_forever()


if __name__ == "__main__":
    sys.exit(main())
