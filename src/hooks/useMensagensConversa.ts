// Mensagens do chat aberto: página inicial (as mais novas), carregar antigas ao subir,
// eventos do Realtime (via `ouvir` da lista) e reconferência a cada 5 s como rede de segurança.
import { useCallback, useEffect, useRef, useState } from "react";
import { chaveConversa, chaveDaMensagem, mesclarMensagens, type MensagemCRM } from "@/lib/crm/conversas";
import type { FonteConversas } from "@/lib/crm/fonteConversas";

export const TAMANHO_PAGINA = 50;
const RECONFERIR_MS = 5000;
/** Teto do histórico do WhatsApp por conversa (proxy: TETO_HISTORICO_FUNDO). */
export const TETO_WHATSAPP = 2000;

/** Conversa sob demanda (18/10/2026): só WhatsApp (telefone ou grupo); Instagram não tem histórico no OpenWA. */
export const buscaNoWhatsApp = (phone: string | null): boolean => !!phone && /^(\d{10,15}|\d{5,25}(-\d{5,15})?@g\.us)$/.test(phone);

/** Quantas mensagens pedir ao WhatsApp para trazer a próxima página (o banco deduplica pelo id). */
export const limiteDaProximaPagina = (jaCarregadas: number): number =>
  Math.min(TETO_WHATSAPP, Math.max(TAMANHO_PAGINA, jaCarregadas + TAMANHO_PAGINA));

// Cache das conversas abertas nesta aba (21/10/2026): voltar a uma conversa mostra na hora o que já estava
// carregado e atualiza por trás, em vez de spinner a cada toque.
const CACHE_MAX = 40;
const cacheConversas = new Map<string, { mensagens: MensagemCRM[]; temMais: boolean }>();
function guardarNoCache(k: string, mensagens: MensagemCRM[], temMais: boolean) {
  cacheConversas.delete(k);
  cacheConversas.set(k, { mensagens, temMais });
  while (cacheConversas.size > CACHE_MAX) cacheConversas.delete(cacheConversas.keys().next().value as string);
}
/** Só para testes. */
export function esquecerCacheConversas() { cacheConversas.clear(); preAquecidas.clear(); }

// Pré-aquecimento (22/10/2026): o dedo encosta (ou o mouse passa) numa conversa da lista e a primeira página do
// banco já sai — o toque (pointerdown → click) leva de 80 a 150 ms; no 4G a página leva ~300 ms. Ao abrir, o chat
// usa esse mesmo pedido em vez de fazer outro. Resposta com mais de 10 s não serve (pede de novo).
const VALIDADE_PRE_AQUECIDA_MS = 10_000;
const preAquecidas = new Map<string, { pedido: Promise<MensagemCRM[]>; em: number }>();

export function preAquecerConversa(fonte: FonteConversas, phone: string, numeroId: string | null = null): void {
  const k = chaveConversa({ phone, numero_id: numeroId });
  const ja = preAquecidas.get(k);
  if (ja && Date.now() - ja.em < VALIDADE_PRE_AQUECIDA_MS) return;
  const pedido = fonte.mensagensDoContato(phone, TAMANHO_PAGINA, undefined, numeroId);
  pedido.catch(() => undefined);
  preAquecidas.set(k, { pedido, em: Date.now() });
  if (preAquecidas.size > CACHE_MAX) preAquecidas.delete(preAquecidas.keys().next().value as string);
}

/** Pedido pré-aquecido ainda válido desta conversa (uma vez só). */
function tomarPreAquecida(k: string): Promise<MensagemCRM[]> | null {
  const p = preAquecidas.get(k);
  preAquecidas.delete(k);
  return p && Date.now() - p.em < VALIDADE_PRE_AQUECIDA_MS ? p.pedido : null;
}

// conversa que já foi ao WhatsApp nesta aba (abrir de novo não repete a busca inicial)
const buscadasAoAbrir = new Set<string>();
// conversa cujo histórico do WhatsApp acabou (pedir mais não traz nada novo)
const esgotadasNoWhatsApp = new Set<string>();
/** Só para testes. */
export function esquecerBuscasWhatsApp() { buscadasAoAbrir.clear(); esgotadasNoWhatsApp.clear(); cacheConversas.clear(); preAquecidas.clear(); }

export function useMensagensConversa(
  fonte: FonteConversas,
  phone: string | null,
  ouvir: (fn: (m: MensagemCRM, ev: "INSERT" | "UPDATE") => void) => () => void,
  /** Número da conversa: só as mensagens dele (o mesmo telefone em outro número é outra conversa). */
  numeroId: string | null = null,
  /** Mensagens que a lista já tem desta conversa: aparecem na hora, antes da página do banco chegar. */
  previa?: (phone: string, numeroId: string | null) => MensagemCRM[],
) {
  const [mensagens, setMensagens] = useState<MensagemCRM[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const [temMais, setTemMais] = useState(false);
  const chave = phone ? chaveConversa({ phone, numero_id: numeroId }) : null;
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const chaveRef = useRef(chave);
  chaveRef.current = chave;
  const numeroRef = useRef(numeroId);
  numeroRef.current = numeroId;

  const recarregarNovas = useCallback(async () => {
    const alvo = phoneRef.current;
    const k = chaveRef.current;
    if (!alvo) return;
    try {
      const pg = await fonte.mensagensDoContato(alvo, TAMANHO_PAGINA, undefined, numeroRef.current);
      if (chaveRef.current === k) setMensagens((m) => mesclarMensagens(m, pg));
    } catch {
      /* a próxima volta tenta de novo */
    }
  }, [fonte]);

  /**
   * Pede ao WhatsApp (whatsapp-import-history { phone, limit }) as `limite` mensagens mais recentes da conversa,
   * grava sem duplicar e sem mídia (baixa ao abrir). Devolve quantas eram novas; 0 = o WhatsApp não tem mais.
   */
  const buscarNoWhatsApp = useCallback(async (alvo: string, numero: string | null, k: string, limite: number): Promise<number> => {
    try {
      const novas = await fonte.importarHistorico(alvo, numero, { limite, semMidia: true });
      if (!novas) esgotadasNoWhatsApp.add(k);
      return novas;
    } catch {
      return 0; // sessão fora do ar/limite: fica como está, sem marcar esgotada
    }
  }, [fonte]);

  const previaRef = useRef(previa);
  previaRef.current = previa;

  // o que está na tela vira o cache desta conversa (só quando as mensagens já são dela: na troca de conversa
  // este efeito roda antes do de abrir, ainda com as mensagens da anterior)
  const dono = useRef<string | null>(null);
  // "carregar antigas" só depois da primeira página do banco: com a prévia na tela, a rolagem inicial chegava
  // ao topo e pedia a página anterior (e até o WhatsApp) antes de a conversa terminar de abrir
  const paginaInicial = useRef<string | null>(null);
  useEffect(() => {
    if (chave && dono.current === chave && mensagens.length) guardarNoCache(chave, mensagens, temMais);
  }, [chave, mensagens, temMais]);

  useEffect(() => {
    if (!phone) {
      dono.current = null;
      setMensagens([]);
      setTemMais(false);
      return;
    }
    let vivo = true;
    // abre com o que já tem (cache desta aba ou as recentes da lista) e atualiza por trás
    const guardado = chave ? cacheConversas.get(chave) : undefined;
    const semente = guardado?.mensagens ?? mesclarMensagens([], previaRef.current?.(phone, numeroId) ?? []);
    dono.current = chave;
    setMensagens(semente);
    setTemMais(guardado?.temMais ?? false);
    setCarregando(semente.length === 0);
    ((chave && tomarPreAquecida(chave)) || fonte.mensagensDoContato(phone, TAMANHO_PAGINA, undefined, numeroId))
      .then(async (pg) => {
        if (!vivo) return;
        paginaInicial.current = chave;
        setMensagens((atual) => mesclarMensagens(atual, pg));
        setTemMais((guardado?.temMais ?? false) || pg.length >= TAMANHO_PAGINA);
        // conversa sem mensagens (ou só com o resumo da lista): busca as últimas no WhatsApp na hora
        if (pg.length < TAMANHO_PAGINA && chave && buscaNoWhatsApp(phone) && !buscadasAoAbrir.has(chave)) {
          buscadasAoAbrir.add(chave);
          setCarregandoAntigas(true);
          try {
            const novas = await buscarNoWhatsApp(phone, numeroId, chave, TAMANHO_PAGINA);
            if (!vivo || !novas) return;
            const pg2 = await fonte.mensagensDoContato(phone, TAMANHO_PAGINA, undefined, numeroId);
            if (!vivo) return;
            setMensagens((m) => mesclarMensagens(m, pg2));
            setTemMais(pg2.length >= TAMANHO_PAGINA);
          } finally {
            if (vivo) setCarregandoAntigas(false);
          }
        }
      })
      .catch(() => { if (vivo) paginaInicial.current = chave; })
      .finally(() => vivo && setCarregando(false));

    // link da mídia que chegou depois da página: só atualiza o que já está na tela
    const pararAssinadas = fonte.ouvirMidiasAssinadas?.((assinadas) => {
      if (!vivo) return;
      setMensagens((atual) => {
        const ids = new Set(atual.map((m) => m.id));
        const daqui = assinadas.filter((m) => ids.has(m.id));
        return daqui.length ? mesclarMensagens(atual, daqui) : atual;
      });
    });

    const parar = ouvir((m) => {
      // sem numero_id na mensagem (banco antigo) casa pelo telefone, como antes
      if (m.contact_phone === phone && (!m.numero_id || !numeroId || chaveDaMensagem(m) === chave)) {
        setMensagens((atual) => mesclarMensagens(atual, [m]));
      }
    });
    const relogio = window.setInterval(() => {
      if (document.visibilityState === "visible") recarregarNovas();
    }, RECONFERIR_MS);
    return () => {
      vivo = false;
      parar();
      pararAssinadas?.();
      window.clearInterval(relogio);
    };
  }, [fonte, phone, numeroId, chave, ouvir, recarregarNovas, buscarNoWhatsApp]);

  // o banco acabou mas o WhatsApp ainda pode ter mais antigas: "carregar mais" busca a página anterior lá
  const maisNoWhatsApp = !!chave && buscaNoWhatsApp(phone) && !esgotadasNoWhatsApp.has(chave) && mensagens.length > 0
    && mensagens.length < TETO_WHATSAPP;

  const carregarAntigas = useCallback(async () => {
    const alvo = phoneRef.current;
    const k = chaveRef.current;
    if (!alvo || !k || paginaInicial.current !== k || carregandoAntigas || (!temMais && !maisNoWhatsApp) || mensagens.length === 0) return false;
    setCarregandoAntigas(true);
    try {
      const antesDe = mensagens[0].created_at;
      let pg = await fonte.mensagensDoContato(alvo, TAMANHO_PAGINA, antesDe, numeroRef.current);
      if (chaveRef.current !== k) return false;
      if (pg.length < TAMANHO_PAGINA && maisNoWhatsApp) {
        const novas = await buscarNoWhatsApp(alvo, numeroRef.current, k, limiteDaProximaPagina(mensagens.length));
        if (chaveRef.current !== k) return false;
        if (novas) pg = await fonte.mensagensDoContato(alvo, TAMANHO_PAGINA, antesDe, numeroRef.current);
        if (chaveRef.current !== k) return false;
      }
      setMensagens((m) => mesclarMensagens(m, pg));
      setTemMais(pg.length >= TAMANHO_PAGINA);
      return pg.length > 0;
    } catch {
      return false;
    } finally {
      setCarregandoAntigas(false);
    }
  }, [fonte, carregandoAntigas, temMais, mensagens, maisNoWhatsApp, buscarNoWhatsApp]);

  return { mensagens, carregando, carregandoAntigas, temMais: temMais || maisNoWhatsApp, carregarAntigas, recarregarNovas };
}
