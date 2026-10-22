import { describe, expect, it } from "vitest";
import {
  DADOS,
  achaAlimento,
  calculaTroca,
  distribuiTroca,
  ehBloqueado,
  ehRepetido,
  grupoDaTroca,
  passoDe,
  medidasDe,
  medidasComPreparo,
  opiniao,
  preparosDe,
  rendimentoDe,
  seloDaCarne,
  melhorTrocaDoPrato,
  procura,
  REFEICOES,
  refeicoesProximas,
  somaDoPrato,
  todosItens,
  trocasDe,
} from "@/lib/substituicoes";

const pega = (grupo: Parameters<typeof achaAlimento>[0], nome: string) => {
  const item = achaAlimento(grupo, nome);
  if (!item) throw new Error(`não achei ${nome} em ${grupo}`);
  return item;
};

describe("fontes", () => {
  it("a lista do Breno vem antes da TACO na busca", () => {
    const achou = procura("banana");
    expect(achou.length).toBeGreaterThan(1);
    expect(achou[0].item.n).toBe("Banana prata");
    expect(achou[0].item.f).toBe("lista");
    expect(achou.some((a) => a.item.f === "taco")).toBe(true);
  });

  it("fruta da TACO fica no grupo das frutas, não em carboidratos", () => {
    const abacaxi = procura("abacaxi")[0];
    expect(abacaxi.grupo).toBe("FRUTAS");
    expect(abacaxi.item.f).toBe("taco");
  });
});

describe("vetos", () => {
  it("a aluna acha a maionese que ela comeu, mas ela nunca vira troca", () => {
    expect(procura("maionese").length).toBeGreaterThan(0);
    expect(ehBloqueado("Maionese, tradicional com ovos")).toBe(true);
    const azeite = pega("GORDURAS", "Azeite de Oliva extra virgem");
    const alvos = trocasDe("GORDURAS", azeite, 10).map((x) => x.item.n);
    expect(alvos.some((n) => /maionese/i.test(n))).toBe(false);
  });

  it("embutido é achável e nunca é destino", () => {
    expect(procura("mortadela").length).toBeGreaterThan(0);
    expect(ehBloqueado("Mortadela")).toBe(true);
    const frango = pega("PROTEÍNAS", "Peito de frango");
    const alvos = trocasDe("PROTEÍNAS", frango, 100).map((x) => x.item.n);
    expect(alvos.some((n) => /mortadela|salame|presunto|salsicha/i.test(n))).toBe(false);
  });

  it("o vetado desce pro fim da busca", () => {
    const achou = procura("queijo", undefined, 12);
    const vetados = achou.map((a) => (ehBloqueado(a.item.n) ? 1 : 0));
    expect(vetados).toEqual([...vetados].sort());
  });

  it("refrigerante zero passa pelo veto do refrigerante com açúcar", () => {
    expect(ehBloqueado("Coca-Cola")).toBe(true);
    expect(ehBloqueado("Coca-Cola Zero")).toBe(false);
    expect(ehBloqueado("Guaraná Antarctica Zero")).toBe(false);
  });

  it("o veto de biscoito salgado não derruba os biscoitos da lista dele", () => {
    const achou = procura("biscoito").map((a) => a.item.n);
    expect(achou).toContain("Biscoito de arroz Cemil");
    expect(ehBloqueado("Biscoito de arroz Cemil")).toBe(false);
  });

  it("vetado nunca aparece como troca", () => {
    const frango = pega("PROTEÍNAS", "Peito de frango");
    const nomes = trocasDe("PROTEÍNAS", frango, 100).map((t) => t.item.n);
    expect(nomes.every((n) => !ehBloqueado(n))).toBe(true);
  });
});

describe("a conta da troca", () => {
  it("iguala o macro do grupo e chega perto da caloria", () => {
    const banana = pega("FRUTAS", "Banana prata");
    const [primeira] = trocasDe("FRUTAS", banana, 1);
    const carboBanana = banana.carb * 1;
    const kcalBanana = banana.kcal * 1;

    expect(primeira.macro).toBeCloseTo(carboBanana, 0);
    expect(Math.abs(primeira.kcal - kcalBanana)).toBeLessThan(kcalBanana * 0.1);
  });

  it("arroz vira batata na quantidade que fecha o carboidrato", () => {
    const arroz = pega("CARBOIDRATOS", "Arroz branco cozido");
    const batata = pega("CARBOIDRATOS", "Batata inglesa cozida");
    const t = calculaTroca("CARBOIDRATOS", arroz, 40, batata);
    expect(t.qtd).toBe(95);
    expect(t.macro).toBeCloseTo(arroz.carb * 40, 0);
  });

  it("a lista do Breno vem antes da TACO nas opções", () => {
    const arroz = pega("CARBOIDRATOS", "Arroz branco cozido");
    const trocas = trocasDe("CARBOIDRATOS", arroz, 100);
    const primeiraTaco = trocas.findIndex((t) => t.item.f === "taco");
    const ultimaLista = trocas.map((t) => t.item.f).lastIndexOf("lista");
    expect(ultimaLista).toBeLessThan(primeiraTaco);
  });
});

describe("unidades da quantidade", () => {
  it("alimento em grama tem grama e porção", () => {
    const ids = medidasDe(pega("CARBOIDRATOS", "Arroz branco cozido")).map((m) => m.id);
    expect(ids).toEqual(["nativa", "porcao"]);
  });

  it("ovo tem unidade e grama, porque o peso está no nome", () => {
    const ovo = pega("PROTEÍNAS", "Ovo inteiro 60g");
    const medidas = medidasDe(ovo);
    expect(medidas.map((m) => m.id)).toContain("grama");
    expect(medidas.find((m) => m.id === "grama")?.fator).toBeCloseTo(1 / 60, 5);
  });

  it("não oferece grama pra quem a planilha não diz o peso da unidade", () => {
    const banana = pega("FRUTAS", "Banana prata");
    expect(medidasDe(banana).map((m) => m.id)).not.toContain("grama");
  });
});

describe("opinião da troca", () => {
  it("fala de volume quando a troca rende mais comida no prato", () => {
    const arroz = pega("CARBOIDRATOS", "Arroz branco cozido");
    const batata = pega("CARBOIDRATOS", "Batata inglesa cozida");
    const t = calculaTroca("CARBOIDRATOS", arroz, 120, batata);
    const op = opiniao(arroz, 120, "CARBOIDRATOS", t);
    expect(op.selo).toBe("Mais volume");
    expect(op.texto).toContain("mais comida no prato");
  });

  it("não repete o selo dentro do texto", () => {
    const arroz = pega("CARBOIDRATOS", "Arroz branco cozido");
    const feijao = pega("CARBOIDRATOS", "Feijão cozido");
    const t = calculaTroca("CARBOIDRATOS", arroz, 40, feijao);
    const op = opiniao(arroz, 40, "CARBOIDRATOS", t);
    expect(op.selo).toBe("Pesa um pouco mais");
    expect(op.texto.toLowerCase()).not.toContain("pesa");
    expect(op.texto).toContain("kcal a mais");
  });

  it("avisa quando perde proteína, sem mandar evitar nada", () => {
    const frango = pega("PROTEÍNAS", "Peito de frango");
    const ovo = pega("PROTEÍNAS", "Ovo inteiro 60g");
    const t = calculaTroca("PROTEÍNAS", frango, 100, ovo);
    const op = opiniao(frango, 100, "PROTEÍNAS", t);
    expect(op.texto).not.toMatch(/evite|cuidado|engorda|sabota/i);
  });
});

describe("integridade da tabela", () => {
  it("todo alimento tem caloria e alguma fonte", () => {
    Object.values(DADOS).forEach((grupo) => {
      grupo.itens.forEach((i) => {
        // refrigerante zero é o único que pode não ter caloria
        expect(i.kcal).toBeGreaterThanOrEqual(0);
        if (i.kcal === 0) expect(i.n).toMatch(/zero/i);
        expect(["lista", "taco", "estimativa", "marca"]).toContain(i.f);
      });
    });
  });
});

describe("a busca perdoa como a aluna escreve", () => {
  it("acha mesmo com hífen e vírgula no nome da tabela", () => {
    expect(procura("grao de bico").map((a) => a.item.n)).toContain("Grão-de-bico, cru");
    expect(procura("pao de queijo").length).toBeGreaterThan(0);
    expect(procura("cuscuz de milho").length).toBeGreaterThan(0);
  });

  it("entende mussarela, nozes e mexerica", () => {
    expect(procura("mussarela").length).toBeGreaterThan(0);
    expect(procura("nozes").length).toBeGreaterThan(0);
    expect(procura("mexerica").length).toBeGreaterThan(0);
  });
});

describe("os números da TACO", () => {
  it("usam a energia da própria tabela, não a conta 4/4/9", () => {
    const arroz = procura("Arroz, tipo 1, cozido")[0].item;
    expect(Math.round(arroz.kcal * 100)).toBe(128);
    expect(Math.round(arroz.carb * 100 * 10) / 10).toBe(28.1);
  });

  it("trazem fibra na maioria dos alimentos", () => {
    const todos = Object.values(DADOS).flatMap((g) => g.itens);
    const comFibra = todos.filter((i) => i.fib && i.fib > 0);
    expect(comFibra.length).toBeGreaterThan(300);
  });
});

describe("refeição completa", () => {
  it("as refeições prontas fecham a conta dos próprios itens", () => {
    expect(REFEICOES.length).toBeGreaterThan(0);
    REFEICOES.forEach((r) => {
      const soma = r.itens.reduce((a, i) => a + i.kcal, 0);
      expect(Math.abs(soma - r.kcal)).toBeLessThan(1.5);
      expect(r.itens.length).toBeGreaterThan(1);
    });
  });

  it("soma o prato inteiro", () => {
    const arroz = pega("CARBOIDRATOS", "Arroz branco cozido");
    const frango = pega("PROTEÍNAS", "Peito de frango");
    const conta = somaDoPrato([
      { grupo: "CARBOIDRATOS", item: arroz, qtd: 100 },
      { grupo: "PROTEÍNAS", item: frango, qtd: 100 },
    ]);
    expect(Math.round(conta.kcal)).toBe(Math.round(arroz.kcal * 100 + frango.kcal * 100));
    expect(conta.ptn).toBeGreaterThan(30);
  });

  it("sugere as refeições dele mais perto da caloria do prato", () => {
    const pao = pega("CARBOIDRATOS", "Pão de sal francês");
    const conta = somaDoPrato([{ grupo: "CARBOIDRATOS", item: pao, qtd: 1 }]);
    const perto = refeicoesProximas(conta);
    expect(perto.length).toBeGreaterThan(0);
    // a mais próxima tem que ser mais próxima que a mais distante
    const dist = (r: { kcal: number }) => Math.abs(r.kcal - conta.kcal);
    expect(dist(perto[0])).toBeLessThanOrEqual(dist(perto[perto.length - 1]));
  });

  it("nenhum alimento se sugere como troca de si mesmo", () => {
    Object.entries(DADOS).forEach(([grupo, g]) => {
      g.itens.slice(0, 12).forEach((item) => {
        const nomes = trocasDe(grupo as never, item, item.b).map((t) => t.item.n);
        expect(nomes).not.toContain(item.n);
        expect(new Set(nomes).size).toBe(nomes.length);
      });
    });
  });
});

describe("a troca dentro do prato", () => {
  it("não manda 400g de cenoura no lugar do arroz", () => {
    const arroz = pega("CARBOIDRATOS", "Arroz branco cozido");
    const t = melhorTrocaDoPrato("CARBOIDRATOS", arroz, 120);
    expect(t).not.toBeNull();
    expect(t!.qtd / 120).toBeGreaterThanOrEqual(0.4);
    expect(t!.qtd / 120).toBeLessThanOrEqual(2.5);
  });

  it("prefere a lista do Breno", () => {
    const frango = pega("PROTEÍNAS", "Peito de frango");
    const t = melhorTrocaDoPrato("PROTEÍNAS", frango, 100);
    expect(t!.item.f).toBe("lista");
  });
});

describe("a troca que ela dirige", () => {
  const prato = [
    { item: pega("CARBOIDRATOS", "Arroz branco cozido"), qtd: 120 },
    { item: pega("CARBOIDRATOS", "Feijão cozido"), qtd: 130 },
    { item: pega("PROTEÍNAS", "Peito de frango"), qtd: 120 },
  ];
  const conta = somaDoPrato(prato as never);
  const alvos = [
    { id: 1, grupo: "CARBOIDRATOS" as const, item: pega("CARBOIDRATOS", "Batata inglesa cozida") },
    { id: 2, grupo: "CARBOIDRATOS" as const, item: pega("CARBOIDRATOS", "Macarrão cozido") },
    { id: 3, grupo: "PROTEÍNAS" as const, item: pega("PROTEÍNAS", "Patinho grelhado") },
  ];
  const soma = (fora: ReturnType<typeof distribuiTroca>) => somaDoPrato(fora.filter((d) => d.qtd > 0) as never);

  it("fecha a caloria da refeição", () => {
    const nova = soma(distribuiTroca(conta, alvos));
    expect(Math.abs(nova.kcal - conta.kcal) / conta.kcal).toBeLessThan(0.05);
  });

  it("não deixa a proteína cair quando a carne é mais gorda", () => {
    const nova = soma(distribuiTroca(conta, alvos));
    expect(nova.ptn).toBeGreaterThanOrEqual(conta.ptn * 0.95);
  });

  it("a proteína vai pro alimento de proteína", () => {
    const fora = distribuiTroca(conta, alvos);
    const ptn = fora.find((d) => d.id === 3)!;
    expect(ptn.macro).toBe("ptn");
    expect(ptn.item.ptn * ptn.qtd).toBeGreaterThan(conta.ptn * 0.9);
  });

  it("mais batata vira menos macarrão, e a caloria continua fechando", () => {
    const solto = distribuiTroca(conta, alvos);
    const batataSolta = solto.find((d) => d.id === 1)!.qtd;
    const macarraoSolto = solto.find((d) => d.id === 2)!.qtd;

    const preso = distribuiTroca(conta, [{ ...alvos[0], travada: batataSolta * 1.5 }, alvos[1], alvos[2]]);
    expect(preso.find((d) => d.id === 1)!.qtd).toBe(batataSolta * 1.5);
    expect(preso.find((d) => d.id === 1)!.travada).toBe(true);
    expect(preso.find((d) => d.id === 2)!.qtd).toBeLessThan(macarraoSolto);
    // a proteína não se mexe: ela só dividiu o carboidrato
    expect(preso.find((d) => d.id === 3)!.qtd).toBe(solto.find((d) => d.id === 3)!.qtd);
    expect(Math.abs(soma(preso).kcal - conta.kcal) / conta.kcal).toBeLessThan(0.08);
  });

  it("travar mais do que a refeição tem não devolve quantidade negativa", () => {
    const fora = distribuiTroca(conta, [{ ...alvos[0], travada: 2000 }, alvos[1], alvos[2]]);
    expect(fora.find((d) => d.id === 2)!.qtd).toBe(0);
  });

  it("sem refeição pra dividir, a quantidade sai zerada e marcada", () => {
    const vazia = somaDoPrato([]);
    const fora = distribuiTroca(vazia, alvos);
    expect(fora.every((d) => d.qtd === 0 && d.semAlvo)).toBe(true);
  });

  it("a ordem que ela escreveu é a ordem que volta", () => {
    const fora = distribuiTroca(conta, alvos);
    expect(fora.map((d) => d.id)).toEqual([1, 2, 3]);
  });

  it("o passo acompanha o tamanho da quantidade", () => {
    const batata = pega("CARBOIDRATOS", "Batata inglesa cozida");
    expect(passoDe(batata, 30)).toBe(5);
    expect(passoDe(batata, 120)).toBe(10);
    expect(passoDe(batata, 300)).toBe(20);
  });
});

describe("preparo: cru, cozido, grelhado", () => {
  it("acha os preparos que a TACO tem do mesmo alimento", () => {
    const cru = pega("PROTEÍNAS", "Carne, bovina, patinho, sem gordura, cru");
    const preparos = preparosDe("PROTEÍNAS", cru).map((p) => p.id);
    expect(preparos).toContain("cru");
    expect(preparos).toContain("grelhado");
    // a ordem é a que ela lê: cru primeiro
    expect(preparos[0]).toBe("cru");
  });

  it("não inventa preparo pra quem a TACO só tem cru", () => {
    const alface = pega("CARBOIDRATOS", "Alface, crespa, crua");
    expect(preparosDe("CARBOIDRATOS", alface)).toHaveLength(1);
    expect(medidasComPreparo("CARBOIDRATOS", alface).map((m) => m.id)).not.toContain("pronto");
  });

  it("carne que só existe crua ganha o peso já pronto", () => {
    const bisteca = pega("PROTEÍNAS", "Porco, bisteca, crua");
    const medidas = medidasComPreparo("PROTEÍNAS", bisteca);
    const pronto = medidas.find((m) => m.id === "pronto");
    expect(pronto).toBeTruthy();
    // 100g no prato vieram de ~150g cruas: a carne perde perto de um terço
    expect(pronto!.fator).toBeGreaterThan(1.3);
    expect(pronto!.fator).toBeLessThan(1.7);
  });

  it("quem já tem a versão pronta na TACO não ganha estimativa", () => {
    const patinho = pega("PROTEÍNAS", "Carne, bovina, patinho, sem gordura, cru");
    expect(rendimentoDe("PROTEÍNAS", patinho)).toBeNull();
  });

  it("o rendimento da carne bate com o par cru/grelhado da própria TACO", () => {
    const cru = pega("PROTEÍNAS", "Carne, bovina, patinho, sem gordura, cru");
    const grelhado = pega("PROTEÍNAS", "Carne, bovina, patinho, sem gordura, grelhado");
    const bisteca = pega("PROTEÍNAS", "Porco, bisteca, crua");
    const estimado = 1 / medidasComPreparo("PROTEÍNAS", bisteca).find((m) => m.id === "pronto")!.fator;
    const real = cru.ptn / grelhado.ptn;
    expect(Math.abs(estimado - real) / real).toBeLessThan(0.2);
  });
});

describe("selo de magreza da carne", () => {
  it("abaixo de 5g de gordura por 100g, extremamente magra", () => {
    const frango = pega("PROTEÍNAS", "Peito de frango");
    expect(seloDaCarne(frango)).toMatchObject({ nivel: "extrema", texto: "CARNE EXTREMAMENTE MAGRA" });
    const tilapia = pega("PROTEÍNAS", "Tilapia grelhada");
    expect(seloDaCarne(tilapia)!.nivel).toBe("extrema");
  });

  it("entre 5 e 10g, mais magra", () => {
    const patinho = pega("PROTEÍNAS", "Patinho grelhado");
    const selo = seloDaCarne(patinho)!;
    expect(selo.nivel).toBe("magra");
    expect(selo.texto).toBe("CARNE MAIS MAGRA");
    expect(selo.gordura).toBeGreaterThanOrEqual(5);
    expect(selo.gordura).toBeLessThan(10);
  });

  it("carne gorda não ganha selo", () => {
    const gorda = pega("GORDURAS", "Carne gorda, cozida");
    expect(seloDaCarne(gorda)).toBeNull();
  });

  it("o que não é carne nem peixe fica de fora", () => {
    expect(seloDaCarne(pega("CARBOIDRATOS", "Arroz branco cozido"))).toBeNull();
    expect(seloDaCarne(pega("PROTEÍNAS", "Ovo inteiro 60g"))).toBeNull();
  });

  it("quem procura por carne seca continua achando", () => {
    const achou = procura("carne seca").map((a) => a.item.n);
    expect(achou.some((n) => n.startsWith("Carne gorda"))).toBe(true);
  });
});

describe("a troca da carne gorda", () => {
  it("procura entre as carnes, não entre as gorduras", () => {
    const gorda = pega("GORDURAS", "Carne gorda, cozida");
    expect(grupoDaTroca("GORDURAS", gorda)).toBe("PROTEÍNAS");
    const nomes = trocasDe("GORDURAS", gorda, 100).map((t) => t.item.n);
    expect(nomes.length).toBeGreaterThan(0);
    expect(nomes.some((n) => /abacate|azeite|castanha/i.test(n))).toBe(false);
    expect(nomes.some((n) => /frango|patinho|tilapia|carne|peixe/i.test(n))).toBe(true);
  });

  it("azeite e castanha continuam sendo gordura", () => {
    const azeite = pega("GORDURAS", "Azeite de Oliva extra virgem");
    expect(grupoDaTroca("GORDURAS", azeite)).toBe("GORDURAS");
  });

  it("a troca por carne magra mostra a economia de caloria", () => {
    const gorda = pega("GORDURAS", "Carne gorda, cozida");
    const t = trocasDe("GORDURAS", gorda, 100).find((x) => x.item.n === "Peito de frango");
    expect(t).toBeTruthy();
    // mesma proteína, muito menos caloria
    expect(t!.deltaKcal).toBeLessThan(-100);
  });
});

describe("alimento repetido", () => {
  it("o patinho da lista come o da TACO", () => {
    const daLista = pega("PROTEÍNAS", "Patinho grelhado");
    const daTaco = pega("PROTEÍNAS", "Carne, bovina, patinho, sem gordura, grelhado");
    expect(ehRepetido("PROTEÍNAS", daLista)).toBe(false);
    expect(ehRepetido("PROTEÍNAS", daTaco)).toBe(true);
    const nomes = procura("patinho").map((a) => a.item.n);
    expect(nomes).toContain("Patinho grelhado");
    expect(nomes).not.toContain("Carne, bovina, patinho, sem gordura, grelhado");
  });

  it("alimento diferente com número parecido continua na lista", () => {
    const nomes = procura("pastel").map((a) => a.item.n);
    expect(nomes.filter((n) => /pastel/i.test(n)).length).toBeGreaterThan(1);
    const costela = procura("costela").map((a) => a.item.n);
    expect(costela.some((n) => /bovina/i.test(n))).toBe(true);
    expect(costela.some((n) => /porco/i.test(n))).toBe(true);
  });

  it("suco de laranja não vira laranja", () => {
    const suco = pega("FRUTAS", "Laranja, baía, suco");
    expect(ehRepetido("FRUTAS", suco)).toBe(false);
  });

  it("a cópia também não aparece como troca", () => {
    const arroz = pega("CARBOIDRATOS", "Arroz branco cozido");
    const nomes = trocasDe("CARBOIDRATOS", arroz, 120).map((t) => t.item.n);
    expect(nomes).not.toContain("Feijão, carioca, cozido");
  });
});

describe("a carne magra na frente", () => {
  it("quem procura carne vê as magras primeiro", () => {
    const achou = procura("carne", undefined, 12);
    const gordas = achou.map((a) => (a.item.c && !seloDaCarne(a.item) ? 1 : 0));
    // nenhuma gorda aparece antes de uma magra
    const primeiraGorda = gordas.indexOf(1);
    const ultimaMagra = gordas.lastIndexOf(0);
    if (primeiraGorda >= 0) expect(primeiraGorda).toBeGreaterThan(ultimaMagra - achou.length);
    expect(achou.slice(0, 3).every((a) => !a.item.c || !!seloDaCarne(a.item))).toBe(true);
  });

  it("quem procura carne abre com uma magra de boi, porco, frango e peixe", () => {
    ["carne", "carnes", "Carne"].forEach((q) => {
      const primeiras = procura(q).slice(0, 4).map((a) => a.item);
      expect(primeiras.map((i) => i.n), q).toEqual([
        "Patinho grelhado",
        "Porco, lombo, assado",
        "Peito de frango",
        "Tilapia grelhada",
      ]);
      primeiras.forEach((i) => expect(seloDaCarne(i), i.n).not.toBeNull());
    });
    // o resto da busca continua lá, magra na frente
    expect(procura("carne", undefined, 12).slice(4).some((a) => /bovina/.test(a.item.n))).toBe(true);
  });

  it("a vitrine é só pra quem escreve carne: o resto da busca não muda", () => {
    expect(procura("carne bovina")[0].item.n).not.toBe("Patinho grelhado");
    expect(procura("porco")[0].item.n).toMatch(/^Porco/);
  });

  it("a vitrine não oferece o próprio alimento que ela está trocando", () => {
    expect(procura("carne", "Patinho grelhado").map((a) => a.item.n)).not.toContain("Patinho grelhado");
  });

  it("o alimento procurado pelo nome não perde o lugar", () => {
    expect(procura("peito de frango")[0].item.n).toBe("Peito de frango");
    expect(procura("patinho")[0].item.n).toBe("Patinho grelhado");
  });
});

describe("as refeições do Breno", () => {
  it("cada uma fecha com a soma dos alimentos dela", () => {
    REFEICOES.forEach((r) => {
      const soma = r.itens.reduce((a, i) => a + i.kcal, 0);
      expect(Math.abs(soma - r.kcal)).toBeLessThan(1);
    });
  });

  it("todas têm fibra contada", () => {
    expect(REFEICOES.every((r) => typeof r.fib === "number")).toBe(true);
  });

  it("cobrem do lanche ao prato feito", () => {
    const kcals = REFEICOES.map((r) => r.kcal).sort((a, b) => a - b);
    expect(kcals[0]).toBeLessThan(200);
    expect(kcals[kcals.length - 1]).toBeGreaterThan(500);
    expect(REFEICOES.length).toBeGreaterThanOrEqual(10);
  });

  it("prato de fibra puxa refeição de fibra", () => {
    const comFibra = somaDoPrato([
      { item: pega("CARBOIDRATOS", "Feijão cozido"), qtd: 130 },
      { item: pega("CARBOIDRATOS", "Arroz branco cozido"), qtd: 80 },
      { item: pega("PROTEÍNAS", "Patinho grelhado"), qtd: 100 },
    ] as never);
    expect(comFibra.fib).toBeGreaterThan(8);
    const perto = refeicoesProximas(comFibra, 3);
    expect(perto[0].fib).toBeGreaterThan(3);
  });

  it("lanche pequeno não devolve prato feito", () => {
    const lanche = somaDoPrato([{ item: pega("CARBOIDRATOS", "Tapioca"), qtd: 40 }] as never);
    const perto = refeicoesProximas(lanche, 3);
    expect(perto[0].kcal).toBeLessThan(350);
  });
});

describe("pratos montados", () => {
  it("cada estimativa diz de que é feita", () => {
    const todos = todosItens().filter(({ item }) => item.f === "estimativa");
    expect(todos.length).toBeGreaterThanOrEqual(7);
    todos.forEach(({ item }) => {
      expect(item.obs).toMatch(/TACO/);
      expect(item.kcal).toBeGreaterThan(0);
    });
  });

  it("a conta bate com a soma dos macros", () => {
    todosItens()
      .filter(({ item }) => item.f === "estimativa")
      .forEach(({ item }) => {
        const somado = item.ptn * 4 + item.carb * 4 + item.fat * 9;
        expect(Math.abs(somado - item.kcal) / item.kcal).toBeLessThan(0.08);
      });
  });

  it("a aluna acha pizza, podrão, sushi e hambúrguer", () => {
    ["pizza", "podrão", "sushi", "temaki", "hot roll", "hambúrguer", "cachorro-quente"].forEach((q) => {
      expect(procura(q).length, q).toBeGreaterThan(0);
    });
  });

  it("chocolate abre com as marcas, depois o ao leite, e o 70% por último", () => {
    const achou = procura("chocolate", undefined, 40);
    const nomes = achou.map((a) => a.item.n);
    expect(achou[0].item.f).toBe("marca");
    // as marcas famosas estão lá
    ["Snickers", "KitKat", "Ouro Branco", "Bis", "Sonho de Valsa", "Diamante Negro"].forEach((m) =>
      expect(nomes.some((n) => n.includes(m)), m).toBe(true),
    );
    const marca = nomes.findIndex((n, i) => achou[i].item.f === "marca");
    const leite = nomes.findIndex((n) => /ao leite/i.test(n));
    const setenta = nomes.findIndex((n) => /70%/.test(n));
    expect(marca).toBeLessThan(leite);
    if (setenta >= 0) expect(leite).toBeLessThan(setenta);
  });

  it("mandioca atende por aipim e macaxeira", () => {
    ["mandioca", "aipim", "macaxeira"].forEach((q) => {
      expect(procura(q)[0].item.n).toBe("Mandioca (aipim) cozida");
    });
  });
});

describe("industrializados de marca", () => {
  it("cada um diz de onde veio o número", () => {
    const marcas = todosItens().filter(({ item }) => item.f === "marca");
    expect(marcas.length).toBeGreaterThanOrEqual(15);
    marcas.forEach(({ item }) => expect(item.obs).toMatch(/[Rr]ótulo/));
  });

  it("a aluna acha o que ela come", () => {
    ["doritos", "ruffles", "cheetos", "pringles", "sonho de valsa", "ouro branco", "bis",
     "kitkat", "trento", "coca", "guaraná", "sprite", "fanta"].forEach((q) => {
      expect(procura(q).length, q).toBeGreaterThan(0);
    });
  });

  it("refrigerante zero não tem caloria e o normal tem", () => {
    const zero = procura("coca-cola zero")[0].item;
    expect(zero.kcal).toBe(0);
    const normal = procura("coca-cola").find((a) => !/zero/i.test(a.item.n))!.item;
    expect(normal.kcal * 350).toBeGreaterThan(130);
  });

  it("o X-tudo é mais caro que o hambúrguer simples", () => {
    const tudo = procura("x-tudo")[0].item;
    const simples = procura("hambúrguer simples")[0].item;
    expect(tudo.kcal).toBeGreaterThan(simples.kcal);
    expect(tudo.kcal).toBeGreaterThan(800);
  });

  it("tem pizza de vários sabores", () => {
    const sabores = procura("pizza", undefined, 20).map((a) => a.item.n);
    expect(sabores.length).toBeGreaterThanOrEqual(8);
    ["calabresa", "portuguesa", "marguerita", "quatro queijos", "bacon"].forEach((s) =>
      expect(sabores.some((n) => n.toLowerCase().includes(s)), s).toBe(true),
    );
  });
});

describe("catálogo de chocolate de marca", () => {
  it("tem as famosas que a aluna come", () => {
    ["snickers", "kitkat", "ouro branco", "sonho de valsa", "serenata", "ferrero", "alpino",
     "prestígio", "chokito", "baton", "diamante negro", "talento", "twix", "trento", "bis"].forEach((q) => {
      expect(procura(q).length, q).toBeGreaterThan(0);
    });
  });

  it("cada chocolate de marca diz a caloria de rótulo e o perfil usado", () => {
    todosItens()
      .filter(({ item }) => item.f === "marca" && /chocolate|bombom|kitkat|trento|bis/i.test(item.n))
      .forEach(({ item }) => {
        expect(item.obs).toMatch(/rótulo/i);
        expect(item.obs).toMatch(/perfil|açúcar|rótulo oficial/i);
        // a conta fecha com os macros
        const somado = item.ptn * 4 + item.carb * 4 + item.fat * 9;
        expect(Math.abs(somado - item.kcal) / item.kcal).toBeLessThan(0.05);
      });
  });
});

// ---------------------------------------------------------------------------
// Troca em gramas (pedido do Breno, 19/10/2026): a aluna trocou 100g de laranja
// por maçã e a tela disse "0,5 unidades". Grama é sempre o valor principal;
// unidade só inteira, e com as gramas do lado.
// ---------------------------------------------------------------------------
import {
  ajustaPasso,
  arredondaGramas,
  escreveQtd as escreve,
  origemDoPeso,
  pesoDaUnidade,
  qtdDoCampo,
  quantidadeDaTroca,
} from "@/lib/substituicoes";

describe("troca sempre em gramas", () => {
  const laranja = pega("FRUTAS", "Laranja");
  const maca = pega("FRUTAS", "Maça");

  it("laranja 100g → maçã sai em gramas, com os números da quantidade da tela", () => {
    const t = calculaTroca("FRUTAS", laranja, 100, maca);
    const texto = escreve(t.qtd, maca);
    expect(texto).toBe("60 g");
    expect(texto).not.toMatch(/unidade/);
    // macro e caloria batem com os 60g que ela lê
    const gramas = 60;
    const porGrama = maca.carb / (pesoDaUnidade(maca) as number);
    expect(t.macro).toBeCloseTo(porGrama * gramas, 6);
    expect(t.kcal).toBeCloseTo((maca.kcal / 130) * gramas, 6);
    // mesmo carboidrato: a diferença é só o arredondamento pra 5g
    expect(Math.abs(t.macro - laranja.carb * 100)).toBeLessThan(porGrama * 2.5 + 1e-9);
  });

  it("quando cai numa unidade inteira, mostra a unidade com as gramas do lado", () => {
    // 1 maçã de carboidrato ≈ 220g de laranja
    const q = (maca.carb / laranja.carb);
    const t = calculaTroca("FRUTAS", laranja, q, maca);
    expect(t.qtd).toBe(1);
    expect(escreve(t.qtd, maca)).toBe("1 unidade (≈130 g)");
    expect(t.macro).toBeCloseTo(maca.carb, 6);
  });

  it("nenhuma troca exibida, em grupo nenhum, mostra unidade quebrada", () => {
    for (const grupo of GRUPOS_TESTE) {
      for (const item of DADOS[grupo].itens.slice(0, 40)) {
        for (const q of item.p ?? [item.b]) {
          for (const t of trocasDe(grupo, item, q)) {
            const texto = escreve(t.qtd, t.item);
            expect(texto, `${item.n} ${q} → ${t.item.n}: ${texto}`).not.toMatch(/\d,\d+ unidade|(^|\s)0 unidade/);
            if (/unidade/.test(texto)) expect(Number.isInteger(t.qtd)).toBe(true);
            if (t.item.u !== "un" || pesoDaUnidade(t.item)) {
              expect(texto, texto).toMatch(/\d+(,\d+)? (g|ml)\)?$/);
            }
          }
        }
      }
    }
  });

  it("macro e caloria da troca saem da quantidade arredondada", () => {
    for (const t of trocasDe("FRUTAS", laranja, 100)) {
      expect(t.kcal).toBeCloseTo(t.item.kcal * t.qtd, 9);
      expect(t.macro).toBeCloseTo(t.item.carb * t.qtd, 9);
    }
  });

  it("gramas práticas: inteiro até 40g, múltiplo de 5 dali pra cima", () => {
    expect(arredondaGramas(0.3)).toBe(1);
    expect(arredondaGramas(7.4)).toBe(7);
    expect(arredondaGramas(33.6)).toBe(34);
    expect(arredondaGramas(57.6)).toBe(60);
    expect(arredondaGramas(122)).toBe(120);
    expect(arredondaGramas(263)).toBe(265);
  });

  it("alimento em grama arredonda pra grama prática", () => {
    expect(quantidadeDaTroca(laranja, 137.2)).toBe(135);
    expect(escreve(135, laranja)).toBe("135 g");
  });

  it("peso da unidade: da tabela, do nome, derivado da TACO, ou nenhum", () => {
    expect(pesoDaUnidade(pega("PROTEÍNAS", "Ovo inteiro 60g"))).toBe(60);
    expect(origemDoPeso(pega("PROTEÍNAS", "Ovo inteiro 60g"))).toBe("tabela");
    expect(pesoDaUnidade(pega("GORDURAS", "Chocolate Snickers grande (52,7g)"))).toBe(52.7);
    expect(pesoDaUnidade(pega("CARBOIDRATOS", "Chocolate Twix (pacote 45g)"))).toBe(45);
    expect(origemDoPeso(maca)).toBe("derivado");
    expect(pesoDaUnidade(maca)).toBe(130);
    expect(pesoDaUnidade(pega("CARBOIDRATOS", "Pão de sal francês"))).toBe(50);
    expect(pesoDaUnidade(pega("FRUTAS", "Mexirica"))).toBeNull();
    expect(pesoDaUnidade(laranja)).toBeNull();
  });

  it("sem peso da unidade: unidade inteira, nunca quebrada", () => {
    const mexirica = pega("FRUTAS", "Mexirica");
    expect(quantidadeDaTroca(mexirica, 0.4)).toBe(1);
    expect(quantidadeDaTroca(mexirica, 2.6)).toBe(3);
    expect(escreve(3, mexirica)).toBe("3 unidades");
    const t = calculaTroca("FRUTAS", laranja, 100, mexirica);
    expect(Number.isInteger(t.qtd)).toBe(true);
    expect(t.kcal).toBeCloseTo(mexirica.kcal * t.qtd, 9);
  });

  it("o mais e o menos da refeição andam em grama e param em grama pesável", () => {
    const passo = passoDe(maca, 60 / 130);
    expect(passo * 130).toBeCloseTo(10, 9);
    const nova = ajustaPasso(maca, 60 / 130 + passo);
    expect(escreve(nova, maca)).toBe("70 g");
    expect(ajustaPasso(maca, 120 / 130 + passo)).toBe(1); // 130g = 1 maçã
    expect(passoDe(pega("FRUTAS", "Mexirica"), 2)).toBe(1);
  });
});

describe("campo de quantidade em branco", () => {
  it("vazio, zero ou lixo é 0 (sem troca); número vale", () => {
    expect(qtdDoCampo("", 1)).toBe(0);
    expect(qtdDoCampo("   ", 1)).toBe(0);
    expect(qtdDoCampo("0", 1)).toBe(0);
    expect(qtdDoCampo("abc", 1)).toBe(0);
    expect(qtdDoCampo("100", 1)).toBe(100);
    expect(qtdDoCampo("1,5", 140)).toBe(210);
  });

  it("sem quantidade não há troca", () => {
    expect(trocasDe("FRUTAS", pega("FRUTAS", "Laranja"), 0)).toEqual([]);
  });
});

const GRUPOS_TESTE = ["CARBOIDRATOS", "PROTEÍNAS", "FRUTAS", "GORDURAS"] as const;
