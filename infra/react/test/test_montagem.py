"""Testes das partes puras da montagem (sem ffmpeg). Rodar: python3 -m unittest discover -s infra/react/test"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import montagem as m  # noqa: E402


class Pedido(unittest.TestCase):
    def test_valida_e_limpa(self):
        ok, p = m.validar_pedido({"trechos": [{"tipo": "tocando", "ini": 0, "fim": 2, "orig": 0}]})
        self.assertTrue(ok)
        self.assertEqual(p["modo"], "aqui")
        self.assertEqual(p["layout"], "dividido")
        self.assertTrue(p["legenda"] and p["cortar_silencio"])

    def test_recusa(self):
        self.assertFalse(m.validar_pedido([])[0])
        self.assertFalse(m.validar_pedido({"layout": "x", "trechos": [{}]})[0])
        self.assertFalse(m.validar_pedido({"trechos": []})[0])
        self.assertFalse(m.validar_pedido({"trechos": [{"tipo": "outro", "ini": 0, "fim": 1}]})[0])
        self.assertFalse(m.validar_pedido({"trechos": [{"tipo": "tocando", "ini": "a", "fim": 1}]})[0])
        self.assertFalse(m.validar_pedido({"trechos": [{"tipo": "tocando", "ini": float("nan"), "fim": 1}]})[0])
        self.assertFalse(m.validar_pedido({"trechos": [{"tipo": "tocando", "ini": 0, "fim": 1}] * 1001})[0])

    def test_separado_sem_trechos(self):
        ok, p = m.validar_pedido({"modo": "separado"})
        self.assertTrue(ok)
        self.assertEqual(p["trechos"], [])


class Linha(unittest.TestCase):
    def test_preenche_buraco_e_limita(self):
        t = m.normalizar_trechos([
            {"tipo": "tocando", "ini": 0.3, "fim": 5, "orig": 0},
            {"tipo": "comentario", "ini": 5, "fim": 9, "orig": 4.7},
            {"tipo": "tocando", "ini": 9, "fim": 30, "orig": 4.7},
        ], dur_reacao=20, dur_original=10)
        self.assertEqual(t[0], {"tipo": "comentario", "ini": 0.0, "fim": 0.3, "orig": 0})
        self.assertEqual(t[1]["tipo"], "tocando")
        # o último tocando passaria do fim do original (4.7 + 11 > 10): acaba no fim e o resto congela no último quadro
        toc = t[3]
        self.assertAlmostEqual(toc["fim"] - toc["ini"], 10 - 4.7, places=3)
        self.assertEqual(t[4]["tipo"], "comentario")
        self.assertAlmostEqual(t[4]["fim"], 20)
        self.assertAlmostEqual(t[4]["orig"], 10 - 1 / 30, places=3)

    def test_sobreposicao(self):
        t = m.normalizar_trechos([
            {"tipo": "tocando", "ini": 0, "fim": 5, "orig": 0},
            {"tipo": "comentario", "ini": 4, "fim": 8, "orig": 5},
        ], 8, 60)
        self.assertEqual([(x["ini"], x["fim"]) for x in t], [(0, 5), (5, 8)])


class Silencio(unittest.TestCase):
    def test_le_saida(self):
        txt = ("[silencedetect @ 0x1] silence_start: -0.002\n[silencedetect @ 0x1] silence_end: 1.5 | silence_duration: 1.5\n"
               "[silencedetect @ 0x1] silence_start: 8.25\n")
        self.assertEqual(m.ler_silencedetect(txt, 10.0), [(0.0, 1.5), (8.25, 10.0)])

    def test_limiar(self):
        self.assertEqual(m.limiar_silencio(None), -38.0)
        self.assertEqual(m.limiar_silencio(-20), -34.0)
        self.assertEqual(m.limiar_silencio(-10), -28.0)
        self.assertEqual(m.limiar_silencio(-60), -50.0)

    def test_corta_respiros_e_silencio_longo(self):
        trechos = [
            {"tipo": "tocando", "ini": 0, "fim": 4, "orig": 0},
            {"tipo": "comentario", "ini": 4, "fim": 14, "orig": 4},
            {"tipo": "comentario", "ini": 14, "fim": 16, "orig": 4},  # mudo: sai
        ]
        # fala 5-7 e 9-10 (silêncio interno de 2 s), resto silêncio
        sil = [(3.0, 5.0), (7.0, 9.0), (10.0, 16.0)]
        p = m.planejar(trechos, sil, "dividido", True)
        self.assertEqual(p[0]["tipo"], "tocando")
        self.assertAlmostEqual(p[0]["dur"], 4.0)
        com = [x for x in p if x["tipo"] == "comentario"]
        self.assertEqual(len(com), 2)
        self.assertAlmostEqual(com[0]["ini"], 5 - m.PAD_ANTES, places=3)
        self.assertAlmostEqual(com[0]["dur"], m.quadro(2 + m.PAD_ANTES + m.PAD_DEPOIS), places=3)
        self.assertAlmostEqual(com[1]["ini"], 9 - m.PAD_ANTES, places=3)
        self.assertTrue(all(abs(x["dur"] * 30 - round(x["dur"] * 30)) < 1e-6 for x in p))  # quadros inteiros

    def test_sem_cortar(self):
        p = m.planejar([{"tipo": "comentario", "ini": 0, "fim": 3, "orig": 1}], [(0, 3)], "dividido", False)
        self.assertEqual(len(p), 1)
        self.assertAlmostEqual(p[0]["dur"], 3)

    def test_cheia_longos(self):
        tr = [{"tipo": "comentario", "ini": 0, "fim": 20, "orig": 1}, {"tipo": "comentario", "ini": 20, "fim": 23, "orig": 2}]
        p = m.planejar(tr, [], "cheia_longos", True)
        self.assertEqual([x["cheia"] for x in p], [True, False])
        self.assertEqual([x["cheia"] for x in m.planejar(tr, [], "dividido", True)], [False, False])

    def test_silencio_curto_fica(self):
        tr = [{"tipo": "comentario", "ini": 0, "fim": 5, "orig": 1}]
        p = m.planejar(tr, [(0, 1), (2, 2.5), (4, 5)], "dividido", True)  # pausa de 0,5 s fica
        self.assertEqual(len(p), 1)


class Legenda(unittest.TestCase):
    def test_agrupa_2_a_4(self):
        ws = [{"w": w, "ini": i * 0.3, "fim": i * 0.3 + 0.25} for i, w in enumerate(
            " olha só esse agachamento, a postura está toda errada.".split())]
        g = m.agrupar_palavras(ws)
        self.assertTrue(all(1 <= len(x["palavras"]) <= 4 for x in g))
        self.assertTrue(all(sum(len(p["t"]) for p in x["palavras"]) <= m.MAX_LETRAS + 12 for x in g))
        self.assertEqual(g[0]["palavras"][0]["t"], "OLHA")
        for a, b in zip(g, g[1:]):
            self.assertLessEqual(a["fim"], b["ini"] + 1e-9)

    def test_pausa_quebra(self):
        g = m.agrupar_palavras([{"w": "um", "ini": 0, "fim": 0.2}, {"w": "dois", "ini": 1.5, "fim": 1.8}])
        self.assertEqual(len(g), 2)

    def test_limpa(self):
        self.assertEqual(m.limpar_palavra(' "Tá{\\b1}'), "TÁB1")
        self.assertEqual(m.agrupar_palavras([{"w": "...", "ini": 0, "fim": 1}]), [])
        g = m.agrupar_palavras([{"w": "errada.", "ini": 0, "fim": 1}, {"w": "sério?", "ini": 1, "fim": 2}])
        self.assertEqual([p["t"] for x in g for p in x["palavras"]], ["ERRADA", "SÉRIO?"])

    def test_ass(self):
        g = m.agrupar_palavras([{"w": "olha", "ini": 1.0, "fim": 1.3}, {"w": "isso", "ini": 1.35, "fim": 1.7}])
        ass = m.gerar_ass(g, lambda t: 960)
        self.assertIn("PlayResY: 1920", ass)
        self.assertIn("Archivo Black", ass)
        linhas = [l for l in ass.splitlines() if l.startswith("Dialogue:")]
        self.assertEqual(len(linhas), 2)
        self.assertIn(r"\pos(540,960)", linhas[0])
        self.assertIn(r"{\c&H0000E5FF&}OLHA", linhas[0])
        self.assertIn(r"{\c&H0000E5FF&}ISSO", linhas[1])
        self.assertEqual(m.tempo_ass(61.234), "0:01:01.23")


class Comandos(unittest.TestCase):
    def test_peca_tocando(self):
        p = {"tipo": "tocando", "ini": 1.0, "dur": 2.0, "orig": 3.0, "cheia": False}
        c = m.cmd_peca(p, "r.bin", "o.bin", None, True, "s.mkv", "v.wav")
        g = c[c.index("-filter_complex") + 1]
        self.assertIn("sidechaincompress", g)
        self.assertIn("vstack", g)
        self.assertIn("agate", g)
        self.assertIn("o.bin", c)

    def test_peca_comentario_cheia(self):
        p = {"tipo": "comentario", "ini": 1.0, "dur": 6.0, "orig": 3.0, "cheia": True}
        c = m.cmd_peca(p, "r.bin", "o.bin", "t.png", True, "s.mkv", "v.wav")
        g = c[c.index("-filter_complex") + 1]
        self.assertIn("t.png", c)
        self.assertNotIn("o.bin", c)
        self.assertIn("pad=444:396", g)
        self.assertNotIn("sidechaincompress", g)

    def test_sem_audio_no_original(self):
        p = {"tipo": "tocando", "ini": 0, "dur": 1.0, "orig": 0, "cheia": False}
        g = m.cmd_peca(p, "r", "o", None, False, "s", "v")
        self.assertIn("anullsrc", g[g.index("-filter_complex") + 1])

    def test_final(self):
        c = m.cmd_final("lista.txt", "legendas.ass", "f.mp4")
        self.assertIn("+faststart", c)
        self.assertIn("libx264", c)
        self.assertIn("aac", c)
        self.assertTrue(any(x.startswith("ass=legendas.ass:fontsdir=") for x in c))


if __name__ == "__main__":
    unittest.main()


class EdicaoManual(unittest.TestCase):
    """Tela de edição: escolhas do Breno por trecho (layout, volume, mudo, congelar, remover) e o que vence a IA."""
    TR = [{"tipo": "tocando", "ini": 0, "fim": 4, "orig": 0},
          {"tipo": "comentario", "ini": 4, "fim": 8, "orig": 4},
          {"tipo": "tocando", "ini": 8, "fim": 12, "orig": 4}]

    def test_validar_extras(self):
        ok, p = m.validar_pedido({"trechos": [{**self.TR[0], "layout": "original_pip", "volume": 1.7, "mudo": True},
                                              {**self.TR[1], "congelar": True, "removido": False},
                                              {**self.TR[2], "layout": "auto", "congelar": True, "pausa": True}],
                                  "edicao": {"volume_geral": "0.5", "ia_gancho": False, "cortes_ia_restaurados": ["c1-2", "x", "c1-2"]}})
        self.assertTrue(ok, p)
        t = p["trechos"]
        self.assertEqual((t[0]["layout"], t[0]["volume"], t[0]["mudo"]), ("original_pip", 1.0, True))
        self.assertNotIn("congelar", t[1])          # congelar só vale em trecho tocando
        self.assertEqual(t[1]["removido"], False)
        self.assertNotIn("layout", t[2])            # "auto" = sem escolha
        self.assertTrue(t[2]["congelar"] and t[2]["pausa"])
        self.assertEqual(p["edicao"], {"volume_geral": 0.5, "ia_gancho": False, "ia_titulo": True, "cortes_ia_restaurados": ["c1-2"]})
        self.assertFalse(m.validar_pedido({"trechos": [{**self.TR[0], "layout": "lado"}]})[0])
        self.assertFalse(m.validar_pedido({"trechos": [{**self.TR[0], "volume": "alto"}]})[0])
        self.assertFalse(m.validar_pedido({"trechos": self.TR, "edicao": {"volume_geral": "x"}})[0])
        ok, p = m.validar_pedido({"modo": "separado", "trechos": self.TR})   # separado editado: usa os trechos dele
        self.assertTrue(ok and len(p["trechos"]) == 3)

    def test_normalizar_guarda_escolhas_e_nao_junta_diferentes(self):
        tr = [{"tipo": "comentario", "ini": 0, "fim": 2, "orig": 1, "layout": "ele"},
              {"tipo": "comentario", "ini": 2, "fim": 4, "orig": 1},
              {"tipo": "tocando", "ini": 4, "fim": 9, "orig": 1, "congelar": True, "pausa": True}]
        n = m.normalizar_trechos(tr, 9, 30)
        self.assertEqual(len(n), 3)
        self.assertEqual(n[0]["layout"], "ele")
        self.assertTrue(n[2]["congelar"])

    def test_planejar_layout_volume_removido_congelado(self):
        tr = [{**self.TR[0], "layout": "original", "volume": 0.3},
              {**self.TR[1], "removido": True},
              {**self.TR[2], "mudo": True, "removido": False}]
        p = m.planejar(tr, [], "dividido", True, geral=0.5)
        self.assertEqual([x["k"] for x in p], [0, 2])            # o removido não entra
        self.assertEqual((p[0]["layout"], p[0]["vol"]), ("original", 0.15))
        self.assertEqual((p[1]["vol"], p[1]["fixo"]), (0.0, True))
        # congelado por ele: vira pedaço congelado no quadro orig e o silêncio NÃO é cortado
        p = m.planejar([{**self.TR[0], "congelar": True}], [(0, 4)], "dividido", True)
        self.assertEqual([(x["tipo"], x["dur"], x["orig"]) for x in p], [("comentario", 4.0, 0.0)])
        # comentário da gravação continua com o silêncio cortado (sem fala = sai)
        self.assertEqual(m.planejar([self.TR[1]], [(4, 8)], "dividido", True), [])

    def test_aplicar_edicao_escolha_vence_ia(self):
        pal = [{"w": w, "ini": 4.2 + i * 0.4, "fim": 4.5 + i * 0.4} for i, w in enumerate("olha só que agachamento".split())]
        plano = {"titulo": "T", "chaves": [], "gancho": (2, 3), "cortar": [(1, 1)], "remover": [1], "enfase": [], "notas": {1: 1}}
        pecas = m.planejar(self.TR, [], "dividido", False)
        pe, res = m.aplicar_edicao(pecas, self.TR, pal, plano, 600)
        self.assertFalse(any(x["k"] == 1 and x["tipo"] == "comentario" and not x.get("gancho") for x in pe))   # a IA tirou
        tr = [self.TR[0], {**self.TR[1], "removido": False}, self.TR[2]]
        pe, res = m.aplicar_edicao(m.planejar(tr, [], "dividido", False), tr, pal, plano, 600, restaurados=["c1-1"], sem_gancho=True)
        self.assertTrue(any(x["k"] == 1 and x["tipo"] == "comentario" for x in pe))                            # ele mandou ficar
        self.assertEqual(res["cortes"], 0)                                                                       # corte restaurado
        self.assertEqual(res["detalhe"]["cortes"][0]["id"], "c1-1")
        self.assertTrue(res["detalhe"]["cortes"][0]["restaurado"])
        self.assertFalse(pe[0].get("gancho"))
        # trecho removido por ele não volta como gancho
        tr = [self.TR[0], {**self.TR[1], "removido": True}, self.TR[2]]
        pe, res = m.aplicar_edicao(m.planejar(tr, [], "dividido", False), tr, pal, {**plano, "remover": []}, 600)
        self.assertFalse(any(x.get("gancho") for x in pe))
        # duração alvo não encurta nem tira trecho fixo
        tr = [{**self.TR[0], "removido": False}, {**self.TR[1], "removido": False}, {**self.TR[2], "removido": False}]
        pe, res = m.aplicar_edicao(m.planejar(tr, [], "dividido", False), tr, pal, {**plano, "remover": [], "gancho": None, "cortar": []}, 15)
        self.assertEqual(sum(x["dur"] for x in pe), 12.0)

    def test_remapear_plano(self):
        plano = {"remover": [1], "notas": {1: 2, 3: 5}, "cortar": [(4, 5)]}
        trechos_ia = [{"tipo": "tocando", "ini": 0, "fim": 4}, {"tipo": "comentario", "ini": 4, "fim": 8},
                      {"tipo": "tocando", "ini": 8, "fim": 12}, {"tipo": "comentario", "ini": 12, "fim": 14}]
        novos = [{"tipo": "tocando", "ini": 0, "fim": 2}, {"tipo": "tocando", "ini": 2, "fim": 4},
                 {"tipo": "comentario", "ini": 4, "fim": 8}, {"tipo": "tocando", "ini": 8, "fim": 12},
                 {"tipo": "comentario", "ini": 12, "fim": 14}]
        r = m.remapear_plano(plano, trechos_ia, novos)
        self.assertEqual(r["remover"], [2])
        self.assertEqual(r["notas"], {2: 2, 4: 5})
        self.assertEqual(r["cortar"], [(4, 5)])
        j = m.plano_de_json(json.loads(json.dumps(m.plano_para_json({**plano, "gancho": (1, 2), "enfase": []}))))
        self.assertEqual(j["notas"], {1: 2, 3: 5})
        self.assertEqual(j["gancho"], (1, 2))

    def test_cmd_peca_layouts(self):
        for lay in ("dividido", "cheia", "ele", "original", "original_pip"):
            for tipo in ("tocando", "comentario"):
                p = {"tipo": tipo, "ini": 1.0, "dur": 2.0, "orig": 3.0, "cheia": lay != "dividido", "layout": lay, "vol": 0.3}
                cmd = " ".join(m.cmd_peca(p, "r.mkv", "o.mkv", "t.png", True, "s.mkv", "v.wav"))
                self.assertIn("[v]", cmd)
                if tipo == "tocando":
                    self.assertIn("volume=0.300", cmd)
                if lay == "ele":
                    self.assertNotIn("vstack", cmd)
        p = {"tipo": "tocando", "ini": 0, "dur": 1.0, "orig": 0, "layout": "dividido", "vol": 0.0}
        cmd = " ".join(m.cmd_peca(p, "r", "o", None, True, "s", "v"))
        self.assertIn("anullsrc", cmd)                         # mudo = silêncio de verdade
        self.assertNotIn("[1:a]", cmd)

    def test_falas_de_silencios(self):
        self.assertEqual(m.falas_de_silencios([(0, 1.0), (3.0, 3.05), (3.1, 5)], 6), [[1.0, 3.0], [5, 6]])


class ModeloNativo(unittest.TestCase):
    """Legenda nativa (padrão): fonte limpa, branca com contorno/sombra leves, sem cor por palavra, 2 a 5 palavras."""

    def falas(self, texto, t=0.0, passo=0.3):
        out = []
        for w in texto.split():
            out.append({"w": w, "ini": round(t, 3), "fim": round(t + passo - 0.05, 3), "k": w.startswith("agach")})
            t += passo
        return out

    def test_modelos_listados(self):
        L = m.listar_modelos()
        ids = [x["id"] for x in L["modelos"]]
        self.assertEqual(L["padrao"], "nativo")
        self.assertEqual(ids[:2], ["nativo", "eduestevesfitness"])
        self.assertIn("classico", ids)
        self.assertEqual(L["planejados"], [])
        self.assertEqual(m.carregar_modelo("nao-existe")["id"], "nativo")
        self.assertEqual(m.carregar_modelo(None)["legenda"]["fonte"], "DM Sans")
        self.assertEqual(m.carregar_modelo("../etc")["id"], "nativo")
        ok, p = m.validar_pedido({"trechos": [{"tipo": "tocando", "ini": 0, "fim": 1, "orig": 0}]})
        self.assertEqual(p["modelo"], "nativo")
        ok, p = m.validar_pedido({"trechos": [{"tipo": "tocando", "ini": 0, "fim": 1, "orig": 0}], "modelo": "eduestevesfitness"})
        self.assertEqual(p["modelo"], "eduestevesfitness")
        ok, p = m.validar_pedido({"trechos": [{"tipo": "tocando", "ini": 0, "fim": 1, "orig": 0}], "modelo": "ainda-nao-existe"})
        self.assertEqual(p["modelo"], "nativo")     # modelo sem arquivo: monta no nativo
        self.assertFalse(m.validar_pedido({"trechos": [{"tipo": "tocando", "ini": 0, "fim": 1, "orig": 0}], "modelo": "a b"})[0])

    def test_frases_2_a_5_palavras_como_faladas(self):
        est = m.carregar_modelo("nativo")["legenda"]
        g = m.agrupar_palavras(self.falas("Olha só esse agachamento, a postura está toda errada. E o pior é que ele nem percebe 🔥"), est)
        textos = [" ".join(p["t"] for p in x["palavras"]) for x in g]
        self.assertTrue(all(2 <= len(t.split()) <= 5 for t in textos), textos)
        self.assertEqual(textos[0].split()[0], "Olha")             # sem maiúsculas forçadas
        self.assertFalse(any("🔥" in t for t in textos))
        self.assertTrue(all(len(t) <= est["max_letras"] + 4 for t in textos), textos)

    def test_ass_nativo_sem_cor_nem_karaoke(self):
        mod = m.carregar_modelo("nativo")
        g = m.agrupar_palavras(self.falas("Olha só esse agachamento torto aqui"), mod["legenda"])
        ass = m.gerar_ass(g, lambda t: 960, "O ERRO DO AGACHAMENTO", 10.0, mod)
        estilo = next(l for l in ass.splitlines() if l.startswith("Style: R,"))
        self.assertIn("DM Sans,60,&H00FFFFFF", estilo)
        self.assertNotIn("&H0000E5FF", ass)      # amarelo da palavra da vez
        self.assertNotIn("&H0060FF3C", ass)      # verde das chaves
        ev = [l for l in ass.splitlines() if l.startswith("Dialogue: 0,")]
        self.assertEqual(len(ev), len(g))        # um evento por frase (sem karaokê)
        self.assertTrue(all("pos(540,1420)" in l for l in ev))
        self.assertIn("O erro do agachamento", ass)
        cls = m.gerar_ass(m.agrupar_palavras(self.falas("Olha só esse agachamento"), m.carregar_modelo("classico")["legenda"]),
                          lambda t: 960, "", 0, m.carregar_modelo("classico"))
        self.assertIn("&H0000E5FF", cls)         # o clássico continua com o karaokê


class ModeloEduEsteves(unittest.TestCase):
    """Preset Edu Esteves: pausa > 0,4 s cortada, gancho central de 2 linhas por 3 a 5 s, sem legenda, punch-in."""

    def test_carrega(self):
        md = m.carregar_modelo("eduestevesfitness")
        self.assertFalse(md["legenda"]["mostrar"])
        self.assertEqual((md["titulo"]["estilo"], md["titulo"]["y"], md["titulo"]["duracao_min"], md["titulo"]["duracao_max"]), ("gancho", 768, 3.0, 5.0))
        self.assertEqual(md["corte"]["silencio_longo"], 0.4)
        self.assertEqual(md["zoom"]["punch_in_seg"], 3.5)
        self.assertIsNone(m.carregar_modelo("nativo")["zoom"]["punch_in_seg"])

    def test_corte_de_pausa_mais_curta(self):
        tr = [{"tipo": "comentario", "ini": 0, "fim": 6, "orig": 0}]
        sil = [(0, 0.5), (2.0, 2.5), (4.0, 6)]          # pausa de 0,5 s no meio da fala
        self.assertEqual(len(m.planejar(tr, sil, "dividido", True)), 1)                                   # nativo: 0,7 s
        p = m.planejar(tr, sil, "dividido", True, corte=m.carregar_modelo("eduestevesfitness")["corte"])
        self.assertEqual(len(p), 2)
        self.assertLessEqual(p[1]["ini"] - (p[0]["ini"] + p[0]["dur"]), 0.5 - 0.2 + 0.04)                 # sobrou só a folga

    def test_punch_in_a_cada_3_5_s(self):
        pec = [{"tipo": "comentario", "ini": 0, "dur": 12.0, "orig": 0, "layout": "dividido"},
               {"tipo": "tocando", "ini": 12, "dur": 3.0, "orig": 0, "layout": "dividido"},
               {"tipo": "tocando", "ini": 15, "dur": 9.0, "orig": 0, "layout": "original"}]
        n = m.punch_in(pec, 3.5)
        self.assertEqual(pec[0]["zoom"], [[3.5, 7.0], [10.5, 12.0]])
        self.assertNotIn("zoom", pec[1])       # curto: o próprio corte já troca o plano
        self.assertNotIn("zoom", pec[2])       # só o original na tela: não tem câmera dele
        self.assertEqual(n, 2)

    def test_ass_gancho_central_sem_legenda(self):
        md = m.carregar_modelo("eduestevesfitness")
        ass = m.gerar_ass([], lambda t: 960, "O erro do agachamento que ninguém te conta", 40.0, md, 4.2)
        g = [l for l in ass.splitlines() if l.startswith("Dialogue: 1,")]
        self.assertEqual(len(g), 1)
        self.assertIn(",G,", g[0])
        self.assertIn("0:00:00.00,0:00:04.20", g[0])
        self.assertIn("pos(540,768)", g[0])
        self.assertEqual(g[0].count("\\N"), 1)          # 2 linhas
        self.assertIn("O ERRO DO", g[0])
        self.assertIn("Style: G,Archivo Black,80,&H00FFFFFF", ass)
        self.assertFalse([l for l in ass.splitlines() if l.startswith("Dialogue: 0,")])
