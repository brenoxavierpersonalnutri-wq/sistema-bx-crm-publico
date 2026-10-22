// Cartão de Conexões: "Trazer histórico completo" de um número conectado, com progresso (conversas importadas /
// total), pausar, retomar e cancelar. O trabalho roda no servidor (whatsapp-backfill + pg_cron, em lotes, mais
// recentes primeiro); a tela só lê o job a cada 5 s enquanto ele anda.
import { useCallback, useEffect, useState } from "react";
import { History, Loader2, Pause, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import type { FonteConversas, JobBackfill } from "@/lib/crm/fonteConversas";
import { detalheHistorico, estadoHistorico, type AcaoHistorico } from "@/lib/crm/historicoCompleto";

const INTERVALO_MS = 5000;

export function HistoricoCompleto({ numeroId, apelido, api }: {
  numeroId: string;
  apelido: string;
  api: NonNullable<FonteConversas["backfill"]>;
}) {
  const { toast } = useToast();
  const [job, setJob] = useState<JobBackfill | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  const ler = useCallback(async () => {
    try { setJob(await api.status(numeroId)); } catch { /* sem tabela ainda */ }
  }, [api, numeroId]);
  useEffect(() => { void ler(); }, [ler]);

  const estado = estadoHistorico(job);
  useEffect(() => {
    if (!estado.ativo) return;
    const t = window.setInterval(() => void ler(), INTERVALO_MS);
    return () => window.clearInterval(t);
  }, [estado.ativo, ler]);

  const executar = async (acao: AcaoHistorico) => {
    setOcupado(true);
    try {
      const novo = acao === "iniciar" ? await api.iniciar(numeroId, { completo: true })
        : acao === "pausar" ? await api.pausar?.(numeroId)
        : acao === "retomar" ? await api.retomar?.(numeroId)
        : await api.cancelar(numeroId);
      if (novo) setJob(novo);
      else await ler();
    } catch (e) {
      toast({ title: "Não deu certo", description: e instanceof Error ? e.message : "Tente de novo.", variant: "destructive" });
    } finally {
      setOcupado(false);
    }
  };

  const detalhe = detalheHistorico(job);

  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs space-y-1.5" data-testid="historico-completo" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        {estado.ativo ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /> : <History className="h-3.5 w-3.5 shrink-0" />}
        <span className="flex-1 min-w-0">{estado.texto}</span>
      </div>
      {estado.pct !== null && (
        <div className="h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden>
          <div className="h-full bg-primary transition-all" style={{ width: `${estado.pct}%` }} />
        </div>
      )}
      {detalhe && <div className="text-muted-foreground">{detalhe}</div>}
      <div className="flex flex-wrap gap-1.5">
        {estado.acoes.includes("iniciar") && (
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={ocupado} onClick={() => setConfirmar(true)}>
            <History className="h-3.5 w-3.5 mr-1" />{estado.rotuloIniciar}
          </Button>
        )}
        {estado.acoes.includes("pausar") && api.pausar && (
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={ocupado} onClick={() => executar("pausar")}>
            <Pause className="h-3.5 w-3.5 mr-1" />Pausar
          </Button>
        )}
        {estado.acoes.includes("retomar") && api.retomar && (
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={ocupado} onClick={() => executar("retomar")}>
            <Play className="h-3.5 w-3.5 mr-1" />Retomar
          </Button>
        )}
        {estado.acoes.includes("cancelar") && (
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" disabled={ocupado} onClick={() => executar("cancelar")}>
            <X className="h-3.5 w-3.5 mr-1" />Cancelar
          </Button>
        )}
      </div>

      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trazer o histórico completo de {apelido}?</AlertDialogTitle>
            <AlertDialogDescription>
              Todas as conversas do celular, das mais recentes para as mais antigas, até 2000 mensagens por conversa, com o
              horário real de cada mensagem. Roda no servidor em lotes (pode levar horas em número grande) e você pode pausar.
              Fotos, áudios e documentos antigos não são baixados agora: cada um baixa quando você clicar nele. Nenhum contato
              que já existe muda de etapa ou de posição, e a importação não conta como não lida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Agora não</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmar(false); void executar("iniciar"); }}>Trazer histórico</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
