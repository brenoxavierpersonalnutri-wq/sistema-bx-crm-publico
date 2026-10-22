// Visão "Conversas" (padrão do /crm): lista à esquerda, chat à direita.
// No celular são duas telas: a lista, e o chat com botão de voltar.
// Número (17/10/2026): `selecionado` é a chave da conversa (número + telefone, chaveConversa); um telefone
// solto (link antigo ?abrir=) ainda abre a primeira conversa desse telefone. O seletor de número do topo
// filtra a lista e diz de qual número a sincronização e o backfill trazem as conversas.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ControleConversas } from "@/hooks/useConversas";
import type { FonteConversas } from "@/lib/crm/fonteConversas";
import { chaveConversa, contatoDaSelecao, type Conversa } from "@/lib/crm/conversas";
import { ListaConversas } from "./ListaConversas";
import { ChatConversa } from "./ChatConversa";
import { ProgressoBackfill } from "./ProgressoBackfill";
import { preAquecerConversa } from "@/hooks/useMensagensConversa";
import { toast } from "@/hooks/use-toast";
import {
  criarDepartamento, editarDepartamento, excluirDepartamento, salvarOrdem, useAtendentes, useDepartamentos, useMeuAcessoCrm,
} from "@/hooks/useCrmEquipe";
import type { FiltroAtendente } from "@/lib/crm/departamentos";
import type { AcoesDepartamento } from "./AbasDepartamentos";

// Admin cria/edita/exclui/reordena as abas de departamento (crm_departamentos: RLS só deixa admin gravar).
const ACOES_DEPARTAMENTO: AcoesDepartamento = {
  criar: criarDepartamento,
  editar: (id, patch) => editarDepartamento(id, patch),
  excluir: excluirDepartamento,
  reordenar: salvarOrdem,
};

interface Props {
  fonte: FonteConversas;
  controle: ControleConversas;
  /** Chave da conversa (chaveConversa) ou, de link antigo, só o telefone. */
  selecionado: string | null;
  onSelecionar: (chave: string | null) => void;
  agora?: Date;
}

export function ConversasCRM({ fonte, controle, selecionado, onSelecionar, agora }: Props) {
  const {
    conversas, contatos, numeros, carregando, erro, ouvir, previaConversa, marcarLida, marcarNaoLida, definirAberto, atualizarContatoLocal,
    paginacao, garantirConversas, procurarNoServidor,
  } = controle;
  const contato = contatoDaSelecao(contatos, selecionado);
  // lista paginada: a conversa do link (?abrir=) pode não estar nas 60 primeiras — pede ela ao servidor, uma vez
  const pedidas = useRef(new Set<string>());
  useEffect(() => {
    if (!paginacao || !selecionado || contato || pedidas.current.has(selecionado)) return;
    pedidas.current.add(selecionado);
    void garantirConversas([selecionado]);
  }, [paginacao, selecionado, contato, garantirConversas]);
  const chaveAberta = contato ? chaveConversa(contato) : null;
  const [numeroFiltro, setNumeroFiltro] = useState<string | null>(null);
  const [atendenteFiltro, setAtendenteFiltro] = useState<FiltroAtendente>("todos");
  const departamentos = useDepartamentos();
  const atendentes = useAtendentes();
  const meuAcesso = useMeuAcessoCrm();
  const erroDepartamento = useCallback((msg: string) => toast({ title: "Departamento", description: msg, variant: "destructive" }), []);

  useEffect(() => {
    definirAberto(chaveAberta);
    return () => definirAberto(null);
  }, [chaveAberta, definirAberto]);

  const selecionar = useCallback((c: Conversa) => onSelecionar(chaveConversa(c.contato)), [onSelecionar]);
  const preAquecer = useCallback((c: Conversa) => preAquecerConversa(fonte, c.contato.phone, c.contato.numero_id ?? null), [fonte]);

  // backfill do número escolhido no topo (sem escolha: o padrão)
  const apiBackfill = useMemo(() => {
    const b = fonte.backfill;
    if (!b) return undefined;
    return {
      status: () => b.status(numeroFiltro),
      iniciar: () => b.iniciar(numeroFiltro),
      cancelar: () => b.cancelar(numeroFiltro),
    };
  }, [fonte, numeroFiltro]);

  // Cartão de contato: abre a conversa se o número já está no CRM; senão, o WhatsApp Web daquele número.
  const abrirConversaDoCartao = useCallback(async (digitos: string) => {
    const ultimos = (s: string) => s.replace(/\D/g, "").slice(-10);
    const casam = (cs: typeof contatos) => cs.filter((c) => !c.is_group && ultimos(c.phone) === ultimos(digitos));
    // prefere a conversa no mesmo número da que está aberta
    let candidatos = casam(contatos);
    // lista paginada: a conversa pode existir no banco sem estar carregada
    if (!candidatos.length && paginacao) candidatos = casam(await procurarNoServidor(ultimos(digitos)));
    const alvo = candidatos.find((c) => c.numero_id && c.numero_id === contato?.numero_id) ?? candidatos[0];
    if (alvo) {
      onSelecionar(chaveConversa(alvo));
      return;
    }
    toast({ title: "Contato ainda não está no CRM", description: "Abrindo no WhatsApp Web." });
    window.open(`https://wa.me/${digitos}`, "_blank", "noopener,noreferrer");
  }, [contatos, contato?.numero_id, onSelecionar, paginacao, procurarNoServidor]);

  const sincronizar = useCallback(async () => {
    if (!fonte.sincronizarConversas) return;
    try {
      const r = await fonte.sincronizarConversas(numeroFiltro);
      toast({
        title: "Conversas atualizadas",
        description: `${r.chats} conversa(s), ${r.imported} mensagem(ns) nova(s), ${r.fotos} foto(s).${r.aviso ? ` ${r.aviso}` : ""}`,
      });
    } catch (e) {
      toast({ title: "Não atualizou", description: e instanceof Error ? e.message : "Tente de novo em 1 minuto.", variant: "destructive" });
    }
  }, [fonte, numeroFiltro]);

  return (
    <div className="h-full flex min-h-0 overflow-hidden">
      <aside
        className={`${selecionado ? "hidden md:flex" : "flex"} w-full md:w-80 lg:w-96 xl:w-1/3 shrink-0 flex-col min-h-0 border-r`}
        aria-label="Lista de conversas"
      >
        {apiBackfill && <div className="pt-2 shrink-0"><ProgressoBackfill key={numeroFiltro ?? "padrao"} api={apiBackfill} /></div>}
        <div className="flex-1 min-h-0">
          <ListaConversas
            conversas={conversas}
            selecionado={chaveAberta}
            onSelecionar={selecionar}
            onPreAquecer={preAquecer}
            numeros={numeros}
            numeroFiltro={numeroFiltro}
            onNumeroFiltro={setNumeroFiltro}
            carregando={carregando}
            erro={erro}
            agora={agora}
            onSincronizar={fonte.sincronizarConversas ? sincronizar : undefined}
            onMarcarNaoLida={marcarNaoLida}
            onMarcarLida={marcarLida}
            departamentos={departamentos}
            acoesDepartamento={meuAcesso?.admin ? ACOES_DEPARTAMENTO : undefined}
            onErroDepartamento={erroDepartamento}
            atendentes={atendentes.length ? atendentes : undefined}
            atendenteFiltro={atendenteFiltro}
            onAtendenteFiltro={setAtendenteFiltro}
            paginacao={paginacao}
          />
        </div>
      </aside>
      <section className={`${selecionado ? "flex" : "hidden md:flex"} flex-1 min-w-0 flex-col min-h-0`} aria-label="Conversa">
        <ChatConversa
          contato={contato}
          numeros={numeros}
          fonte={fonte}
          ouvir={ouvir}
          previa={previaConversa}
          onLida={marcarLida}
          onVoltar={() => onSelecionar(null)}
          onContatoAtualizado={atualizarContatoLocal}
          onAbrirConversa={abrirConversaDoCartao}
        />
      </section>
    </div>
  );
}
