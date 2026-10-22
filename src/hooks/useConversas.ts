// Estado da lista de conversas: contatos + resumo (última mensagem e não lidas) + Realtime.
// Uma assinatura só para a tela inteira; o chat aberto escuta os mesmos eventos via `ouvir`.
//
// Dois modos (21/10/2026):
//  - paginado (/crm/conversas com a migration 20261126100000): a primeira carga traz só as 60 conversas mais
//    recentes; rolar e buscar pedem mais ao servidor por cursor; a cada 30 s (e a cada evento do Realtime) vem só
//    o que mudou (delta). Os contadores das abas vêm de uma consulta leve separada.
//  - completo (Kanban, que precisa de todos os cards, ou banco sem a migration): tudo de uma vez, como antes.
// Nos dois, a lista que ficou em cache (localStorage, por usuário) aparece na hora e é trocada pela do servidor.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canalDoContato,
  chaveConversa,
  chaveDaMensagem,
  carregarLeituras,
  carregarMarcadas,
  indexarResumos,
  mesclarMensagens,
  montarConversas,
  numeroOcultoEmConversas,
  salvarLeitura,
  salvarMarcada,
  type ContatoCRM,
  type IndiceResumos,
  type Leituras,
  type MensagemCRM,
  type NumeroConversa,
  type ResumoConversa,
} from "@/lib/crm/conversas";
import type { FonteConversas, LeiturasDoUsuario } from "@/lib/crm/fonteConversas";
import {
  avancarPagina,
  chaveConsulta,
  CONSULTA_PADRAO,
  lerCacheLista,
  PAGINA_SERVIDOR,
  proximoDesde,
  resumoDaLinha,
  salvarCacheLista,
  sementeDoCache,
  type ConsultaLista,
  type ContadoresLista,
  type LinhaLista,
  type PaginaConsulta,
} from "@/lib/crm/listaPaginada";
import { EVENTO_NUMEROS_ALTERADOS } from "@/lib/crm/renomearNumero";
import { assinaturaOcultos, guardarOcultos, tomarNumerosPreCarregados, tomarPaginaPreCarregada } from "@/lib/crm/preCarga";

type Ouvinte = (m: MensagemCRM, evento: "INSERT" | "UPDATE") => void;

const RECARGA_LISTA_MS = 30_000;
/** Depois de um evento do Realtime: espera os vizinhos (rajada de mensagens) e pede um delta só. */
const ESPERA_DELTA_MS = 1_200;
const ESPERA_CONTADORES_MS = 1_500;
/** Mensagens recentes que a lista paginada busca em segundo plano (o chat abre na hora com elas). */
const JANELA_PREVIA = 300;
/** Delta com tantas linhas = mudou muita coisa (backfill): recomeça a página em vez de remendar. */
const TETO_DELTA = 500;

const cobreWhatsapp = (c: ContatoCRM) => canalDoContato(c) === "whatsapp";

function mesclarContatos(atuais: ContatoCRM[], novos: ContatoCRM[]): ContatoCRM[] {
  if (!novos.length) return atuais;
  const porId = new Map(atuais.map((c) => [c.id, c] as const));
  for (const c of novos) porId.set(c.id, { ...porId.get(c.id), ...c });
  return [...porId.values()];
}

export interface OpcoesConversas {
  /** Lista paginada pelo servidor (só /crm/conversas; o Kanban precisa de todos os contatos). */
  paginada?: boolean;
  /**
   * Usar o que a pré-carga (lib/crm/preCarga, disparada no main.tsx) já pediu: crm_numeros e a primeira página
   * da aba padrão. Só com a fonte real do banco — a pré-carga consulta o Supabase direto.
   */
  preCarga?: boolean;
}

export function useConversas(fonte: FonteConversas, opcoes: OpcoesConversas = {}) {
  const [semPaginacao, setSemPaginacao] = useState(false);
  const paginada = !!opcoes.paginada && !!fonte.paginaConversas && !semPaginacao;

  const [contatos, setContatos] = useState<ContatoCRM[]>([]);
  const [recentes, setRecentes] = useState<MensagemCRM[]>([]);
  const [resumos, setResumos] = useState<IndiceResumos | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<string | null>(null);
  const [leituras, setLeituras] = useState<Leituras>({});
  const [base, setBase] = useState<string | null>(null);
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(() => new Set());
  const [todosNumeros, setNumeros] = useState<NumeroConversa[]>([]);
  const [numerosProntos, setNumerosProntos] = useState(false);
  const [consulta, setConsulta] = useState<ConsultaLista>(CONSULTA_PADRAO);
  const [paginas, setPaginas] = useState<Record<string, PaginaConsulta>>({});
  const [contadores, setContadores] = useState<ContadoresLista | null>(null);
  /** true depois da primeira resposta do servidor (o cache só é regravado com dado do servidor). */
  const [doServidor, setDoServidor] = useState(false);

  const ouvintes = useRef(new Set<Ouvinte>());
  const abertoRef = useRef<string | null>(null);
  const leiturasRef = useRef<{ leituras: Leituras; base: string | null }>({ leituras: {}, base: null });
  leiturasRef.current = { leituras, base };
  const marcadasRef = useRef(marcadas);
  marcadasRef.current = marcadas;
  const paginasRef = useRef(paginas);
  paginasRef.current = paginas;
  const consultaRef = useRef(consulta);
  consultaRef.current = consulta;
  const paginadaRef = useRef(paginada);
  paginadaRef.current = paginada;
  const usarPreCarga = !!opcoes.preCarga;
  const usuarioRef = useRef<string | null>(null);
  /** Base do próximo delta (hora do servidor). */
  const desdeRef = useRef<string | null>(null);
  /** Ids que vieram só do cache: saem quando o servidor responder sem eles. */
  const doCacheRef = useRef<Set<string> | null>(null);
  const timerDelta = useRef<number | null>(null);
  const timerContadores = useRef<number | null>(null);
  const segundoPlanoFeito = useRef(false);

  // números fora de Conversas (ex.: Grupos 1): somem do seletor, das listas e dos contadores; nada é apagado
  const ocultos = useMemo(
    () => new Set(todosNumeros.filter(numeroOcultoEmConversas).map((n) => n.id)),
    [todosNumeros],
  );
  const ocultosRef = useRef(ocultos);
  ocultosRef.current = ocultos;

  const doUsuario = useCallback((): LeiturasDoUsuario => ({
    leituras: leiturasRef.current.leituras,
    base: leiturasRef.current.base,
    marcadas: [...marcadasRef.current],
    ocultos: [...ocultosRef.current],
  }), []);

  // ---------------------------------------------------------------- modo completo (como antes)
  const recarregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    try {
      const { leituras: l, base: b } = leiturasRef.current;
      const [cs, ms, rs] = await Promise.all([
        fonte.listarContatos(),
        fonte.mensagensRecentes(),
        // o resumo nunca derruba a tela: falhou = fallback pela janela de recentes
        fonte.resumoConversas ? fonte.resumoConversas(l, b).catch(() => null) : Promise.resolve(null),
      ]);
      doCacheRef.current = null;
      setContatos(cs);
      setResumos(rs ? indexarResumos(rs, cobreWhatsapp) : null);
      setRecentes((atuais) => mesclarMensagens(silencioso ? atuais : [], ms));
      setErro(null);
      setDoServidor(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar as conversas.");
    } finally {
      if (!silencioso) setCarregando(false);
    }
  }, [fonte]);

  // ---------------------------------------------------------------- modo paginado
  /** Linhas do servidor no estado: contato, resumo (última + não lidas) e a base do delta. */
  const aplicarLinhas = useCallback((linhas: LinhaLista[], deUmaPagina: boolean) => {
    desdeRef.current = proximoDesde(linhas, desdeRef.current);
    const sairam = deUmaPagina && doCacheRef.current
      ? new Set([...doCacheRef.current].filter((id) => !linhas.some((l) => l.contato.id === id)))
      : null;
    if (deUmaPagina) doCacheRef.current = null;
    setContatos((cs) => {
      const base = sairam?.size ? cs.filter((c) => !sairam.has(c.id)) : cs;
      return mesclarContatos(base, linhas.map((l) => l.contato));
    });
    setResumos((r) => {
      const m = new Map<string, ResumoConversa>(r?.porTelefone ?? []);
      for (const l of linhas) {
        const k = chaveConversa(l.contato);
        const res = resumoDaLinha(l);
        if (res) m.set(k, res); else m.delete(k);
      }
      return { porTelefone: m, cobre: cobreWhatsapp };
    });
    setDoServidor(true);
  }, []);

  const carregarPagina = useCallback(async (q: ConsultaLista, mais: boolean) => {
    if (!fonte.paginaConversas) return;
    const k = chaveConsulta(q);
    const atual = paginasRef.current[k];
    if (atual?.carregando) return;
    if (mais && (!atual || atual.fim)) return;
    if (!mais && atual) return; // já tem: o delta mantém em dia
    const marcar = (p: PaginaConsulta) => { paginasRef.current = { ...paginasRef.current, [k]: p }; setPaginas(paginasRef.current); };
    marcar({ ids: atual?.ids ?? new Set(), cursor: atual?.cursor ?? null, fronteira: atual?.fronteira ?? null, fim: false, carregando: true });
    try {
      // primeira página da aba padrão: a pré-carga já pediu a mesma consulta lá no início (usa se bater)
      let linhas: LinhaLista[] | null | undefined;
      if (usarPreCarga && !mais && k === chaveConsulta(CONSULTA_PADRAO)) {
        const pre = await tomarPaginaPreCarregada()?.catch(() => null);
        const u = doUsuario();
        if (pre && pre.usuario === usuarioRef.current && pre.ocultos === assinaturaOcultos(u.ocultos)) linhas = pre.linhas;
      }
      if (linhas === undefined) {
        linhas = await fonte.paginaConversas({ ...doUsuario(), consulta: q, cursor: mais ? atual?.cursor : null, limite: PAGINA_SERVIDOR });
      }
      if (linhas === null) { setSemPaginacao(true); return; }
      aplicarLinhas(linhas, true);
      marcar(avancarPagina(mais ? atual : undefined, linhas, PAGINA_SERVIDOR));
      setErro(null);
    } catch (e) {
      const { [k]: _descartada, ...resto } = paginasRef.current;
      paginasRef.current = atual ? { ...resto, [k]: { ...atual, carregando: false } } : resto;
      setPaginas(paginasRef.current);
      setErro(e instanceof Error ? e.message : "Não consegui carregar as conversas.");
    } finally {
      setCarregando(false);
    }
  }, [fonte, doUsuario, aplicarLinhas, usarPreCarga]);

  const buscarDelta = useCallback(async () => {
    if (!fonte.paginaConversas || !paginadaRef.current || !desdeRef.current) return;
    try {
      const linhas = await fonte.paginaConversas({ ...doUsuario(), desde: desdeRef.current });
      if (linhas === null) { setSemPaginacao(true); return; }
      if (!linhas.length) return;
      aplicarLinhas(linhas, false);
      if (linhas.length >= TETO_DELTA) {
        // mudou muita coisa (backfill/importação): recomeça a consulta atual do zero
        paginasRef.current = {};
        setPaginas({});
        void carregarPagina(consultaRef.current, false);
      }
    } catch {
      /* sem rede agora: o próximo delta cobre o mesmo intervalo (desde não avançou) */
    }
  }, [fonte, doUsuario, aplicarLinhas, carregarPagina]);

  const agendarDelta = useCallback(() => {
    if (!paginadaRef.current) return;
    if (timerDelta.current) window.clearTimeout(timerDelta.current);
    timerDelta.current = window.setTimeout(() => { timerDelta.current = null; void buscarDelta(); }, ESPERA_DELTA_MS);
  }, [buscarDelta]);

  const lerContadores = useCallback(async () => {
    if (!fonte.contadoresConversas || !paginadaRef.current) return;
    const q = consultaRef.current;
    try {
      const c = await fonte.contadoresConversas({ ...doUsuario(), numeroId: q.numeroId, atendente: q.atendente });
      setContadores(c);
    } catch {
      /* contador velho é melhor que contador nenhum */
    }
  }, [fonte, doUsuario]);

  const agendarContadores = useCallback((ms = ESPERA_CONTADORES_MS) => {
    if (!paginadaRef.current) return;
    if (timerContadores.current) window.clearTimeout(timerContadores.current);
    timerContadores.current = window.setTimeout(() => { timerContadores.current = null; void lerContadores(); }, ms);
  }, [lerContadores]);

  // ---------------------------------------------------------------- comum
  // números do WhatsApp (seletor do topo, selo e cabeçalho do chat); falhou = tela sem seletor
  // relê quando alguém renomeia um número em /crm/conexoes (evento de janela, sem esperar recarregar a página)
  useEffect(() => {
    let vivo = true;
    // a primeira leitura aproveita o crm_numeros que a pré-carga já pediu
    let primeira = usarPreCarga;
    const ler = () => {
      const pre = primeira ? tomarNumerosPreCarregados() : null;
      primeira = false;
      const p = pre ?? fonte.listarNumeros?.() ?? Promise.resolve([] as NumeroConversa[]);
      p.then((ns) => { if (vivo) setNumeros(ns); })
        .catch(() => undefined)
        .finally(() => { if (vivo) setNumerosProntos(true); });
    };
    ler();
    window.addEventListener(EVENTO_NUMEROS_ALTERADOS, ler);
    return () => { vivo = false; window.removeEventListener(EVENTO_NUMEROS_ALTERADOS, ler); };
  }, [fonte, usarPreCarga]);

  useEffect(() => {
    let vivo = true;
    fonte.usuarioId().then((id) => {
      if (!vivo) return;
      const l = carregarLeituras(id);
      // a lista da última visita aparece já, antes de qualquer resposta do servidor
      const cache = lerCacheLista(id);
      if (cache.length) {
        const s = sementeDoCache(cache);
        setContatos((cs) => {
          if (cs.length) return cs;
          doCacheRef.current = new Set(s.contatos.map((c) => c.id));
          return s.contatos;
        });
        setResumos((r) => r ?? indexarResumos(s.resumos, cobreWhatsapp));
        setRecentes((r) => (r.length ? r : mesclarMensagens([], s.mensagens)));
      }
      usuarioRef.current = id;
      setUsuario(id);
      setLeituras(l.leituras);
      setBase(l.base);
      setMarcadas(carregarMarcadas(id));
    });
    return () => { vivo = false; };
  }, [fonte]);

  /** `chave`: chave da conversa (chaveConversa: número + telefone). */
  const marcarLida = useCallback((chave: string, iso: string = new Date().toISOString()) => {
    // abrir a conversa (ou ler mensagem nova com ela aberta) tira a marca de "não lida"
    setMarcadas((m) => {
      if (!m.has(chave)) return m;
      const n = new Set(m); n.delete(chave); return n;
    });
    if (usuario) salvarMarcada(usuario, chave, false);
    setLeituras((l) => ((l[chave] ?? "") >= iso ? l : { ...l, [chave]: iso }));
    if (usuario) salvarLeitura(usuario, chave, iso);
  }, [usuario]);

  /** Menu de contexto: volta a bolinha de não lida (sem mexer na leitura real nem no celular). */
  const marcarNaoLida = useCallback((chave: string) => {
    setMarcadas((m) => (m.has(chave) ? m : new Set(m).add(chave)));
    if (usuario) salvarMarcada(usuario, chave, true);
  }, [usuario]);

  const definirAberto = useCallback((chave: string | null) => {
    abertoRef.current = chave;
    if (chave) marcarLida(chave);
  }, [marcarLida]);

  // Realtime: uma assinatura para os dois modos
  useEffect(() => {
    const parar = fonte.assinar({
      onMensagem: (m, evento) => {
        setRecentes((r) => mesclarMensagens(r, [m]));
        if (evento === "INSERT") {
          const chave = chaveDaMensagem(m);
          if (abertoRef.current === chave && document.visibilityState === "visible") {
            marcarLida(chave, m.created_at);
          }
          // conversa que a lista ainda não tem (ou subiu para o topo): o delta traz contato e resumo
          agendarDelta();
          agendarContadores();
        }
        ouvintes.current.forEach((fn) => fn(m, evento));
      },
      onContato: (c, evento) => {
        setContatos((cs) => {
          if (evento === "DELETE") return cs.filter((x) => x.id !== c.id);
          // por id: o mesmo telefone em outro número é outro contato (outra conversa)
          const i = cs.findIndex((x) => x.id === c.id);
          if (i < 0) return [c, ...cs];
          const novo = [...cs];
          novo[i] = { ...novo[i], ...c };
          return novo;
        });
        agendarContadores();
      },
    });
    return () => { parar(); };
    // marcarLida muda quando o usuário chega; a assinatura não precisa ser refeita por isso
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fonte]);

  // modo completo: carrega tudo e reconfere a cada 30 s (rede de segurança se o Realtime não entregar)
  useEffect(() => {
    if (paginada) return;
    void recarregar();
    const relogio = window.setInterval(() => {
      if (document.visibilityState === "visible") void recarregar(true);
    }, RECARGA_LISTA_MS);
    return () => window.clearInterval(relogio);
  }, [paginada, recarregar]);

  // modo paginado: a página da consulta atual (espera o usuário, para contar as não lidas com as leituras dele,
  // e os números, para não gastar a primeira página com conversas de número oculto)
  const prontoParaPaginar = paginada && !!usuario && numerosProntos;
  const prontoRef = useRef(prontoParaPaginar);
  prontoRef.current = prontoParaPaginar;
  useEffect(() => {
    if (!prontoParaPaginar) return;
    void carregarPagina(consulta, false);
  }, [prontoParaPaginar, consulta, carregarPagina]);

  // modo paginado: depois da primeira página, em segundo plano, o Direct inteiro e uma janela de mensagens
  // recentes (o chat abre na hora com elas); uma vez só — dali em diante é o Realtime e o delta
  useEffect(() => {
    if (!paginada || !doServidor || segundoPlanoFeito.current) return;
    segundoPlanoFeito.current = true;
    fonte.canaisCompletos?.().then(({ contatos: cs, mensagens }) => {
      setContatos((atuais) => mesclarContatos(atuais, cs));
      setRecentes((r) => mesclarMensagens(r, mensagens));
    }).catch(() => undefined);
    fonte.mensagensRecentes(JANELA_PREVIA)
      .then((ms) => setRecentes((r) => mesclarMensagens(r, ms.filter((m) => !m.contact_phone.startsWith("ig:")))))
      .catch(() => undefined);
  }, [paginada, doServidor, fonte]);

  // modo paginado: delta a cada 30 s e ao voltar para a aba/app (celular saindo do bloqueio)
  useEffect(() => {
    if (!paginada) return;
    const passo = () => {
      if (document.visibilityState !== "visible") return;
      // a primeira página falhou (rede caiu): tenta de novo em vez de ficar com a lista vazia
      if (prontoRef.current && !paginasRef.current[chaveConsulta(consultaRef.current)]) void carregarPagina(consultaRef.current, false);
      void buscarDelta();
      agendarContadores(0);
    };
    const relogio = window.setInterval(passo, RECARGA_LISTA_MS);
    document.addEventListener("visibilitychange", passo);
    return () => {
      window.clearInterval(relogio);
      document.removeEventListener("visibilitychange", passo);
    };
  }, [paginada, buscarDelta, agendarContadores, carregarPagina]);

  // modo paginado: contadores das abas (relê quando muda número/atendente, leitura, marca ou números ocultos)
  const chaveOcultos = [...ocultos].sort().join(",");
  // os ocultos desta visita servem à pré-carga da próxima (ela não precisa esperar crm_numeros)
  useEffect(() => {
    if (usuario && numerosProntos) guardarOcultos(usuario, chaveOcultos ? chaveOcultos.split(",") : []);
  }, [usuario, numerosProntos, chaveOcultos]);
  useEffect(() => {
    if (!prontoParaPaginar) { setContadores(null); return; }
    agendarContadores(150);
  }, [prontoParaPaginar, consulta.numeroId, consulta.atendente, leituras, marcadas, chaveOcultos, agendarContadores]);

  useEffect(() => () => {
    if (timerDelta.current) window.clearTimeout(timerDelta.current);
    if (timerContadores.current) window.clearTimeout(timerContadores.current);
  }, []);

  const numeros = useMemo(() => todosNumeros.filter((n) => !ocultos.has(n.id)), [todosNumeros, ocultos]);
  const contatosVisiveis = useMemo(
    () => (ocultos.size ? contatos.filter((c) => !c.numero_id || !ocultos.has(c.numero_id)) : contatos),
    [contatos, ocultos],
  );

  const conversas = useMemo(
    () => montarConversas(contatosVisiveis, recentes, leituras, base, resumos, marcadas),
    [contatosVisiveis, recentes, leituras, base, resumos, marcadas],
  );

  // cache da lista: as primeiras conversas, regravadas (sem pressa) sempre que o servidor mudar algo
  useEffect(() => {
    if (!usuario || !doServidor || !conversas.length) return;
    const t = window.setTimeout(() => salvarCacheLista(usuario, conversas), 2_000);
    return () => window.clearTimeout(t);
  }, [usuario, doServidor, conversas]);

  // o chat abre na hora com as mensagens desta conversa que a lista já tem (21/10/2026)
  const recentesRef = useRef(recentes);
  recentesRef.current = recentes;
  const resumosRef = useRef(resumos);
  resumosRef.current = resumos;
  const previaConversa = useCallback((phone: string, numeroId: string | null) => {
    const daJanela = recentesRef.current.filter((m) => m.contact_phone === phone && (!m.numero_id || !numeroId || m.numero_id === numeroId));
    // na lista paginada a janela é menor: a última mensagem do resumo garante ao menos ela
    const ultima = resumosRef.current?.porTelefone.get(chaveConversa({ phone, numero_id: numeroId }))?.ultima;
    return ultima && !daJanela.some((m) => m.id === ultima.id) ? [...daJanela, ultima] : daJanela;
  }, []);

  const ouvir = useCallback((fn: Ouvinte) => {
    ouvintes.current.add(fn);
    return () => { ouvintes.current.delete(fn); };
  }, []);

  const atualizarContatoLocal = useCallback((id: string, patch: Partial<ContatoCRM>) => {
    setContatos((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  /** A lista mudou de número, atendente, aba ou busca (a busca já chega com espera de digitação). */
  const definirConsulta = useCallback((q: ConsultaLista) => {
    setConsulta((atual) => (chaveConsulta(atual) === chaveConsulta(q) ? atual : q));
  }, []);

  const carregarMais = useCallback(() => { void carregarPagina(consultaRef.current, true); }, [carregarPagina]);

  /**
   * Conversas que a tela precisa e a lista paginada ainda não trouxe (link ?abrir=, cartão de contato).
   * `chaves`: chaveConversa ou telefone solto. Devolve os contatos achados (o RLS decide o que volta).
   */
  const garantirConversas = useCallback(async (chaves: string[]): Promise<ContatoCRM[]> => {
    if (!paginadaRef.current || !fonte.paginaConversas || !chaves.length) return [];
    try {
      const linhas = await fonte.paginaConversas({ ...doUsuario(), chaves, limite: 50 });
      if (!linhas) return [];
      aplicarLinhas(linhas, false);
      return linhas.map((l) => l.contato);
    } catch {
      return [];
    }
  }, [fonte, doUsuario, aplicarLinhas]);

  /** Busca no servidor (cartão de contato: o telefone pode estar numa conversa que a lista não carregou). */
  const procurarNoServidor = useCallback(async (busca: string): Promise<ContatoCRM[]> => {
    if (!paginadaRef.current || !fonte.paginaConversas || !busca.trim()) return [];
    try {
      const linhas = await fonte.paginaConversas({ ...doUsuario(), consulta: { ...CONSULTA_PADRAO, busca }, limite: 20 });
      if (!linhas) return [];
      aplicarLinhas(linhas, false);
      return linhas.map((l) => l.contato);
    } catch {
      return [];
    }
  }, [fonte, doUsuario, aplicarLinhas]);

  const paginacao = useMemo(() => (paginada ? {
    pagina: paginas[chaveConsulta(consulta)] ?? null,
    contadores,
    onConsulta: definirConsulta,
    onCarregarMais: carregarMais,
  } : null), [paginada, paginas, consulta, contadores, definirConsulta, carregarMais]);

  return {
    conversas, contatos: contatosVisiveis, numeros, carregando, erro, recarregar, ouvir, previaConversa, marcarLida, marcarNaoLida,
    definirAberto, atualizarContatoLocal, paginacao, garantirConversas, procurarNoServidor,
  };
}

export type ControleConversas = ReturnType<typeof useConversas>;
export type PaginacaoConversas = NonNullable<ControleConversas["paginacao"]>;
