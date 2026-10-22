import { useEffect, useState, useCallback } from "react";
import { format, parseISO, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bell, Phone, Instagram } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { numeroParaWhatsapp } from "@/lib/telefoneDaLead";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

interface PendingReminder {
  consultationId: string;
  clientName: string;
  clientPhone: string | null;
  instagram: string | null;
  signalValue: number | null;
  signalFollowUpDate: string | null;
}

/**
 * Lembretes unificados de cobrança de sinal.
 * Fonte mestre = consultations. Exibe nome, telefone e instagram.
 * Marcar como pago atualiza consulta + aluna vinculada.
 */
export function SignalReminderUnified({ daysAhead = 3 }: { daysAhead?: number }) {
  const [items, setItems] = useState<PendingReminder[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("consultations")
      .select("id, client_name, client_phone, instagram, signal_value, signal_follow_up_date, signal_residue_paid, converted, gave_signal")
      .eq("gave_signal", true)
      .is("signal_residue_paid", null)
      .not("signal_follow_up_date", "is", null);

    if (error) {
      console.error("[SignalReminderUnified]", error);
      return;
    }

    const today = new Date();
    const filtered = (data || [])
      .filter((c: any) => {
        if (c.converted === true && c.signal_residue_paid === true) return false;
        try {
          const d = parseISO(c.signal_follow_up_date);
          return differenceInDays(d, today) <= daysAhead;
        } catch {
          return false;
        }
      })
      .map((c: any) => ({
        consultationId: c.id,
        clientName: c.client_name,
        clientPhone: c.client_phone,
        instagram: c.instagram,
        signalValue: c.signal_value,
        signalFollowUpDate: c.signal_follow_up_date,
      }));

    setItems(filtered);
  }, [daysAhead]);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener("alunas-updated", handler);
    window.addEventListener("consultations-updated", handler);
    return () => {
      window.removeEventListener("alunas-updated", handler);
      window.removeEventListener("consultations-updated", handler);
    };
  }, [load]);

  const syncTasks = async (consultationId: string, completed: boolean) => {
    await supabase
      .from("collaborator_tasks" as any)
      .update({ status: completed ? "completed" : "pending" })
      .eq("metadata->>type", "residuo")
      .eq("metadata->>consultationId", consultationId);
  };

  const handleMarkPaid = async (item: PendingReminder) => {
    try {
      const { error: cErr } = await supabase
        .from("consultations")
        .update({
          signal_residue_paid: true,
          converted: true,
          attended: true,
          status: "convertido",
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.consultationId);
      if (cErr) throw cErr;

      const { error: aErr } = await supabase
        .from("alunas" as any)
        .update({ residuo_pago: true, pago: true })
        .eq("origem_lead", `consulta:${item.consultationId}`);
      if (aErr) console.warn("Aluna sync warning:", aErr);

      await syncTasks(item.consultationId, true);

      toast({ title: "Sucesso", description: "Cobrança marcada como paga em todos os módulos." });
      queryClient.invalidateQueries({ queryKey: ["consultations"] });
      queryClient.invalidateQueries({ queryKey: ["alunas"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      window.dispatchEvent(new Event("alunas-updated"));
      window.dispatchEvent(new Event("consultations-updated"));
      load();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const handleMarkUnpaid = async (item: PendingReminder) => {
    if (!confirm(`Marcar ${item.clientName} como NÃO PAGO o restante? A venda será marcada como não convertida.`)) return;
    try {
      const { error: cErr } = await supabase
        .from("consultations")
        .update({
          signal_residue_paid: false,
          converted: false,
          status: "não convertido",
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.consultationId);
      if (cErr) throw cErr;

      const { error: aErr } = await supabase
        .from("alunas" as any)
        .update({ residuo_pago: false, pago: false })
        .eq("origem_lead", `consulta:${item.consultationId}`);
      if (aErr) console.warn("Aluna sync warning:", aErr);

      await syncTasks(item.consultationId, true); // remove da pendência da agenda

      toast({ title: "Registrado", description: "Marcado como não pagou o restante." });
      queryClient.invalidateQueries({ queryKey: ["consultations"] });
      queryClient.invalidateQueries({ queryKey: ["alunas"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      window.dispatchEvent(new Event("alunas-updated"));
      window.dispatchEvent(new Event("consultations-updated"));
      load();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  if (items.length === 0) return null;

  // Antes cravava o 55 na frente, o que duplicava o DDI de quem já tinha.
  const cleanPhone = (p: string | null) => numeroParaWhatsapp(p) ?? "";
  const cleanInsta = (i: string | null) => (i || "").replace(/^@/, "").trim();

  return (
    <Card className="border-warning/30 bg-warning/5">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Bell className="h-5 w-5 text-warning" />
          <h3 className="font-semibold text-sm">Lembretes de Sinal — Cobrança Pendente</h3>
        </div>
        <div className="space-y-2">
          {items.map((c) => {
            const phone = cleanPhone(c.clientPhone);
            const insta = cleanInsta(c.instagram);
            return (
              <div
                key={c.consultationId}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm bg-background rounded-lg px-3 py-2 border border-border/40"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{c.clientName}</span>
                  {phone && (
                    <a
                      href={`https://wa.me/${phone}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-success hover:underline"
                    >
                      <Phone className="h-3 w-3" />
                      {c.clientPhone}
                    </a>
                  )}
                  {insta && (
                    <a
                      href={`https://instagram.com/${insta}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-pink-600 hover:underline"
                    >
                      <Instagram className="h-3 w-3" />@{insta}
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-muted-foreground">
                    <span>Sinal: R$ {(c.signalValue ?? 0).toFixed(2).replace(".", ",")}</span>
                    <span className="ml-2">
                      Cobrar:{" "}
                      {c.signalFollowUpDate
                        ? format(parseISO(c.signalFollowUpDate), "dd/MM", { locale: ptBR })
                        : "—"}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-success text-success hover:bg-success hover:text-white"
                    onClick={() => handleMarkPaid(c)}
                  >
                    Marcar como Pago
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-destructive text-destructive hover:bg-destructive hover:text-white"
                    onClick={() => handleMarkUnpaid(c)}
                  >
                    Não pagou o restante
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
