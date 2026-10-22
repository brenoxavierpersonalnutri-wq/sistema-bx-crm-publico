"""Edição com IA: validação da resposta, aplicação no plano de pedaços, legenda, ASS e o ajudante do claude -p.

    python3 -m unittest discover -s infra/react/test -p 'test_*.py'
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import edicao_ia as IA  # noqa: E402
import ia_ponte  # noqa: E402
import montagem as M  # noqa: E402


def falas(*blocos):
    """[(t0, "palavras ..."), ...] -> palavras com 0,3 s cada e 0,05 s entre elas."""
    out = []
    for t, texto in blocos:
        for w in texto.split():
            out.append({"w": w, "ini": round(t, 3), "fim": round(t + 0.3, 3)})
            t += 0.35
    return out


# linha do tempo: tocando 0-10, comentário 10-20 (orig 10), tocando 20-50, comentário 50-60 (orig 40), tocando 60-70
TRECHOS = [
    {"tipo": "tocando", "ini": 0.0, "fim": 10.0, "orig": 0.0},
    {"tipo": "comentario", "ini": 10.0, "fim": 20.0, "orig": 10.0},
    {"tipo": "tocando", "ini": 20.0, "fim": 50.0, "orig": 10.0},
    {"tipo": "comentario", "ini": 50.0, "fim": 60.0, "orig": 40.0},
    {"tipo": "tocando", "ini": 60.0, "fim": 70.0, "orig": 40.0},
]
PAL = falas((3.0, "nossa"),                                                       # 0      tocando
            (11.0, "é então olha esse agachamento a postura está errada"),       # 1-9    comentário 1
            (16.0, "o joelho entra demais"),                                      # 10-13  comentário 1, outra frase
            (51.0, "tipo assim sei lá"),                                          # 14-17  comentário 3
            (55.0, "ninguém te conta isso na academia"))                          # 18-23  comentário 3


def plano_bruto(**extra):
    r = {"titulo": "O erro do agachamento 🔥 #fit", "palavras_chave": [5, 6, 9, 3, 4, 12, 22], "gancho": {"de": 18, "ate": 23},
         "cortar": [{"de": 1, "ate": 2}], "remover": [], "enfase": [{"de": 8, "ate": 9}], "notas": [{"comentario": 1, "nota": 5},
                                                                                                   {"comentario": 3, "nota": 2}]}
    r.update(extra)
    return r


class Validacao(unittest.TestCase):
    def setUp(self):
        self.frases = IA.montar_frases(PAL, TRECHOS)

    def test_frases_quebram_por_trecho_e_pausa(self):
        self.assertEqual([(f["trecho"], f["de"], f["ate"]) for f in self.frases],
                         [(0, 0, 0), (1, 1, 9), (1, 10, 13), (3, 14, 17), (3, 18, 23)])

    def test_titulo_limpo_e_curto(self):
        p = IA.validar_resposta(plano_bruto(), PAL, self.frases, TRECHOS)
        self.assertEqual(p["titulo"], "O ERRO DO AGACHAMENTO FIT")
        self.assertLessEqual(len(IA.limpar_titulo("um dois três quatro cinco seis sete oito nove").split()), 7)

    def test_no_maximo_duas_chaves_por_frase(self):
        p = IA.validar_resposta(plano_bruto(), PAL, self.frases, TRECHOS)
        self.assertEqual(p["chaves"], [5, 9, 12, 22])   # 6 ("a") é curta demais; 3 e 4 passam do limite da frase

    def test_indices_ruins_e_faixa_atravessando_comentario_saem(self):
        r = plano_bruto(cortar=[{"de": 9, "ate": 15}, {"de": -1, "ate": 2}, {"de": 0, "ate": 0}, {"de": "x"}, {"de": 2, "ate": 1}],
                        gancho={"de": 0, "ate": 0}, enfase=[{"de": 500, "ate": 501}], palavras_chave=[999, "a"])
        p = IA.validar_resposta(r, PAL, self.frases, TRECHOS)
        self.assertEqual(p["cortar"], [(1, 2)])     # só a invertida, desvirada
        self.assertIsNone(p["gancho"])             # gancho em fala por cima do tocando: não vale
        self.assertEqual(p["enfase"], [])
        self.assertEqual(p["chaves"], [])

    def test_nao_tira_todos_os_comentarios_nem_o_do_gancho(self):
        p = IA.validar_resposta(plano_bruto(remover=[1, 3]), PAL, self.frases, TRECHOS)
        self.assertEqual(p["remover"], [1])        # o 3 tem o gancho
        p = IA.validar_resposta(plano_bruto(remover=[1, 3], gancho={"de": 1, "ate": 1}), PAL, self.frases, TRECHOS)
        self.assertEqual(p["remover"], [3])

    def test_corte_que_pisa_no_gancho_sai(self):
        p = IA.validar_resposta(plano_bruto(cortar=[{"de": 19, "ate": 20}]), PAL, self.frases, TRECHOS)
        self.assertEqual(p["cortar"], [])

    def test_resposta_nao_objeto(self):
        with self.assertRaises(IA.FalhaIA):
            IA.validar_resposta([], PAL, self.frases, TRECHOS)
        self.assertEqual(IA.extrair_json('```json\n{"a": 1}\n```'), {"a": 1})
        with self.assertRaises(IA.FalhaIA):
            IA.extrair_json("sem json")


class Editar(unittest.TestCase):
    def test_uma_chamada_e_uso_registrado(self):
        chamadas = []

        def falso(sistema, usuario):
            chamadas.append((sistema, usuario))
            return {"conteudo": plano_bruto(), "modelo": "claude-sonnet-5-5", "tokens_entrada": 3000, "tokens_saida": 400,
                    "custo_lista_usd": 0.01, "fonte": "claude-assinatura"}
        plano, uso = IA.editar(PAL, TRECHOS, 90, 80, chamar=falso)
        self.assertEqual(len(chamadas), 1)
        self.assertIn("[5]agachamento", chamadas[0][1])
        self.assertIn("70% extraordinário", chamadas[0][0])        # contexto do Head vai junto
        self.assertEqual((uso["chamadas"], uso["tokens_entrada"], uso["tokens_saida"], uso["custo_usd"]), (1, 3000, 400, 0.0))
        self.assertEqual(plano["gancho"], (18, 23))

    def test_resposta_quebrada_nao_tenta_de_novo(self):
        n = []

        def quebrado(s, u):
            n.append(1)
            return {"conteudo": "isto não é json", "tokens_entrada": 10, "tokens_saida": 5}
        with self.assertRaises(IA.FalhaIA) as cm:
            IA.editar(PAL, TRECHOS, 90, 80, chamar=quebrado)
        self.assertEqual(len(n), 1)
        self.assertEqual(cm.exception.custo["tokens_entrada"], 10)

    def test_sem_fala_em_comentario(self):
        with self.assertRaises(IA.FalhaIA):
            IA.editar(PAL[:1], TRECHOS, 90, 80, chamar=lambda s, u: {})

    def test_ajudante_fora_do_ar(self):
        IA.SOCKET = "/tmp/nao-existe-headturbo.sock"
        with self.assertRaises(IA.FalhaIA) as cm:
            IA.chamar_claude("s", "u")
        self.assertIn("não está rodando", str(cm.exception))


class Aplicar(unittest.TestCase):
    def pecas(self):
        return M.planejar(TRECHOS, [], "dividido", cortar=False)

    def plano(self, **extra):
        return IA.validar_resposta(plano_bruto(**extra), PAL, IA.montar_frases(PAL, TRECHOS), TRECHOS)

    def test_gancho_abre_o_video_entre_2_e_4_s(self):
        pec, res = M.aplicar_edicao(self.pecas(), TRECHOS, PAL, self.plano(), 600)
        g = pec[0]
        self.assertTrue(g.get("gancho"))
        self.assertEqual((g["tipo"], g["orig"], g["k"]), ("comentario", 40.0, 3))
        self.assertTrue(M.GANCHO_MIN <= g["dur"] <= M.GANCHO_MAX, g["dur"])
        self.assertAlmostEqual(g["ini"], PAL[18]["ini"] - 0.08, places=2)

    def test_corte_de_muleta_nao_come_palavra_vizinha(self):
        pec, res = M.aplicar_edicao(self.pecas(), TRECHOS, PAL, self.plano(gancho={"de": 99, "ate": 99}), 600)
        c1 = [p for p in pec if p.get("k") == 1]
        # "é então" (11,00-11,65) sai; "olha" começa em 11,70 e fica inteira
        self.assertEqual(res["cortes"], 1)
        self.assertTrue(any(abs(p["ini"] - (PAL[3]["ini"] - 0.05)) < 0.04 for p in c1), [p["ini"] for p in c1])
        for p in c1:
            for w in PAL[1:3]:
                self.assertFalse(p["ini"] <= (w["ini"] + w["fim"]) / 2 < p["ini"] + p["dur"])

    def test_remover_comentario(self):
        pec, res = M.aplicar_edicao(self.pecas(), TRECHOS, PAL, self.plano(remover=[1]), 600)
        self.assertFalse(any(p.get("k") == 1 for p in pec))
        self.assertEqual(res["comentarios_removidos"], 1)

    def test_duracao_alvo_encurta_tocando_sem_cortar_fala_e_tira_nota_menor(self):
        # total sem IA = 70 s + gancho. Máximo 30 s: tocando vai a 3 s; ainda passa, sai o comentário de nota menor
        # (o 3 tem o gancho e é protegido: sai o 1, mesmo com nota 5, porque é o único que pode sair)
        pec, res = M.aplicar_edicao(self.pecas(), TRECHOS, PAL, self.plano(), 30)
        self.assertLessEqual(res["duracao_depois_seg"], 30.5)
        t0 = next(p for p in pec if p.get("k") == 0)
        # o primeiro tocando tem a fala "nossa" em 3,0 s: o corte do começo para antes dela
        self.assertLessEqual(t0["ini"], PAL[0]["ini"] - 0.1)
        self.assertAlmostEqual(t0["orig"], t0["ini"], places=3)     # o original anda junto
        for p in pec:
            if p["tipo"] == "tocando":
                self.assertGreaterEqual(p["dur"], M.TOCANDO_PISO_2 - 0.05)

    def test_duracao_alvo_prefere_tirar_nota_menor(self):
        pl = self.plano(gancho={"de": 99, "ate": 99}, notas=[{"comentario": 1, "nota": 5}, {"comentario": 3, "nota": 1}])
        pec, res = M.aplicar_edicao(self.pecas(), TRECHOS, PAL, pl, 25)
        ks = {p["k"] for p in pec if p["tipo"] == "comentario"}
        self.assertEqual(ks, {1})
        self.assertEqual(res["comentarios_tirados_pela_duracao"], 1)

    def test_zoom_nas_enfases_em_tempo_do_pedaco(self):
        pec, res = M.aplicar_edicao(self.pecas(), TRECHOS, PAL, self.plano(), 600)
        z = [p for p in pec if p.get("zoom")]
        self.assertEqual(res["zooms"], 1)
        p = z[0]
        a, b = p["zoom"][0]
        self.assertAlmostEqual(p["ini"] + a, PAL[8]["ini"] - 0.05, places=2)
        self.assertGreaterEqual(b - a, 0.8)

    def test_palavras_no_final_repetem_no_gancho(self):
        pec, _ = M.aplicar_edicao(self.pecas(), TRECHOS, PAL, self.plano(), 600)
        pec = M.linha_final(pec)
        f = M.palavras_no_final(pec, [{**w, "k": i == 23} for i, w in enumerate(PAL)])
        acad = [w for w in f if w["w"] == "academia"]
        self.assertEqual(len(acad), 2)                       # no gancho e no lugar dele
        self.assertLess(acad[0]["ini"], 4.0)
        self.assertTrue(all(w["k"] for w in acad))


class Ass(unittest.TestCase):
    def test_titulo_no_topo_e_chave_verde(self):
        grupos = M.agrupar_palavras([{"w": "olha", "ini": 0.0, "fim": 0.3}, {"w": "agachamento", "ini": 0.35, "fim": 0.9, "k": True}])
        ass = M.gerar_ass(grupos, lambda t: 960, "O ERRO QUE NINGUÉM TE CONTA", 12.0)
        tit = [l for l in ass.splitlines() if l.startswith("Dialogue: 1,")]
        self.assertEqual(len(tit), 1)
        self.assertIn("0:00:12.00,T,", tit[0])
        self.assertIn(r"\an8\pos(540,64)", tit[0])
        self.assertIn(r"\N", tit[0])
        primeira = [l for l in ass.splitlines() if l.startswith("Dialogue: 0,")][0]
        self.assertIn(r"{\c&H0060FF3C&\fscx112\fscy112}AGACHAMENTO", primeira)

    def test_linhas_titulo(self):
        self.assertEqual(M.linhas_titulo("CURTO"), ["CURTO"])
        self.assertEqual(M.linhas_titulo("O ERRO QUE NINGUÉM TE CONTA"), ["O ERRO QUE", "NINGUÉM TE CONTA"])


class Zoom(unittest.TestCase):
    def test_filtro_com_e_sem_zoom(self):
        self.assertNotIn("overlay", M.filtro_ele("0:v", "bot", 1080, 960))
        f = M.filtro_ele("0:v", "bot", 1080, 960, [[0.5, 1.5], [2.0, 3.0]])
        self.assertIn("scale=1296:1152", f)
        self.assertIn("enable='between(t,0.500,1.500)+between(t,2.000,3.000)'", f)
        self.assertTrue(f.endswith("[bot]"))


class Pedido(unittest.TestCase):
    def test_ia_e_duracao(self):
        ok, p = M.validar_pedido({"modo": "separado"})
        self.assertTrue(ok)
        self.assertEqual((p["ia"], p["duracao_max"]), (True, 90.0))
        ok, p = M.validar_pedido({"modo": "separado", "ia": False, "duracao_max": 5})
        self.assertEqual((p["ia"], p["duracao_max"]), (False, 15.0))
        ok, p = M.validar_pedido({"modo": "separado", "duracao_max": "x"})
        self.assertFalse(ok)


class Ponte(unittest.TestCase):
    def test_comando_sem_ferramentas_hooks_nem_sessao(self):
        c = ia_ponte.comando("sis", {"type": "object"})
        for flag in ("-p", "--strict-mcp-config", "--no-session-persistence"):
            self.assertIn(flag, c)
        self.assertEqual(c[c.index("--tools") + 1], "")
        self.assertEqual(c[c.index("--setting-sources") + 1], "")
        self.assertEqual(c[c.index("--output-format") + 1], "json")

    def test_interpretar(self):
        ok = json.dumps({"type": "result", "subtype": "success", "is_error": False, "structured_output": {"titulo": "X"},
                         "usage": {"input_tokens": 2, "cache_creation_input_tokens": 2100, "cache_read_input_tokens": 600,
                                   "output_tokens": 62}, "total_cost_usd": 0.0048, "modelUsage": {"claude-sonnet-5-5": {}}})
        r = ia_ponte.interpretar(ok, 0)
        self.assertEqual((r["ok"], r["saida"], r["tokens_entrada"], r["tokens_saida"], r["modelo"]),
                         (True, {"titulo": "X"}, 2702, 62, "claude-sonnet-5-5"))
        r = ia_ponte.interpretar(json.dumps({"is_error": True, "result": "Invalid API key · Please run /login"}), 1)
        self.assertFalse(r["ok"])
        self.assertIn("login", r["erro"])
        self.assertFalse(ia_ponte.interpretar("Please run /login", 1)["ok"])
        self.assertFalse(ia_ponte.interpretar(json.dumps({"subtype": "success", "result": "texto solto"}), 0)["ok"])


if __name__ == "__main__":
    unittest.main()
