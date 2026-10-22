// Chat à direita (layout de mensageria): cabeçalho com ações do CRM, mensagens com separadores
// de data e agrupamento, rolagem automática + botão "↓", antigas ao subir, barra de digitação.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, History, ListOrdered, Loader2, MessageCircle, MoreVertical, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RoteiroPainel } from "@/components/crm/RoteiroPainel";
import { TagsContato } from "@/components/crm/TagsContato";
import { useEtapas } from "@/hooks/useEtapas";
import { useToast } from "@/hooks/use-toast";
import { useMensagensConversa } from "@/hooks/useMensagensConversa";
import {
  canalDoContato, chaveConversa, contatoEhGrupo, ehEnviada, formatarTelefone, montarItensChat, nomeExibido, subtituloContato,
  type ContatoCRM, type MensagemCRM, type NumeroConversa,
} from "@/lib/crm/conversas";
import { grupoEnviavel } from "@/lib/crm/envioGrupo";
import { AvisoJanelaInstagram } from "./AvisoJanelaInstagram";
import { AvatarContato } from "./AvatarContato";
import type { FonteConversas } from "@/lib/crm/fonteConversas";
import { JANELA_AUTO } from "@/lib/crm/filaAudio";
import { BolhaMensagem } from "./BolhaMensagem";
import { BarraDigitacao } from "./BarraDigitacao";
import { PainelRoteiros } from "./PainelRoteiros";
import { ControleIA } from "./ControleIA";
import { AtendimentoConversa } from "./AtendimentoConversa";
import { AvisoIAAtendendo } from "./AvisoIAAtendendo";
import { assumirHumano } from "@/lib/crm/roboIA";
import { iaAtendendo } from "@/lib/crm/departamentos";
import { podeAcao } from "@/lib/crm/acesso";
import { useMeuAcessoCrm } from "@/hooks/useCrmEquipe";
import { useAuth } from "@/hooks/useAuth";
import { registrarEnvios } from "@/lib/crmRoteiros";
import type { AnexoPendente, InsercaoRoteiro } from "@/lib/crm/roteirosChat";
import "./conversas.css";

interface Props {
  contato: ContatoCRM | null;
  /** Números do WhatsApp: o cabeçalho mostra por qual número esta conversa responde. */
  numeros?: NumeroConversa[];
  fonte: FonteConversas;
  ouvir: (fn: (m: MensagemCRM, ev: "INSERT" | "UPDATE") => void) => () => void;
  /** Mensagens que a lista já tem desta conversa: o chat abre com elas na hora. */
  previa?: (phone: string, numeroId: string | null) => MensagemCRM[];
  /** `chave`: chave da conversa (chaveConversa). */
  onLida?: (chave: string, iso: string) => void;
  onVoltar?: () => void;
  onContatoAtualizado?: (id: string, patch: Partial<ContatoCRM>) => void;
  /** Painel estreito (ao lado do Kanban): ações viram menu. */
  compacto?: boolean;
  /** Cartão de contato (vCard) na conversa: abrir a conversa daquele número. */
  onAbrirConversa?: (digitos: string) => void;
}

const PERTO_DO_FIM = 120;
const LARGURA_PAINEL_FIXO = "(min-width: 1280px)";

/** Tela larga: painel de roteiros fica ao lado do chat; menor que isso vira gaveta. */
function useTelaLarga(): boolean {
  const [larga, setLarga] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(LARGURA_PAINEL_FIXO).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(LARGURA_PAINEL_FIXO);
    if (!mq) return;
    const aoMudar = () => setLarga(mq.matches);
    aoMudar();
    mq.addEventListener?.("change", aoMudar);
    return () => mq.removeEventListener?.("change", aoMudar);
  }, []);
  return larga;
}
const CHAVE_PAINEL = "crm.roteiros.aberto";
const MOSTRAR_SETA = 240;

export function ChatConversa({ contato, numeros = [], fonte, ouvir, previa, onLida, onVoltar, onContatoAtualizado, compacto, onAbrirConversa }: Props) {
  const meuAcesso = useMeuAcessoCrm();
  const { user } = useAuth();
  // depois de "HUMANO ASSUME DAQUI" a caixa volta com foco
  const [focarCaixa, setFocarCaixa] = useState(false);
  const chaveFoco = contato ? chaveConversa(contato) : null;
  useEffect(() => { setFocarCaixa(false); }, [chaveFoco]);
  const { colunas: KANBAN_COLUMNS } = useEtapas(); // etapas de crm_etapas (ativas)
  const { toast } = useToast();
  const phone = contato?.phone ?? null;
  const numeroId = contato?.numero_id ?? null;
  // chave da conversa: número + telefone (o mesmo telefone em outro número é outra conversa)
  const chave = contato ? chaveConversa(contato) : null;
  const { mensagens, carregando, carregandoAntigas, temMais, carregarAntigas, recarregarNovas } =
    useMensagensConversa(fonte, phone, ouvir, numeroId, previa);
  const [enviando, setEnviando] = useState(false);
  const [anexando, setAnexando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [roteiroAberto, setRoteiroAberto] = useState(false);
  const telaLarga = useTelaLarga() && !compacto;
  const [painelFixo, setPainelFixo] = useState(() => {
    try { return localStorage.getItem(CHAVE_PAINEL) === "1"; } catch { return false; }
  });
  const [gavetaRoteiros, setGavetaRoteiros] = useState(false);
  const [insercao, setInsercao] = useState<{ chave: string; ins: InsercaoRoteiro } | null>(null);
  const [versaoEnvios, setVersaoEnvios] = useState(0);
  const [seta, setSeta] = useState(false);
  // áudios além das últimas JANELA_AUTO só baixam sozinhos depois que a pessoa rola para cima
  const [rolouAcima, setRolouAcima] = useState(false);
  const [novasAbaixo, setNovasAbaixo] = useState(0);

  const rolagem = useRef<HTMLDivElement>(null);
  const ultimoId = useRef<string | null>(null);
  const precisaIrAoFim = useRef(true);
  const ajusteAntigas = useRef<{ altura: number; topo: number } | null>(null);
  const conteudo = useRef<HTMLDivElement>(null);
  // preso no fim: imagem/áudio que carregam depois não tiram a última mensagem da tela
  const grudado = useRef(true);

  const itens = useMemo(() => montarItensChat(mensagens), [mensagens]);
  // estável entre renders: a bolha é memo
  useEffect(() => { setRolouAcima(false); }, [chave]);
  const idsRecentes = useMemo(() => new Set(mensagens.slice(-JANELA_AUTO).map((m) => m.id)), [mensagens]);
  const baixarMidia = useMemo(() => fonte.baixarMidia?.bind(fonte), [fonte]);

  const irAoFim = useCallback((suave: boolean) => {
    const el = rolagem.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: suave ? "smooth" : "auto" });
    setNovasAbaixo(0);
  }, []);

  // conversa trocada: volta a abrir no fim
  useEffect(() => {
    precisaIrAoFim.current = true;
    grudado.current = true;
    ultimoId.current = null;
    setNovasAbaixo(0);
    setSeta(false);
  }, [chave]);

  useLayoutEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    // antigas carregadas no topo: mantém a mensagem que estava na tela no mesmo lugar
    if (ajusteAntigas.current) {
      const { altura, topo } = ajusteAntigas.current;
      el.scrollTop = el.scrollHeight - altura + topo;
      ajusteAntigas.current = null;
      return;
    }
    const ultima = mensagens[mensagens.length - 1];
    if (!ultima) return;
    if (precisaIrAoFim.current) {
      el.scrollTop = el.scrollHeight;
      precisaIrAoFim.current = false;
      ultimoId.current = ultima.id;
      return;
    }
    if (ultima.id !== ultimoId.current) {
      ultimoId.current = ultima.id;
      const distancia = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distancia < PERTO_DO_FIM + 200 || ehEnviada(ultima)) irAoFim(true);
      else setNovasAbaixo((n) => n + 1);
    }
  }, [mensagens, irAoFim]);

  useEffect(() => {
    const el = rolagem.current;
    const dentro = conteudo.current;
    if (!el || !dentro || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => {
      if (grudado.current && !ajusteAntigas.current) el.scrollTop = el.scrollHeight;
    });
    obs.observe(dentro);
    return () => obs.disconnect();
  }, [chave, carregando]);

  // leitura: última recebida vista com a conversa aberta
  useEffect(() => {
    if (!chave || !onLida) return;
    const ultimaRecebida = [...mensagens].reverse().find((m) => !ehEnviada(m));
    if (ultimaRecebida && document.visibilityState === "visible") onLida(chave, ultimaRecebida.created_at);
  }, [mensagens, chave, onLida]);

  const aoRolar = async () => {
    const el = rolagem.current;
    if (!el) return;
    const distancia = el.scrollHeight - el.scrollTop - el.clientHeight;
    setSeta(distancia > MOSTRAR_SETA);
    if (distancia > MOSTRAR_SETA) setRolouAcima(true);
    grudado.current = distancia < PERTO_DO_FIM;
    if (distancia < PERTO_DO_FIM) setNovasAbaixo(0);
    if (el.scrollTop < 80 && temMais && !carregandoAntigas) {
      ajusteAntigas.current = { altura: el.scrollHeight, topo: el.scrollTop };
      const veio = await carregarAntigas();
      if (!veio) ajusteAntigas.current = null;
    }
  };

  if (!contato) {
    return (
      <div className="crm-chat h-full flex flex-col items-center justify-center bg-muted/40 text-center px-6 border-l">
        <div className="h-24 w-24 rounded-full bg-muted flex items-center justify-center mb-5">
          <MessageCircle className="h-12 w-12 text-muted-foreground/60" />
        </div>
        <h3 className="text-xl font-medium mb-1">Selecione uma conversa</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Escolha um contato para ver as mensagens e responder.
        </p>
      </div>
    );
  }

  const enviarTexto = async (texto: string) => {
    setEnviando(true);
    try {
      // responde pelo MESMO número da conversa
      await fonte.enviarTexto(contato.phone, texto, numeroId);
      recarregarNovas();
      return true;
    } catch (e) {
      toast({ title: "Erro ao enviar", description: e instanceof Error ? e.message : "Tente novamente.", variant: "destructive" });
      return false;
    } finally {
      setEnviando(false);
    }
  };

  const anexar = async (anexo: AnexoPendente, legenda: string) => {
    setAnexando(true);
    try {
      if (anexo.arquivo) {
        await fonte.enviarMidia(contato.phone, anexo.arquivo, legenda, {
          ...(anexo.voz ? { ptt: true } : {}),
          ...(numeroId ? { numeroId } : {}),
        });
      } else if (anexo.url && fonte.enviarMidiaUrl) {
        await fonte.enviarMidiaUrl(contato.phone, { url: anexo.url, tipo: anexo.tipo, nome: anexo.nome, ...(anexo.voz ? { ptt: true } : {}) }, legenda, numeroId);
      } else throw new Error("Anexo sem arquivo.");
      recarregarNovas();
      return true;
    } catch (e) {
      toast({ title: "Erro ao enviar mídia", description: e instanceof Error ? e.message : "Tente novamente.", variant: "destructive" });
      return false;
    } finally {
      setAnexando(false);
    }
  };

  const aoEnviado = (passoIds: string[]) => {
    if (!passoIds.length) return;
    registrarEnvios(contato.phone, passoIds)
      .then(() => setVersaoEnvios((v) => v + 1))
      .catch(() => undefined);
  };

  const alternarRoteiros = () => {
    if (telaLarga) {
      setPainelFixo((v) => {
        try { localStorage.setItem(CHAVE_PAINEL, v ? "0" : "1"); } catch { /* sem storage */ }
        return !v;
      });
    } else setGavetaRoteiros((v) => !v);
  };

  const usarRoteiro = (ins: InsercaoRoteiro) => {
    setInsercao({ chave: chaveConversa(contato), ins });
    if (!telaLarga) setGavetaRoteiros(false);
  };

  const importar = async () => {
    if (importando) return;
    setImportando(true);
    try {
      const n = await fonte.importarHistorico(contato.phone, numeroId);
      toast({ title: "Histórico importado", description: `${n} mensagem(ns) adicionada(s).` });
      recarregarNovas();
    } catch (e) {
      toast({ title: "Erro ao importar", description: e instanceof Error ? e.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setImportando(false);
    }
  };

  const mudarContato = async (patch: Partial<Pick<ContatoCRM, "stage">>) => {
    const antes = { stage: contato.stage };
    onContatoAtualizado?.(contato.id, patch);
    try {
      await fonte.atualizarContato(contato.id, patch);
    } catch (e) {
      onContatoAtualizado?.(contato.id, antes);
      toast({ title: "Não salvou", description: e instanceof Error ? e.message : "Tente novamente.", variant: "destructive" });
    }
  };

  const etapas = KANBAN_COLUMNS.some((c) => c.id === contato.stage)
    ? KANBAN_COLUMNS
    : [...KANBAN_COLUMNS, { id: contato.stage, title: contato.stage }];
  const nome = nomeExibido(contato);
  const grupo = contatoEhGrupo(contato);
  // Direct do Instagram: sem importar histórico, sem tags/agente do WhatsApp; aviso da janela de 24 h
  const instagram = canalDoContato(contato) === "instagram";
  const subtitulo = grupo ? "Grupo" : subtituloContato(contato);
  // por qual número do WhatsApp esta conversa responde (Instagram não tem número)
  const numeroDaConversa = !instagram && numeroId ? numeros.find((n) => n.id === numeroId) ?? null : null;

  return (
    <div className="crm-chat h-full flex min-h-0 overflow-hidden">
      <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden relative">
      {/* Cabeçalho */}
      <div className="crm-chat-barra h-16 shrink-0 flex items-center gap-2 px-2 md:px-4 border-l border-black/5 dark:border-white/5">
        {onVoltar && (
          <Button variant="ghost" size="icon" onClick={onVoltar} aria-label="Voltar para a lista" className="md:hidden shrink-0 rounded-full">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <AvatarContato contato={contato} className="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-base leading-tight truncate crm-chat-texto">{nome}</h3>
          {subtitulo ? <p className="text-xs leading-tight crm-chat-meta truncate" data-testid="subtitulo-contato">{subtitulo}</p> : null}
          {numeroDaConversa ? (
            <p
              className="text-xs leading-tight crm-chat-meta truncate"
              data-testid="numero-da-conversa"
              title="Mensagens desta conversa saem por este número"
            >
              Respondendo pelo {numeroDaConversa.apelido}
              {numeroDaConversa.telefone ? ` (${formatarTelefone(numeroDaConversa.telefone)})` : ""}
            </p>
          ) : null}
        </div>

        {!grupo && <Select value={contato.stage} onValueChange={(v) => mudarContato({ stage: v })}>
          <SelectTrigger aria-label="Etapa do funil" className="h-8 w-auto max-w-36 gap-1 text-xs bg-background/60 border-none shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {etapas.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
          </SelectContent>
        </Select>}

        {!compacto && (
          <div className="hidden lg:flex items-center gap-1 crm-chat-meta">
            {!instagram && (
              <Button variant="ghost" size="sm" onClick={importar} disabled={importando} className="h-9 gap-1 text-xs hover:bg-black/5">
                {importando ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
                Importar histórico
              </Button>
            )}
            {!grupo && !instagram && (
              <Button variant="ghost" size="sm" onClick={() => setRoteiroAberto(true)} className="h-9 gap-1 text-xs hover:bg-black/5">
                <Tags className="h-4 w-4" />
                Tags e agente
              </Button>
            )}
          </div>
        )}

        {/* robô de IA: selo + "Transferir para IA" / "Assumir (humano)" + log (nunca em grupo nem no Direct) */}
        {!grupo && !instagram && <ControleIA contato={contato} onContatoAtualizado={onContatoAtualizado} compacto={compacto || !telaLarga} />}
        {!instagram && <AtendimentoConversa contato={contato} onContatoAtualizado={onContatoAtualizado} compacto={compacto || !telaLarga} />}

        <Button
          variant="ghost"
          size="sm"
          onClick={alternarRoteiros}
          aria-pressed={telaLarga ? painelFixo : gavetaRoteiros}
          aria-label="Roteiros"
          title="Roteiros"
          className={`h-9 gap-1 text-xs shrink-0 crm-chat-meta hover:bg-black/5 ${(telaLarga ? painelFixo : gavetaRoteiros) ? "bg-black/10 dark:bg-white/10" : ""}`}
        >
          <ListOrdered className="h-4 w-4" />
          <span className="hidden sm:inline">Roteiros</span>
        </Button>

        {!instagram && <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Mais ações" className={`shrink-0 rounded-full crm-chat-meta ${compacto ? "" : "lg:hidden"}`}>
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!instagram && (
              <DropdownMenuItem onClick={importar} disabled={importando}>
                <History className="h-4 w-4 mr-2" /> Importar histórico
              </DropdownMenuItem>
            )}
            {!grupo && !instagram && (
              <DropdownMenuItem onClick={() => setRoteiroAberto(true)}>
                <Tags className="h-4 w-4 mr-2" /> Tags e agente IA
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>

      <Sheet open={roteiroAberto} onOpenChange={setRoteiroAberto}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>Tags e agente</SheetTitle>
            <SheetDescription>{nome}: tags, agente de IA e envio direto de um passo.</SheetDescription>
          </SheetHeader>
          {roteiroAberto && <TagsContato phone={contato.phone} numeroId={numeroId} />}
          {roteiroAberto && <RoteiroPainel phone={contato.phone} numeroId={numeroId} />}
        </SheetContent>
      </Sheet>

      {/* Mensagens */}
      <div ref={rolagem} onScroll={aoRolar} className="crm-chat-fundo flex-1 min-h-0 overflow-y-auto pb-2" data-testid="rolagem-chat">
        {carregando ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin crm-chat-meta" />
          </div>
        ) : itens.length === 0 ? (
          <div className="h-full flex items-center justify-center px-6">
            <p className="crm-chat-separador text-sm rounded-lg px-4 py-2 shadow-sm text-center">
              {instagram
                ? "Nenhuma mensagem ainda. O Direct aparece aqui a partir da conexão."
                : 'Nenhuma mensagem ainda. Use "Importar histórico" para trazer a conversa do celular.'}
            </p>
          </div>
        ) : (
          <div ref={conteudo}>
            <div className="h-8 flex items-center justify-center">
              {carregandoAntigas && <Loader2 className="h-4 w-4 animate-spin crm-chat-meta" />}
              {!temMais && !carregandoAntigas && mensagens.length > 0 && (
                <span className="text-xs crm-chat-meta">Início da conversa</span>
              )}
            </div>
            {itens.map((it) =>
              it.tipo === "data" ? (
                <div key={it.chave} className="flex justify-center my-3" data-testid="separador-data">
                  <span className="crm-chat-separador text-xs uppercase px-3 py-1.5 rounded-lg shadow-sm">{it.rotulo}</span>
                </div>
              ) : (
                <BolhaMensagem
                  key={it.chave}
                  msg={it.msg}
                  primeiraDoGrupo={it.primeiraDoGrupo}
                  ultimaDoGrupo={it.ultimaDoGrupo}
                  tamanhoArquivo={fonte.tamanhoArquivo}
                  baixarMidia={baixarMidia}
                  autoBaixarAudio={rolouAcima || idsRecentes.has(it.msg.id)}
                  emGrupo={grupo}
                  onAbrirConversa={onAbrirConversa}
                />
              ),
            )}
          </div>
        )}
      </div>

      {seta && (
        <button
          type="button"
          onClick={() => irAoFim(true)}
          aria-label="Ir para a última mensagem"
          className="absolute right-5 bottom-20 z-20 h-10 w-10 rounded-full bg-background shadow-md flex items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className="h-6 w-6" />
          {novasAbaixo > 0 && (
            <span className="absolute -top-1.5 -right-1 min-w-5 h-5 px-1 rounded-full bg-success text-success-foreground text-xs font-semibold flex items-center justify-center">
              {novasAbaixo}
            </span>
          )}
        </button>
      )}

      {/* grupo: envio MANUAL liberado (18/10/2026); automação/IA continuam fora de grupo. Grupo gravado
          no formato antigo (sem o id …@g.us) não tem para onde mandar até a próxima sincronização. */}
      {grupo && !grupoEnviavel(contato.phone) ? (
        <div className="crm-chat-barra shrink-0 px-4 py-3 text-center text-xs crm-chat-meta" data-testid="grupo-sem-id">
          Este grupo ainda não tem o id do WhatsApp no CRM. Sincronize as conversas para poder responder.
        </div>
      ) : (
        <>
        {instagram && <AvisoJanelaInstagram ultimaEntrada={contato.ultima_entrada_em ?? null} />}
        {!grupo && !instagram && iaAtendendo(contato) ? (
          <AvisoIAAtendendo
            podeAssumir={meuAcesso ? podeAcao(meuAcesso, "conversas.assumir_ia") : true}
            onAssumir={async () => {
              try {
                await assumirHumano(numeroId, contato.phone);
                onContatoAtualizado?.(contato.id, {
                  ai_pausado: true, ai_pausado_motivo: "humano", ai_precisa_humano: false,
                  ...(user?.id ? { atendente_id: user.id } : {}),
                });
                setFocarCaixa(true);
              } catch (e) {
                toast({ title: "Não deu para assumir", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
              }
            }}
          />
        ) : meuAcesso && !podeAcao(meuAcesso, "conversas.enviar") ? (
          <div className="crm-chat-barra shrink-0 px-4 py-3 text-center text-xs crm-chat-meta" data-testid="sem-permissao-enviar">
            Seu usuário só visualiza esta conversa (sem permissão para enviar mensagem).
          </div>
        ) : (
        <BarraDigitacao
          focarAoMontar={focarCaixa}
          key={chaveConversa(contato)}
          enviando={enviando}
          anexando={anexando}
          onEnviar={enviarTexto}
          onEnviarAnexo={anexar}
          insercao={insercao?.chave === chaveConversa(contato) ? insercao.ins : null}
          onEnviado={aoEnviado}
          onAviso={(m) => toast({ title: "Ainda não dá para enviar", description: m, variant: "destructive" })}
        />
        )}
        </>
      )}
      </div>

      {telaLarga && painelFixo && (
        <aside className="w-80 2xl:w-96 shrink-0 border-l min-h-0 flex flex-col" aria-label="Roteiros">
          <PainelRoteiros contato={contato} onUsar={usarRoteiro} onFechar={alternarRoteiros} versaoEnvios={versaoEnvios} />
        </aside>
      )}

      {!telaLarga && (
        <Sheet open={gavetaRoteiros} onOpenChange={setGavetaRoteiros}>
          <SheetContent side="right" className="w-full sm:max-w-sm p-0 flex flex-col [&>button]:hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>Roteiros</SheetTitle>
              <SheetDescription>Escolha um roteiro para jogar na caixa de mensagem.</SheetDescription>
            </SheetHeader>
            {gavetaRoteiros && (
              <PainelRoteiros contato={contato} onUsar={usarRoteiro} onFechar={() => setGavetaRoteiros(false)} versaoEnvios={versaoEnvios} />
            )}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
