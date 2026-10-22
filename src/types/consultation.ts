export type ConsultationStatus = "convertido" | "não convertido" | "no-show" | "pendente" | "negociando";
export type LeadQuality = "quente" | "morno" | "frio";
export type ConsultationVia = "comentou-eu-quero" | "low-ticket" | "trafego" | "organico" | "acompanhamento-individual" | "indicacao" | "desafio" | "social-selling" | "api-oficial-low-ticket" | "grupo-low-ticket" | "site" | string;

export interface Consultation {
  id: string;
  clientName: string;
  clientPhone: string | null;
  date: string; // YYYY-MM-DD
  startTime: string | null;  // ISO timestamp
  endTime: string | null;    // ISO timestamp
  status: ConsultationStatus;
  leadQuality: LeadQuality;
  observation: string;
  attended: boolean | null;
  converted: boolean | null;
  closerObservation: string;
  eventTypeName?: string;
  receivedReminderMessages: boolean | null;
  via: ConsultationVia | null;
  ticketValue: number | null;
  paymentMethod: string | null;
  gaveSignal: boolean | null;
  signalValue: number | null;
  signalFollowUpDate: string | null;
  signalResiduePaid: boolean | null;
  negotiating: boolean | null;
  instagram?: string | null;
  disqualified?: boolean | null;
  callConfirmed?: boolean | null;
  utmSource?: string | null;
  utmCampaign?: string | null;
  utmMedium?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  is_future_reschedule?: boolean | null;
  is_incomplete_flow?: boolean | null;
  lowIncome?: boolean | null;
  leadScore?: number | null;
  refunded?: boolean | null;
  refundedAt?: string | null;
  deletionReason?: string | null;
  programValue?: string | null;
  createdAt?: string | null;
  whatsappClickedAt?: string | null;
  passedPitch01?: boolean | null;
  confirmedByUserId?: string | null;
  confirmedAt?: string | null;
}

export interface DailyStats {
  date: string;
  scheduled: number;
  converted: number;
  noShow: number;
  notConverted: number;
}
