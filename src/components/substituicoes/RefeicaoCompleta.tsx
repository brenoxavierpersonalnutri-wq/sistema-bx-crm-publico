import { useEffect, useMemo, useRef, useState } from "react";
import type { ContextoTroca } from "@/components/substituicoes/PesquisaTroca";
import { ArrowRight, Minus, Plus, Search, X } from "lucide-react";
import {
  Achado,
  Alimento,
  AlvoTroca,
  Distribuido,
  Medida,
  ROTULO_FONTE,
  ROTULO_GRUPO,
  ROTULO_MACRO,
  RefeicaoPronta,
  distribuiTroca,
  ajustaPasso,
  escreveQtd,
  grupoDaTroca,
  medidaAtiva,
  medidasComPreparo,
  melhorTrocaDoPrato,
  passoDe,
  preparoDoItem,
  preparosDe,
  procura,
  refeicoesProximas,
  seloDaCarne,
  somaDoPrato,
} from "@/lib/substituicoes";

const n1 = (v: number) => (Math.round(v * 10) / 10).toString().replace(".", ",");
/** Quantidade escrita na medida que ela escolheu, sem casa decimal sobrando. */
const naMedida = (qtd: number, fator: number) => {
  const v = qtd / fator;
  const arredondado = v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
  return String(arredondado).replace(".", ",");
};

/** Quantas linhas de alimento já nascem na tela. */
const LINHAS_INICIAIS = 4;
/** Quantas linhas abrem no "pelo que tu quer trocar". */
const DESTINOS_INICIAIS = 3;

/** Uma linha do prato: o campo do alimento e a quantidade do lado. */
interface Linha {
  id: number;
  /** O que ela escreveu no campo. */
  texto: string;
  escolha: Achado | null;
  /** Quantidade em unidade nativa do alimento (grama, ml ou unidade). */
  qtd: number;
  /** Em que medida ela está contando essa linha. */
  medida: Medida["id"];
}

let sequencia = 0;
const linhaVazia = (): Linha => ({ id: ++sequencia, texto: "", escolha: null, qtd: 0, medida: "nativa" });
const linhasVazias = (quantas: number) => Array.from({ length: quantas }, linhaVazia);

/**
 * O modo "refeição completa": ela monta o prato alimento por alimento, diz por
 * quais alimentos quer trocar, e a tela devolve a quantidade de cada um. Se ela
 * quiser mais de um deles, mexe na quantidade e o resto se acomoda em volta.
 */
export function RefeicaoCompleta({ onTroca }: { onTroca?: (ctx: ContextoTroca) => void } = {}) {
  const [linhas, setLinhas] = useState<Linha[]>(() => linhasVazias(LINHAS_INICIAIS));
  /** Qual campo está com a lista de sugestões aberta, e em que item ela está. */
  const [abertaId, setAbertaId] = useState<number | null>(null);
  const [idx, setIdx] = useState(-1);
  /** A conta só vira troca quando ela apertar o botão. */
  const [verTrocas, setVerTrocas] = useState(false);
  /** Os alimentos pelos quais ela quer trocar. */
  const [destinos, setDestinos] = useState<Linha[]>([]);
  const [calculado, setCalculado] = useState(false);
  /** Quantidades que ela fixou na mão; o resto se acomoda em volta. */
  const [travas, setTravas] = useState<Record<number, number>>({});
  const caixaTroca = useRef<HTMLDivElement>(null);
  /** Depois de calcular, a tela desce sozinha pro resultado. */
  useEffect(() => {
    if (calculado) caixaTroca.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [calculado]);

  const prato = useMemo(
    () =>
      linhas
        .filter((l) => l.escolha && l.qtd > 0)
        .map((l) => ({ id: l.id, grupo: l.escolha!.grupo, item: l.escolha!.item, qtd: l.qtd })),
    [linhas],
  );

  const conta = somaDoPrato(prato);
  const proximas = refeicoesProximas(conta);
  const mostra = verTrocas && prato.length > 0;

  const alvos: AlvoTroca[] = useMemo(
    () =>
      destinos
        .filter((d) => d.escolha)
        .map((d) => ({ id: d.id, grupo: d.escolha!.grupo, item: d.escolha!.item, travada: travas[d.id] })),
    [destinos, travas],
  );
  const distribuido = useMemo(
    () => (calculado && alvos.length ? distribuiTroca(conta, alvos) : []),
    [calculado, alvos, conta],
  );
  const contaNova = somaDoPrato(distribuido.filter((d) => d.qtd > 0));

  // a troca saiu: o pai usa isso pra perguntar o que ela achou
  const prontos = distribuido.filter((d) => d.qtd > 0);
  useEffect(() => {
    if (!calculado || !prontos.length) return;
    onTroca?.({
      modo: "refeicao",
      alimentos: prato.map((p) => `${p.item.n} ${escreveQtd(p.qtd, p.item)}`),
      trocas: prontos.map((d) => `${d.item.n} ${escreveQtd(d.qtd, d.item)}`),
    });
    // só quando a lista de trocas muda de verdade
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculado, prontos.map((d) => `${d.item.n}:${d.qtd}`).join("|")]);

  const mexe = (id: number, muda: (l: Linha) => Linha) =>
    setLinhas((ls) => ls.map((l) => (l.id === id ? muda(l) : l)));

  /** Escreveu no campo do alimento: a escolha de antes deixa de valer. */
  function escreve(id: number, texto: string) {
    mexe(id, (l) => (l.texto === texto ? l : { ...l, texto, escolha: null, qtd: 0, medida: "nativa" }));
    setAbertaId(id);
    setIdx(-1);
  }

  /** Escolheu o alimento: a quantidade já vem na medida mais comum dele. */
  function escolhe(id: number, achado: Achado) {
    const qtd = achado.item.p?.length ? achado.item.p[0] : achado.item.b;
    mexe(id, (l) => ({ ...l, texto: achado.item.n, escolha: achado, qtd, medida: "nativa" }));
    setAbertaId(null);
    setIdx(-1);
  }

  function mudaQtd(id: number, valor: string, fator: number) {
    const v = Number(valor.replace(",", "."));
    if (!Number.isFinite(v) || v <= 0 || v * fator > 5000) return;
    mexe(id, (l) => ({ ...l, qtd: v * fator }));
  }

  function mudaMedida(id: number, medida: Medida["id"]) {
    mexe(id, (l) => ({ ...l, medida }));
  }

  /** Trocou o ponto (cru, cozido, grelhado): a quantidade é a mesma, a conta muda. */
  function mudaPreparo(id: number, preparo: string) {
    mexe(id, (l) => {
      if (!l.escolha) return l;
      const achado = preparosDe(l.escolha.grupo, l.escolha.item).find((p) => p.id === preparo);
      if (!achado) return l;
      return { ...l, texto: achado.item.n, escolha: { grupo: achado.grupo, item: achado.item }, medida: "nativa" };
    });
  }

  /** O X limpa a linha. Nas linhas extras, tira a linha inteira. */
  function limpa(id: number, extra: boolean) {
    if (extra) setLinhas((ls) => ls.filter((l) => l.id !== id));
    else mexe(id, () => ({ ...linhaVazia(), id }));
    setAbertaId(null);
  }

  /** Abre o "pelo que tu quer trocar" com uma linha por alimento do prato. */
  function abreTrocas() {
    setVerTrocas(true);
    if (!destinos.length) setDestinos(linhasVazias(Math.max(DESTINOS_INICIAIS, prato.length)));
  }

  const mexeDestino = (id: number, muda: (l: Linha) => Linha) =>
    setDestinos((ls) => ls.map((l) => (l.id === id ? muda(l) : l)));

  function escreveDestino(id: number, texto: string) {
    mexeDestino(id, (l) => (l.texto === texto ? l : { ...l, texto, escolha: null }));
    setTravas((t) => {
      const { [id]: _fora, ...resto } = t;
      return resto;
    });
    setAbertaId(id);
    setIdx(-1);
  }

  function escolheDestino(id: number, achado: Achado) {
    mexeDestino(id, (l) => ({ ...l, texto: achado.item.n, escolha: achado }));
    setAbertaId(null);
    setIdx(-1);
  }

  function mudaPreparoDestino(id: number, preparo: string) {
    mexeDestino(id, (l) => {
      if (!l.escolha) return l;
      const achado = preparosDe(l.escolha.grupo, l.escolha.item).find((p) => p.id === preparo);
      if (!achado) return l;
      return { ...l, texto: achado.item.n, escolha: { grupo: achado.grupo, item: achado.item } };
    });
    setTravas((t) => {
      const { [id]: _fora, ...resto } = t;
      return resto;
    });
  }

  function limpaDestino(id: number, extra: boolean) {
    if (extra) setDestinos((ls) => ls.filter((l) => l.id !== id));
    else mexeDestino(id, () => ({ ...linhaVazia(), id }));
    setTravas((t) => {
      const { [id]: _fora, ...resto } = t;
      return resto;
    });
    setAbertaId(null);
  }

  /** Ela pediu mais (ou menos) desse alimento: fixa esse e solta o resto. */
  function calibra(d: Distribuido, passo: number) {
    const nova = ajustaPasso(d.item, d.qtd + passo);
    setTravas((t) => ({ ...t, [d.id]: nova }));
  }

  return (
    <>
      <div className="sub-cartao">
        <div className="sub-cartao-topo">
          <div>
            <h2>A tua refeição</h2>
            <p className="sub-medida">Põe tudo o que está no prato. Depois a tela troca a refeição inteira.</p>
          </div>
        </div>

        <ul className="sub-prato">
          {linhas.map((linha, i) => (
            <LinhaPrato
              key={linha.id}
              linha={linha}
              numero={i + 1}
              extra={i >= LINHAS_INICIAIS}
              aberta={abertaId === linha.id}
              idx={idx}
              onEscreve={escreve}
              onEscolhe={escolhe}
              onQtd={mudaQtd}
              onMedida={mudaMedida}
              onPreparo={mudaPreparo}
              onLimpa={limpa}
              onAbre={(id) => setAbertaId(id)}
              onIdx={setIdx}
            />
          ))}
        </ul>

        <button type="button" className="sub-mais-linha" onClick={() => setLinhas((ls) => [...ls, linhaVazia()])}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Adicionar mais um alimento
        </button>

        {prato.length > 0 && (
          <div className="sub-macros">
            <span>
              <b>{Math.round(conta.kcal)}</b> kcal
            </span>
            <span>
              <b>{n1(conta.carb)}g</b> de carboidrato
            </span>
            <span>
              <b>{n1(conta.ptn)}g</b> de proteína
            </span>
            <span>
              <b>{n1(conta.fat)}g</b> de gordura
            </span>
            {conta.fib > 0 && (
              <span>
                <b>{n1(conta.fib)}g</b> de fibra
              </span>
            )}
          </div>
        )}

        {prato.length > 0 && !verTrocas && (
          <button type="button" className="sub-botao-trocar" onClick={abreTrocas}>
            Quero trocar essa refeição
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      {!mostra ? (
        <p className="sub-vazio">
          <Plus className="mx-auto mb-2 h-5 w-5" />
          {prato.length === 0
            ? "Monta o prato aí em cima e eu te devolvo a refeição inteira trocada."
            : "Prato montado. Aperta o botão e escolhe pelo que tu quer trocar."}
        </p>
      ) : (
        <div className="sub-resultado">
          <div className="sub-cartao sub-escolher">
            <div className="sub-cartao-topo">
              <div>
                <h2>Pelo que tu quer trocar?</h2>
                <p className="sub-medida">Põe os alimentos. A quantidade de cada um eu calculo.</p>
              </div>
            </div>

            <ul className="sub-prato">
              {destinos.map((linha, i) => (
                <LinhaDestino
                  key={linha.id}
                  linha={linha}
                  numero={i + 1}
                  extra={i >= DESTINOS_INICIAIS}
                  aberta={abertaId === linha.id}
                  idx={idx}
                  onEscreve={escreveDestino}
                  onEscolhe={escolheDestino}
                  onPreparo={mudaPreparoDestino}
                  onLimpa={limpaDestino}
                  onAbre={(id) => setAbertaId(id)}
                  onIdx={setIdx}
                />
              ))}
            </ul>

            <button
              type="button"
              className="sub-mais-linha"
              onClick={() => setDestinos((ls) => [...ls, linhaVazia()])}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Adicionar mais um alimento
            </button>

            <button
              type="button"
              className="sub-botao-trocar"
              disabled={!alvos.length}
              onClick={() => setCalculado(true)}
            >
              Calcular
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {calculado && distribuido.length > 0 && (
            <div className="sub-cartao sub-calculado" ref={caixaTroca}>
              <div className="sub-cartao-topo">
                <div>
                  <h2>A tua troca</h2>
                  <p className="sub-medida">Quer mais de um? Mexe no mais e no menos que o resto se ajusta.</p>
                </div>
              </div>

              <ul className="sub-prato">
                {distribuido.map((d) => {
                  const passo = passoDe(d.item, d.qtd || d.item.b);
                  const kcal = Math.round(d.item.kcal * d.qtd);
                  const menorPorcao = d.item.p?.length ? d.item.p[0] : 0;
                  const curta = d.qtd > 0 && menorPorcao > 0 && d.qtd < menorPorcao;
                  return (
                    <li key={d.id} className={`sub-linha-prato cheia${d.travada ? " travada" : ""}`}>
                      <span className="sub-calc-nome">
                        {d.item.n}
                        <em>
                          <b>{kcal} kcal</b> · fecha a {ROTULO_MACRO[d.macro]}
                          {curta && ` · menos que a tua porção de ${escreveQtd(menorPorcao, d.item)}`}
                        </em>
                        <SeloCarne item={d.item} />
                      </span>
                      <span className="sub-linha-fim">
                        <button
                          type="button"
                          className="sub-passo"
                          aria-label={`Menos ${d.item.n}`}
                          disabled={d.qtd <= 0}
                          onClick={() => calibra(d, -passo)}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <b className="sub-calc-qtd">{d.qtd > 0 ? escreveQtd(d.qtd, d.item) : "—"}</b>
                        <button
                          type="button"
                          className="sub-passo"
                          aria-label={`Mais ${d.item.n}`}
                          onClick={() => calibra(d, passo)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>

              <Mandona distribuido={distribuido} kcalPrato={conta.kcal} />

              {distribuido.some((d) => d.qtd <= 0) && (
                <p className="sub-medida" style={{ marginTop: 10 }}>
                  Quem está com traço ficou sem sobra na conta: o que tu escolheu antes dele já usa a
                  refeição inteira. Tira quantidade no menos, ou escolhe uma versão mais magra.
                </p>
              )}

              <div className="sub-macros">
                <span>
                  <b>{Math.round(contaNova.kcal)}</b> kcal
                </span>
                <span>
                  <b>{n1(contaNova.carb)}g</b> de carboidrato
                </span>
                <span>
                  <b>{n1(contaNova.ptn)}g</b> de proteína
                </span>
                <span>
                  <b>{n1(contaNova.fat)}g</b> de gordura
                </span>
                {contaNova.fib > 0 && (
                  <span>
                    <b>{n1(contaNova.fib)}g</b> de fibra
                  </span>
                )}
              </div>

              <p className="sub-conta sub-fecha">
                A tua refeição tem {Math.round(conta.kcal)} kcal.{" "}
                <Fecha kcalA={conta.kcal} kcalB={contaNova.kcal} />
                {Object.keys(travas).length > 0 && (
                  <>
                    {" · "}
                    <button type="button" className="sub-voltar" onClick={() => setTravas({})}>
                      voltar ao automático
                    </button>
                  </>
                )}
              </p>
            </div>
          )}

          {proximas.length > 0 && (
            <>
              <div className="sub-titulo-secao">
                <h3>Refeições do Breno que fecham parecido</h3>
                <em>a conta inteira, não só um alimento</em>
              </div>
              {proximas.map((r) => (
                <CartaoRefeicao key={r.nome} refeicao={r} kcalPrato={conta.kcal} />
              ))}
            </>
          )}

          <div className="sub-titulo-secao" style={{ marginTop: 10 }}>
            <h3>Ou deixa comigo: a mesma refeição, item por item</h3>
          </div>
          <div className="sub-troca">
            {prato.map((p, i) => {
              const para = melhorTrocaDoPrato(p.grupo, p.item, p.qtd);
              return (
                <p key={p.id} className={i ? "sub-conta" : "sub-linha-dieta"} style={{ marginTop: i ? 8 : 0 }}>
                  {para ? (
                    <>
                      {p.item.n} <span className="sub-seta">→</span>{" "}
                      <b>
                        {para.item.n} - {escreveQtd(para.qtd, para.item)}
                      </b>
                    </>
                  ) : (
                    <>
                      {p.item.n} — sem troca cadastrada, mantém {escreveQtd(p.qtd, p.item)}
                    </>
                  )}
                </p>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

/** O selo de magreza da carne, do jeito que o Breno escreve. */
export function SeloCarne({ item }: { item: Alimento }) {
  const selo = seloDaCarne(item);
  if (!selo) return null;
  return (
    <span className={`sub-selo-magra ${selo.nivel}`} title={`${selo.gordura}g de gordura por 100g`}>
      {selo.texto}
    </span>
  );
}

/**
 * Quando um alimento sozinho come a refeição inteira, a tela fala. É o caso da
 * carne seca: ela fecha a proteína e já leva quase toda a caloria, então o que
 * vem depois sai em quantidade que não é comida.
 */
function Mandona({ distribuido, kcalPrato }: { distribuido: Distribuido[]; kcalPrato: number }) {
  if (!kcalPrato || distribuido.length < 2) return null;
  const pesados = distribuido
    .map((d) => ({ d, parte: (d.item.kcal * d.qtd) / kcalPrato }))
    .filter((x) => x.parte >= 0.6)
    .sort((a, b) => b.parte - a.parte);
  if (!pesados.length) return null;
  const { d, parte } = pesados[0];
  return (
    <p className="sub-medida sub-aviso">
      {d.item.n} responde por {Math.round(parte * 100)}% da caloria da refeição — por isso sobra pouco pro
      resto. Uma versão mais magra abre espaço no prato.
    </p>
  );
}

/** Quanto a troca fecha perto da refeição dela. */
function Fecha({ kcalA, kcalB }: { kcalA: number; kcalB: number }) {
  const d = Math.round(kcalB - kcalA);
  if (!kcalA) return null;
  if (Math.abs(d) <= Math.max(15, kcalA * 0.05)) return <span className="igual">A troca fecha igual.</span>;
  return (
    <span className={Math.abs(d) > kcalA * 0.18 ? "difere" : "igual"}>
      A troca está {Math.abs(d)} kcal {d > 0 ? "acima" : "abaixo"}.
    </span>
  );
}

interface CampoProps {
  linha: Linha;
  numero: number;
  aberta: boolean;
  idx: number;
  onEscreve: (id: number, texto: string) => void;
  onEscolhe: (id: number, achado: Achado) => void;
  onAbre: (id: number | null) => void;
  onIdx: (i: number) => void;
}

/** O campo de buscar alimento com a lista de sugestões, usado nas duas listas. */
function CampoAlimento({ linha, numero, aberta, idx, onEscreve, onEscolhe, onAbre, onIdx }: CampoProps) {
  const sugestoes = useMemo(
    () => (aberta && linha.texto.trim() && !linha.escolha ? procura(linha.texto) : []),
    [aberta, linha.texto, linha.escolha],
  );
  const mostraLista = aberta && !!linha.texto.trim() && !linha.escolha;

  function tecla(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      onIdx(sugestoes.length ? (idx + 1) % sugestoes.length : -1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onIdx(sugestoes.length ? (idx - 1 + sugestoes.length) % sugestoes.length : -1);
    } else if (e.key === "Enter" && sugestoes.length) {
      e.preventDefault();
      onEscolhe(linha.id, sugestoes[idx >= 0 ? idx : 0]);
    } else if (e.key === "Escape") {
      onAbre(null);
    }
  }

  return (
    <>
      <div className="sub-linha-busca">
        <div className="sub-busca menor">
          <Search className="sub-lupa" aria-hidden="true" />
          <input
            id={`sub-linha-${linha.id}`}
            type="text"
            autoComplete="off"
            role="combobox"
            aria-expanded={mostraLista}
            aria-controls={`sub-linha-sug-${linha.id}`}
            aria-autocomplete="list"
            placeholder={`Alimento ${numero}`}
            aria-label={`Alimento ${numero}`}
            value={linha.texto}
            onChange={(e) => onEscreve(linha.id, e.target.value)}
            onFocus={() => onAbre(linha.id)}
            onKeyDown={tecla}
          />
        </div>
      </div>

      {mostraLista && (
        <ul id={`sub-linha-sug-${linha.id}`} className="sub-sugestoes" role="listbox" aria-label="Sugestões">
          {sugestoes.length === 0 ? (
            <li className="sub-sug-vazio">Nada com esse nome na lista nem na TACO</li>
          ) : (
            sugestoes.map((achado, k) => (
              <li
                key={`${achado.grupo}-${achado.item.n}`}
                role="option"
                aria-selected={k === idx}
                className={`sub-sug${k === idx ? " ativa" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onEscolhe(linha.id, achado);
                }}
              >
                <span className="sub-sug-nome">{achado.item.n}</span>
                <span className="sub-sug-meta">
                  <span className="sub-sug-grupo">{ROTULO_GRUPO[grupoDaTroca(achado.grupo, achado.item)]}</span>
                  <SeloCarne item={achado.item} />
                  <span className={`sub-selo-fonte ${achado.item.f}`}>
                    {ROTULO_FONTE[achado.item.f]}
                  </span>
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </>
  );
}

/** Cru, cozido, grelhado: só aparece quando a TACO tem mais de um do alimento. */
function SeletorPreparo({
  linha,
  onPreparo,
}: {
  linha: Linha;
  onPreparo: (id: number, preparo: string) => void;
}) {
  const escolha = linha.escolha;
  const preparos = escolha ? preparosDe(escolha.grupo, escolha.item) : [];
  if (!escolha || preparos.length < 2) return null;
  return (
    <select
      className="sub-preparo-sel"
      value={preparoDoItem(escolha.item) ?? preparos[0].id}
      onChange={(e) => onPreparo(linha.id, e.target.value)}
      aria-label={`Ponto de ${escolha.item.n}`}
    >
      {preparos.map((p) => (
        <option key={p.id} value={p.id}>
          {p.id}
        </option>
      ))}
    </select>
  );
}

interface LinhaProps extends CampoProps {
  extra: boolean;
  onQtd: (id: number, valor: string, fator: number) => void;
  onMedida: (id: number, medida: Medida["id"]) => void;
  onPreparo: (id: number, preparo: string) => void;
  onLimpa: (id: number, extra: boolean) => void;
}

function LinhaPrato({ extra, onQtd, onMedida, onPreparo, onLimpa, ...campo }: LinhaProps) {
  const { linha, numero } = campo;
  const item = linha.escolha?.item ?? null;
  const medidas = item && linha.escolha ? medidasComPreparo(linha.escolha.grupo, item) : [];
  const mAtiva = item ? medidaAtiva(item, linha.medida, medidas) : null;
  const mostraLista = campo.aberta && !!linha.texto.trim() && !linha.escolha;

  return (
    <li className={`sub-linha-prato${mostraLista ? " aberta" : ""}${linha.escolha ? " cheia" : ""}`}>
      <span className="sub-prato-num" aria-hidden="true">
        {numero}
      </span>

      <CampoAlimento {...campo} />

      <span className="sub-linha-fim">
        <SeletorPreparo linha={linha} onPreparo={onPreparo} />

        <span className="sub-campo pequeno">
          <input
            key={`${item?.n ?? "vazio"}-${linha.medida}`}
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            disabled={!item}
            defaultValue={item && mAtiva ? naMedida(linha.qtd, mAtiva.fator) : ""}
            onChange={(e) => onQtd(linha.id, e.target.value, mAtiva?.fator ?? 1)}
            aria-label={item ? `Quantidade de ${item.n}` : `Quantidade do alimento ${numero}`}
          />
          {medidas.length > 1 ? (
            <select
              className="sub-medida-sel"
              value={linha.medida}
              onChange={(e) => onMedida(linha.id, e.target.value as Medida["id"])}
              aria-label={`Medida de ${item?.n ?? `alimento ${numero}`}`}
            >
              {medidas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.curto}
                </option>
              ))}
            </select>
          ) : (
            <b>{mAtiva?.curto ?? "g"}</b>
          )}
        </span>

        <button
          type="button"
          className="sub-tirar"
          aria-label={extra ? `Tirar a linha ${numero}` : `Limpar o alimento ${numero}`}
          onClick={() => onLimpa(linha.id, extra)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </span>
    </li>
  );
}

interface DestinoProps extends CampoProps {
  extra: boolean;
  onPreparo: (id: number, preparo: string) => void;
  onLimpa: (id: number, extra: boolean) => void;
}

/** A linha do "pelo que tu quer trocar": só o alimento, a quantidade sai da conta. */
function LinhaDestino({ extra, onPreparo, onLimpa, ...campo }: DestinoProps) {
  const { linha, numero } = campo;
  const mostraLista = campo.aberta && !!linha.texto.trim() && !linha.escolha;

  return (
    <li className={`sub-linha-prato${mostraLista ? " aberta" : ""}${linha.escolha ? " cheia" : ""}`}>
      <span className="sub-prato-num" aria-hidden="true">
        {numero}
      </span>

      <CampoAlimento {...campo} />

      <span className="sub-linha-fim">
        <SeletorPreparo linha={linha} onPreparo={onPreparo} />

        <button
          type="button"
          className="sub-tirar"
          aria-label={extra ? `Tirar a linha ${numero}` : `Limpar o alimento ${numero}`}
          onClick={() => onLimpa(linha.id, extra)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </span>
    </li>
  );
}

function CartaoRefeicao({ refeicao, kcalPrato }: { refeicao: RefeicaoPronta; kcalPrato: number }) {
  const d = Math.round(refeicao.kcal - kcalPrato);
  const longe = Math.abs(d) > Math.max(40, kcalPrato * 0.18);
  return (
    <div className={`sub-troca${longe ? " longe" : ""}`}>
      <p className="sub-linha-dieta">{refeicao.nome}</p>
      <p className="sub-conta">{refeicao.itens.map((i) => `${i.qtd} ${i.nome}`).join(" + ")}</p>
      <p className="sub-conta">
        {Math.round(refeicao.kcal)} kcal ·{" "}
        {d === 0 ? (
          <span className="igual">igual</span>
        ) : (
          <span className={longe ? "difere" : "igual"}>
            {Math.abs(d)} {d > 0 ? "a mais" : "a menos"}
          </span>
        )}{" "}
        · {n1(refeicao.ptn)}g de proteína · {n1(refeicao.carb)}g de carboidrato · {n1(refeicao.fat)}g de gordura
        {refeicao.fib > 0 && ` · ${n1(refeicao.fib)}g de fibra`}
      </p>
    </div>
  );
}
