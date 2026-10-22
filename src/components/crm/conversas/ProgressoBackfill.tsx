// Faixa do topo da lista: "Importar todas as conversas" e, durante o backfill, o progresso
// ("importando 120/600 conversas") com barra. Lê o job a cada 5 s enquanto está andando.
import { useCallback, useEffect, useState } from "react";
import { DownloadCloud, Loader2, X } from "lucide-react";
import type { FonteConversas, JobBackfill } from "@/lib/crm/fonteConversas";
import { toast } from "@/hooks/use-toast";

const ATIVO = new Set(["listando", "importando"]);

export function textoBackfill(j: Pick<JobBackfill, "status" | "total_chats" | "chats_feitos">): string {
  if (j.status === "listando") return "Listando as conversas do WhatsApp…";
  if (j.status === "importando") return `Importando ${j.chats_feitos}/${j.total_chats} conversas`;
  if (j.status === "concluido") return `Importação concluída: ${j.chats_feitos}/${j.total_chats} conversas`;
  if (j.status === "cancelado") return `Importação cancelada em ${j.chats_feitos}/${j.total_chats}`;
  if (j.status === "pausado") return `Importação pausada em ${j.chats_feitos}/${j.total_chats}`;
  return "A importação parou com erro";
}

export function ProgressoBackfill({ api }: { api: NonNullable<FonteConversas["backfill"]> }) {
  const [job, setJob] = useState<JobBackfill | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [fechado, setFechado] = useState(false);

  const ler = useCallback(async () => {
    try { setJob(await api.status()); } catch { /* sem tabela ainda */ }
  }, [api]);

  useEffect(() => { void ler(); }, [ler]);
  const ativo = !!job && ATIVO.has(job.status);
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => void ler(), 5000);
    return () => clearInterval(t);
  }, [ativo, ler]);

  const iniciar = async () => {
    setOcupado(true);
    try {
      setJob(await api.iniciar());
      setFechado(false);
    } catch (e) {
      toast({ title: "Não começou", description: e instanceof Error ? e.message : "Tente de novo.", variant: "destructive" });
    } finally { setOcupado(false); }
  };
  const cancelar = async () => {
    setOcupado(true);
    try { setJob(await api.cancelar()); } finally { setOcupado(false); }
  };

  if (!ativo && (fechado || job?.status === "concluido")) {
    return null;
  }
  const pct = job && job.total_chats > 0 ? Math.min(100, Math.round((job.chats_feitos / job.total_chats) * 100)) : 0;

  return (
    <div className="mx-3 mb-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs" role="status" aria-live="polite">
      {ativo && job ? (
        <>
          <div className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            <span className="flex-1 truncate">{textoBackfill(job)}</span>
            <button type="button" onClick={cancelar} disabled={ocupado} className="underline text-muted-foreground disabled:opacity-60">
              cancelar
            </button>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden>
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-muted-foreground">
            {job.msgs_importadas} mensagens · {job.midias} mídias{job.chats_erro ? ` · ${job.chats_erro} com erro` : ""}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <DownloadCloud className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            {job ? textoBackfill(job) : "Trazer TODAS as conversas do WhatsApp (até onde o celular sincronizou)"}
          </span>
          <button type="button" onClick={iniciar} disabled={ocupado} className="font-medium underline disabled:opacity-60">
            {job?.status === "pausado" ? "retomar" : job ? "importar de novo" : "importar tudo"}
          </button>
          <button type="button" onClick={() => setFechado(true)} aria-label="Fechar" className="text-muted-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
