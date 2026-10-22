import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, MessageSquare, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  FEEDBACK_PRODUTOS,
  FeedbackSemanalResponse,
  respostasPorEtapa,
} from "@/types/feedbackSemanal";

interface Props {
  alunaId: string | null;
  alunaTelefone?: string;
}

type Row = FeedbackSemanalResponse & { id: string; created_at: string };

/**
 * Os feedbacks que a aluna já mandou, do mais novo pro mais antigo, com todas
 * as respostas de cada um. Usa o mesmo `respostasPorEtapa` do dashboard, então
 * pergunta nova no formulário aparece aqui sozinha.
 */
export function FeedbacksPainel({ alunaId, alunaTelefone }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!alunaId) return;
    let cancelado = false;
    setLoading(true);

    (async () => {
      // Os feedbacks novos já vêm com aluna_id. Os antigos (enviados antes do
      // login por WhatsApp) só têm telefone — por isso o casamento pelos
      // últimos 8 dígitos como rede de segurança.
      const digitos = (alunaTelefone ?? "").replace(/\D/g, "");
      const filtros = [`aluna_id.eq.${alunaId}`];
      if (digitos.length >= 8) filtros.push(`telefone.like.%${digitos.slice(-8)}%`);

      const { data, error } = await supabase
        .from("feedback_semanal_responses" as any)
        .select("*")
        .or(filtros.join(","))
        .order("created_at", { ascending: false });

      if (cancelado) return;
      if (!error && data) setRows(data as unknown as Row[]);
      setLoading(false);
    })();

    return () => {
      cancelado = true;
    };
  }, [alunaId, alunaTelefone]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="py-10 text-center">
        <MessageSquare className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Nenhum feedback enviado por ela ainda.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((r) => {
        const blocos = respostasPorEtapa(r);
        return (
          <div key={r.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {format(parseISO(r.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </p>
              {r.produto && (
                <Badge variant="secondary" className="text-[10px]">
                  {FEEDBACK_PRODUTOS[r.produto as keyof typeof FEEDBACK_PRODUTOS]?.rotulo ?? r.produto}
                </Badge>
              )}
            </div>

            {r.resumo_ia && (
              <div className="rounded-md bg-muted/60 p-3">
                <p className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  Resumo
                </p>
                <p className="whitespace-pre-line text-sm">{r.resumo_ia}</p>
              </div>
            )}

            {blocos.map((bloco) => (
              <div key={bloco.etapa} className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                  {bloco.etapa}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {bloco.itens.map((item) => (
                    <div key={item.label}>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {item.label}
                      </p>
                      <p className="whitespace-pre-wrap text-sm">{item.valor}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
