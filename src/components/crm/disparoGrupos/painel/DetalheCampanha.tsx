// Detalhe da campanha (estilo /whats/campaigns/:id do SendFlow): cabeçalho com link de convite e menu
// (duplicar, encerrar/reabrir, projeto) e as abas. Reaproveita os componentes que já existiam (criação,
// configuração dos grupos, boas-vindas, agenda relativa ao evento, relatório) — todas as travas continuam neles.
import { useState } from "react";
import { ArrowLeft, Copy, CopyPlus, FolderOpen, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { db, linkPublico, numeroCriaGrupo, type CampanhaGrupos } from "@/lib/grupos";
import { copiaDeCampanha, nomeCampanha, type Periodo } from "@/lib/painelGrupos";
import { nomeDoNumero } from "@/lib/disparoGrupos";
import type { PainelGrupos } from "@/hooks/usePainelGrupos";
import { CampanhaConfig } from "@/components/crm/grupos/CampanhaConfig";
import { GruposCampanha } from "@/components/crm/grupos/GruposCampanha";
import { FluxoGrupo } from "@/components/crm/grupos/FluxoGrupo";
import { AgendaMensagens } from "@/components/crm/grupos/AgendaMensagens";
import { RelatorioGrupos } from "@/components/crm/grupos/RelatorioGrupos";
import { AbaCriacao } from "../AbaCriacao";
import { AbaConfigGrupos } from "../AbaConfigGrupos";
import { GruposTabela } from "./GruposTabela";
import { MensagensLista } from "./MensagensLista";
import { CalendarioMensagens } from "./CalendarioMensagens";
import { GraficoDiario } from "./GraficoDiario";
import { RecursosCampanha } from "./RecursosCampanha";
import { AtividadesCampanha, CliquesCampanha, DiagnosticoCampanha } from "./AbasLeituraCampanha";
import { clsPrimario, EmBreve, KpisGrupos, PontoStatus, SeletorPeriodo } from "./ui";

export const SUBABAS = [
  ["visao", "Visão geral"], ["grupos", "Grupos"], ["diagnostico", "Diagnóstico"], ["criacao", "Criação de grupos"],
  ["config", "Configuração dos grupos"], ["mensagens", "Mensagens"], ["automacoes", "Automações"], ["calendario", "Calendário"],
  ["atividades", "Atividades"], ["cliques", "Cliques"], ["relatorio", "Relatório"], ["ajustes", "Configurações"], ["mais", "Mais"],
] as const;
export type SubAba = typeof SUBABAS[number][0];

export function DetalheCampanha({ campanha, painel, periodo, onPeriodo, sub, onSub, onVoltar, onAbrir, onEnviar }: {
  campanha: CampanhaGrupos;
  painel: PainelGrupos;
  periodo: Periodo;
  onPeriodo: (p: Periodo) => void;
  sub: SubAba;
  onSub: (s: SubAba) => void;
  onVoltar: () => void;
  onAbrir: (id: string) => void;
  onEnviar: (numeroId: string | null) => void;
}) {
  const { toast } = useToast();
  const { campanhas, numeros, grupos, metricas, temPeriodo, recarregar } = painel;
  const [projeto, setProjeto] = useState(campanha.projeto ?? "");
  const m = metricas.get(campanha.id);
  const numero = numeros.find((n) => n.id === campanha.numero_id);
  const abas = SUBABAS.filter(([k]) => !(campanha.avulsa && (k === "criacao" || k === "cliques")));

  async function salvarCampos(campos: Record<string, unknown>, ok: string) {
    const { error } = await db.from("grupos_campanhas").update({ ...campos, updated_at: new Date().toISOString() }).eq("id", campanha.id);
    toast({ title: error ? "Não foi possível salvar" : ok, description: error?.message, variant: error ? "destructive" : undefined });
    if (!error) await recarregar();
  }

  async function duplicar() {
    if (!confirm(`Duplicar "${campanha.nome}"? A cópia nasce sem grupos, com o link pausado e sem criação automática.`)) return;
    const linha = copiaDeCampanha(campanha, campanhas.map((c) => c.slug));
    const { data, error } = await db.from("grupos_campanhas").insert(linha).select("id").single();
    toast({ title: error ? "Não foi possível duplicar" : "Campanha duplicada", description: error?.message, variant: error ? "destructive" : undefined });
    if (!error && data?.id) { await recarregar(); onAbrir(data.id); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button size="sm" variant="ghost" onClick={onVoltar}><ArrowLeft className="h-4 w-4 mr-1" /> Campanhas</Button>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium truncate">{nomeCampanha(campanha)}</span>
        <span className="flex-1" />
        <SeletorPeriodo valor={periodo} onChange={onPeriodo} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
        <div className="rounded-xl border border-border bg-card/60 p-4 flex flex-wrap items-center gap-3">
          <PontoStatus ok={!campanha.encerrada && !campanha.link_pausado} />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold truncate">{nomeCampanha(campanha)}</p>
            <p className="text-xs text-muted-foreground">
              {nomeDoNumero(numeros, campanha.numero_id)} · criada em {new Date(campanha.created_at).toLocaleDateString("pt-BR")}
              {campanha.encerrada && " · encerrada"}{campanha.disparos_pausados && " · disparos pausados"}
            </p>
          </div>
          {!campanha.avulsa && <Button size="sm" variant="outline" onClick={duplicar}><CopyPlus className="h-4 w-4 mr-1" /> Duplicar</Button>}
          <Button size="sm" variant="outline" onClick={() => salvarCampos({ encerrada: !campanha.encerrada }, campanha.encerrada ? "Campanha reaberta" : "Campanha encerrada")}>
            {campanha.encerrada ? <><LockOpen className="h-4 w-4 mr-1" /> Reabrir</> : <><Lock className="h-4 w-4 mr-1" /> Encerrar</>}
          </Button>
          <Button size="sm" className={clsPrimario} onClick={() => onEnviar(campanha.numero_id)}>Enviar mensagem</Button>
        </div>
        {!campanha.avulsa && (
          <div className="rounded-xl border border-border bg-card/60 p-4 space-y-2">
            <p className="font-semibold text-sm">Link de convite</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{linkPublico(campanha.slug)}</code>
              <Button size="sm" className={clsPrimario} onClick={() => { navigator.clipboard.writeText(linkPublico(campanha.slug)); toast({ title: "Link copiado" }); }}>
                <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{campanha.link_pausado ? "Pausado: cai na página de lotado." : campanha.modo_distribuicao === "split" ? "Split por peso entre os grupos com vaga." : "Enche um grupo por vez."} Editar o link em Configurações.</p>
          </div>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Abas da campanha">
        {abas.map(([k, rotulo]) => (
          <button key={k} type="button" role="tab" aria-selected={sub === k} onClick={() => onSub(k)}
            className={cn("whitespace-nowrap px-3 py-2 text-sm -mb-px border-b-2", sub === k ? "border-amber-400 font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {rotulo}
          </button>
        ))}
      </div>

      {sub === "visao" && (
        <div className="space-y-4">
          {m && <KpisGrupos m={m} temPeriodo={temPeriodo} periodo={periodo} />}
          <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
            <RecursosCampanha campanha={campanha} onAbrir={(a) => onSub(a as SubAba)} />
            <GraficoDiario campanhaId={campanha.id} periodo={periodo} />
          </div>
        </div>
      )}
      {sub === "grupos" && (
        <div className="space-y-4">
          <GruposTabela campanha={campanha} campanhas={campanhas} grupos={grupos} onMudou={recarregar} />
          <details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">Adicionar, importar e editar grupos (link, peso, ativo)</summary>
            <div className="pt-3"><GruposCampanha key={`g-${campanha.id}`} campanha={campanha} /></div>
          </details>
        </div>
      )}
      {sub === "diagnostico" && <DiagnosticoCampanha campanha={campanha} grupos={grupos} numeros={numeros} />}
      {sub === "criacao" && (
        <div className="space-y-4">
          <AbaCriacao campanha={campanha} numeros={numeros} onSalvo={recarregar} />
          <FluxoGrupo key={`cr-${campanha.id}-${campanha.updated_at ?? ""}`} campanha={campanha} partes={["criacao"]}
            criaGrupo={numeroCriaGrupo(numero?.sessao)} onSalvo={() => { void recarregar(); }} />
        </div>
      )}
      {sub === "config" && <AbaConfigGrupos key={campanha.id} campanha={campanha} />}
      {sub === "mensagens" && <MensagensLista campanhas={campanhas} campanhaId={campanha.id} onEnviar={() => onEnviar(campanha.numero_id)} />}
      {sub === "automacoes" && (
        <div className="space-y-4">
          <FluxoGrupo key={`ev-${campanha.id}-${campanha.updated_at ?? ""}`} campanha={campanha} partes={["evento"]} onSalvo={() => { void recarregar(); }} />
          <AgendaMensagens key={`ag-${campanha.id}`} campanha={campanha} />
          <FluxoGrupo key={`bv-${campanha.id}-${campanha.updated_at ?? ""}`} campanha={campanha} partes={["boasvindas"]} onSalvo={() => { void recarregar(); }} />
          <EmBreve titulo="Cronograma recorrente, tags e gatilhos de integração">
            <p>No SendFlow: disparo toda semana no mesmo dia/hora, tag ao entrar/sair, “encheu o grupo → mensagem”, gatilhos de Hotmart/Kiwify. Aqui ainda não há motor para isso; por enquanto use as mensagens relativas ao evento acima.</p>
          </EmBreve>
        </div>
      )}
      {sub === "calendario" && <CalendarioMensagens campanhas={campanhas} campanhaId={campanha.id} />}
      {sub === "atividades" && <AtividadesCampanha campanha={campanha} grupos={grupos} periodo={periodo} />}
      {sub === "cliques" && <CliquesCampanha campanha={campanha} grupos={grupos} periodo={periodo} />}
      {sub === "relatorio" && <RelatorioGrupos campanha={campanha} />}
      {sub === "ajustes" && (
        <div className="space-y-4 max-w-3xl">
          <div className="rounded-xl border border-border bg-card/60 p-4 space-y-2">
            <p className="font-semibold text-sm flex items-center gap-2"><FolderOpen className="h-4 w-4 text-amber-400" /> Projeto</p>
            <p className="text-xs text-muted-foreground">Agrupa campanhas do mesmo cliente/expert (filtro na lista de campanhas).</p>
            <div className="flex gap-2">
              <Input value={projeto} maxLength={80} placeholder="ex.: Turbo Academy" onChange={(e) => setProjeto(e.target.value)} />
              <Button variant="outline" onClick={() => salvarCampos({ projeto: projeto.trim() || null }, "Projeto salvo")}>Salvar</Button>
            </div>
          </div>
          <CampanhaConfig key={`c-${campanha.id}-${campanha.updated_at ?? ""}`} campanha={campanha} numeros={numeros} onSalvo={() => { void recarregar(); }} />
        </div>
      )}
      {sub === "mais" && (
        <div className="grid gap-3 md:grid-cols-2">
          <EmBreve titulo="Contas associadas (vários números por campanha)"><p>No SendFlow a campanha divide os disparos entre vários números e redistribui se um cair. Aqui cada campanha usa um número.</p></EmBreve>
          <EmBreve titulo="Solicitações de entrada"><p>Aprovar/recusar pedidos de entrada em grupos com aprovação de admin. Precisa de rota nova no proxy.</p></EmBreve>
          <EmBreve titulo="Leadscoring e desempenho por grupo"><p>Pontos por recebeu/visualizou/reproduziu/reagiu/respondeu. Precisa dos eventos de leitura e reação do WhatsApp.</p></EmBreve>
          <EmBreve titulo="Mensagens recebidas nos grupos"><p>Guardar o que os membros escrevem (30 dias) e exportar. Precisa ligar o evento de mensagem de grupo no webhook.</p></EmBreve>
          <EmBreve titulo="Remover participantes / participantes duplicados"><p>Remover membro e checar duplicados de hora em hora. Precisa de rota de remoção no proxy.</p></EmBreve>
          <EmBreve titulo="Fixar mensagem, mensagem temporária, contato, evento, figurinha"><p>Tipos e opções extras do “Enviar mensagem”. Precisam de rotas novas no proxy.</p></EmBreve>
        </div>
      )}
    </div>
  );
}
