import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Search, X } from "lucide-react";
import fotoBrenoGabi from "@/assets/breno-gabi.webp";
import {
  ADEQUADOS,
  Achado,
  Adequado,
  Alimento,
  Bloqueado,
  DADOS,
  MAIS_BUSCADOS,
  MESMO_MACRO,
  Medida,
  NomeGrupo,
  ROTULO_FONTE,
  ROTULO_GRUPO,
  ROTULO_MACRO,
  Troca,
  achaAlimento,
  adequadoDoTermo,
  bloqueioDoTermo,
  calculaTroca,
  escreveQtd,
  qtdDoCampo,
  grupoDaTroca,
  medidaAtiva,
  medidasComPreparo,
  preparoDoItem,
  preparosDe,
  opiniao,
  procura,
  trocasDe,
  vetoDoAlimento,
} from "@/lib/substituicoes";
import { RefeicaoCompleta, SeloCarne } from "@/components/substituicoes/RefeicaoCompleta";
import { ContextoTroca, PesquisaTroca } from "@/components/substituicoes/PesquisaTroca";
import "./substituicoes.css";

const n1 = (v: number) => (Math.round(v * 10) / 10).toString().replace(".", ",");

interface Origem {
  grupo: NomeGrupo;
  item: Alimento;
}

/**
 * A tela de substituição que a aluna usa. Entra no lugar da IA do ChatGPT que
 * ia no fim da mensagem de liberação.
 */
export default function Substituicoes() {
  const [modo, setModo] = useState<"alimento" | "refeicao">("alimento");
  const [busca, setBusca] = useState("");
  const [origem, setOrigem] = useState<Origem | null>(null);
  const [qtd, setQtd] = useState(0);
  const [medidaId, setMedidaId] = useState<Medida["id"]>("nativa");
  const [destino, setDestino] = useState<Alimento | null>(null);
  const [buscaDestino, setBuscaDestino] = useState("");
  const [verTodas, setVerTodas] = useState(false);
  const [sugAberta, setSugAberta] = useState<"origem" | "destino" | null>(null);
  const [sugIdx, setSugIdx] = useState(-1);

  const campoQtd = useRef<HTMLInputElement>(null);
  const campoBusca = useRef<HTMLInputElement>(null);
  const pedeFoco = useRef(false);

  // Escolheu o alimento: o cursor já vai pro campo da quantidade.
  useEffect(() => {
    if (!pedeFoco.current || !origem) return;
    pedeFoco.current = false;
    campoQtd.current?.focus();
  }, [origem]);

  const sugestoes = useMemo(() => (sugAberta === "origem" ? procura(busca) : []), [busca, sugAberta]);
  const sugestoesDestino = useMemo<Achado[]>(() => {
    if (sugAberta !== "destino" || !origem) return [];
    if (!buscaDestino.trim()) {
      return DADOS[origem.grupo].itens
        .filter((i) => i.f === "lista" && i.n !== origem.item.n)
        .slice(0, 8)
        .map((item) => ({ grupo: origem.grupo, item }));
    }
    return procura(buscaDestino, origem.item.n);
  }, [buscaDestino, origem, sugAberta]);

  const listaAtiva = sugAberta === "destino" ? sugestoesDestino : sugestoes;

  useEffect(() => setSugIdx(-1), [busca, buscaDestino, sugAberta]);

  // Quando nada foi achado, quem responde é a regra: vetado, versão controlada
  // ou "não está na base".
  const semResultado = busca.trim().length >= 4 && procura(busca).length === 0;
  const bloqueado: Bloqueado | null = semResultado ? bloqueioDoTermo(busca) : null;
  const adequado: Adequado | null = semResultado && !bloqueado ? adequadoDoTermo(busca) : null;

  function escolheAlimento(grupo: NomeGrupo, item: Alimento) {
    setOrigem({ grupo, item });
    // Quantidade em branco: quem sabe quanto está no plano é ela (pedido do
    // Breno, 19/10/2026). Antes vinha a primeira porção da lista e ela tinha
    // que apagar pra escrever a dela.
    setQtd(0);
    setMedidaId("nativa");
    setDestino(null);
    setBuscaDestino("");
    setVerTodas(false);
    setBusca(item.n);
    setSugAberta(null);
    campoBusca.current?.blur();
    pedeFoco.current = true;
  }

  function escolheSugestao(k: number) {
    const escolha = listaAtiva[k];
    if (!escolha) return;
    if (sugAberta === "destino") {
      setDestino(escolha.item);
      setBuscaDestino(escolha.item.n);
      setSugAberta(null);
    } else {
      escolheAlimento(escolha.grupo, escolha.item);
    }
  }

  function aoDigitarTecla(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSugIdx((i) => (listaAtiva.length ? (i + 1) % listaAtiva.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSugIdx((i) => (listaAtiva.length ? (i - 1 + listaAtiva.length) % listaAtiva.length : -1));
    } else if (e.key === "Enter") {
      if (listaAtiva.length) {
        e.preventDefault();
        escolheSugestao(sugIdx >= 0 ? sugIdx : 0);
      }
    } else if (e.key === "Escape") {
      setSugAberta(null);
    }
  }

  const macro = origem ? DADOS[origem.grupo].macro : "carb";
  const rot = ROTULO_MACRO[macro];
  const medidas = origem ? medidasComPreparo(origem.grupo, origem.item) : [];
  const mAtiva = origem ? medidaAtiva(origem.item, medidaId, medidas) : null;
  const preparos = origem ? preparosDe(origem.grupo, origem.item) : [];
  const kcal = origem ? origem.item.kcal * qtd : 0;

  const todas = origem ? trocasDe(origem.grupo, origem.item, qtd) : [];
  const lista = verTodas ? todas : todas.slice(0, 3);

  // quando a troca de um alimento aparece na tela, guarda o contexto pra pesquisa
  const [contextoTroca, setContextoTroca] = useState<ContextoTroca | null>(null);

  // A faixa da foto começa onde o cabeçalho termina: senão o cabeçalho cobre a
  // cabeça de quem está na foto, e a altura dele muda com o modo e com a tela.
  const caixaTopo = useRef<HTMLElement>(null);
  const [alturaTopo, setAlturaTopo] = useState(0);
  // No celular, rolar até o fim mostrava o fundo branco do documento por baixo.
  useEffect(() => {
    const antes = document.body.style.backgroundColor;
    document.body.style.backgroundColor = "#05070d";
    return () => {
      document.body.style.backgroundColor = antes;
    };
  }, []);

  useEffect(() => {
    const el = caixaTopo.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const olho = new ResizeObserver(() => setAlturaTopo(el.offsetHeight));
    olho.observe(el);
    setAlturaTopo(el.offsetHeight);
    return () => olho.disconnect();
  }, []);
  const assinaturaTroca = origem && todas.length ? `${origem.item.n}:${qtd}:${todas[0].item.n}` : "";
  useEffect(() => {
    if (!origem || !todas.length) return;
    setContextoTroca({
      modo: "alimento",
      alimentos: [`${origem.item.n} ${escreveQtd(qtd, origem.item)}`],
      trocas: todas.slice(0, 3).map((t) => `${t.item.n} ${escreveQtd(t.qtd, t.item)}`),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinaturaTroca]);
  const destinoServe = destino ? destino[macro] > 0 : false;

  function mudaMedida(id: Medida["id"]) {
    setMedidaId(id);
    if (origem && campoQtd.current) {
      const m = medidaAtiva(origem.item, id);
      campoQtd.current.value = qtd > 0 ? String(Math.round((qtd / m.fator) * 100) / 100) : "";
    }
  }

  function aoDigitarQtd(e: React.ChangeEvent<HTMLInputElement>) {
    if (!origem || !mAtiva) return;
    // Campo vazio ou inválido vira 0, e aí a tela volta pra dica.
    setQtd(qtdDoCampo(e.target.value, mAtiva.fator));
  }

  function usaAtalho(p: number) {
    setQtd(p);
    if (campoQtd.current && mAtiva) {
      campoQtd.current.value = String(Math.round((p / mAtiva.fator) * 100) / 100);
    }
  }

  return (
    <div
      className="sub-pagina"
      style={{
        ["--sub-foto" as string]: `url(${fotoBrenoGabi})`,
        ["--sub-topo-altura" as string]: `${alturaTopo}px`,
      }}
    >
      <div className="sub-fundo" role="img" aria-label="Breno e Gabi na Corrida do Galo" />
      <div className="sub-app">
        <header className="sub-topo" ref={caixaTopo}>
          <div className="sub-marca">
            <h1>Substituições</h1>
            <span>Time Breno Xavier</span>
          </div>

          <div className="sub-modos" role="group" aria-label="O que tu quer trocar">
            <button
              type="button"
              className="sub-modo"
              aria-pressed={modo === "alimento"}
              onClick={() => setModo("alimento")}
            >
              Um alimento
            </button>
            <button
              type="button"
              className="sub-modo"
              aria-pressed={modo === "refeicao"}
              onClick={() => setModo("refeicao")}
            >
              Refeição completa
            </button>
          </div>

          {modo === "alimento" && (
          <div className="sub-busca-wrap">
            <div className="sub-busca">
              <Search className="sub-lupa" aria-hidden="true" />
              <input
                id="sub-busca"
                ref={campoBusca}
                type="text"
                value={busca}
                placeholder="Escreve o alimento da tua dieta"
                autoComplete="off"
                role="combobox"
                aria-expanded={sugAberta === "origem"}
                aria-controls="sub-sugestoes"
                aria-autocomplete="list"
                aria-label="Escreve o alimento da tua dieta"
                onChange={(e) => {
                  setBusca(e.target.value);
                  setSugAberta("origem");
                  if (!e.target.value.trim()) setOrigem(null);
                }}
                onFocus={() => setSugAberta("origem")}
                onKeyDown={aoDigitarTecla}
              />
              {busca && (
                <button
                  type="button"
                  className="sub-limpar"
                  aria-label="Limpar"
                  onClick={() => {
                    setBusca("");
                    setOrigem(null);
                    setDestino(null);
                    setSugAberta(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {sugAberta === "origem" && busca.trim() && (
              <ul id="sub-sugestoes" className="sub-sugestoes" role="listbox" aria-label="Sugestões">
                {sugestoes.length === 0 ? (
                  <li className="sub-sug-vazio">Nada com esse nome na lista nem na TACO</li>
                ) : (
                  sugestoes.map(({ grupo, item }, k) => (
                    <li
                      key={`${grupo}-${item.n}`}
                      role="option"
                      aria-selected={k === sugIdx}
                      className={`sub-sug${k === sugIdx ? " ativa" : ""}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        escolheSugestao(k);
                      }}
                    >
                      <span className="sub-sug-nome">{item.n}</span>
                      <span className="sub-sug-meta">
                        <span className="sub-sug-grupo">{ROTULO_GRUPO[grupoDaTroca(grupo, item)]}</span>
                        <SeloCarne item={item} />
                        <span className={`sub-selo-fonte ${item.f}`}>{ROTULO_FONTE[item.f]}</span>
                      </span>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          )}
        </header>

        <main className="sub-corpo">
          {modo === "refeicao" ? (
            <RefeicaoCompleta onTroca={setContextoTroca} />
          ) : bloqueado ? (
            <div className="sub-veto">
              <span className="sub-selo-veto">Não entra na dieta</span>
              <h2>{bloqueado.nome}</h2>
              <p>{bloqueado.motivo}</p>
              <div className="sub-troca-veto">
                <span>No lugar dele</span>
                {bloqueado.troca}
              </div>
            </div>
          ) : adequado ? (
            <div className="sub-cartao">
              <div className="sub-cartao-topo">
                <div>
                  <h2>{adequado.nome}</h2>
                  {adequado.motivo && <p className="sub-medida">{adequado.motivo}</p>}
                </div>
                <span className="sub-tag-grupo">Versão controlada</span>
              </div>
              <div className="sub-troca" style={{ marginTop: 14 }}>
                <p className="sub-linha-dieta">{adequado.vira}</p>
              </div>
            </div>
          ) : semResultado ? (
            <div className="sub-cartao">
              <div className="sub-cartao-topo">
                <div>
                  <h2>Não achei "{busca.trim()}"</h2>
                  <p className="sub-medida">Nem na lista do Breno, nem na TACO.</p>
                </div>
                <span className="sub-tag-grupo">Fora da base</span>
              </div>
              <p className="sub-aviso-fora">
                Se for produto de marca, manda a foto do rótulo pro Breno que ele coloca na lista.
              </p>
            </div>
          ) : !origem ? (
            <div className="sub-abertura">
              <div className="sub-chamada">
                <p>
                  Sofrer na dieta
                  <br />
                  <span>é loucura</span>
                </p>
              </div>

              <div className="sub-como">
                <h3>Como usar</h3>
                <ol>
                  <li>
                    <span>
                      <b>Escreve o alimento</b> lá em cima. As opções aparecem enquanto tu digita.
                    </span>
                  </li>
                  <li>
                    <span>
                      <b>Confirma a quantidade</b> que está no teu plano.
                    </span>
                  </li>
                  <li>
                    <span>
                      <b>Escolhe por quem trocar</b>, ou olha as opções que já vêm prontas.
                    </span>
                  </li>
                </ol>
                <p className="sub-aviso">
                  Se tu escrever algo que não entra na dieta, a tela avisa e já mostra o que colocar no lugar.
                </p>
              </div>

              <div>
                <p className="sub-rotulo">Mais buscados</p>
                <div className="sub-chips">
                  {MAIS_BUSCADOS.map(([g, nome]) => {
                    const item = achaAlimento(g, nome);
                    if (!item) return null;
                    return (
                      <button key={nome} type="button" className="sub-chip" onClick={() => escolheAlimento(g, item)}>
                        {nome}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="sub-cartao">
                <div className="sub-cartao-topo">
                  <div>
                    <h2>{origem.item.n}</h2>
                    <p className="sub-medida">
                      {origem.item.f === "lista"
                        ? `Porções da tua lista: ${(origem.item.p ?? [])
                            .map((p) => escreveQtd(p, origem.item))
                            .join(" · ")}`
                        : origem.item.obs
                          ? origem.item.obs
                          : "Valores da tabela TACO, por 100g"}
                    </p>
                    {vetoDoAlimento(origem.item.n) && (
                      <p className="sub-medida sub-aviso" style={{ marginTop: 8 }}>
                        O Breno não prescreve isso: {vetoDoAlimento(origem.item.n)!.motivo} No lugar:{" "}
                        {vetoDoAlimento(origem.item.n)!.troca}
                      </p>
                    )}
                  </div>
                  <span className="sub-tags">
                    <span className="sub-tag-grupo">{ROTULO_GRUPO[grupoDaTroca(origem.grupo, origem.item)]}</span>
                    <SeloCarne item={origem.item} />
                    <span className={`sub-selo-fonte ${origem.item.f}`}>
                      {origem.item.f === "lista" ? "Lista do Breno" : ROTULO_FONTE[origem.item.f]}
                    </span>
                  </span>
                </div>

                <div className="sub-quanto">
                  <label htmlFor="sub-qtd">Quantidade</label>
                  <span className="sub-campo">
                    <input
                      id="sub-qtd"
                      ref={campoQtd}
                      type="text"
                      inputMode="decimal"
                      enterKeyHint="done"
                      autoComplete="off"
                      defaultValue={qtd > 0 ? (mAtiva ? Math.round((qtd / mAtiva.fator) * 100) / 100 : qtd) : ""}
                      placeholder={
                        mAtiva?.curto === "un"
                          ? "quantas unidades estão no seu plano?"
                          : mAtiva?.curto === "ml"
                            ? "quantos ml estão no seu plano?"
                            : "quantos gramas estão no seu plano?"
                      }
                      key={`${origem.item.n}-${medidaId}`}
                      onChange={aoDigitarQtd}
                      aria-label="Quantidade"
                    />
                    <b>{mAtiva?.rotulo}</b>
                  </span>
                  {medidas.length > 1 && (
                    <span className="sub-medidas" role="group" aria-label="Contar em">
                      {medidas.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="sub-medida-btn"
                          aria-pressed={m.id === mAtiva?.id}
                          onClick={() => mudaMedida(m.id)}
                        >
                          {m.curto}
                        </button>
                      ))}
                    </span>
                  )}
                  {preparos.length > 1 && origem && (
                    <select
                      className="sub-preparo-sel"
                      value={preparoDoItem(origem.item) ?? preparos[0].id}
                      onChange={(e) => {
                        const achado = preparos.find((x) => x.id === e.target.value);
                        if (!achado) return;
                        setOrigem({ grupo: achado.grupo, item: achado.item });
                        setMedidaId("nativa");
                      }}
                      aria-label={`Ponto de ${origem.item.n}`}
                    >
                      {preparos.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.id}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="sub-atalhos">
                  {(origem.item.p ?? []).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="sub-atalho"
                      aria-pressed={Math.abs(p - qtd) < 0.001}
                      onClick={() => usaAtalho(p)}
                    >
                      {escreveQtd(p, origem.item)}
                    </button>
                  ))}
                </div>

                {qtd > 0 && (
                <div className="sub-macros">
                  <span>
                    <b>{Math.round(kcal)}</b> kcal
                  </span>
                  <span className="principal">
                    <b>{n1(origem.item[macro] * qtd)}g</b> de {rot}
                  </span>
                  {macro !== "ptn" && (
                    <span>
                      <b>{n1(origem.item.ptn * qtd)}g</b> de proteína
                    </span>
                  )}
                  {macro !== "carb" && (
                    <span>
                      <b>{n1(origem.item.carb * qtd)}g</b> de carboidrato
                    </span>
                  )}
                  {macro !== "fat" && (
                    <span>
                      <b>{n1(origem.item.fat * qtd)}g</b> de gordura
                    </span>
                  )}
                </div>
                )}

                <div className="sub-trocar-por">
                  <label htmlFor="sub-busca-destino">Trocar por</label>
                  <div className="sub-busca-wrap">
                    <div className="sub-busca menor">
                      <input
                        id="sub-busca-destino"
                        type="text"
                        autoComplete="off"
                        role="combobox"
                        aria-expanded={sugAberta === "destino"}
                        aria-controls="sub-sugestoes-destino"
                        aria-autocomplete="list"
                        placeholder="Escreve o que tu quer no lugar"
                        value={buscaDestino}
                        onChange={(e) => {
                          setBuscaDestino(e.target.value);
                          setSugAberta("destino");
                          if (!e.target.value.trim()) setDestino(null);
                        }}
                        onFocus={() => setSugAberta("destino")}
                        onKeyDown={aoDigitarTecla}
                      />
                    </div>
                    {sugAberta === "destino" && (
                      <ul
                        id="sub-sugestoes-destino"
                        className="sub-sugestoes"
                        role="listbox"
                        aria-label="Sugestões de troca"
                      >
                        {sugestoesDestino.length === 0 ? (
                          <li className="sub-sug-vazio">Nada com esse nome na lista nem na TACO</li>
                        ) : (
                          sugestoesDestino.map(({ grupo, item }, k) => (
                            <li
                              key={`${grupo}-${item.n}`}
                              role="option"
                              aria-selected={k === sugIdx}
                              className={`sub-sug${k === sugIdx ? " ativa" : ""}`}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                escolheSugestao(k);
                              }}
                            >
                              <span className="sub-sug-nome">{item.n}</span>
                              <span className="sub-sug-meta">
                                <span className="sub-sug-grupo">{ROTULO_GRUPO[grupoDaTroca(grupo, item)]}</span>
                                <SeloCarne item={item} />
                                <span className={`sub-selo-fonte ${item.f}`}>{ROTULO_FONTE[item.f]}</span>
                              </span>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              <div className="sub-resultado">
                {qtd <= 0 ? (
                  <p className="sub-vazio" role="status">
                    Digite a quantidade do seu plano para ver a troca.
                  </p>
                ) : destino && !destinoServe ? (
                  <>
                    <div className="sub-titulo-secao">
                      <h3>Troca escolhida</h3>
                    </div>
                    <div className="sub-troca longe">
                      <p className="sub-linha-dieta">{destino.n}</p>
                      <p className="sub-conta">
                        Esse não tem {rot}, então não dá pra trocar por ele mantendo a conta. Escolhe outro.
                      </p>
                    </div>
                    <button type="button" className="sub-ver-mais" onClick={() => setDestino(null)}>
                      Ver todas as opções do grupo
                    </button>
                  </>
                ) : destino ? (
                  <>
                    <div className="sub-titulo-secao">
                      <h3>Troca escolhida</h3>
                      <em>{MESMO_MACRO[macro]}, caloria mais próxima</em>
                    </div>
                    <LinhaTroca
                      troca={calculaTroca(origem.grupo, origem.item, qtd, destino)}
                      origem={origem}
                      qtd={qtd}
                      rot={rot}
                      kcalOrigem={kcal}
                      destaque
                    />
                    <button
                      type="button"
                      className="sub-ver-mais"
                      onClick={() => {
                        setDestino(null);
                        setBuscaDestino("");
                      }}
                    >
                      Ver todas as opções do grupo
                    </button>
                  </>
                ) : (
                  <>
                    <div className="sub-titulo-secao">
                      <h3>Pode trocar por</h3>
                      <em>{MESMO_MACRO[macro]}, caloria mais próxima</em>
                    </div>
                    {lista.length === 0 ? (
                      <p className="sub-vazio">Sem troca cadastrada pra esse.</p>
                    ) : (
                      lista.map((t) => (
                        <LinhaTroca
                          key={t.item.n}
                          troca={t}
                          origem={origem}
                          qtd={qtd}
                          rot={rot}
                          kcalOrigem={kcal}
                        />
                      ))
                    )}
                    {todas.length > 3 && (
                      <button type="button" className="sub-ver-mais" onClick={() => setVerTodas((v) => !v)}>
                        {verTodas ? "Mostrar só as 3 principais" : `Ver as outras ${todas.length - 3} opções`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          <PesquisaTroca contexto={contextoTroca} />
        </main>

        <p className="sub-rodape">
          <a href="https://instagram.com/brenoxavieer_" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" stroke="none" />
            </svg>
            @brenoxavieer_
          </a>
        </p>
      </div>
    </div>
  );
}

function LinhaTroca({
  troca,
  origem,
  qtd,
  rot,
  kcalOrigem,
  destaque,
}: {
  troca: Troca;
  origem: Origem;
  qtd: number;
  rot: string;
  kcalOrigem: number;
  destaque?: boolean;
}) {
  const d = Math.round(troca.deltaKcal);
  const longe = Math.abs(d) > Math.max(20, kcalOrigem * 0.15);
  const op = opiniao(origem.item, qtd, origem.grupo, troca);
  const selo =
    troca.item.f === "lista" ? (troca.naLista ? "porção da tua lista" : "lista do Breno") : "TACO";

  return (
    <div className={`sub-troca${longe ? " longe" : ""}${destaque ? " destaque" : ""}`}>
      <p className="sub-linha-dieta">
        {troca.item.n} - <b>{escreveQtd(troca.qtd, troca.item)}</b>
        <span className="sub-selo-lista">{selo}</span>
        <SeloCarne item={troca.item} />
      </p>
      <p className="sub-conta">
        {n1(troca.macro)}g de {rot} ·{" "}
        {d === 0 ? (
          <span className="igual">{Math.round(troca.kcal)} kcal, igual</span>
        ) : (
          <>
            {Math.round(troca.kcal)} kcal,{" "}
            <span className={longe ? "difere" : "igual"}>
              {Math.abs(d)} {d > 0 ? "a mais" : "a menos"}
            </span>
          </>
        )}
      </p>
      <p className="sub-opiniao">
        <span className="sub-selo-op">{op.selo}</span>
        {destaque && op.texto && <span className="sub-texto-op">{op.texto}</span>}
      </p>
    </div>
  );
}
