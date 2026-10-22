// /crm/automacao (antes /crm/central, que redireciona) — Central de Automação: organiza fluxos, automações, disparos, grupos e roteiros
// por NÚMERO de WhatsApp (sessões do OpenWA + número oficial). ?numero=<id>&aba=<aba> abre direto.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bot, Loader2, RefreshCw, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AutomacoesModal } from "@/components/crm/automacoes/AutomacoesModal";
import { RoteirosEditorModal } from "@/components/crm/RoteirosEditorModal";
import { CartaoNumero } from "@/components/crm/central/CartaoNumero";
import { PainelNumero } from "@/components/crm/central/PainelNumero";
import { VisaoGeral } from "@/components/crm/central/VisaoGeral";
import { CanalInstagram } from "@/components/crm/central/CanalInstagram";
import { useCentralAutomacao } from "@/hooks/useCentralAutomacao";
import { ABAS_CENTRAL, contarPorNumero, type ModuloCentral } from "@/lib/crm/central";
import { ListaFluxos } from "@/components/crm/fluxos/ListaFluxos";

// Automação abre na LISTA DE FLUXOS (como o "Workflows" do Full Funnel); a visão por número continua em ?visao=numeros.
export default function CentralAutomacao() {
  const [params, setParams] = useSearchParams();
  const visao = params.get("visao") === "numeros" || params.get("numero") ? "numeros" : "fluxos";
  const trocar = (v: "fluxos" | "numeros") => {
    const p = new URLSearchParams(params);
    if (v === "numeros") p.set("visao", "numeros"); else { p.delete("visao"); p.delete("numero"); p.delete("aba"); }
    setParams(p, { replace: true });
  };
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2 border-b px-4 pt-3 md:px-8">
        <div className="flex items-center gap-1" role="tablist" aria-label="Automação">
          {([["fluxos", "Fluxos"], ["numeros", "Números e canais"]] as const).map(([k, r]) => (
            <button key={k} role="tab" aria-selected={visao === k} onClick={() => trocar(k)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${visao === k ? "border-primary text-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{r}</button>
          ))}
        </div>
        {visao === "fluxos" && (
          <div className="mb-1.5 flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-8" asChild title="Agentes de IA: número, limites, horário, prompt, base de conhecimento e simulador">
              <Link to="/crm/agente-ia"><Bot className="h-4 w-4" /><span className="ml-1.5">Treinar IA</span></Link>
            </Button>
            <Button variant="outline" size="sm" className="h-8" asChild title="Grupos de WhatsApp (link único e disparo agendado)">
              <Link to="/crm/grupos"><UsersRound className="h-4 w-4" /><span className="ml-1.5">Grupos</span></Link>
            </Button>
          </div>
        )}
      </div>
      {visao === "fluxos" ? <div className="px-4 py-5 md:px-8 md:py-7"><ListaFluxos /></div> : <VisaoNumeros />}
    </div>
  );
}

function VisaoNumeros() {
  const { dados, carregando, recarregar } = useCentralAutomacao();
  const [params, setParams] = useSearchParams();
  const [automacoesAberto, setAutomacoesAberto] = useState(false);
  const [roteirosAberto, setRoteirosAberto] = useState(false);

  const abaParam = params.get("aba");
  const aba: ModuloCentral = ABAS_CENTRAL.some((a) => a.id === abaParam) ? (abaParam as ModuloCentral) : "fluxos";
  const numeroSel = dados?.numeros.find((n) => n.id === params.get("numero")) ?? null;
  const abrir = (numero: string | null, novaAba: ModuloCentral = aba) => {
    const p = new URLSearchParams(params);
    if (numero) p.set("numero", numero); else p.delete("numero");
    p.set("aba", novaAba);
    p.set("visao", "numeros");
    setParams(p, { replace: true });
  };

  const fluxosLigados = dados ? contarPorNumero(dados.fluxos, dados.numeros, (f) => f.ativo === true) : new Map();
  const autsLigadas = dados ? contarPorNumero(dados.automacoes, dados.numeros, (a) => a.ativo === true) : new Map();

  return (
    <div className="px-4 py-5 md:px-8 md:py-7 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-bold tracking-tight">Automação</h2>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8" asChild title="Agentes de IA: número, limites, horário, prompt, base de conhecimento e simulador">
            <Link to="/crm/agente-ia"><Bot className="h-4 w-4" /><span className="ml-1.5">Treinar IA</span></Link>
          </Button>
          <Button variant="outline" size="sm" className="h-8" asChild title="Grupos de WhatsApp (link único e disparo agendado)">
            <Link to="/crm/grupos"><UsersRound className="h-4 w-4" /><span className="ml-1.5">Grupos</span></Link>
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={recarregar} disabled={carregando}>
            {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-1.5">Atualizar</span>
          </Button>
        </div>
      </div>

      {!dados ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
      ) : (
        <>
          <VisaoGeral dados={dados} onAbrirNumero={(id) => abrir(id)} />

          {dados.numerosProvisorios && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Cadastro de números ainda não instalado no banco: mostrando os 5 números iniciais (só leitura).
            </p>
          )}

          <section aria-label="Números de WhatsApp" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {dados.numeros.map((n) => (
              <CartaoNumero
                key={n.id}
                numero={n}
                status={dados.status.get(n.id)}
                envios={dados.envios.get(n.id) ?? 0}
                fluxos={fluxosLigados.get(n.id) ?? 0}
                automacoes={autsLigadas.get(n.id) ?? 0}
                selecionado={numeroSel?.id === n.id}
                onClick={() => abrir(numeroSel?.id === n.id ? null : n.id)}
              />
            ))}
          </section>

          <CanalInstagram />

          {numeroSel ? (
            <PainelNumero
              numero={numeroSel}
              dados={dados}
              aba={aba}
              onAba={(a) => abrir(numeroSel.id, a)}
              onAbrirAutomacoes={() => setAutomacoesAberto(true)}
              onAbrirRoteiros={() => setRoteirosAberto(true)}
              onMudou={recarregar}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Clique num número para ver os fluxos, automações, disparos, grupos, roteiros e limites dele.</p>
          )}
        </>
      )}

      <AutomacoesModal isOpen={automacoesAberto} onClose={() => { setAutomacoesAberto(false); recarregar(); }} />
      <RoteirosEditorModal isOpen={roteirosAberto} onClose={() => { setRoteirosAberto(false); recarregar(); }} />
    </div>
  );
}
