// Coluna esquerda: busca, filtros em pílulas (Tudo, Não lidas, Grupos, Sem conversa, etapa, tag) e a lista
// ordenada pela última mensagem. Com mais de um número do WhatsApp: seletor de número no topo
// (Todos os números / Closer / Comercial Fit 2 / ...) e selo do número em cada conversa.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, FileText, Image as ImageIcon, Loader2, Mic, MailOpen, Mail, RefreshCw, Search, Video, X } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useEtapas } from "@/hooks/useEtapas";
import {
  canalDoContato,
  chaveConversa,
  contatoEhGrupo,
  ehEnviada,
  filtrarConversas,
  horarioDaLista,
  nomeExibido,
  previaDaMensagem,
  rotuloAutor,
  rotuloNumero,
  temNaoLida,
  statusEntrega,
  tagsDisponiveis,
  type Conversa,
  type FiltroConversa,
  type NumeroConversa,
  type TipoMidia,
} from "@/lib/crm/conversas";
import { StatusEntregaIcone } from "./StatusEntregaIcone";
import { AvatarContato } from "./AvatarContato";
import { SeloIA } from "./SeloIA";
import { AbasDepartamentos, type AcoesDepartamento } from "./AbasDepartamentos";
import { casaAtendente, conversaNoDepartamento, type Atendente, type Departamento, type FiltroAtendente } from "@/lib/crm/departamentos";
import { dentroDaFronteira, type ConsultaLista, type ContadoresLista, type PaginaConsulta } from "@/lib/crm/listaPaginada";

/** Lista paginada pelo servidor (useConversas no modo paginado). Sem ela, a lista filtra e conta tudo no aparelho. */
export interface PaginacaoLista {
  /** Estado da consulta atual: quem o servidor confirmou, até onde já veio e se acabou. null = ainda não respondeu. */
  pagina: PaginaConsulta | null;
  /** Contadores das abas vindos do banco (null = ainda não chegaram: conta o que tem na tela). */
  contadores: ContadoresLista | null;
  onConsulta: (q: ConsultaLista) => void;
  onCarregarMais: () => void;
}

/** Espera de digitação antes de buscar no servidor. */
const ESPERA_BUSCA_MS = 250;


/** Quantas conversas a lista monta por vez. */
export const PASSO_LISTA = 60;

interface Props {
  conversas: Conversa[];
  selecionado: string | null;
  onSelecionar: (c: Conversa) => void;
  /** Dedo encostou / mouse passou numa conversa: dá para adiantar as mensagens dela. */
  onPreAquecer?: (c: Conversa) => void;
  carregando?: boolean;
  erro?: string | null;
  agora?: Date;
  /** Traz do celular as conversas recentes (contatos e grupos) com as fotos. */
  onSincronizar?: () => Promise<void>;
  /** Números do WhatsApp (crm_numeros). Com 2 ou mais, aparece o seletor e o selo. */
  numeros?: NumeroConversa[];
  /** Número escolhido no seletor (null = todos). */
  numeroFiltro?: string | null;
  onNumeroFiltro?: (numeroId: string | null) => void;
  /** Menu de contexto (botão direito): marcar como não lida / lida. Recebem chaveConversa. */
  onMarcarNaoLida?: (chave: string) => void;
  onMarcarLida?: (chave: string) => void;
  /**
   * Departamentos = abas depois de Tudo · Não lidas · Grupos (migration 20261123100000). Vazio (banco sem a
   * migration): as pílulas de etapa voltam, como antes.
   */
  departamentos?: Departamento[];
  /** admin: criar/editar/excluir/reordenar departamento nas abas */
  acoesDepartamento?: AcoesDepartamento;
  onErroDepartamento?: (msg: string) => void;
  /** Filtro "Atendente" (abaixo do seletor de número). Sem `atendentes`, o filtro não aparece. */
  atendentes?: Atendente[];
  atendenteFiltro?: FiltroAtendente;
  onAtendenteFiltro?: (f: FiltroAtendente) => void;
  paginacao?: PaginacaoLista | null;
}

export function ListaConversas({
  conversas, selecionado, onSelecionar, onPreAquecer, carregando, erro, agora, onSincronizar, numeros = [], numeroFiltro = null, onNumeroFiltro, onMarcarNaoLida, onMarcarLida,
  departamentos = [], acoesDepartamento, onErroDepartamento, atendentes, atendenteFiltro = "todos", onAtendenteFiltro, paginacao = null,
}: Props) {
  const comDepartamentos = departamentos.length > 0;
  const variosNumeros = numeros.length > 1;
  const { colunas } = useEtapas();
  const [sincronizando, setSincronizando] = useState(false);
  const sincronizar = async () => {
    if (!onSincronizar || sincronizando) return;
    setSincronizando(true);
    try { await onSincronizar(); } finally { setSincronizando(false); }
  };
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroConversa>("tudo");

  // seletor de número: contagens e pílulas valem para o número escolhido
  // seletor de número + filtro Atendente: contagens, pílulas e abas valem para os dois
  const doNumero = useMemo(
    () => conversas.filter((c) =>
      (!variosNumeros || !numeroFiltro || c.contato.numero_id === numeroFiltro) && casaAtendente(c.contato, atendenteFiltro)),
    [conversas, numeroFiltro, variosNumeros, atendenteFiltro],
  );
  // lista paginada: o servidor busca e filtra na lista inteira; a espera evita uma consulta por tecla
  const onConsulta = paginacao?.onConsulta;
  useEffect(() => {
    if (!onConsulta) return;
    const q: ConsultaLista = { numeroId: variosNumeros ? numeroFiltro : null, atendente: atendenteFiltro, filtro, busca };
    if (!busca.trim()) { onConsulta(q); return; }
    const t = window.setTimeout(() => onConsulta(q), ESPERA_BUSCA_MS);
    return () => window.clearTimeout(t);
  }, [onConsulta, numeroFiltro, variosNumeros, atendenteFiltro, filtro, busca]);
  const contadores = paginacao?.contadores ?? null;
  // canais que não paginam no servidor (Instagram) entram nas contagens pelo que está na tela
  const foraDoServidor = useMemo(() => (contadores ? doNumero.filter((c) => canalDoContato(c.contato) !== "whatsapp") : doNumero), [contadores, doNumero]);

  const tags = useMemo(() => {
    const locais = tagsDisponiveis(foraDoServidor.map((c) => c.contato));
    if (!contadores) return locais;
    return [...new Set([...contadores.tags, ...locais])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [foraDoServidor, contadores]);
  const etapasComContato = useMemo(() => {
    const presentes = new Set<string>(foraDoServidor.map((c) => c.contato.stage));
    for (const e of contadores?.etapas ?? []) presentes.add(e);
    return colunas.filter((c) => presentes.has(c.id));
  }, [foraDoServidor, contadores, colunas]);
  const pagina = paginacao?.pagina ?? null;
  const visiveis = useMemo(() => {
    const filtradas = filtrarConversas(doNumero, busca, filtro, null, {
      departamentos,
      casouNaBusca: pagina ? (c) => pagina.ids.has(c.contato.id) : undefined,
    });
    // abaixo da última conversa que o servidor mandou a lista ainda não sabe o que existe: espera a próxima página
    return pagina ? filtradas.filter((c) => dentroDaFronteira(c, pagina)) : filtradas;
  }, [doNumero, busca, filtro, departamentos, pagina]);
  // Lista em lotes (21/10/2026): ~860 conversas montadas de uma vez (e de novo a cada recarga de 30 s) travavam o
  // celular e atrasavam o toque na conversa. Mostra as primeiras PASSO_LISTA e mais um lote ao chegar no fim.
  const [limite, setLimite] = useState(PASSO_LISTA);
  useEffect(() => { setLimite(PASSO_LISTA); }, [busca, filtro, numeroFiltro, atendenteFiltro]);
  const fimDaLista = useRef<HTMLDivElement>(null);
  const temMaisLocal = visiveis.length > limite;
  const temMaisServidor = !!pagina && !pagina.fim;
  const temMaisNaLista = temMaisLocal || temMaisServidor;
  const onCarregarMais = paginacao?.onCarregarMais;
  const mostrarMais = useCallback(() => {
    if (visiveis.length > limite) setLimite((l) => l + PASSO_LISTA);
    else if (temMaisServidor) onCarregarMais?.();
  }, [visiveis.length, limite, temMaisServidor, onCarregarMais]);
  useEffect(() => {
    const el = fimDaLista.current;
    if (!el || !temMaisNaLista || pagina?.carregando || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) mostrarMais();
    }, { rootMargin: "600px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [temMaisNaLista, mostrarMais, pagina?.carregando]);
  // contagem de não lidas por aba de departamento
  const naoLidasPorDep = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of departamentos) {
      m[d.id] = (contadores?.porDepartamento[d.id] ?? 0)
        + foraDoServidor.filter((c) => !contatoEhGrupo(c.contato) && !c.semConversa && temNaoLida(c) && conversaNoDepartamento(c.contato, d)).length;
    }
    return m;
  }, [foraDoServidor, contadores, departamentos]);
  const totalNaoLidas = useMemo(() => (contadores?.naoLidas ?? 0) + foraDoServidor.filter(temNaoLida).length, [foraDoServidor, contadores]);
  const temInstagram = useMemo(() => doNumero.some((c) => canalDoContato(c.contato) === "instagram"), [doNumero]);
  const totalSemConversa = useMemo(() => (contadores?.semConversa ?? 0) + foraDoServidor.filter((c) => !c.ultima).length, [foraDoServidor, contadores]);

  const pilulas: { id: FiltroConversa; rotulo: string }[] = [
    { id: "tudo", rotulo: "Tudo" },
    { id: "nao-lidas", rotulo: totalNaoLidas ? `Não lidas ${totalNaoLidas}` : "Não lidas" },
    ...(temInstagram
      ? [{ id: "canal:whatsapp" as FiltroConversa, rotulo: "WhatsApp" }, { id: "canal:instagram" as FiltroConversa, rotulo: "Instagram" }]
      : []),
    { id: "grupos", rotulo: "Grupos" },
  ];
  // depois das abas de departamento (ou, sem elas, das etapas como antes)
  const pilulasFim: { id: FiltroConversa; rotulo: string }[] = [
    ...(totalSemConversa ? [{ id: "sem-conversa" as FiltroConversa, rotulo: `Sem conversa ${totalSemConversa}` }] : []),
    ...(comDepartamentos ? [] : etapasComContato.map((e) => ({ id: `etapa:${e.id}` as FiltroConversa, rotulo: e.title }))),
    ...tags.map((t) => ({ id: `tag:${t}` as FiltroConversa, rotulo: `#${t}` })),
  ];
  const pilula = (p: { id: FiltroConversa; rotulo: string }) => (
    <button
      key={p.id}
      type="button"
      role="tab"
      aria-selected={filtro === p.id}
      onClick={() => setFiltro(p.id)}
      className={`shrink-0 h-8 rounded-full px-3 text-sm whitespace-nowrap transition-colors ${
        filtro === p.id
          ? "bg-success/15 text-success font-medium"
          : "bg-muted text-muted-foreground hover:bg-muted/70"
      }`}
    >
      {p.rotulo}
    </button>
  );

  return (
    <div className="h-full flex flex-col min-h-0 bg-background">
      <div className="px-3 pt-3 pb-2 space-y-2 shrink-0">
        {variosNumeros && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">Número</span>
            <select
              value={numeroFiltro ?? ""}
              onChange={(e) => onNumeroFiltro?.(e.target.value || null)}
              aria-label="Número do WhatsApp"
              data-testid="seletor-numero"
              className="h-8 flex-1 min-w-0 rounded-lg bg-muted px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/20"
            >
              <option value="">Todos os números</option>
              {numeros.map((n) => (
                <option key={n.id} value={n.id}>{n.apelido}</option>
              ))}
            </select>
          </label>
        )}
        {atendentes && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">Atendente</span>
            <select
              value={atendenteFiltro}
              onChange={(e) => onAtendenteFiltro?.(e.target.value as FiltroAtendente)}
              aria-label="Atendente"
              data-testid="filtro-atendente"
              className="h-8 flex-1 min-w-0 rounded-lg bg-muted px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/20"
            >
              <option value="todos">Todos os atendentes</option>
              <option value="sem">Sem atendente</option>
              <option value="ia">IA (agente atendendo)</option>
              {atendentes.map((a) => (
                <option key={a.id} value={`u:${a.id}`}>{a.nome}</option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Pesquisar ou começar uma conversa"
            aria-label="Pesquisar conversas"
            className="w-full h-9 rounded-lg bg-muted pl-10 pr-8 text-sm outline-none focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground"
          />
          {busca && (
            <button type="button" onClick={() => setBusca("")} aria-label="Limpar busca" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {onSincronizar && (
          <button
            type="button"
            onClick={sincronizar}
            disabled={sincronizando}
            aria-label="Atualizar conversas e fotos do WhatsApp"
            title="Atualizar conversas e fotos do WhatsApp"
            className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-60"
          >
            {sincronizando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        )}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Filtros">
          {pilulas.map(pilula)}
          {comDepartamentos && (
            <AbasDepartamentos
              departamentos={departamentos}
              filtro={filtro}
              onFiltro={setFiltro}
              contagem={naoLidasPorDep}
              acoes={acoesDepartamento}
              onErro={onErroDepartamento}
            />
          )}
          {pilulasFim.map(pilula)}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" role="list" aria-label="Conversas">
        {erro && <p className="px-4 py-3 text-sm text-destructive">{erro}</p>}
        {(carregando && conversas.length === 0) || (visiveis.length === 0 && paginacao && (!pagina || pagina.carregando)) ? (
          <ListaCarregando />
        ) : visiveis.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {filtro === "grupos" ? "Nenhum grupo ainda. Use o botão de atualizar para trazer os grupos do celular." : busca ? "Nada encontrado." : "Nenhuma conversa aqui."}
          </p>
        ) : (
          visiveis.slice(0, limite).map((c) => (
            <ItemConversa
              key={c.contato.id}
              conversa={c}
              ativo={selecionado === chaveConversa(c.contato)}
              onClick={onSelecionar}
              onPreAquecer={onPreAquecer}
              onMarcarNaoLida={onMarcarNaoLida}
              onMarcarLida={onMarcarLida}
              agora={agora}
              selo={variosNumeros && !numeroFiltro ? rotuloNumero(numeros, c.contato.numero_id) : null}
            />
          ))
        )}
        {temMaisNaLista && (
          <div ref={fimDaLista} className="py-3 flex justify-center" data-testid="lista-mais">
            {pagina?.carregando && !temMaisLocal ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Carregando mais conversas" />
            ) : (
              <button type="button" onClick={mostrarMais} className="text-xs text-muted-foreground underline">
                Mostrar mais conversas
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const ICONE_MIDIA: Partial<Record<NonNullable<TipoMidia>, typeof ImageIcon>> = {
  image: ImageIcon, sticker: ImageIcon, audio: Mic, video: Video, document: FileText,
};

const ItemConversa = memo(function ItemConversa({
  conversa, ativo, onClick, onPreAquecer, agora, selo, onMarcarNaoLida, onMarcarLida,
}: {
  conversa: Conversa; ativo: boolean; onClick: (c: Conversa) => void; onPreAquecer?: (c: Conversa) => void; agora?: Date; selo?: string | null;
  onMarcarNaoLida?: (chave: string) => void; onMarcarLida?: (chave: string) => void;
}) {
  const { contato, ultima, naoLidas } = conversa;
  const chave = chaveConversa(contato);
  const naoLida = temNaoLida(conversa);
  const previa = previaDaMensagem(ultima);
  const Icone = previa.tipo ? ICONE_MIDIA[previa.tipo] : undefined;
  const nome = nomeExibido(contato);
  const grupo = contatoEhGrupo(contato);
  const { nomeEtapa } = useEtapas();
  const etapa = grupo ? null : nomeEtapa(contato.stage);
  const autor = grupo && ultima && !ehEnviada(ultima) ? rotuloAutor(ultima) : null;

  const item = (
    <button
      type="button"
      role="listitem"
      onClick={() => onClick(conversa)}
      onPointerDown={onPreAquecer && !ativo ? () => onPreAquecer(conversa) : undefined}
      onMouseEnter={onPreAquecer && !ativo ? () => onPreAquecer(conversa) : undefined}
      data-testid="item-conversa"
      data-phone={contato.phone}
      data-numero={contato.numero_id ?? undefined}
      data-canal={canalDoContato(contato)}
      aria-current={ativo ? "true" : undefined}
      className={`w-full flex items-center gap-3 pl-3 text-left transition-colors ${ativo ? "bg-muted" : "hover:bg-muted/50"}`}
    >
      <AvatarContato contato={contato} />
      <div className="min-w-0 flex-1 border-b border-border/60 py-3 pr-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-base truncate text-foreground">{nome}</span>
          <span className={`text-xs shrink-0 ${naoLida ? "text-success font-medium" : "text-muted-foreground"}`}>
            {horarioDaLista(ultima?.created_at, agora)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className="flex items-center gap-1 min-w-0 text-sm text-muted-foreground">
            {ultima && ehEnviada(ultima) && <StatusEntregaIcone status={statusEntrega(ultima)} className="h-4 w-4 shrink-0" />}
            {Icone && <Icone className="h-4 w-4 shrink-0" />}
            <span className="truncate">
              {autor && <span className="text-foreground/80">{autor}: </span>}
              {previa.texto || (ultima ? "" : "Sem mensagens")}
            </span>
          </span>
          <span className="flex items-center gap-1.5 shrink-0">
            {selo && (
              <span
                className="text-xs rounded px-1.5 py-0.5 border border-border text-muted-foreground max-w-28 truncate"
                title={`Número do WhatsApp: ${selo}`}
                data-testid="selo-numero"
              >
                {selo}
              </span>
            )}
            {!grupo && <SeloIA contato={contato} />}
            {etapa && (
              <span className="text-xs rounded px-1.5 py-0.5 bg-muted text-muted-foreground max-w-24 truncate" title="Etapa do funil">
                {etapa}
              </span>
            )}
            {naoLidas === 0 && conversa.marcadaNaoLida && (
              <span
                className="h-3 w-3 mr-1 rounded-full bg-success"
                aria-label="Marcada como não lida"
                data-testid="marcada-nao-lida"
              />
            )}
            {naoLidas > 0 && (
              <span
                className="min-w-5 h-5 px-1.5 rounded-full bg-success text-success-foreground text-xs font-semibold flex items-center justify-center"
                aria-label={`${naoLidas} não lida(s)`}
                data-testid="nao-lidas"
              >
                {naoLidas > 99 ? "99+" : naoLidas}
              </span>
            )}
          </span>
        </div>
      </div>
    </button>
  );
  if (!onMarcarNaoLida && !onMarcarLida) return item;
  const novaAba = `${window.location.origin}/crm/conversas?abrir=${encodeURIComponent(chave)}`;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{item}</ContextMenuTrigger>
      <ContextMenuContent>
        {naoLida ? (
          <ContextMenuItem onSelect={() => onMarcarLida?.(chave)}><MailOpen className="h-4 w-4 mr-2" />Marcar como lida</ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={() => onMarcarNaoLida?.(chave)}><Mail className="h-4 w-4 mr-2" />Marcar como não lida</ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => window.open(novaAba, "_blank", "noopener,noreferrer")}>
          <ExternalLink className="h-4 w-4 mr-2" />Abrir em nova aba
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

function ListaCarregando() {
  return (
    <div className="space-y-1 px-3 py-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <div className="h-12 w-12 rounded-full bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
            <div className="h-3 w-3/4 rounded bg-muted animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
