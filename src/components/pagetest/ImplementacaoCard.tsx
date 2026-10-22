import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Activity, ExternalLink } from "lucide-react";
import {
  buscarTesteImplementacao,
  FuncaoAusenteError,
  pctBR,
  totaisDe,
  type TotaisImplementacao,
} from "@/lib/implementacaoTeste";

/**
 * Cartão do teste /r/implementacao (projeto da implementação, outro banco)
 * na lista do Link Master. Só leitura: os números vêm do agregado público
 * daquele banco (ver lib/implementacaoTeste).
 */
export function ImplementacaoCard() {
  const navigate = useNavigate();
  const [totais, setTotais] = useState<TotaisImplementacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    buscarTesteImplementacao()
      .then((v) => { if (vivo) setTotais(totaisDe(v)); })
      .catch((e) => {
        if (!vivo) return;
        setErro(e instanceof FuncaoAusenteError ? "falta rodar o SQL no banco da implementação" : e?.message || "erro");
      });
    return () => { vivo = false; };
  }, []);

  const valor = (f: (t: TotaisImplementacao) => string) => (erro ? "erro" : totais ? f(totais) : "…");

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="group flex flex-col justify-between rounded-xl border border-border bg-card hover:border-primary/40 transition-all cursor-pointer overflow-hidden p-5"
      onClick={() => navigate("/teste/implementacao")}
      data-card="implementacao"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Implementação (BG)</p>
            <p className="text-xs text-muted-foreground mt-0.5">/r/implementacao · bgimplementacao</p>
          </div>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider bg-secondary text-muted-foreground px-2 py-0.5 rounded">
          Só leitura
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2 pt-4 border-t border-border/40" title={erro ? `Implementação: ${erro}` : "Desde o início do teste"}>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Visitas</p>
          <p className="text-sm font-semibold" data-metric="visitas">{valor((t) => t.visitas.toLocaleString("pt-BR"))}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Leads</p>
          <p className="text-sm font-semibold" data-metric="leads">{valor((t) => `${t.leads} (${pctBR(t.taxa_lead)})`)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Qualificados</p>
          <p className="text-sm font-semibold" data-metric="qualificados">{valor((t) => `${t.qualificados} (${pctBR(t.taxa_qualificado)})`)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Agendamentos</p>
          <p className="text-sm font-semibold text-emerald-400" data-metric="agendamentos">{valor((t) => `${t.agendamentos} (${pctBR(t.taxa_agendamento)})`)}</p>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground group-hover:text-primary transition-colors">
        <span>{erro ? erro : "Ver resultados por versão"}</span>
        <ExternalLink className="h-3.5 w-3.5" />
      </div>
    </motion.div>
  );
}
