import { useRef, useState } from "react";
import { format, isBefore, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Aluna, ProgramType, PlanDuration } from "@/lib/alunaTypes";
import { alunasVencendo } from "@/lib/alunaFiltros";
import { PROGRAM_OPTIONS as ConsultationsPrograms } from "@/data/programs";
import { useAuth } from "@/hooks/useAuth";
import { upsertAluna } from "@/lib/alunaStore";
import { useToast } from "@/hooks/use-toast";

interface ExpiringRemindersProps {
  alunas: Aluna[];
}

export function ExpiringReminders({ alunas }: ExpiringRemindersProps) {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  
  const [renewDialogOpen, setRenewDialogOpen] = useState(false);
  const [renewingAluna, setRenewingAluna] = useState<Aluna | null>(null);
  const [renewProgram, setRenewProgram] = useState<string>("");
  const [renewMonths, setRenewMonths] = useState<number>(1);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const renewalCompletedRef = useRef(false);

  const dismissReminder = (id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id));
  };

  const restoreReminder = (id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleRenewDialogOpenChange = (open: boolean) => {
    if (!open && renewingAluna && !renewalCompletedRef.current) {
      restoreReminder(renewingAluna.id);
      setRenewingAluna(null);
      setRenewProgram("");
      setRenewMonths(1);
    }

    setRenewDialogOpen(open);
  };

  // A regra de quem está vencendo mora em alunaFiltros; aqui só tiramos quem
  // foi dispensada nesta sessão.
  const expiringAlunas = alunasVencendo(alunas).filter((a) => !dismissedIds.has(a.id));

  const handleNotRenewed = async (aluna: Aluna) => {
    if (!user || !isAdmin) return;
    setIsProcessing(aluna.id);
    try {
      await upsertAluna({
        ...aluna,
        status: "inativa",
        renovacaoRecusada: true,
      }, user.id);
      dismissReminder(aluna.id);
      
      toast({ title: "Inativada", description: "Aluna marcada como inativa." });
      window.dispatchEvent(new Event('alunas-updated'));
    } catch (err: any) {
      toast({ title: "Erro ao atualizar", description: err.message, variant: "destructive" });
    } finally {
      setIsProcessing(null);
    }
  };

  const handleRenewedSubmit = async () => {
    if (!user || !isAdmin || !renewingAluna || !renewProgram) return;
    
    setIsProcessing(renewingAluna.id);
    try {
      const selectedProg = ConsultationsPrograms.find(p => p.value === renewProgram);
      if (!selectedProg) throw new Error("Plano selecionado inválido");

      const novaDataCompra = format(new Date(), "yyyy-MM-dd");
      const novoVencimento = addMonths(new Date(), renewMonths);

      await upsertAluna({
        ...renewingAluna,
        programa: selectedProg.programa as ProgramType,
        duracaoPlano: selectedProg.duracao as PlanDuration,
        dataCompra: novaDataCompra,
        dataVencimento: novoVencimento.toISOString().split("T")[0],
        deuSinal: false, // Clear old signals
        valorSinal: 0,
        dataCobrancaSinal: undefined,
        residuoPago: false,
        status: "ativa",
        renovacaoRecusada: false,
      }, user.id);
      renewalCompletedRef.current = true;
      dismissReminder(renewingAluna.id);

      toast({ title: "Sucesso", description: "Plano renovado com sucesso!" });
      window.dispatchEvent(new Event('alunas-updated'));
      setRenewDialogOpen(false);
      setRenewingAluna(null);
    } catch (err: any) {
      toast({ title: "Erro ao renovar", description: err.message, variant: "destructive" });
    } finally {
      setIsProcessing(null);
    }
  };

  if (expiringAlunas.length === 0) return null;

  return (
    <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-4 flex flex-col gap-2 relative">
      <div className="flex items-center gap-2 text-destructive">
        <AlertCircle className="h-5 w-5" />
        <span className="font-semibold text-sm">Avisos de Vencimento de Plano (Em 7 dias ou menos)</span>
      </div>
      <div className="space-y-2">
        {expiringAlunas.map((a) => {
          const vDate = new Date(a.dataVencimento);
          const isExpired = isBefore(vDate, new Date()) && !isToday(vDate);
          return (
            <div key={a.id} className={`flex items-center justify-between bg-background/80 rounded-md p-2 text-sm text-foreground overflow-visible border ${isExpired ? 'border-destructive/40' : 'border-border/50'}`}>
              <div>
                ⏳ <span className="font-medium">{a.nomeCompleto}</span> — Vence(u) em {format(vDate, "dd/MM/yyyy", { locale: ptBR })}
                {isExpired && <span className="ml-2 text-xs font-semibold text-destructive uppercase">Expirado</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  disabled={isProcessing === a.id || !isAdmin}
                  title={!isAdmin ? "Apenas administradores podem gerenciar renovações" : ""}
                  className="h-7 text-xs border-destructive text-destructive hover:bg-destructive hover:text-white"
                  onClick={() => handleNotRenewed(a)}
                >
                  <XCircle className="w-3 h-3 mr-1" />
                  Não Renovou
                </Button>
                
                <Button 
                  variant="default" 
                  size="sm" 
                  disabled={isProcessing === a.id || !isAdmin}
                  title={!isAdmin ? "Apenas administradores podem gerenciar renovações" : ""}
                  className="h-7 text-xs gap-1 bg-success hover:bg-success/90 text-white"
                  onClick={() => {
                    renewalCompletedRef.current = false;
                    dismissReminder(a.id);
                    setRenewingAluna(a);
                    setRenewProgram("");
                    setRenewMonths(1);
                    setRenewDialogOpen(true);
                  }}
                >
                  <CheckCircle2 className="w-3 h-3" />
                  Renovou
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={renewDialogOpen} onOpenChange={handleRenewDialogOpenChange}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Renovar Aluna: {renewingAluna?.nomeCompleto}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Novo Plano</label>
              <Select value={renewProgram} onValueChange={setRenewProgram}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o plano" />
                </SelectTrigger>
                <SelectContent>
                  {ConsultationsPrograms.map(prog => (
                    <SelectItem key={prog.value} value={prog.value}>
                      {prog.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Meses a Adicionar</label>
              <Input
                type="number"
                min={1}
                value={renewMonths}
                onChange={(e) => setRenewMonths(parseInt(e.target.value) || 1)}
              />
              <p className="text-xs text-muted-foreground">
                O novo vencimento será calculado a partir de hoje + {renewMonths} meses.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => handleRenewDialogOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleRenewedSubmit} disabled={!renewProgram || isProcessing !== null}>
              Salvar Renovação
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Helper funcs needed in this context
function isToday(date: Date) {
  const today = new Date();
  return date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
}

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}
