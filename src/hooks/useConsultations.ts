import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Consultation, ConsultationStatus, ConsultationVia } from "@/types/consultation";
import { toast } from "sonner";
import { PROGRAM_OPTIONS } from "@/data/programs";
import { addMonths } from "date-fns";
import { atualizarTelasDepoisDeApagarAluna } from "@/lib/telasDaAluna";

export interface DbConsultation {
  id: string;
  calendly_event_uri: string | null;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
  lead_quality: string;
  observation: string | null;
  event_type_name: string | null;
  calendly_status: string | null;
  attended: boolean | null;
  converted: boolean | null;
  closer_observation: string | null;
  received_reminder_messages: boolean | null;
  via: string | null;
  ticket_value: number | null;
  payment_method: string | null;
  gave_signal: boolean | null;
  signal_value: number | null;
  signal_follow_up_date: string | null;
  signal_residue_paid: boolean | null;
  negotiating: boolean | null;
  instagram: string | null;
  disqualified: boolean | null;
  call_confirmed: boolean | null;
  utm_source: string | null;
  utm_campaign: string | null;
  utm_medium: string | null;
  utm_content: string | null;
  utm_term: string | null;
  is_future_reschedule: boolean | null;
  is_incomplete_flow: boolean | null;
  low_income: boolean | null;
  lead_score: number | null;
  refunded: boolean | null;
  refunded_at: string | null;
  deletion_reason: string | null;
  program_value: string | null;
  created_at: string;
  updated_at: string;
  whatsapp_clicked_at?: string | null;
  passed_pitch_01?: boolean | null;
  confirmed_by_user_id?: string | null;
  confirmed_at?: string | null;
}

function deriveStatus(row: DbConsultation): ConsultationStatus {
  // If it was auto-created with the buggy defaults, DB status is 'pendente'
  if (row.status === 'pendente' && row.attended === false && row.converted === false) {
    return "pendente";
  }
  if (row.attended === false) return "no-show";
  if (row.negotiating === true) return "negociando";
  if (row.converted === true) return "convertido";
  if (row.converted === false) return "não convertido";
  
  // Keep original DB status if it matches our literals
  if (row.status === "pendente" || row.status === "cancelado") {
    return row.status as ConsultationStatus;
  }
  
  return "pendente";
}

export function mapToConsultation(row: DbConsultation): Consultation {
  return {
    id: row.id,
    clientName: row.client_name,
    clientPhone: row.client_phone || null,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: deriveStatus(row),
    leadQuality: (row.lead_quality || "morno") as Consultation["leadQuality"],
    observation: row.observation || "",
    attended: row.attended,
    converted: row.converted,
    closerObservation: row.closer_observation || "",
    eventTypeName: row.event_type_name || undefined,
    receivedReminderMessages: row.received_reminder_messages,
    via: (row.via as ConsultationVia) || null,
    ticketValue: row.ticket_value,
    paymentMethod: row.payment_method,
    gaveSignal: row.gave_signal,
    signalValue: row.signal_value,
    signalFollowUpDate: row.signal_follow_up_date,
    signalResiduePaid: row.signal_residue_paid,
    negotiating: row.negotiating,
    instagram: row.instagram,
    disqualified: row.disqualified ?? null,
    callConfirmed: row.call_confirmed ?? null,
    utmSource: row.utm_source ?? null,
    utmCampaign: row.utm_campaign ?? null,
    utmMedium: row.utm_medium ?? null,
    utmContent: row.utm_content ?? null,
    utmTerm: row.utm_term ?? null,
    is_future_reschedule: row.is_future_reschedule ?? null,
    is_incomplete_flow: row.is_incomplete_flow ?? null,
    lowIncome: (row as any).low_income ?? null,
    leadScore: row.lead_score ?? null,
    refunded: row.refunded ?? null,
    refundedAt: row.refunded_at ?? null,
    deletionReason: row.deletion_reason ?? null,
    programValue: (row as any).program_value ?? null,
    createdAt: row.created_at ?? null,
    whatsappClickedAt: (row as any).whatsapp_clicked_at ?? null,
    passedPitch01: (row as any).passed_pitch_01 ?? null,
    confirmedByUserId: (row as any).confirmed_by_user_id ?? null,
    confirmedAt: (row as any).confirmed_at ?? null,
  };
}

export function useConsultations() {
  return useQuery({
    queryKey: ["consultations"],
    queryFn: async (): Promise<Consultation[]> => {
      const PAGE = 1000;
      let from = 0;
      const all: any[] = [];
      // Paginate to bypass PostgREST 1000-row cap
      while (true) {
        const { data, error } = await supabase
          .from("consultations")
          .select("*")
          .order("date", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return (all as unknown as DbConsultation[]).map(mapToConsultation);
    },
  });
}

export function useAddConsultation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (c: Consultation) => {
      const { error } = await supabase.from("consultations").insert({
        client_name: c.clientName,
        client_phone: c.clientPhone,
        date: c.date,
        status: c.status,
        lead_quality: c.leadQuality,
        observation: c.observation,
        start_time: c.startTime,
        via: c.via,
        ticket_value: c.ticketValue,
        payment_method: c.paymentMethod,
        gave_signal: c.gaveSignal,
        signal_value: c.signalValue,
        signal_follow_up_date: c.signalFollowUpDate,
        signal_residue_paid: c.signalResiduePaid,
        negotiating: c.negotiating,
        instagram: c.instagram,
        disqualified: c.disqualified,
        call_confirmed: c.callConfirmed,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consultations"] });
      toast.success("Consulta registrada!");
    },
    onError: (err: Error) => {
      toast.error("Erro ao registrar: " + err.message);
    },
  });
}

export function useUpdateConsultation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (update: {
      id: string;
      clientName?: string;
      attended?: boolean | null;
      converted?: boolean | null;
      closerObservation?: string;
      leadQuality?: string;
      receivedReminderMessages?: boolean | null;
      via?: string | null;
      ticketValue?: number | null;
      paymentMethod?: string | null;
      gaveSignal?: boolean | null;
      signalValue?: number | null;
      signalFollowUpDate?: string | null;
      signalResiduePaid?: boolean | null;
      negotiating?: boolean | null;
      date?: string;
      startTime?: string | null;
      endTime?: string | null;
      instagram?: string | null;
      disqualified?: boolean | null;
      callConfirmed?: boolean | null;
      is_future_reschedule?: boolean | null;
      is_incomplete_flow?: boolean | null;
      lowIncome?: boolean | null;
      refunded?: boolean | null;
      deletionReason?: string | null;
      programValue?: string | null;
      passedPitch01?: boolean | null;
      confirmedByUserId?: string | null;
      whatsappClicked?: boolean | null;
    }) => {

      const payload: any = { updated_at: new Date().toISOString() };
      if (update.clientName !== undefined) {
        payload.client_name = update.clientName;
      }
      if (update.attended !== undefined) {
        payload.attended = update.attended;
        payload.attended_at = update.attended === null ? null : new Date().toISOString();
      }
      if (update.converted !== undefined) {
        payload.converted = update.converted;
        payload.converted_at = update.converted === null ? null : new Date().toISOString();
      }
      if (update.negotiating !== undefined) {
        payload.negotiating = update.negotiating;
      }
      if (update.disqualified !== undefined) {
        payload.disqualified = update.disqualified;
        // Free up the schedule slot when disqualified
        if (update.disqualified === true) {
          payload.start_time = null;
          payload.end_time = null;
        }
      }
      if (update.callConfirmed !== undefined) {
        payload.call_confirmed = update.callConfirmed;
        // A autoria acompanha a confirmacao: desmarcar limpa quem confirmou,
        // senao a metrica do SDR ficaria contando consulta que voltou atras.
        if (update.callConfirmed === true) {
          payload.confirmed_at = new Date().toISOString();
        } else {
          payload.confirmed_by_user_id = null;
          payload.confirmed_at = null;
        }
      }
      if (update.confirmedByUserId !== undefined) {
        payload.confirmed_by_user_id = update.confirmedByUserId;
      }
      if (update.closerObservation !== undefined) {
        payload.closer_observation = update.closerObservation;
      }
      if (update.leadQuality !== undefined) {
        payload.lead_quality = update.leadQuality;
      }
      if (update.date !== undefined) {
        payload.date = update.date;
      }
      if (update.startTime !== undefined) {
        if (update.startTime && update.startTime.length <= 5 && update.date) {
          // Convert "HH:MM" to full timestamp with timezone
          payload.start_time = `${update.date} ${update.startTime}:00 -03:00`;
        } else {
          payload.start_time = update.startTime;
        }
      }
      if (update.endTime !== undefined) {
        if (update.endTime && update.endTime.length <= 5 && update.date) {
          payload.end_time = `${update.date} ${update.endTime}:00 -03:00`;
        } else {
          payload.end_time = update.endTime;
        }
      }
      if (update.receivedReminderMessages !== undefined) {
        payload.received_reminder_messages = update.receivedReminderMessages;
      }
      if (update.via !== undefined) {
        payload.via = update.via;
      }
      if (update.ticketValue !== undefined) {
        payload.ticket_value = update.ticketValue;
      }
      if (update.paymentMethod !== undefined) {
        payload.payment_method = update.paymentMethod;
      }
      if (update.gaveSignal !== undefined) {
        payload.gave_signal = update.gaveSignal;
      }
      if (update.signalValue !== undefined) {
        payload.signal_value = update.signalValue;
      }
      if (update.signalFollowUpDate !== undefined) {
        payload.signal_follow_up_date = update.signalFollowUpDate;
      }
      if (update.signalResiduePaid !== undefined) {
        payload.signal_residue_paid = update.signalResiduePaid;
      }
      if (update.is_future_reschedule !== undefined) {
        payload.is_future_reschedule = update.is_future_reschedule;
      }
      if (update.is_incomplete_flow !== undefined) {
        payload.is_incomplete_flow = update.is_incomplete_flow;
      }
      if (update.lowIncome !== undefined) {
        (payload as any).low_income = update.lowIncome;
      }
      if (update.refunded !== undefined) {
        payload.refunded = update.refunded;
        payload.refunded_at = update.refunded === true ? new Date().toISOString() : null;
      }
      if (update.deletionReason !== undefined) {
        payload.deletion_reason = update.deletionReason;
      }
      if (update.programValue !== undefined) {
        payload.program_value = update.programValue;
      }
      if (update.passedPitch01 !== undefined) {
        (payload as any).passed_pitch_01 = update.passedPitch01;
      }
      if (update.whatsappClicked !== undefined) {
        (payload as any).whatsapp_clicked_at = update.whatsappClicked ? new Date().toISOString() : null;
      }

      // Derive status
      const attended = update.attended;
      const converted = update.converted;
      const negotiating = update.negotiating;
      if (attended === null) payload.status = "pendente";
      else if (attended === false) payload.status = "no-show";
      else if (negotiating === true) payload.status = "negociando";
      else if (converted === null) payload.status = "pendente";
      else if (converted === true) payload.status = "convertido";
      else if (converted === false) payload.status = "não convertido";

      const { data: currentTask, error: fetchErr } = await (supabase
        .from("consultations")
        .select("client_name, signal_follow_up_date, signal_residue_paid")
        .eq("id", update.id) as any)
        .single();
      
      if (fetchErr) throw fetchErr;

      const { error } = await supabase
        .from("consultations")
        .update(payload)
        .eq("id", update.id);
      if (error) throw error;

      // Automated Task Creation for Signal Residue
      if (update.signalFollowUpDate && update.signalFollowUpDate !== currentTask.signal_follow_up_date) {
        // Dedupe: apaga cobranças antigas da MESMA consulta antes de criar novas,
        // pra não acumular pontos de contato duplicados na agenda do time.
        await supabase
          .from("collaborator_tasks" as any)
          .delete()
          .eq("metadata->>type", "residuo")
          .eq("metadata->>consultationId", update.id);

        // Fetch all approved collaborators
        const { data: collaborators } = await supabase
          .from("profiles")
          .select("id")
          .eq("approved", true);

        if (collaborators && collaborators.length > 0) {
          const tasksToInsert = collaborators.map(collab => ({
            user_id: collab.id,
            title: `Cobrança de Resíduo: ${currentTask.client_name}`,
            description: `Cobrar o restante do valor da venda de ${currentTask.client_name}.`,
            due_date: `${update.signalFollowUpDate}T09:00:00`,
            type: "manual",
            status: "pending",
            metadata: {
              type: "residuo",
              consultationId: update.id
            }
          }));

          await supabase.from("collaborator_tasks" as any).insert(tasksToInsert);
        }
      }

      // If signal fields changed, sync to alunas table
      if (update.gaveSignal !== undefined || update.signalValue !== undefined || update.signalFollowUpDate !== undefined || update.signalResiduePaid !== undefined) {
        const alunaUpdates: any = {};
        if (update.gaveSignal !== undefined) alunaUpdates.deu_sinal = update.gaveSignal;
        if (update.signalValue !== undefined) alunaUpdates.valor_sinal = update.signalValue;
        if (update.signalFollowUpDate !== undefined) alunaUpdates.data_cobranca_sinal = update.signalFollowUpDate;
        if (update.signalResiduePaid !== undefined) alunaUpdates.residuo_pago = update.signalResiduePaid;

        const { error: alunaError } = await supabase
          .from("alunas" as any)
          .update(alunaUpdates)
          .eq("origem_lead", `consulta:${update.id}`);

        if (alunaError) {
          console.error("Erro ao sincronizar sinal com aluna:", alunaError);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consultations"] });
      toast.success("Consulta atualizada!");
    },
    onError: (err: Error) => {
      toast.error("Erro ao atualizar a consulta: " + err.message);
    },
  });
}

export function useDeleteConsultation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("consultations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consultations"] });
      toast.success("Consulta excluída.");
    },
    onError: (err: Error) => {
      toast.error("Erro ao excluir: " + err.message);
    },
  });
}

export function useCreateAlunaFromConsultation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      consultationId: string;
      consultationDate: string;
      clientName: string;
      clientPhone: string | null;
      programValue: string;
      userId: string;
      gaveSignal?: boolean | null;
      signalValue?: number | null;
      signalFollowUpDate?: string | null;
    }) => {
      const prog = PROGRAM_OPTIONS.find((p) => p.value === params.programValue);
      if (!prog) throw new Error("Programa não encontrado");

      const dataCompra = params.consultationDate;
      const duracao = prog.duracao;
      const vencimento = addMonths(new Date(dataCompra), parseInt(duracao));

      const row = {
        nome_completo: params.clientName,
        programa: prog.programa,
        data_compra: dataCompra,
        duracao_plano: duracao,
        data_vencimento: vencimento.toISOString().split("T")[0],
        forma_pagamento: "pix",
        pago: false,
        user_id: params.userId,
        telefone: params.clientPhone || null,
        origem_lead: `consulta:${params.consultationId}`,
        deu_sinal: params.gaveSignal ?? false,
        valor_sinal: params.signalValue ?? 0,
        data_cobranca_sinal: params.signalFollowUpDate || null,
      };

      // Find-or-create: se já existe aluna com o mesmo nome normalizado no banco,
      // atualiza ela em vez de criar duplicata. Nome é a chave de negócio do Breno.
      const normalize = (n: string) => n.trim().toLowerCase().replace(/\s+/g, " ");
      const targetName = normalize(params.clientName);

      const { data: existentes } = await supabase
        .from("alunas" as any)
        .select("id, nome_completo")
        .eq("user_id", params.userId);

      const match = (existentes || []).find(
        (a: any) => normalize(a.nome_completo || "") === targetName
      ) as any;

      if (match) {
        // Atualiza a aluna existente — vincula com a consulta nova e atualiza dados de sinal,
        // sem mexer em campos do plano já preenchidos (deixa o que o personal/nutri configurou).
        const { error } = await supabase
          .from("alunas" as any)
          .update({
            telefone: params.clientPhone || null,
            origem_lead: `consulta:${params.consultationId}`,
            deu_sinal: params.gaveSignal ?? false,
            valor_sinal: params.signalValue ?? 0,
            data_cobranca_sinal: params.signalFollowUpDate || null,
          })
          .eq("id", match.id);
        if (error) throw error;
        return;
      }

      const { error } = await supabase.from("alunas" as any).insert(row as any);
      if (error) {
        if ((error as any).code === "23505") {
          throw new Error("Já existe aluna com esse nome. Use a Gestão de Alunas para atualizar.");
        }
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alunas"] });
      toast.success("Aluna cadastrada automaticamente na Gestão de Alunas!");
    },
    onError: (err: Error) => {
      toast.error("Erro ao cadastrar aluna: " + err.message);
    },
  });
}

export function useDeleteAlunaByConsultation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (consultationId: string) => {
      const { error } = await supabase
        .from("alunas" as any)
        .delete()
        .eq("origem_lead", `consulta:${consultationId}`);
      if (error) throw error;
    },
    onSuccess: () => {
      void atualizarTelasDepoisDeApagarAluna(queryClient);
    },
    onError: (err: Error) => {
      console.error("Erro ao remover aluna vinculada:", err.message);
    },
  });
}

export function useSyncCalendly() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (options?: { silent?: boolean }) => {
      try {
        const { data, error } = await supabase.functions.invoke("sync-calendly");
        if (error) {
          (error as any).__silent = options?.silent;
          throw error;
        }
        return { ...data, silent: options?.silent };
      } catch (err: any) {
        // Treat transient runtime errors (503, boot failures) as silent always
        const msg = String(err?.message || "");
        const isTransient =
          msg.includes("503") ||
          msg.includes("temporarily unavailable") ||
          msg.includes("SUPABASE_EDGE_RUNTIME_ERROR") ||
          msg.includes("Failed to fetch") ||
          msg.includes("Failed to send a request");
        if (options?.silent || isTransient) {
          (err as any).__silent = true;
        }
        throw err;
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["consultations"] });
      if (!data?.silent) {
        toast.success(`Sincronizado! ${data?.synced || 0} consultas do Calendly.`);
      }
    },
    onError: (err: any) => {
      if (err?.__silent) {
        console.warn("Auto-sync skipped (transient):", err?.message || err);
        return;
      }
      console.error("Sync error:", err);
      if (err.context && typeof err.context.text === 'function') {
        err.context.text().then((text: string) => {
          console.error("Response body:", text);
          toast.error("Erro do Servidor: " + text.substring(0, 50));
        }).catch(() => {
          toast.error("Erro ao sincronizar: " + err.message);
        });
      } else {
        toast.error("Erro ao sincronizar: " + err.message);
      }
    },
  });
}
