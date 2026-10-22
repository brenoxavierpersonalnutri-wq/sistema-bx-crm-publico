import { format, isToday, isBefore, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Aluna } from "@/lib/alunaTypes";
import { useAuth } from "@/hooks/useAuth";
import { upsertAluna } from "@/lib/alunaStore";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface SignalRemindersProps {
  alunas: Aluna[];
  onToggleResiduo?: (aluna: Aluna) => void; 
}

export function SignalReminders({ alunas, onToggleResiduo }: SignalRemindersProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const sinaisVencendo = alunas.filter((a) => {
    if (!a.deuSinal || !a.dataCobrancaSinal || a.pago || a.residuoPago) return false;
    // Skip alunas vinculadas a consulta — exibidas pelo lembrete unificado
    if (a.origemLead?.startsWith("consulta:")) return false;
    const dataCobranca = new Date(a.dataCobrancaSinal);
    return isToday(dataCobranca) || isBefore(dataCobranca, new Date());
  });

  const handleToggle = async (aluna: Aluna) => {
    if (onToggleResiduo) {
      onToggleResiduo(aluna);
      return;
    }

    if (!user) return;
    try {
      // 1. Update Aluna
      await upsertAluna({ ...aluna, residuoPago: true }, user.id);
      
      // 2. Update Consultation if it came from one
      if (aluna.origemLead?.startsWith("consulta:")) {
        const consultationId = aluna.origemLead.replace("consulta:", "");
        const { error: updateErr } = await supabase
          .from("consultations")
          .update({
            signal_residue_paid: true,
            converted: true,
            attended: true,
            updated_at: new Date().toISOString()
          })
          .eq("id", consultationId);
          
        if (updateErr) {
          console.error("Failed to update consultation:", updateErr);
        } else {
          // Invalidate consultations query so dashboard updates
          queryClient.invalidateQueries({ queryKey: ["consultations"] });
          queryClient.invalidateQueries({ queryKey: ["alunas"] });
        }
      }

      toast({ title: "Sucesso", description: "Lembrete marcado como pago!" });
      window.dispatchEvent(new Event('alunas-updated'));
    } catch (err: any) {
      toast({ title: "Erro ao atualizar", description: err.message, variant: "destructive" });
    }
  };

  if (sinaisVencendo.length === 0) return null;

  return (
    <div className="rounded-lg bg-accent/10 border border-accent/30 p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-accent">
        <BellRing className="h-5 w-5" />
        <span className="font-semibold text-sm">Lembretes de Cobrança</span>
      </div>
      <div className="space-y-2">
        {sinaisVencendo.map((a) => (
          <div key={a.id} className="flex items-center justify-between bg-background/50 rounded-md p-2 text-sm text-foreground">
            <div>
              🔔 <span className="font-medium">{a.nomeCompleto}</span> — cobrar restante (sinal: R$ {a.valorSinal?.toFixed(2)}) — venceu em {format(new Date(a.dataCobrancaSinal!), "dd/MM/yyyy", { locale: ptBR })}
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              className="h-7 text-xs border-success text-success hover:bg-success hover:text-white"
              onClick={() => handleToggle(a)}
            >
              Marcar como Pago
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
