// Cabeçalho da conversa: "Atendente: X ▾" e "Departamento: Y ▾" (migration 20261123100000).
// Trocar/tirar à mão passa pelas RPCs crm_atendente_definir / crm_departamento_definir, que conferem
// número, "só as dele", "só dos departamentos" e as ações transferir/mover. A IA é regra: não se escolhe aqui.
import { useState } from "react";
import { Building2, UserRound } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { definirAtendenteDaConversa, definirDepartamentoDaConversa, useAtendentes, useDepartamentos } from "@/hooks/useCrmEquipe";
import { rotuloAtendente } from "@/lib/crm/departamentos";
import type { ContatoCRM } from "@/lib/crm/conversas";

const NENHUM = "__nenhum__";

interface Props {
  contato: ContatoCRM;
  onContatoAtualizado?: (id: string, patch: Partial<ContatoCRM>) => void;
  compacto?: boolean;
}

export function AtendimentoConversa({ contato, onContatoAtualizado, compacto }: Props) {
  const { toast } = useToast();
  const atendentes = useAtendentes();
  const departamentos = useDepartamentos();
  const [ocupado, setOcupado] = useState(false);
  const manuais = departamentos.filter((d) => d.regra === "manual" && (d.ativo || d.id === contato.departamento_id));
  // banco sem a migration: nada a mostrar
  if (!atendentes.length && !departamentos.length) return null;

  const trocar = async (patch: Partial<ContatoCRM>, fazer: () => Promise<unknown>) => {
    const antes: Partial<ContatoCRM> = Object.fromEntries(Object.keys(patch).map((k) => [k, contato[k as keyof ContatoCRM]]));
    setOcupado(true);
    onContatoAtualizado?.(contato.id, patch);
    try {
      await fazer();
    } catch (e) {
      onContatoAtualizado?.(contato.id, antes);
      toast({ title: "Não deu para trocar", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setOcupado(false);
    }
  };

  const atendente = contato.atendente_id ?? NENHUM;
  const departamento = contato.departamento_id ?? NENHUM;
  const larguras = compacto ? "max-w-28" : "max-w-40";

  return (
    <div className="flex items-center gap-1 shrink-0" data-testid="atendimento-conversa">
      {atendentes.length > 0 && (
        <Select
          value={atendente}
          disabled={ocupado}
          onValueChange={(v) => {
            const id = v === NENHUM ? null : v;
            void trocar({ atendente_id: id }, () => definirAtendenteDaConversa(contato.id, id));
          }}
        >
          <SelectTrigger aria-label="Atendente" title="Atendente da conversa" className={`h-8 w-auto ${larguras} gap-1 text-xs bg-background/60 border-none`}>
            <UserRound className="h-3.5 w-3.5 shrink-0" />
            {!compacto && <span className="crm-chat-meta">Atendente:</span>}
            <SelectValue>{rotuloAtendente(atendentes, contato.atendente_id)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NENHUM}>Sem atendente</SelectItem>
            {atendentes.map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {manuais.length > 0 && (
        <Select
          value={departamento}
          disabled={ocupado}
          onValueChange={(v) => {
            const id = v === NENHUM ? null : v;
            const d = departamentos.find((x) => x.id === id);
            // departamento que veio de etapa: a etapa vai junto (o banco faz o mesmo)
            const patch: Partial<ContatoCRM> = { departamento_id: id, ...(d?.etapa_origem ? { stage: d.etapa_origem } : {}) };
            void trocar(patch, () => definirDepartamentoDaConversa(contato.id, id));
          }}
        >
          <SelectTrigger aria-label="Departamento" title="Departamento da conversa" className={`h-8 w-auto ${larguras} gap-1 text-xs bg-background/60 border-none`}>
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            {!compacto && <span className="crm-chat-meta">Departamento:</span>}
            <SelectValue>{departamentos.find((d) => d.id === contato.departamento_id)?.nome ?? "Sem departamento"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NENHUM}>Sem departamento</SelectItem>
            {manuais.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: d.cor }} />{d.nome}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
