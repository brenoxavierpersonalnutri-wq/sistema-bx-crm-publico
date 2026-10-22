import { useState, useMemo, useCallback, useEffect } from "react";
import { QuemConfirmouDialog } from "@/components/QuemConfirmouDialog";
import { Consultation, ConsultationVia } from "@/types/consultation";
import { supabase } from "@/integrations/supabase/client";
import { numeroParaWhatsapp } from "@/lib/telefoneDaLead";
import { getDay, isBefore, addMinutes, isToday, parse } from "date-fns";
import { PROGRAM_OPTIONS, getProgramByPrice, fetchAllPrograms, addCustomProgram, normalizeProgramValue, ProgramOption, updateCustomProgram, archiveCustomProgram, isDefaultProgram } from "@/data/programs";
import { PROGRAM_LABELS, DURATION_LABELS, ProgramType, PlanDuration } from "@/lib/alunaTypes";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter";
import { DateRange } from "react-day-picker";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogHeader as AlertDialogTitleContainer,
} from "@/components/ui/alert-dialog";
import { format, parseISO, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, X, Minus, AlertTriangle, Calendar as CalendarIcon, Coins, Trash2, Clock, Ban, RotateCcw, Pencil, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateConsultation, useCreateAlunaFromConsultation, useDeleteAlunaByConsultation, useDeleteConsultation, useAddConsultation } from "@/hooks/useConsultations";
import { inferFunnelKey, FunnelKey } from "@/lib/funnelClassification";

const FUNNEL_FILTER_OPTIONS: { value: FunnelKey | "all"; label: string }[] = [
  { value: "all", label: "Todos os funis" },
  { value: "trafego_direto", label: "Tráfego Direto" },
  { value: "social_selling", label: "Social Selling - Avaliação" },
  { value: "social_selling_individual", label: "Social Selling - Consultoria" },
    { value: "organico", label: "Orgânico / Link da Bio" },
    { value: "low_ticket", label: "LOW/PAGINA DE OBRIGADO" },
    
    { value: "grupo_individual", label: "GRUPO DO LOW - CONSULTORIA" },
    { value: "grupo_avaliacao", label: "GRUPO DO LOW - AVALIAÇÃO" },
  { value: "indicacao", label: "Indicação" },
  { value: "comentou_eu_quero", label: "Comentou Eu Quero" },
  { value: "acomp_individual", label: "Acomp. Individual" },
  { value: "ex_aluna", label: "Ex aluna" },
  { value: "renovacao", label: "Renovação" },
  { value: "fluxo_incompleto", label: "Fluxo Incompleto" },
  { value: "manychat_seguidor", label: "ManyChat · Novo Seguidor" },
  { value: "ia_whatsapp", label: "IA WhatsApp" },
];
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { LeadFormResponsesDialog } from "@/components/shared/LeadFormResponsesDialog";

interface ConsultationTableProps {
  consultations: Consultation[];
  defaultLimit?: number;
  hideAddButton?: boolean;
}

function statusBadgeVariant(status: Consultation["status"]) {
  switch (status) {
    case "convertido": return "success" as const;
    case "não convertido": return "warning" as const;
    case "no-show": return "noshow" as const;
    case "pendente": return "secondary" as const;
    case "negociando": return "secondary" as const;
  }
}

const statusLabels: Record<Consultation["status"], string> = {
  convertido: "Convertido",
  "não convertido": "Não Convertido",
  "no-show": "No-Show",
  pendente: "Pendente",
  negociando: "Negociando",
};

export function ConsultationTable({ consultations, defaultLimit, hideAddButton }: ConsultationTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState<DateRange | undefined>();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [funnelFilter, setFunnelFilter] = useState<FunnelKey | "all">("all");
  const [programFilter, setProgramFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Reset to page 1 whenever filters or data change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, dateFilter, statusFilter, funnelFilter, programFilter, paymentFilter, pageSize, consultations.length]);

  // Programs state
  const [allPrograms, setAllPrograms] = useState<ProgramOption[]>(PROGRAM_OPTIONS);
  const [newProgOpen, setNewProgOpen] = useState(false);
  const [newProgLabel, setNewProgLabel] = useState("");
  const [newProgPrice, setNewProgPrice] = useState("");
  const [newProgType, setNewProgType] = useState<ProgramType>("consultoria_slim");
  const [newProgDuration, setNewProgDuration] = useState<PlanDuration>("1");
  const [newProgSaving, setNewProgSaving] = useState(false);
  const [editingProgValue, setEditingProgValue] = useState<string | null>(null);

  useEffect(() => {
    fetchAllPrograms().then(setAllPrograms);
  }, []);

  const sorted = useMemo(() => {
    let all = [...consultations];
    
    // Apply name filter
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      all = all.filter(c => c.clientName.toLowerCase().includes(lowerSearch));
    }
    
    // Apply date filter
    if (dateFilter?.from) {
      all = all.filter(c => {
        try {
          const cDate = parseISO(c.date);
          if (dateFilter.to) {
            return cDate >= dateFilter.from! && cDate <= dateFilter.to!;
          }
          return isSameDay(cDate, dateFilter.from!);
        } catch {
          return false;
        }
      });
    }

    // Apply status filter
    if (statusFilter !== "all") {
      all = all.filter(c => {
        if (statusFilter === "feita") return c.attended === true;
        if (statusFilter === "noshow") return c.attended === false;
        if (statusFilter === "convertida") return c.converted === true;
        if (statusFilter === "pendente") return c.status === "pendente" || c.attended === null;
        if (statusFilter === "desqualificada") return c.disqualified === true;
        return true;
      });
    }

    // Apply funnel filter
    if (funnelFilter !== "all") {
      all = all.filter(c => {
        const key = inferFunnelKey({
          via: c.via ?? null,
          utmSource: (c as any).utmSource ?? null,
          utmCampaign: (c as any).utmCampaign ?? null,
          utmMedium: (c as any).utmMedium ?? null,
          utmContent: (c as any).utmContent ?? null,
          utmTerm: (c as any).utmTerm ?? null,
        });
        return key === funnelFilter;
      });
    }

    // Apply program filter (by ticketValue matching program price)
    if (programFilter !== "all") {
      all = all.filter(c => {
        if (c.ticketValue == null) return false;
        const prog = allPrograms.find(p => p.value === programFilter);
        return prog ? prog.price === c.ticketValue : false;
      });
    }

    // Apply payment method filter
    if (paymentFilter !== "all") {
      all = all.filter(c => c.paymentMethod === paymentFilter);
    }

    // Sort chronologically: date ASC, then startTime ASC
    const finalSorted = all.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      
      // Within the same date, sort by start time ascending
      const timeA = a.startTime ? a.startTime : "";
      const timeB = b.startTime ? b.startTime : "";
      return timeA.localeCompare(timeB);
    });
    // Apply limit if no user-driven filters are active and defaultLimit is provided
    const hasActiveFilters = !!searchTerm || !!dateFilter?.from || statusFilter !== "all" || funnelFilter !== "all" || programFilter !== "all" || paymentFilter !== "all";
    if (defaultLimit && !hasActiveFilters && finalSorted.length > defaultLimit) {
      return finalSorted.slice(0, defaultLimit);
    }
    
    return finalSorted;
  }, [consultations, searchTerm, dateFilter, statusFilter, funnelFilter, programFilter, paymentFilter, allPrograms, defaultLimit]);

  // Pagination — only when defaultLimit is not used (drill / full mode)
  const usePagination = !defaultLimit;
  const totalPages = usePagination ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const safePage = Math.min(currentPage, totalPages);
  const paginated = useMemo(() => {
    if (!usePagination) return sorted;
    const start = (safePage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, usePagination, safePage, pageSize]);

  const addMutation = useAddConsultation();
  const updateMutation = useUpdateConsultation();
  // Confirmar exige dizer quem confirmou — e o que alimenta a metrica do SDR
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [confirmandoNome, setConfirmandoNome] = useState<string>("");
  const deleteConsultationMutation = useDeleteConsultation();
  const createAlunaMutation = useCreateAlunaFromConsultation();
  const deleteAlunaMutation = useDeleteAlunaByConsultation();
  const { user } = useAuth();
  const [editingCloser, setEditingCloser] = useState<string | null>(null);
  const [closerObs, setCloserObs] = useState("");
  const [popoverSignalOpen, setPopoverSignalOpen] = useState<string | null>(null);
  const [calendarSignalOpen, setCalendarSignalOpen] = useState<string | null>(null);

  // Authorization state
  const [unconvertDialog, setUnconvertDialog] = useState<{ open: boolean; consultationId: string | null }>({
    open: false,
    consultationId: null
  });

  // Action states
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; id: string | null; consultation: Consultation | null }>({ open: false, id: null, consultation: null });
  const [formResponseDialog, setFormResponseDialog] = useState<{ open: boolean; name: string; phone: string | null }>({ open: false, name: "", phone: null });
  // Edição do nome direto na linha: o nome vem do Calendly ou do formulário e
  // às vezes chega errado ou incompleto, e é ele que segue pra ficha da aluna
  // quando ela converte.
  const [editandoNomeId, setEditandoNomeId] = useState<string | null>(null);
  const [nomeTemporario, setNomeTemporario] = useState("");

  const abrirEdicaoDoNome = (id: string, nomeAtual: string) => {
    setEditandoNomeId(id);
    setNomeTemporario(nomeAtual);
  };

  const salvarNome = (id: string, nomeAtual: string) => {
    const novoNome = nomeTemporario.trim();
    // Nome vazio deixaria a linha sem identificação nenhuma; sem mudança não
    // vale uma ida ao banco.
    if (novoNome && novoNome !== nomeAtual) {
      updateMutation.mutate({ id, clientName: novoNome });
    }
    setEditandoNomeId(null);
  };

  const [editTimePopover, setEditTimePopover] = useState<string | null>(null);
  const [tempStartTime, setTempStartTime] = useState("");
  const [tempEndTime, setTempEndTime] = useState("");
  const [tempDate, setTempDate] = useState("");

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addDate, setAddDate] = useState("");
  const [addTime, setAddTime] = useState("");
  const [addVia, setAddVia] = useState<string>("");
  const [addInstagram, setAddInstagram] = useState("");

  // Available slots state for +Agendar form
  const [addAvailableSlots, setAddAvailableSlots] = useState<string[]>([]);
  const [addIsLoadingSlots, setAddIsLoadingSlots] = useState(false);
  const [addIsDayFull, setAddIsDayFull] = useState(false);

  // Available slots state for Remarcar popover
  const [editAvailableSlots, setEditAvailableSlots] = useState<string[]>([]);
  const [editIsLoadingSlots, setEditIsLoadingSlots] = useState(false);
  const [editIsDayFull, setEditIsDayFull] = useState(false);

  // Fetch available slots when addDate changes
  useEffect(() => {
    if (!addDate || !user) {
      setAddAvailableSlots([]);
      setAddTime("");
      return;
    }

    async function fetchSlots() {
      setAddIsLoadingSlots(true);
      setAddTime("");
      
      const { data, error } = await supabase.rpc("get_public_booking_info", { p_date: addDate });
      
      if (error || !data || data.length === 0) {
         setAddAvailableSlots([]);
         setAddIsDayFull(false);
         setAddIsLoadingSlots(false);
         return;
      }
      
      const profileInfo = data[0];
      const bookedMap = (profileInfo.booked_slots_map as Record<string, number>) || {};
      const capacity = profileInfo.capacity_per_slot ?? 1;
      const bookedSlots = Object.entries(bookedMap)
        .filter(([, qty]) => (qty as number) >= capacity)
        .map(([slot]) => slot);
      const totalBookings = Object.values(bookedMap).reduce((a, b) => a + (b as number), 0);
      const slotGap = profileInfo.slot_gap_minutes && profileInfo.slot_gap_minutes > 0 ? profileInfo.slot_gap_minutes : 40;
      const maxDaily = profileInfo.max_daily_bookings ?? 12;
      const weekly = (profileInfo.availability_weekly as any) || {};
      const overrides = (profileInfo.availability_overrides as any) || {};

      if (totalBookings >= maxDaily) {
        setAddIsDayFull(true);
        setAddAvailableSlots([]);
        setAddIsLoadingSlots(false);
        return;
      }
      setAddIsDayFull(false);


      let ranges: { start: string; end: string }[] = [];
      if (overrides[addDate]) {
        ranges = overrides[addDate];
      } else {
        const dayOfWeek = getDay(new Date(addDate + "T12:00:00")).toString();
        ranges = weekly[dayOfWeek] || [];
      }

      // Admin form: generate slots every 10 minutes for flexibility
      const adminSlotStep = 10;
      const allSlots: string[] = [];
      ranges.forEach((range: { start: string; end: string }) => {
        const [sh, sm] = range.start.split(":").map(Number);
        const [eh, em] = range.end.split(":").map(Number);
        let cur = sh * 60 + sm;
        const end = eh * 60 + em;
        while (cur < end) {
          const hh = String(Math.floor(cur / 60)).padStart(2, "0");
          const mm = String(cur % 60).padStart(2, "0");
          allSlots.push(`${hh}:${mm}`);
          cur += adminSlotStep;
        }
      });

      const timeToMinutes = (t: string) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m;
      };

      // Admin flexibility: only block EXACT booked times (ignore slotGap)
      const bookedSet = new Set(bookedSlots.filter(Boolean));
      const filtered = Array.from(new Set(allSlots)).sort().filter((time) => {
        return !bookedSet.has(time);
      });

      setAddAvailableSlots(filtered);
      setAddIsLoadingSlots(false);
    }

    fetchSlots();
  }, [addDate, user]);

  // Fetch available slots when tempDate (edit) changes
  useEffect(() => {
    if (!tempDate || !editTimePopover || !user) {
      setEditAvailableSlots([]);
      return;
    }

    async function fetchSlots() {
      setEditIsLoadingSlots(true);
      
      const { data, error } = await supabase.rpc("get_public_booking_info", { p_date: tempDate });
      
      if (error || !data || data.length === 0) {
         setEditAvailableSlots([]);
         setEditIsDayFull(false);
         setEditIsLoadingSlots(false);
         return;
      }
      
      const profileInfo = data[0];
      const bookedMap = (profileInfo.booked_slots_map as Record<string, number>) || {};
      const capacity = profileInfo.capacity_per_slot ?? 1;
      const bookedSlots = Object.entries(bookedMap)
        .filter(([, qty]) => (qty as number) >= capacity)
        .map(([slot]) => slot);
      const totalBookings = Object.values(bookedMap).reduce((a, b) => a + (b as number), 0);
      const slotGap = profileInfo.slot_gap_minutes && profileInfo.slot_gap_minutes > 0 ? profileInfo.slot_gap_minutes : 40;
      const maxDaily = profileInfo.max_daily_bookings ?? 12;
      const weekly = (profileInfo.availability_weekly as any) || {};
      const overrides = (profileInfo.availability_overrides as any) || {};

      if (totalBookings >= maxDaily) {
        setEditIsDayFull(true);
        setEditAvailableSlots([]);
        setEditIsLoadingSlots(false);
        return;
      }
      setEditIsDayFull(false);


      let ranges: { start: string; end: string }[] = [];
      if (overrides[tempDate]) {
        ranges = overrides[tempDate];
      } else {
        const dayOfWeek = getDay(new Date(tempDate + "T12:00:00")).toString();
        ranges = weekly[dayOfWeek] || [];
      }

      const adminSlotStep = 10;
      const allSlots: string[] = [];
      ranges.forEach((range: { start: string; end: string }) => {
        const [sh, sm] = range.start.split(":").map(Number);
        const [eh, em] = range.end.split(":").map(Number);
        let cur = sh * 60 + sm;
        const end = eh * 60 + em;
        while (cur < end) {
          const hh = String(Math.floor(cur / 60)).padStart(2, "0");
          const mm = String(cur % 60).padStart(2, "0");
          allSlots.push(`${hh}:${mm}`);
          cur += adminSlotStep;
        }
      });

      const timeToMinutes = (t: string) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m;
      };

      const currentConsultation = consultations.find(c => c.id === editTimePopover);
      const isRescheduling = currentConsultation && currentConsultation.date === tempDate;
      let originalTime: string | null = null;
      if (isRescheduling && currentConsultation?.startTime) {
        try {
          originalTime = format(parseISO(currentConsultation.startTime), "HH:mm");
        } catch(e) {}
      }

      // Admin flexibility: only block EXACT booked times (ignore slotGap), allow original time
      const relevantBooked = new Set(bookedSlots.filter(b => b && b !== originalTime));
      const filtered = Array.from(new Set(allSlots)).sort().filter((time) => {
        if (time === originalTime) return true;
        return !relevantBooked.has(time);
      });

      if (originalTime && !filtered.includes(originalTime)) {
        filtered.push(originalTime);
        filtered.sort();
      }

      setEditAvailableSlots(filtered);
      setEditIsLoadingSlots(false);
    }

    fetchSlots();
  }, [tempDate, editTimePopover, consultations, user]);

  const PAYMENT_OPTIONS = [
    { value: "pix", label: "PIX" },
    { value: "cartao-credito", label: "Cartão Crédito" },
    { value: "cartao-debito", label: "Cartão Débito" },
    { value: "boleto", label: "Boleto" },
    { value: "dinheiro", label: "Dinheiro" },
  ];

  const VIA_OPTIONS: { value: ConsultationVia; label: string }[] = [
    { value: "comentou-eu-quero", label: "Comentou Eu Quero" },
    { value: "trafego", label: "Tráfego Direto" },
    { value: "desafio", label: "Desafio" },
    { value: "organico", label: "Orgânico / Link da Bio" },
    { value: "acompanhamento-individual", label: "Acomp. Individual" },
    { value: "social-selling", label: "Social Selling" },
    { value: "low-ticket", label: "Low Ticket" },
    { value: "indicacao", label: "Indicação" },
    { value: "avaliacao-low-ticket", label: "Avaliação + Low Ticket" },
    { value: "ex-aluna", label: "Ex aluna" },
    { value: "renovacao", label: "Renovação" },
    { value: "fluxo-incompleto", label: "Fluxo Incompleto" },
    { value: "manychat", label: "ManyChat · Novo Seguidor" },
  ];

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName || !addDate) return;

    let fullTimestamp: string | null = null;
    if (addTime) {
      try {
        // Create an ISO string for the local time
        fullTimestamp = new Date(`${addDate}T${addTime}:00-03:00`).toISOString();
      } catch (err) {
        fullTimestamp = null;
      }
    }

    addMutation.mutate({
      id: "new",
      clientName: addName,
      clientPhone: addPhone || null,
      date: addDate,
      startTime: fullTimestamp,
      endTime: null,
      status: "pendente",
      leadQuality: "morno",
      observation: "",
      attended: null,
      converted: null,
      closerObservation: "",
      receivedReminderMessages: null,
      via: addVia || null,
      ticketValue: null,
      paymentMethod: null,
      gaveSignal: null,
      signalValue: null,
      signalFollowUpDate: null,
      signalResiduePaid: null,
      negotiating: null,
      instagram: addInstagram || null,
      callConfirmed: null,
    });
    
    setIsAddOpen(false);
    setAddName("");
    setAddPhone("");
    setAddDate("");
    setAddTime("");
    setAddVia("");
    setAddInstagram("");
  };

  const handleAttended = (id: string, attended: boolean | null) => {
    updateMutation.mutate({ id, attended, ...(attended === null ? { converted: null } : {}) });
  };

  const handleConverted = (id: string, converted: boolean | null, negotiating: boolean | null = null) => {
    const current = consultations.find(c => c.id === id);

    // If we are un-marking "convertido" (it was true and now is null/false)
    if (current?.converted === true && (converted === null || converted === false) && !negotiating) {
      setUnconvertDialog({ open: true, consultationId: id });
    } else {
      updateMutation.mutate({ id, converted, negotiating });
    }
  };

  const confirmUnconvert = () => {
    if (unconvertDialog.consultationId) {
      // First delete aluna, then update consultation
      deleteAlunaMutation.mutate(unconvertDialog.consultationId);
      updateMutation.mutate({ id: unconvertDialog.consultationId, converted: null, ticketValue: null, paymentMethod: null });
    }
    setUnconvertDialog({ open: false, consultationId: null });
  };

  const handleSaveCloserObs = (id: string) => {
    updateMutation.mutate({ id, closerObservation: closerObs });
    setEditingCloser(null);
    setCloserObs("");
  };

  const confirmDeleteConsultation = () => {
    if (deleteDialog.id) {
      deleteConsultationMutation.mutate(deleteDialog.id);
    }
    setDeleteDialog({ open: false, id: null, consultation: null });
  };

  const handleSaveTime = (id: string) => {
    const consultation = consultations.find(c => c.id === id);
    if (!consultation) return;

    if (consultation.attended === false) {
      // Create a NEW consultation for the rescheduled time, leaving the old one as no-show
      let fullTimestamp: string | null = null;
      if (tempStartTime) {
        try {
          fullTimestamp = new Date(`${tempDate}T${tempStartTime}:00-03:00`).toISOString();
        } catch (err) {
          fullTimestamp = null;
        }
      }

      addMutation.mutate({
        id: "new",
        clientName: consultation.clientName,
        clientPhone: consultation.clientPhone,
        date: tempDate,
        startTime: fullTimestamp,
        endTime: null,
        status: "pendente",
        leadQuality: consultation.leadQuality,
        observation: consultation.observation ? `${consultation.observation} (Remarcado após no-show)` : "(Remarcado após no-show)",
        attended: null,
        converted: null,
        closerObservation: "",
        receivedReminderMessages: null,
        via: consultation.via,
        ticketValue: null,
        paymentMethod: null,
        gaveSignal: null,
        signalValue: null,
        signalFollowUpDate: null,
        signalResiduePaid: null,
        negotiating: null,
        instagram: consultation.instagram,
        disqualified: null,
        callConfirmed: null,
      });

    } else {
      updateMutation.mutate({
        id,
        date: tempDate,
        startTime: tempStartTime || null,
        endTime: tempEndTime || null,
      });
    }

    setEditTimePopover(null);
  };

  return (
    <>
      <Card className="border-none shadow-sm">
        <CardHeader className="pb-3 border-b border-border/50">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <CardTitle className="font-display text-lg whitespace-nowrap">Consultas Recentes</CardTitle>
            
            {/* Filters Section */}
            <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
              {/* Search By Name */}
              <div className="relative w-full sm:w-64">
                <Input
                  type="text"
                  placeholder="Pesquisar por nome..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 h-9 text-sm w-full"
                />
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                {searchTerm && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1.5 h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => setSearchTerm("")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {/* Date Filter */}
              <div className="w-full sm:w-auto">
                <DateRangeFilter
                  dateRange={dateFilter}
                  onRangeChange={setDateFilter}
                  onClear={() => setDateFilter(undefined)}
                />
              </div>

              {/* Status Filter */}
              <div className="w-full sm:w-auto">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-[160px] h-9">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Ver Tudo</SelectItem>
                    <SelectItem value="pendente">Pendentes</SelectItem>
                    <SelectItem value="feita">Calls Feitas</SelectItem>
                    <SelectItem value="noshow">No-show</SelectItem>
                    <SelectItem value="convertida">Convertidas (Vendas)</SelectItem>
                    <SelectItem value="desqualificada">Desqualificadas</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Funnel Filter */}
              <div className="w-full sm:w-auto">
                <Select value={funnelFilter} onValueChange={(v) => setFunnelFilter(v as FunnelKey | "all")}>
                  <SelectTrigger className="w-full sm:w-[180px] h-9">
                    <SelectValue placeholder="Funil" />
                  </SelectTrigger>
                  <SelectContent>
                    {FUNNEL_FILTER_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Program Filter */}
              <div className="w-full sm:w-auto">
                <Select value={programFilter} onValueChange={setProgramFilter}>
                  <SelectTrigger className="w-full sm:w-[170px] h-9">
                    <SelectValue placeholder="Programa" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os programas</SelectItem>
                    {allPrograms.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label} – R$ {opt.price}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Payment Method Filter */}
              <div className="w-full sm:w-auto">
                <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                  <SelectTrigger className="w-full sm:w-[160px] h-9">
                    <SelectValue placeholder="Pagamento" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas formas pgto.</SelectItem>
                    {PAYMENT_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!hideAddButton && (
                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                  <DialogTrigger asChild>
                    <Button className="h-9 w-full sm:w-auto" variant="default">
                      + Agendar
                    </Button>
                  </DialogTrigger>
                   <DialogContent onInteractOutside={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
                    <DialogHeader>
                      <DialogTitle>Agendar Nova Consulta</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleManualAdd} className="space-y-4 pt-4">
                      <div className="space-y-2">
                         <label className="text-sm font-medium">Nome da Cliente <span className="text-destructive">*</span></label>
                         <Input required value={addName} onChange={e=>setAddName(e.target.value)} placeholder="Ex: Maria da Silva" />
                      </div>
                      <div className="space-y-2">
                         <label className="text-sm font-medium">WhatsApp</label>
                         <Input value={addPhone} onChange={e=>setAddPhone(e.target.value)} placeholder="Ex: 11999999999" />
                      </div>
                      <div className="space-y-2">
                         <label className="text-sm font-medium">Instagram</label>
                         <Input value={addInstagram} onChange={e=>setAddInstagram(e.target.value)} placeholder="Ex: @brenoxavier" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                           <label className="text-sm font-medium">Data <span className="text-destructive">*</span></label>
                           <Input type="date" required value={addDate} onChange={e=>setAddDate(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                           <label className="text-sm font-medium">Horário</label>
                           {addIsLoadingSlots ? (
                             <div className="h-10 flex items-center justify-center text-sm text-muted-foreground">Carregando...</div>
                           ) : addIsDayFull ? (
                             <div className="h-10 flex items-center text-sm text-amber-600 font-medium">Dia lotado</div>
                           ) : addAvailableSlots.length === 0 && addDate ? (
                             <div className="h-10 flex items-center text-sm text-muted-foreground">Sem horários disponíveis</div>
                           ) : (
                             <Select value={addTime} onValueChange={setAddTime}>
                               <SelectTrigger>
                                 <SelectValue placeholder="Selecionar horário" />
                               </SelectTrigger>
                               <SelectContent>
                                 {addAvailableSlots.map((slot) => (
                                   <SelectItem key={slot} value={slot}>{slot}</SelectItem>
                                 ))}
                               </SelectContent>
                             </Select>
                           )}
                         </div>
                      </div>
                      <div className="space-y-2">
                         <label className="text-sm font-medium">Origem (Via)</label>
                          <Select value={addVia} onValueChange={setAddVia}>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecionar Origem" />
                            </SelectTrigger>
                            <SelectContent>
                               {VIA_OPTIONS.map((opt) => (
                                 <SelectItem key={opt.value} value={opt.value}>
                                   {opt.label}
                                 </SelectItem>
                               ))}
                            </SelectContent>
                          </Select>
                      </div>
                      <Button type="submit" className="w-full" disabled={addMutation.isPending}>
                        {addMutation.isPending ? "Salvando..." : "Salvar Agendamento"}
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="font-semibold w-[80px] sticky left-0 z-30 bg-muted/50">Data</TableHead>
                  <TableHead className="font-semibold min-w-[150px] sticky left-[80px] z-30 bg-muted/50 shadow-[2px_0_4px_-2px_rgba(0,0,0,.25)]">Cliente</TableHead>
                  <TableHead className="font-semibold text-center w-[90px]">
                    <span className="text-[9px]">SDR - MSG DE</span>
                    <br />
                    <span className="text-[9px]">CONFIRMAÇÃO</span>
                  </TableHead>
                  <TableHead className="font-semibold text-center w-[90px]">
                    <span className="text-[10px]">SDR</span>
                    <br />
                    <span className="text-[10px]">CONFIRMADAS</span>
                  </TableHead>
                  <TableHead className="font-semibold text-center w-[70px]">
                    <span className="text-[10px]">SDR</span>
                    <br />
                    <span className="text-[10px]">Comparec.</span>
                  </TableHead>
                  <TableHead className="font-semibold text-center w-[80px]">
                    <span className="text-[10px]">Passou</span>
                    <br />
                    <span className="text-[10px]">Pitch 01</span>
                  </TableHead>
                  <TableHead className="font-semibold text-center w-[70px]">
                    <span className="text-[10px]">Closer</span>
                    <br />
                    <span className="text-[10px]">Converteu?</span>
                  </TableHead>
                  <TableHead className="font-semibold w-[90px] text-[11px]">Funil</TableHead>
                  <TableHead className="font-semibold w-[100px] text-[11px]">Programa</TableHead>
                  <TableHead className="font-semibold w-[90px] text-[11px]">Pagamento</TableHead>
                  <TableHead className="font-semibold w-[100px] text-[11px]">Sinal</TableHead>
                  <TableHead className="font-semibold min-w-[250px] w-[250px] text-[11px]">Observação</TableHead>
                  <TableHead className="font-semibold w-[60px] text-[11px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((c) => (
                  <TableRow
                    key={c.id}
                    className="group hover:bg-muted/30"
                  >
                    <TableCell className="font-medium text-sm sticky left-0 z-20 bg-background group-hover:bg-muted/30 transition-colors">
                      <div>
                        {format(parseISO(c.date), "dd MMM", { locale: ptBR })}
                      </div>
                      {c.startTime && (
                        <div className="text-xs text-muted-foreground">
                          {(() => {
                            try {
                              return format(parseISO(c.startTime), "HH:mm");
                            } catch (e) {
                              return c.startTime;
                            }
                          })()}
                          {c.endTime && (
                            (() => {
                              try {
                                return ` – ${format(parseISO(c.endTime), "HH:mm")}`;
                              } catch (e) {
                                return "";
                              }
                            })()
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm sticky left-[80px] z-20 bg-background group-hover:bg-muted/30 transition-colors shadow-[2px_0_4px_-2px_rgba(0,0,0,.25)]">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {(() => {
                          const WHATSAPP_TRACKING_START = "2026-07-14T00:00:00Z";
                          // Manual: marcado explicitamente pelo time.
                          // Automático: SÓ leads que vieram do formulário público
                          // (lead_score preenchido pelo submit-form-response). Cadastros
                          // manuais nunca são auto-flaggados.
                          const isIncompleteFlow =
                            c.refunded !== true &&
                            c.disqualified !== true &&
                            (
                              c.is_incomplete_flow === true ||
                              (
                                !c.whatsappClickedAt &&
                                c.leadScore != null &&
                                !!c.createdAt &&
                                c.createdAt >= WHATSAPP_TRACKING_START
                              )
                            );
                          return (
                            <>
                              {editandoNomeId === c.id ? (
                                <span className="inline-flex items-center gap-1">
                                  <Input
                                    autoFocus
                                    value={nomeTemporario}
                                    onChange={(e) => setNomeTemporario(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") salvarNome(c.id, c.clientName);
                                      if (e.key === "Escape") setEditandoNomeId(null);
                                    }}
                                    className="h-7 w-44 text-sm"
                                  />
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    title="Salvar o nome"
                                    className="h-6 w-6"
                                    onClick={(e) => { e.stopPropagation(); salvarNome(c.id, c.clientName); }}
                                  >
                                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    title="Cancelar"
                                    className="h-6 w-6"
                                    onClick={(e) => { e.stopPropagation(); setEditandoNomeId(null); }}
                                  >
                                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                                  </Button>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <span className={isIncompleteFlow ? "text-red-600 font-semibold" : ""}>
                                    {c.clientName}
                                  </span>
                                  {/* O lápis só aparece ao passar o mouse na linha, pra não
                                      poluir uma tabela que já tem muito botão. */}
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    title="Editar o nome"
                                    className="h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                    onClick={(e) => { e.stopPropagation(); abrirEdicaoDoNome(c.id, c.clientName); }}
                                  >
                                    <Pencil className="h-3 w-3 text-muted-foreground" />
                                  </Button>
                                </span>
                              )}
                              {isIncompleteFlow && (
                                <>
                                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5">
                                    fluxo incompleto
                                  </Badge>
                                  <span className="inline-flex items-center gap-1 ml-1" title="Já chamou no WhatsApp?">
                                    <span className="text-[10px] text-muted-foreground">chamou?</span>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className="h-5 w-5 p-0 border-emerald-500 text-emerald-600 hover:bg-emerald-50"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        updateMutation.mutate({ id: c.id, whatsappClicked: true });
                                      }}
                                      disabled={updateMutation.isPending}
                                      title="Sim, já chamei"
                                    >
                                      <Check className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className="h-5 w-5 p-0 border-red-500 text-red-600 hover:bg-red-50"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        updateMutation.mutate({ id: c.id, disqualified: true });
                                      }}
                                      disabled={updateMutation.isPending}
                                      title="Não vou chamar (desqualifica)"
                                    >
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </span>
                                </>
                              )}

                            </>
                          );
                        })()}
                        {c.leadScore != null ? (() => {
                          let nivel = "";
                          let color = "";
                          if (c.leadScore >= 65) { nivel = "A"; color = "bg-emerald-500 text-white"; }
                          else if (c.leadScore >= 50) { nivel = "B"; color = "bg-blue-500 text-white"; }
                          else if (c.leadScore >= 41) { nivel = "C"; color = "bg-yellow-500 text-black"; }
                          else if (c.leadScore >= 35) { nivel = "D"; color = "bg-orange-500 text-white"; }
                          else { nivel = "DQ"; color = "bg-red-500 text-white"; }
                          return (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFormResponseDialog({ open: true, name: c.clientName, phone: c.clientPhone ?? null });
                              }}
                              className="flex flex-col items-center gap-0.5 hover:opacity-80 transition-opacity cursor-pointer"
                              title="Ver respostas do formulário"
                            >
                              <span className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-black leading-none ${color}`}>
                                {nivel}
                              </span>
                              <span className="text-[9px] font-semibold text-muted-foreground leading-none">
                                {c.leadScore}/80
                              </span>
                            </button>
                          );
                        })() : (
                          <span
                            className="inline-flex flex-col items-center gap-0.5"
                            title="Lead sem pontuação — agendou sem passar pelo formulário"
                          >
                            <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-black leading-none bg-slate-300 text-slate-600">
                              S/P
                            </span>
                            <span className="text-[9px] font-semibold text-muted-foreground leading-none">
                              sem score
                            </span>
                          </span>
                        )}
                      </div>
                      {c.clientPhone && (
                        <a
                          href={`https://wa.me/${numeroParaWhatsapp(c.clientPhone)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-success hover:underline block"
                        >
                          📱 {c.clientPhone}
                        </a>
                      )}
                      {c.instagram && (
                        <a
                          href={`https://instagram.com/${c.instagram.replace('@', '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-indigo-500 hover:text-indigo-600 hover:underline block mt-0.5"
                        >
                          @{c.instagram.replace('@', '')}
                        </a>
                      )}
                      {c.eventTypeName && (
                        <div className="text-xs text-muted-foreground">{c.eventTypeName}</div>
                      )}
                    </TableCell>

                    {/* SDR Confirmation Column */}
                    <TableCell className="text-center">
                      {c.receivedReminderMessages === null || (c.status === 'pendente' && c.receivedReminderMessages === false) ? (
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 hover:bg-success/10 hover:text-success hover:border-success"
                            onClick={() => updateMutation.mutate({ id: c.id, receivedReminderMessages: true })}
                            disabled={updateMutation.isPending}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
                            onClick={() => updateMutation.mutate({ id: c.id, receivedReminderMessages: false })}
                            disabled={updateMutation.isPending}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : c.receivedReminderMessages ? (
                        <Badge variant="success" className="text-xs cursor-pointer hover:opacity-70" onClick={() => updateMutation.mutate({ id: c.id, receivedReminderMessages: null })}>✓ Sim</Badge>
                      ) : (
                        <Badge variant="noshow" className="text-xs cursor-pointer hover:opacity-70" onClick={() => updateMutation.mutate({ id: c.id, receivedReminderMessages: null })}>✗ Não</Badge>
                      )}
                    </TableCell>

                    {/* SDR Call Confirmed Column */}
                    <TableCell className="text-center">
                      {c.callConfirmed === null || (c.status === 'pendente' && c.callConfirmed === false) ? (
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 hover:bg-success/10 hover:text-success hover:border-success"
                            onClick={() => { setConfirmandoId(c.id); setConfirmandoNome(c.clientName || "esta lead"); }}
                            disabled={updateMutation.isPending}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
                            onClick={() => {
                              // Mark as not confirmed — keep the time slot intact
                              updateMutation.mutate({ id: c.id, callConfirmed: false });
                            }}
                            disabled={updateMutation.isPending}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : c.callConfirmed ? (
                        <Badge variant="success" className="text-xs cursor-pointer hover:opacity-70" onClick={() => updateMutation.mutate({ id: c.id, callConfirmed: null })}>✓ Sim</Badge>
                      ) : (
                        <Badge variant="noshow" className="text-xs cursor-pointer hover:opacity-70" onClick={() => updateMutation.mutate({ id: c.id, callConfirmed: null })}>✗ Não</Badge>
                      )}
                    </TableCell>

                    {/* SDR Attended Column */}
                    <TableCell className="text-center">
                      {c.disqualified ? (
                        <Badge variant="secondary" className="text-xs cursor-pointer hover:opacity-70 bg-slate-200 text-slate-700 hover:bg-slate-300 border-none" onClick={() => updateMutation.mutate({ id: c.id, disqualified: null })}>Desqualificada</Badge>
                      ) : c.attended === null || (c.status === 'pendente' && c.attended === false) ? (
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 hover:bg-success/10 hover:text-success hover:border-success"
                            onClick={() => handleAttended(c.id, true)}
                            disabled={updateMutation.isPending}
                            title="Compareceu"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
                            onClick={() => handleAttended(c.id, false)}
                            disabled={updateMutation.isPending}
                            title="Não compareceu (No-show)"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 hover:bg-slate-200 hover:text-slate-800 hover:border-slate-300"
                            onClick={() => updateMutation.mutate({ id: c.id, disqualified: true })}
                            disabled={updateMutation.isPending}
                            title="Desqualificar"
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : c.attended ? (
                        <Badge variant="success" className="text-xs cursor-pointer hover:opacity-70" onClick={() => handleAttended(c.id, null)}>✓ Sim</Badge>
                      ) : (
                        <Badge variant="noshow" className="text-xs cursor-pointer hover:opacity-70" onClick={() => handleAttended(c.id, null)}>✗ Não</Badge>
                      )}
                    </TableCell>

                    {/* Passou do Pitch 01 — so faz sentido para quem compareceu */}
                    <TableCell className="text-center">
                      {c.attended !== true ? (
                        <Minus className="h-4 w-4 text-muted-foreground mx-auto" />
                      ) : c.passedPitch01 === null || c.passedPitch01 === undefined ? (
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 hover:bg-success/10 hover:text-success hover:border-success"
                            onClick={() => updateMutation.mutate({ id: c.id, passedPitch01: true })}
                            disabled={updateMutation.isPending}
                            title="Passou do Pitch 01"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
                            onClick={() => updateMutation.mutate({ id: c.id, passedPitch01: false })}
                            disabled={updateMutation.isPending}
                            title="Parou no Pitch 01 — lead sem perfil"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : c.passedPitch01 ? (
                        <Badge variant="success" className="text-xs cursor-pointer hover:opacity-70" onClick={() => updateMutation.mutate({ id: c.id, passedPitch01: null })}>✓ Sim</Badge>
                      ) : (
                        <Badge variant="noshow" className="text-xs cursor-pointer hover:opacity-70" onClick={() => updateMutation.mutate({ id: c.id, passedPitch01: null })}>✗ Não</Badge>
                      )}
                    </TableCell>

                    {/* Closer Column */}
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center gap-1">
                        {c.attended !== true ? (
                          <Minus className="h-4 w-4 text-muted-foreground mx-auto" />
                        ) : c.negotiating ? (
                          <Badge variant="secondary" className="text-xs cursor-pointer hover:opacity-70 bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border-none px-2" onClick={() => handleConverted(c.id, null, null)}>⏳ Negoc.</Badge>
                        ) : c.attended === true && c.converted === null ? (
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0 hover:bg-success/10 hover:text-success hover:border-success"
                              onClick={() => handleConverted(c.id, true, false)}
                              disabled={updateMutation.isPending}
                              title="Convertido"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
                              onClick={() => handleConverted(c.id, false, false)}
                              disabled={updateMutation.isPending}
                              title="Não convertido"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0 hover:bg-amber-100 hover:text-amber-700 hover:border-amber-300"
                              onClick={() => updateMutation.mutate({ id: c.id, converted: false, negotiating: false, passedPitch01: false })}
                              disabled={updateMutation.isPending}
                              title="Parou no Pitch 01 (não ouviu a proposta)"
                            >
                              <Flag className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0 hover:bg-indigo-100 hover:text-indigo-700 hover:border-indigo-300"
                              onClick={() => handleConverted(c.id, null, true)}
                              disabled={updateMutation.isPending}
                              title="Negociando"
                            >
                              <Clock className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : c.converted === true ? (
                          <Badge variant="success" className="text-xs cursor-pointer hover:opacity-70" onClick={() => handleConverted(c.id, null, false)}>✓ Sim</Badge>
                        ) : c.converted === false ? (
                          c.passedPitch01 === false ? (
                            <Badge variant="secondary" className="text-xs cursor-pointer hover:opacity-70 bg-amber-100 text-amber-700 hover:bg-amber-200 border-none px-2" onClick={() => handleConverted(c.id, null, false)}>⛔ Pitch 01</Badge>
                          ) : (
                            <Badge variant="warning" className="text-xs cursor-pointer hover:opacity-70" onClick={() => handleConverted(c.id, null, false)}>✗ Não</Badge>
                          )
                        ) : (
                          <Minus className="h-4 w-4 text-muted-foreground mx-auto" />
                        )}

                        {/* Pitch 01 toggle — só faz sentido a partir de "compareceu" */}
                        {c.attended === true && (
                          <button
                            type="button"
                            className={`text-[9px] px-1.5 py-0.5 rounded border transition ${
                              c.passedPitch01
                                ? "bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200"
                                : "bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100"
                            }`}
                            onClick={() => updateMutation.mutate({ id: c.id, passedPitch01: !c.passedPitch01 })}
                            disabled={updateMutation.isPending}
                            title="Passou do Pitch 01 (ouviu a proposta)"
                          >
                            Pitch 01 {c.passedPitch01 ? "✓" : "○"}
                          </button>
                        )}
                      </div>
                    </TableCell>

                    {/* Funil */}
                    <TableCell>
                      {c.via ? (
                        <Badge
                          variant="secondary"
                          className="text-[10px] cursor-pointer hover:opacity-70 px-1.5 py-0"
                          onClick={() => updateMutation.mutate({ id: c.id, via: null })}
                          title="Clique para limpar"
                        >
                          {VIA_OPTIONS.find((o) => o.value === c.via)?.label || c.via}
                          <X className="h-2.5 w-2.5 ml-0.5" />
                        </Badge>
                      ) : (
                        <Select
                          value=""
                          onValueChange={(value) => updateMutation.mutate({ id: c.id, via: value || null })}
                        >
                          <SelectTrigger className="h-6 text-[10px] w-[90px]">
                            <SelectValue placeholder="Selecionar" />
                          </SelectTrigger>
                          <SelectContent>
                            {VIA_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>

                    {/* Programa */}
                    <TableCell>
                      {c.attended === true ? (
                        c.ticketValue ? (
                          <Badge
                            variant="secondary"
                            className="text-[10px] cursor-pointer hover:opacity-70 px-1.5 py-0"
                            onClick={() => updateMutation.mutate({ id: c.id, ticketValue: null, programValue: null })}
                            title="Clique para limpar"
                          >
                            {(c.programValue && allPrograms.find((p) => p.value === c.programValue)?.label) ||
                              getProgramByPrice(c.ticketValue)?.label ||
                              `R$ ${c.ticketValue}`}
                            <X className="h-2.5 w-2.5 ml-0.5" />
                          </Badge>
                        ) : (
                          <Select
                            value=""
                            onValueChange={(value) => {
                              if (value === "__new__") {
                                setNewProgOpen(true);
                                return;
                              }
                              const prog = allPrograms.find((p) => p.value === value);
                              console.log("[ConsultationTable] Program selected:", value, "prog:", prog, "user:", user?.id);
                              if (prog) {
                                updateMutation.mutate({ id: c.id, ticketValue: prog.price, programValue: prog.value });
                                if (user) {
                                  createAlunaMutation.mutate({
                                    consultationId: c.id,
                                    consultationDate: c.date,
                                    clientName: c.clientName,
                                    clientPhone: c.clientPhone,
                                    programValue: value,
                                    userId: user.id,
                                  });
                                }
                              }
                            }}
                          >
                            <SelectTrigger className="h-6 text-[10px] w-[100px]">
                              <SelectValue placeholder="Selecionar" />
                            </SelectTrigger>
                            <SelectContent>
                              {allPrograms.map((opt) => (
                                <div key={opt.value} className="flex items-center gap-1 pr-1">
                                  <SelectItem value={opt.value} className="text-xs flex-1">
                                    {opt.label} – R$ {opt.price}
                                  </SelectItem>
                                  {!isDefaultProgram(opt.value) && (
                                    <>
                                      <button
                                        type="button"
                                        className="p-1 hover:bg-muted rounded"
                                        title="Editar"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingProgValue(opt.value);
                                          setNewProgLabel(opt.label);
                                          setNewProgPrice(String(opt.price));
                                          setNewProgType(opt.programa);
                                          setNewProgDuration(opt.duracao);
                                          setNewProgOpen(true);
                                        }}
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </button>
                                      <button
                                        type="button"
                                        className="p-1 hover:bg-destructive/10 text-destructive rounded"
                                        title="Arquivar (mantém histórico)"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          if (!confirm(`Arquivar "${opt.label}"?\n\nNão aparecerá em novas vendas, mas o histórico das alunas será mantido.`)) return;
                                          try {
                                            await archiveCustomProgram(opt.value);
                                            setAllPrograms((prev) => prev.filter((p) => p.value !== opt.value));
                                          } catch (err: any) {
                                            alert("Erro ao arquivar: " + (err.message || err));
                                          }
                                        }}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              ))}
                              <SelectItem value="__new__" className="text-xs font-semibold text-primary">
                                <span className="flex items-center gap-1"><Plus className="h-3 w-3" /> Novo Programa</span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        )
                      ) : (
                        <Minus className="h-4 w-4 text-muted-foreground mx-auto" />
                      )}
                    </TableCell>

                    {/* Payment Method */}
                    <TableCell>
                      {c.attended === true ? (
                        c.paymentMethod ? (
                          <Badge
                            variant="secondary"
                            className="text-[10px] cursor-pointer hover:opacity-70 px-1.5 py-0"
                            onClick={() => updateMutation.mutate({ id: c.id, paymentMethod: null })}
                            title="Clique para limpar"
                          >
                            {PAYMENT_OPTIONS.find((o) => o.value === c.paymentMethod)?.label || c.paymentMethod}
                            <X className="h-2.5 w-2.5 ml-0.5" />
                          </Badge>
                        ) : (
                          <Select
                            value=""
                            onValueChange={(value) => updateMutation.mutate({ id: c.id, paymentMethod: value || null })}
                          >
                            <SelectTrigger className="h-6 text-[10px] w-[90px]">
                              <SelectValue placeholder="Selecionar" />
                            </SelectTrigger>
                            <SelectContent>
                              {PAYMENT_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )
                      ) : (
                        <Minus className="h-4 w-4 text-muted-foreground mx-auto" />
                      )}
                    </TableCell>

                    {/* Signal Column */}
                    <TableCell>
                      {c.attended === true ? (
                        <Popover
                          open={popoverSignalOpen === c.id}
                          onOpenChange={(open) => setPopoverSignalOpen(open ? c.id : null)}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className={cn(
                                "h-7 px-2 gap-1.5 text-[10px]",
                                c.gaveSignal && "border-orange-500 text-orange-600 bg-orange-50"
                              )}
                            >
                              <Coins className="h-3 w-3" />
                              {c.gaveSignal ? `R$ ${c.signalValue}` : "Sinal"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-4 space-y-4" align="end">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">Aluna deu sinal</span>
                              <Switch
                                checked={!!c.gaveSignal}
                                onCheckedChange={(val) => updateMutation.mutate({ id: c.id, gaveSignal: val })}
                              />
                            </div>

                            {c.gaveSignal && (
                              <>
                                <div className="space-y-2">
                                  <label className="text-xs font-medium">Valor do Sinal (R$)</label>
                                  <Input
                                    type="number"
                                    placeholder="Ex: 150.00"
                                    className="h-8 text-sm"
                                    defaultValue={c.signalValue ?? ""}
                                    onBlur={(e) => {
                                      const val = parseFloat(e.target.value);
                                      if (!isNaN(val)) {
                                        updateMutation.mutate({ id: c.id, signalValue: val });
                                      }
                                    }}
                                  />
                                </div>

                                <div className="space-y-2">
                                  <label className="text-xs font-medium">Data para Cobrar Restante</label>
                                  <Popover
                                    open={calendarSignalOpen === c.id}
                                    onOpenChange={(open) => setCalendarSignalOpen(open ? c.id : null)}
                                  >
                                    <PopoverTrigger asChild>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="w-full justify-start text-left font-normal h-8 text-xs bg-orange-400 hover:bg-orange-500 text-white border-none"
                                      >
                                        <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                                        {c.signalFollowUpDate ? format(parseISO(c.signalFollowUpDate), "dd/MM/yyyy") : "Selecionar data"}
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                      <Calendar
                                        mode="single"
                                        selected={c.signalFollowUpDate ? parseISO(c.signalFollowUpDate) : undefined}
                                        onSelect={(date) => {
                                          if (date) {
                                            updateMutation.mutate({ id: c.id, signalFollowUpDate: format(date, "yyyy-MM-dd") });
                                            setCalendarSignalOpen(null);
                                          }
                                        }}
                                        locale={ptBR}
                                        initialFocus
                                      />
                                    </PopoverContent>
                                  </Popover>
                                </div>
                              </>
                            )}
                          </PopoverContent>
                        </Popover>
                      ) : (
                        <Minus className="h-4 w-4 text-muted-foreground mx-auto" />
                      )}
                    </TableCell>

                    {/* New Observation Column */}
                    <TableCell>
                      <Input
                        className="h-7 text-[10px] w-full"
                        placeholder="Nota..."
                        defaultValue={c.closerObservation || ""}
                        onBlur={(e) => {
                          if (e.target.value !== (c.closerObservation || "")) {
                            updateMutation.mutate({ id: c.id, closerObservation: e.target.value });
                          }
                        }}
                      />
                    </TableCell>

                    {/* Ações */}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Popover
                          open={editTimePopover === c.id}
                          onOpenChange={(open) => {
                            if (open) {
                              // Extract HH:mm from ISO timestamp
                              let startHHmm = "";
                              let endHHmm = "";
                              try {
                                if (c.startTime) startHHmm = format(parseISO(c.startTime), "HH:mm");
                              } catch { startHHmm = c.startTime || ""; }
                              try {
                                if (c.endTime) endHHmm = format(parseISO(c.endTime), "HH:mm");
                              } catch { endHHmm = c.endTime || ""; }
                              setTempStartTime(startHHmm);
                              setTempEndTime(endHHmm);
                              setTempDate(c.date);
                              setEditTimePopover(c.id);
                            } else {
                              setEditTimePopover(null);
                            }
                          }}
                        >
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                              <Clock className="h-4 w-4" />
                            </Button>
                          </PopoverTrigger>
                           <PopoverContent align="end" className="w-[220px] p-3 space-y-3">
                            <h4 className="font-medium text-sm">Remarcar Consulta</h4>
                            <div className="space-y-2">
                              <div className="flex flex-col gap-1">
                                <label className="text-xs text-muted-foreground">Data</label>
                                <Input
                                  type="date"
                                  value={tempDate}
                                  onChange={(e) => setTempDate(e.target.value)}
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs text-muted-foreground">Início</label>
                                {editIsLoadingSlots ? (
                                  <div className="h-8 flex items-center justify-center text-xs text-muted-foreground border rounded-md">Carregando...</div>
                                ) : editIsDayFull ? (
                                  <div className="h-8 flex items-center text-xs text-amber-600 font-medium px-2 border rounded-md bg-amber-50">Dia lotado</div>
                                ) : editAvailableSlots.length === 0 && tempDate ? (
                                  <div className="h-8 flex items-center text-xs text-muted-foreground px-2 border rounded-md bg-muted/50">Sem horários</div>
                                ) : (
                                  <Select value={tempStartTime} onValueChange={setTempStartTime}>
                                    <SelectTrigger className="h-8 text-sm">
                                      <SelectValue placeholder="Selecionar" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {editAvailableSlots.map((slot) => (
                                        <SelectItem key={slot} value={slot}>{slot}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              </div>
                            </div>
                            <Button size="sm" className="w-full h-8" onClick={() => handleSaveTime(c.id)}>
                              Salvar
                            </Button>
                          </PopoverContent>
                        </Popover>

                        {c.refunded ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-success hover:bg-success/10"
                            title="Reverter reembolso (pessoa voltou atrás)"
                            onClick={() => {
                              if (confirm(`Reverter reembolso de ${c.clientName}? Ela voltará a contar como convertida.`)) {
                                updateMutation.mutate({ id: c.id, refunded: false, deletionReason: null });
                              }
                            }}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        ) : null}

                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteDialog({ open: true, id: c.id, consultation: c })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {usePagination && sorted.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border/50 bg-muted/20">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  Mostrando <strong className="text-foreground">{(safePage - 1) * pageSize + 1}</strong>
                  –<strong className="text-foreground">{Math.min(safePage * pageSize, sorted.length)}</strong>
                  {" "}de <strong className="text-foreground">{sorted.length}</strong>
                </span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-7 w-[80px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)} className="text-xs">{n} / pág</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  ← Anterior
                </Button>
                <span className="text-xs text-muted-foreground px-2">
                  Página <strong className="text-foreground">{safePage}</strong> de <strong className="text-foreground">{totalPages}</strong>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                  Próxima →
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={unconvertDialog.open} onOpenChange={(open) => !open && setUnconvertDialog({ open: false, consultationId: null })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Confirmar Desconversão
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>Você está prestes a desmarcar esta aluna como <strong>Convertida</strong>.</p>
              <p className="font-medium text-foreground">Atenção: Isso removerá automaticamente o registro desta aluna na "Gestão de Alunas".</p>
              <p>Deseja autorizar esta ação?</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmUnconvert}
              className="bg-warning hover:bg-warning/90 text-warning-foreground"
            >
              Sim, autorizar e remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Consultation Alert */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => !open && setDeleteDialog({ open: false, id: null, consultation: null })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              {deleteDialog.consultation?.converted === true ? "Motivo da Exclusão" : "Opções do Lead"}
            </DialogTitle>
          </DialogHeader>

          {deleteDialog.consultation?.converted === true ? (
            <div className="py-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                Esta consulta foi convertida. Selecione o motivo da exclusão:
              </p>
              <div className="flex flex-col gap-3">
                <Button
                  variant="outline"
                  className="w-full justify-start h-14 px-4 bg-amber-50 hover:bg-amber-100 border-amber-200"
                  onClick={() => {
                    if (deleteDialog.id) {
                      deleteConsultationMutation.mutate(deleteDialog.id);
                      deleteAlunaMutation.mutate(deleteDialog.id);
                    }
                    setDeleteDialog({ open: false, id: null, consultation: null });
                  }}
                >
                  <div className="flex flex-col items-start text-left w-full">
                    <span className="font-medium text-amber-900 border-b border-amber-200/50 w-full pb-0.5 mb-0.5">Marcou Errado</span>
                    <span className="text-[10px] text-amber-700 font-normal">Exclui o lead e remove a aluna vinculada.</span>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="w-full justify-start h-14 px-4 bg-orange-50 hover:bg-orange-100 border-orange-200"
                  onClick={() => {
                    if (deleteDialog.id) {
                      deleteConsultationMutation.mutate(deleteDialog.id);
                      deleteAlunaMutation.mutate(deleteDialog.id);
                    }
                    setDeleteDialog({ open: false, id: null, consultation: null });
                  }}
                >
                  <div className="flex flex-col items-start text-left w-full">
                    <span className="font-medium text-orange-900 border-b border-orange-200/50 w-full pb-0.5 mb-0.5">Não Pagou</span>
                    <span className="text-[10px] text-orange-700 font-normal">Exclui o lead e remove a aluna vinculada.</span>
                  </div>
                </Button>

                <Button
                  variant="destructive"
                  className="w-full justify-start h-14 px-4"
                  onClick={() => {
                    if (deleteDialog.id) {
                      updateMutation.mutate({
                        id: deleteDialog.id,
                        refunded: true,
                        deletionReason: "reembolso",
                      });
                      deleteAlunaMutation.mutate(deleteDialog.id);
                    }
                    setDeleteDialog({ open: false, id: null, consultation: null });
                  }}
                >
                  <div className="flex flex-col items-start text-left w-full">
                    <span className="font-medium border-b border-white/20 w-full pb-0.5 mb-0.5">Reembolso</span>
                    <span className="text-[10px] text-white/80 font-normal">Mantém o registro para métricas (aba Reembolsadas).</span>
                  </div>
                </Button>
              </div>
            </div>
          ) : (
            <div className="py-4 space-y-4">
              <p className="text-sm text-slate-600">
                O que você deseja fazer com este lead?
              </p>
              <div className="flex flex-col gap-3">
                <Button 
                  variant="outline" 
                  className="w-full justify-start h-14 px-4 text-slate-700 bg-amber-50 hover:bg-amber-100 border-amber-200"
                  onClick={() => {
                    if (deleteDialog.id) {
                      updateMutation.mutate({ 
                        id: deleteDialog.id, 
                        is_future_reschedule: true,
                        date: format(new Date(), "yyyy-MM-dd"),
                      });
                    }
                    setDeleteDialog({ open: false, id: null, consultation: null });
                  }}
                >
                  <div className="flex flex-col items-start text-left w-full">
                    <span className="font-medium text-amber-900 border-b border-amber-200/50 w-full pb-0.5 mb-0.5">Deixar para Reagendamento Futuro</span>
                    <span className="text-[10px] text-amber-700 font-normal">Sinaliza o lead para reagendar posteriormente.</span>
                  </div>
                </Button>

                <Button 
                  variant="outline" 
                  className="w-full justify-start h-14 px-4 text-slate-700 bg-rose-50 hover:bg-rose-100 border-rose-200"
                  onClick={() => {
                    if (deleteDialog.id) {
                      updateMutation.mutate({
                        id: deleteDialog.id,
                        lowIncome: true,
                      });
                    }
                    setDeleteDialog({ open: false, id: null, consultation: null });
                  }}
                >
                  <div className="flex flex-col items-start text-left w-full">
                    <span className="font-medium text-rose-900 border-b border-rose-200/50 w-full pb-0.5 mb-0.5">Renda &lt; R$ 2K</span>
                    <span className="text-[10px] text-rose-700 font-normal">Move o lead para o card "Renda &lt; R$ 2K".</span>
                  </div>
                </Button>

                <Button 
                  variant="outline" 
                  className="w-full justify-start h-14 px-4 text-slate-700 bg-rose-50 hover:bg-rose-100 border-rose-200"
                  onClick={() => {
                    if (deleteDialog.id) {
                      updateMutation.mutate({ 
                        id: deleteDialog.id, 
                        is_incomplete_flow: true,
                      });
                    }
                    setDeleteDialog({ open: false, id: null, consultation: null });
                  }}
                >
                  <div className="flex flex-col items-start text-left w-full">
                    <span className="font-medium text-rose-900 border-b border-rose-200/50 w-full pb-0.5 mb-0.5">Sinalizar Fluxo Incompleto</span>
                    <span className="text-[10px] text-rose-700 font-normal">Lead parou no meio e não enviou WhatsApp.</span>
                  </div>
                </Button>
                
                <Button 
                  variant="destructive" 
                  className="w-full justify-start h-14 px-4"
                  onClick={confirmDeleteConsultation}
                >
                  <div className="flex flex-col items-start text-left w-full">
                    <span className="font-medium border-b border-white/20 w-full pb-0.5 mb-0.5">Apagar Definitivo</span>
                    <span className="text-[10px] text-white/80 font-normal">Exclui permanentemente do banco de dados.</span>
                  </div>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog Novo/Editar Programa */}
      <Dialog open={newProgOpen} onOpenChange={(o) => { setNewProgOpen(o); if (!o) setEditingProgValue(null); }}>
        <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{editingProgValue ? "Editar Programa" : "Criar Novo Programa"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome do Programa *</Label>
              <Input value={newProgLabel} onChange={(e) => setNewProgLabel(e.target.value)} placeholder="Ex: SLIM 3M" disabled={!!editingProgValue} />
              {editingProgValue && <p className="text-[10px] text-muted-foreground mt-1">O nome não pode ser alterado (usado como identificador).</p>}
            </div>
            <div>
              <Label>Valor (R$) *</Label>
              <Input type="number" min="0" step="0.01" value={newProgPrice} onChange={(e) => setNewProgPrice(e.target.value)} placeholder="Ex: 997" />
            </div>
            <div>
              <Label>Tipo de Programa</Label>
              <Select value={newProgType} onValueChange={(v) => setNewProgType(v as ProgramType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PROGRAM_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Duração</Label>
              <Select value={newProgDuration} onValueChange={(v) => setNewProgDuration(v as PlanDuration)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DURATION_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => { setNewProgOpen(false); setEditingProgValue(null); }}>Cancelar</Button>
            <Button
              disabled={!newProgLabel.trim() || !newProgPrice || newProgSaving}
              onClick={async () => {
                setNewProgSaving(true);
                try {
                  if (editingProgValue) {
                    await updateCustomProgram(editingProgValue, {
                      price: parseFloat(newProgPrice),
                      programa: newProgType,
                      duracao: newProgDuration,
                    });
                    setAllPrograms((prev) => prev.map((p) => p.value === editingProgValue ? { ...p, price: parseFloat(newProgPrice), programa: newProgType, duracao: newProgDuration } : p));
                  } else {
                    const normalizedValue = normalizeProgramValue(newProgLabel.trim());
                    const alreadyExists = allPrograms.some((program) => program.value === normalizedValue);
                    if (alreadyExists) {
                      alert("Esse programa já existe na lista.");
                      setNewProgSaving(false);
                      return;
                    }
                    const created = await addCustomProgram({
                      label: newProgLabel.trim(),
                      price: parseFloat(newProgPrice),
                      programa: newProgType,
                      duracao: newProgDuration,
                    });
                    setAllPrograms((prev) => prev.some((program) => program.value === created.value) ? prev : [...prev, created]);
                  }
                  setNewProgOpen(false);
                  setEditingProgValue(null);
                  setNewProgLabel("");
                  setNewProgPrice("");
                  setNewProgType("consultoria_slim");
                  setNewProgDuration("1");
                } catch (err: any) {
                  console.error("Erro ao salvar programa:", err);
                  alert(err?.code === "23505" ? "Esse programa já existe na lista." : "Erro: " + (err.message || err));
                } finally {
                  setNewProgSaving(false);
                }
              }}
            >
              {newProgSaving ? "Salvando..." : (editingProgValue ? "Salvar" : "Criar Programa")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <LeadFormResponsesDialog
        open={formResponseDialog.open}
        onOpenChange={(open) => setFormResponseDialog((prev) => ({ ...prev, open }))}
        clientName={formResponseDialog.name}
        clientPhone={formResponseDialog.phone}
      />

      <QuemConfirmouDialog
        aberto={confirmandoId !== null}
        nomeLead={confirmandoNome}
        onCancelar={() => setConfirmandoId(null)}
        onEscolher={(userId) => {
          if (confirmandoId) {
            updateMutation.mutate({ id: confirmandoId, callConfirmed: true, confirmedByUserId: userId });
          }
          setConfirmandoId(null);
        }}
      />
    </>
  );
}
