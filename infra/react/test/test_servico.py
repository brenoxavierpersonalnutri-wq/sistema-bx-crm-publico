"""Teste do serviço headturbo-react de ponta a ponta, com um Supabase FALSO (nada sai da máquina).

    python3 -m unittest infra/react/test/test_servico.py      (precisa de ffmpeg/ffprobe)

Sobe o serviço num subprocesso (porta livre em 127.0.0.1, pasta e credenciais temporárias) e confere: login,
acesso ao Conteúdo, projeto pela RLS, upload em pedaços com retomada, montagem de verdade (vídeos de 4 s),
endereço assinado com Range, CORS e apagar.
"""
import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

AQUI = os.path.dirname(os.path.abspath(__file__))
SERV = os.path.join(AQUI, "..", "headturbo-react.py")
PID = "11111111-2222-4333-8444-555555555555"
PID_ALHEIO = "99999999-2222-4333-8444-555555555555"
TOK_E = "tok-editora-aaaaaaaaaaaaaaaaaaaa"
TOK_S = "tok-semmodulo-aaaaaaaaaaaaaaaaaa"
UID_E = "aaaaaaaa-0000-4000-8000-00000000000e"
UID_S = "aaaaaaaa-0000-4000-8000-000000000005"


class SupabaseFalso(BaseHTTPRequestHandler):
    chamadas = []

    def log_message(self, *a):
        pass

    def _resp(self, st, corpo):
        d = json.dumps(corpo).encode()
        self.send_response(st)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(d)))
        self.end_headers()
        self.wfile.write(d)

    def _tok(self):
        return (self.headers.get("authorization") or "").replace("Bearer ", "")

    def do_GET(self):
        SupabaseFalso.chamadas.append(self.path)
        t = self._tok()
        if self.path == "/auth/v1/user":
            uid = {TOK_E: UID_E, TOK_S: UID_S}.get(t)
            return self._resp(200, {"id": uid}) if uid else self._resp(401, {"msg": "jwt"})
        if self.path.startswith("/rest/v1/conteudo_reacts?id=eq."):
            pid = self.path.split("eq.", 1)[1].split("&", 1)[0]
            return self._resp(200, [{"id": pid}] if (t == TOK_E and pid == PID) else [])
        self._resp(404, {})

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        self.rfile.read(n)
        t = self._tok()
        if self.path == "/rest/v1/rpc/conteudo_meu_acesso":
            return self._resp(200, {"aprovado": True, "admin": False, "conteudo": t == TOK_E})
        self._resp(404, {})


def porta_livre():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def ff(*args):
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-v", "error", "-y", *args], check=True, timeout=120)


class Servico(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="react-teste-")
        cls.sup = ThreadingHTTPServer(("127.0.0.1", 0), SupabaseFalso)
        threading.Thread(target=cls.sup.serve_forever, daemon=True).start()
        cred = os.path.join(cls.tmp, "cred")
        os.makedirs(cred)
        open(os.path.join(cred, "anon.key"), "w").write("anon-falsa")
        open(os.path.join(cred, "url.secret"), "w").write("s" * 64)
        cls.porta = porta_livre()
        env = {**os.environ, "REACT_PASTA": os.path.join(cls.tmp, "dados"), "REACT_ENDERECO": "127.0.0.1",
               "REACT_PORTA": str(cls.porta), "REACT_SUPABASE_URL": f"http://127.0.0.1:{cls.sup.server_address[1]}",
               "CREDENTIALS_DIRECTORY": cred, "REACT_FOLGA_DISCO": "0", "REACT_WHISPER_MODELO": ""}
        cls.log = open(os.path.join(cls.tmp, "servico.log"), "wb")
        cls.proc = subprocess.Popen([sys.executable, SERV], env=env, stdout=cls.log, stderr=cls.log)
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", cls.porta), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        cls.orig = os.path.join(cls.tmp, "o.mp4")
        cls.reac = os.path.join(cls.tmp, "r.webm")
        ff("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=6", "-f", "lavfi", "-i", "sine=f=500:d=6",
           "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", cls.orig)
        # reação em WebM (VP8/Opus) "ao vivo" (sem índice nem duração), como o MediaRecorder do Chrome grava:
        # 1 s mudo, 2 s de "voz", 1 s mudo
        ff("-f", "lavfi", "-i", "testsrc=size=360x640:rate=30:duration=4",
           "-f", "lavfi", "-i", "aevalsrc='if(between(t,1,3),0.4*sin(2*PI*220*t),0)':s=48000:d=4",
           "-c:v", "libvpx", "-b:v", "500k", "-c:a", "libopus", "-live", "1", "-f", "webm", cls.reac)
        sem_dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", cls.reac],
                                 capture_output=True, text=True).stdout.strip()
        assert sem_dur in ("", "N/A"), f"o WebM de teste devia vir sem duração ({sem_dur})"

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(5)
        cls.sup.shutdown()
        cls.log.close()

    def req(self, metodo, caminho, corpo=None, tok=TOK_E, cab=None):
        c = http.client.HTTPConnection("127.0.0.1", self.porta, timeout=30)
        h = dict(cab or {})
        if tok:
            h["Authorization"] = f"Bearer {tok}"
        c.request(metodo, caminho, body=corpo, headers=h)
        r = c.getresponse()
        dados = r.read()
        c.close()
        return r.status, dict(r.getheaders()), dados

    def subir(self, arq, caminho, pedaco=200_000):
        dados = open(caminho, "rb").read()
        off = 0
        while off < len(dados):
            p = dados[off:off + pedaco]
            st, h, _ = self.req("PUT", f"/v1/up/{PID}/{arq}", p, cab={"X-Offset": str(off), "Content-Length": str(len(p))})
            self.assertEqual(st, 200, h)
            off = int(h["X-Recebido"])
        return len(dados)

    def test_1_saude_e_acesso(self):
        st, _, d = self.req("GET", "/saude", tok=None)
        self.assertEqual(st, 200)
        self.assertTrue(json.loads(d)["assinatura"])
        self.assertEqual(self.req("HEAD", f"/v1/up/{PID}/original", tok=None)[0], 401)
        self.assertEqual(self.req("HEAD", f"/v1/up/{PID}/original", tok="tok-invalido-aaaaaaaaaaaaaaaa")[0], 401)
        self.assertEqual(self.req("HEAD", f"/v1/up/{PID}/original", tok=TOK_S)[0], 403)
        self.assertEqual(self.req("HEAD", f"/v1/up/{PID_ALHEIO}/original")[0], 404)
        self.assertEqual(self.req("GET", f"/v1/estado/{PID_ALHEIO}")[0], 404)
        self.assertEqual(self.req("GET", "/v1/estado/nao-e-uuid")[0], 404)
        st, _, d = self.req("POST", f"/v1/montar/{PID}", b'{"trechos":[]}', tok=TOK_S, cab={"Content-Length": "14"})
        self.assertEqual(st, 403)

    def test_2_upload_retomavel(self):
        dados = open(self.orig, "rb").read()
        st, h, _ = self.req("HEAD", f"/v1/up/{PID}/original")
        self.assertEqual((st, h.get("X-Recebido")), (200, "0"))
        p = dados[:100_000]
        self.assertEqual(self.req("PUT", f"/v1/up/{PID}/original", p, cab={"X-Offset": "0"})[0], 200)
        st, h, _ = self.req("PUT", f"/v1/up/{PID}/original", dados[100_000:150_000], cab={"X-Offset": "5"})
        self.assertEqual((st, h.get("X-Recebido")), (409, "100000"))  # offset errado: diz onde parou
        st, h, _ = self.req("HEAD", f"/v1/up/{PID}/original")
        self.assertEqual(h.get("X-Recebido"), "100000")
        resto = dados[100_000:]
        self.assertEqual(self.req("PUT", f"/v1/up/{PID}/original", resto, cab={"X-Offset": "100000"})[0], 200)
        st, _, d = self.req("POST", f"/v1/fim/{PID}/original")
        j = json.loads(d)
        self.assertEqual(st, 200, j)
        self.assertAlmostEqual(j["duracao_seg"], 6.0, delta=0.2)
        self.assertEqual(j["bytes"], len(dados))
        st, h, _ = self.req("HEAD", f"/v1/up/{PID}/original")
        self.assertEqual(h.get("X-Completo"), "1")

    def test_3_lixo_recusado(self):
        p = b"isto nao e video" * 100
        PIDX = PID
        self.req("PUT", f"/v1/up/{PIDX}/reacao", p, cab={"X-Offset": "0"})
        st, _, d = self.req("POST", f"/v1/fim/{PIDX}/reacao")
        self.assertEqual(st, 422, d)

    def test_4_montar_e_baixar(self):
        self.subir("reacao", self.reac)
        st, _, d = self.req("POST", f"/v1/fim/{PID}/reacao")
        self.assertEqual(st, 200, d)
        self.assertEqual(self.req("POST", f"/v1/montar/{PID}", b"nao json", cab={"Content-Type": "application/json"})[0], 400)
        ped = {"modo": "aqui", "layout": "dividido", "legenda": True, "cortar_silencio": True, "trechos": [
            {"tipo": "tocando", "ini": 0, "fim": 1.0, "orig": 0},
            {"tipo": "comentario", "ini": 1.0, "fim": 3.5, "orig": 1.0},
            {"tipo": "tocando", "ini": 3.5, "fim": 4.0, "orig": 1.0}]}
        st, _, d = self.req("POST", f"/v1/montar/{PID}", json.dumps(ped).encode(), cab={"Content-Type": "application/json"})
        self.assertEqual(st, 202, d)
        st2, _, _ = self.req("POST", f"/v1/montar/{PID}", json.dumps(ped).encode(), cab={"Content-Type": "application/json"})
        self.assertIn(st2, (202, 409))
        fim = time.time() + 180
        e = {}
        while time.time() < fim:
            e = json.loads(self.req("GET", f"/v1/estado/{PID}")[2])
            if e.get("estado") in ("pronto", "erro"):
                break
            time.sleep(1)
        self.assertEqual(e.get("estado"), "pronto", e)
        self.assertTrue(e["resultado"]["avisos"])  # sem Whisper: segue e avisa
        url = e["arquivo"]
        st, h, d = self.req("GET", url, tok=None, cab={"Range": "bytes=0-99"})
        self.assertEqual((st, len(d)), (206, 100))
        self.assertTrue(h["Content-Range"].startswith("bytes 0-99/"))
        st, h, d = self.req("GET", e["baixar"], tok=None)
        self.assertEqual(st, 200)
        self.assertIn("attachment", h.get("Content-Disposition", ""))
        self.assertGreater(len(d), 10_000)
        self.assertEqual(self.req("GET", url[:-4] + "0000", tok=None)[0], 401)          # assinatura adulterada
        self.assertEqual(self.req("GET", url.replace(PID, PID_ALHEIO), tok=None)[0], 401)  # outro projeto
        self.assertEqual(self.req("GET", url.replace("final.mp4", "capa.jpg"), tok=None)[0], 401)  # outro arquivo
        self.assertEqual(self.req("GET", e["capa"], tok=None)[0], 200)

    def test_4b_edicao_e_previas(self):
        """Depois da montagem: a tela de edição recebe trechos, falas e prévias assinadas; salva e reabre as escolhas."""
        self.assertEqual(self.req("GET", f"/v1/edicao/{PID}", tok=None)[0], 401)
        self.assertEqual(self.req("GET", f"/v1/edicao/{PID_ALHEIO}")[0], 404)
        st, _, d = self.req("GET", f"/v1/edicao/{PID}")
        self.assertEqual(st, 200, d)
        e = json.loads(d)
        self.assertIsNone(e["salva"])
        self.assertEqual([t["tipo"] for t in e["base"]["trechos"]][:3], ["tocando", "comentario", "tocando"])
        self.assertTrue(e["falas"], e)                       # a "voz" de 1 a 3 s
        self.assertLess(abs(e["falas"][0][0] - 1.0), 0.3, e["falas"])
        for nome in ("original", "reacao"):
            url = e["previas"][nome]
            self.assertTrue(url and url.startswith(f"/v1/arquivo/{PID}/previa_"), e["previas"])
            st, h, dd = self.req("GET", url, tok=None, cab={"Range": "bytes=0-99"})
            self.assertEqual((st, len(dd)), (206, 100))
            self.assertEqual(h.get("Content-Type"), "video/mp4")
        trechos = [dict(t) for t in e["base"]["trechos"]]
        trechos[0].update(layout="original_pip", volume=0.3)
        trechos[2].update(mudo=True, removido=False)
        corpo = json.dumps({"trechos": trechos, "edicao": {"volume_geral": 0.8, "ia_titulo": False}}).encode()
        st, _, d = self.req("PUT", f"/v1/edicao/{PID}", corpo, cab={"Content-Type": "application/json"})
        self.assertEqual(st, 200, d)
        s = json.loads(self.req("GET", f"/v1/edicao/{PID}")[2])["salva"]
        self.assertEqual(s["trechos"][0]["layout"], "original_pip")
        self.assertEqual(s["trechos"][0]["volume"], 0.3)
        self.assertEqual(s["trechos"][2]["removido"], False)
        self.assertEqual(s["edicao"], {"volume_geral": 0.8, "ia_gancho": True, "ia_titulo": False, "cortes_ia_restaurados": []})
        trechos[0]["layout"] = "lateral"
        st, _, d = self.req("PUT", f"/v1/edicao/{PID}", json.dumps({"trechos": trechos}).encode(), cab={"Content-Type": "application/json"})
        self.assertEqual(st, 400, d)
        self.assertEqual(self.req("PUT", f"/v1/edicao/{PID}", b"{}", tok=TOK_S, cab={"Content-Type": "application/json"})[0], 403)

    def test_4c_link(self):
        """Link: só domínios conhecidos; download que falha vira erro legível (nunca fica preso em "baixando")."""
        st, _, d = self.req("POST", f"/v1/link/{PID}", json.dumps({"url": "https://exemplo.com/video.mp4"}).encode(),
                            cab={"Content-Type": "application/json"})
        self.assertEqual(st, 400, d)
        self.assertEqual(self.req("POST", f"/v1/link/{PID}", json.dumps({"url": "https://www.instagram.com/reel/AAAAAAAAAAA/"}).encode(),
                                  tok=None, cab={"Content-Type": "application/json"})[0], 401)
        self.assertEqual(json.loads(self.req("GET", f"/v1/link/{PID}")[2])["estado"], "nenhum")
        # um link "válido" num servidor de teste sem internet nem yt-dlp: tem que terminar em erro com texto para a tela
        st, _, d = self.req("POST", f"/v1/link/{PID}", json.dumps({"url": "https://www.instagram.com/reel/AAAAAAAAAAA/?igsh=x"}).encode(),
                            cab={"Content-Type": "application/json"})
        self.assertEqual(st, 202, d)
        self.assertEqual(json.loads(d)["url"], "https://www.instagram.com/reel/AAAAAAAAAAA/")
        fim, e = time.time() + 120, {}
        while time.time() < fim:
            e = json.loads(self.req("GET", f"/v1/link/{PID}")[2])
            if e.get("estado") in ("pronto", "erro"):
                break
            time.sleep(0.5)
        self.assertEqual(e.get("estado"), "erro", e)
        self.assertIn("Escolher vídeo", e.get("erro", ""))

    def test_5_cors(self):
        st, h, _ = self.req("OPTIONS", f"/v1/up/{PID}/original", tok=None, cab={"Origin": "https://equipe.brenoxavier.com.br"})
        self.assertEqual(h.get("Access-Control-Allow-Origin"), "https://equipe.brenoxavier.com.br")
        self.assertIn("x-offset", h.get("Access-Control-Allow-Headers", ""))
        st, h, _ = self.req("OPTIONS", f"/v1/up/{PID}/original", tok=None, cab={"Origin": "https://malicioso.com"})
        self.assertNotIn("Access-Control-Allow-Origin", h)

    def test_6_apagar(self):
        self.assertEqual(self.req("DELETE", f"/v1/projeto/{PID}", tok=TOK_S)[0], 403)
        self.assertEqual(self.req("DELETE", f"/v1/projeto/{PID}")[0], 200)
        e = json.loads(self.req("GET", f"/v1/estado/{PID}")[2])
        self.assertEqual(e["estado"], "novo")
        self.assertEqual(e["recebidos"], {"original": False, "reacao": False})


if __name__ == "__main__":
    unittest.main()
