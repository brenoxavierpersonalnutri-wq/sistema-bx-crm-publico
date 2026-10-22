import { useState, useEffect, useCallback } from "react";
import { format, startOfDay, addDays, isAfter, isSameMonth, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Clock, CalendarHeart, Loader2 } from "lucide-react";
import { inferBookingVia } from "@/lib/funnelClassification";
import { captureUtmsFromUrl, getAllUtms } from "@/lib/utmCapture";
import { iniciarEventosDoRotador } from "@/lib/rotatorEventos";
import { melhorNome } from "@/lib/nomeCompleto";
import { CHAVE_WHATSAPP_DO_TIME, WHATSAPP_DO_TIME_PADRAO, whatsappDoTime } from "@/lib/destinoDasLeads";
import {
  diaLotado,
  horariosLivres,
  precisaTrocarDeMes,
  temVaga,
  type InfoDeAgenda,
} from "@/lib/agendaDisponibilidade";

// Format date for calendar links in Brasília timezone (no UTC conversion)
const formatLocalDateTime = (date: Date, time: string): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const [h, m] = time.split(":");
  return `${year}${month}${day}T${h}${m}00`;
};

const WINDOW_SIZE = 7; // janela padrão: 7 dias. Se lotar, libera mais 7.

// Lead pode agendar a partir de amanhã, a qualquer hora do dia (sem corte de 12h)
const getMinBookableDate = (): Date => addDays(startOfDay(new Date()), 1);

/**
 * O tipo gerado do RPC descreve os campos de configuracao como `Json` solto.
 * Aqui eles viram a forma que a regra de disponibilidade espera, num lugar so
 * em vez de tres conversoes espalhadas.
 */
const comoInfoDeAgenda = (linha: unknown): InfoDeAgenda => linha as InfoDeAgenda;

export default function AgendarPublic() {
  const [searchParams] = useSearchParams();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [isAutoSelecting, setIsAutoSelecting] = useState(true);
  
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [maxDailyBookings, setMaxDailyBookings] = useState(12);
  const [isDayFull, setIsDayFull] = useState(false);
  
  // Janela visível no calendário em dias a partir de hoje.
  // Começa em WINDOW_SIZE (7). Se a janela lotar, expande +7, e assim por diante.
  const [maxVisibleDays, setMaxVisibleDays] = useState(WINDOW_SIZE);

  // Dias da janela que ainda tem horario livre, em "yyyy-MM-dd". Sao eles que
  // aparecem em negrito: sem isso, a pessoa clica de dia em dia procurando
  // qual sobrou — e no fim do mes, com a janela caindo no mes seguinte, a tela
  // parece morta.
  const [diasComVaga, setDiasComVaga] = useState<Set<string>>(new Set());

  // Mes que o calendario mostra. Controlado porque a janela reservavel comeca
  // amanha: no dia 30, tudo que da pra marcar esta em outubro, e abrir em
  // setembro mostra um mes inteiro apagado.
  const [mesVisivel, setMesVisivel] = useState<Date>(() => getMinBookableDate());

  // A janela reservável vai de amanhã até hoje + maxVisibleDays. Se esses dois
  // extremos caem em meses diferentes, o calendário precisa mostrar os dois.
  const janelaAtravessaOMes = !isSameMonth(
    getMinBookableDate(),
    addDays(startOfDay(new Date()), maxVisibleDays),
  );


  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [bookedConsultationId, setBookedConsultationId] = useState<string | null>(null);
  const [formResponse, setFormResponse] = useState<any | null>(null);
  const [sdrPhone, setSdrPhone] = useState(WHATSAPP_DO_TIME_PADRAO);

  // Fim do funil das versões /avaliacao/vN: com o cm_click do rotador na URL,
  // manda o pageview que a regra "URL contém agendar" conta como conversão.
  // Sem cm_click (todo o resto do tráfego do /agendar) não faz nada.
  useEffect(() => iniciarEventosDoRotador(), []);

  // Número do time, configurável na tela da agenda (app_settings).
  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", CHAVE_WHATSAPP_DO_TIME)
      .maybeSingle()
      .then(({ data }) => setSdrPhone(whatsappDoTime(data?.value)));
  }, []);



  // Helper to read cookie
  const getCookie = (name: string): string | null => {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  };

  // Helper to set cookie on root domain for cross-subdomain sharing
  const setCookie = (name: string, value: string, days: number) => {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    const parts = window.location.hostname.split('.');
    const domain = parts.length >= 3 ? '.' + parts.slice(-3).join('.') : parts.length === 2 ? '.' + parts.join('.') : window.location.hostname;
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;domain=${domain};SameSite=Lax`;
  };

  // Nome/telefone: URL primeiro; se o parâmetro se perdeu (refresh/redirect), recupera do cookie/sessionStorage
  const urlLeadName = searchParams.get("nome") || searchParams.get("name") || searchParams.get("Nome completo");
  const urlLeadPhone = searchParams.get("whatsapp") || searchParams.get("telefone") || searchParams.get("phone");
  const leadName = urlLeadName || getCookie("ft_lead_name") || sessionStorage.getItem("ft_lead_name") || "Futura Aluna";
  const leadPhone = urlLeadPhone || getCookie("ft_lead_phone") || sessionStorage.getItem("ft_lead_phone") || "Não informado";
  const isIndividual = (searchParams.get("origem") || "").toLowerCase().includes("individual");

  // Gate: bloqueia acesso sem score — redireciona pro formulário
  useEffect(() => {
    const scoreParam = searchParams.get('score');
    const via = (searchParams.get('via') || searchParams.get('origem') || '').toLowerCase();
    const isInternalVia = ['indicacao', 'acompanhamento-individual', 'acompanhamento_individual'].some(v => via.includes(v));
    if (!isInternalVia && (scoreParam === null || isNaN(parseInt(scoreParam, 10)))) {
      window.location.replace('https://novaav.brenoxavier.com.br');
    }
  }, [searchParams]);

  // On mount: persist UTMs + nome/telefone from URL into cookies AND sessionStorage
  useEffect(() => {
    // UTMs como conjunto (lib/utmCapture): URL com qualquer utm_* regrava o
    // conjunto inteiro e apaga os campos que não vieram.
    captureUtmsFromUrl("?" + searchParams.toString());
    if (urlLeadName) {
      sessionStorage.setItem('ft_lead_name', urlLeadName);
      setCookie('ft_lead_name', urlLeadName, 30);
    }
    if (urlLeadPhone) {
      sessionStorage.setItem('ft_lead_phone', urlLeadPhone);
      setCookie('ft_lead_phone', urlLeadPhone, 30);
    }
    console.log('[Agendar] UTM debug on mount:', {
      url_utm_source: searchParams.get('utm_source'),
      url_utm_campaign: searchParams.get('utm_campaign'),
      utm_set: getAllUtms("?" + searchParams.toString()),
      all_cookies: document.cookie,
    });
  }, [searchParams]);

  // Fetch most recent form response for this lead (by phone) to include all answers in WhatsApp message
  useEffect(() => {
    const fetchLatestResponse = async () => {
      const phoneDigits = (leadPhone || "").replace(/\D/g, "");
      if (phoneDigits.length < 8) return;
      const tail = phoneDigits.slice(-9);
      const { data } = await supabase
        .from("lead_form_responses")
        .select("*")
        .ilike("telefone", `%${tail}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setFormResponse(data);
    };
    fetchLatestResponse();
  }, [leadPhone]);

  const fetchAvailability = useCallback(async (date: Date) => {
    setIsLoadingSlots(true);
    const dateStr = format(date, "yyyy-MM-dd");

    const { data, error } = await supabase.rpc("get_public_booking_info", { p_date: dateStr });

    if (!error && data && data.length > 0) {
      const info = comoInfoDeAgenda(data[0]);
      setMaxDailyBookings(info.max_daily_bookings ?? 12);
      setIsDayFull(diaLotado(info));
      // Ja vem filtrado: os horarios que a pessoa consegue clicar, pela mesma
      // regra que decide o negrito no calendario.
      setAvailableSlots(horariosLivres(info, date));
    } else {
      setAvailableSlots([]);
      setIsDayFull(false);
      if (error) console.error("Failed to load availability", error, data);
    }

    setIsLoadingSlots(false);
  }, []);

  useEffect(() => {
    if (!selectedDate) return;

    setSelectedTime(null);
    fetchAvailability(selectedDate);

    // A cada 5s pra pegar horário que alguém acabou de reservar — mas só com a
    // aba à vista. Aba de fundo esquecida aberta consultava o banco 12 vezes por
    // minuto sem ninguém olhando.
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetchAvailability(selectedDate);
    }, 5000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchAvailability(selectedDate);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      setSelectedTime(null);
    };
  }, [fetchAvailability, selectedDate]);

  // Varre a janela reservavel pra saber quais dias ainda tem horario livre.
  // E uma chamada por dia — a mesma que a tela ja fazia uma a uma na escolha
  // automatica —, so que de uma vez, e refeita apenas quando a janela expande.
  useEffect(() => {
    let cancelado = false;

    const carregarDiasComVaga = async () => {
      const primeiro = getMinBookableDate();
      const dias = Array.from({ length: maxVisibleDays }, (_, i) => addDays(primeiro, i));

      const encontrados = await Promise.all(
        dias.map(async (dia) => {
          const { data, error } = await supabase.rpc("get_public_booking_info", {
            p_date: format(dia, "yyyy-MM-dd"),
          });
          if (error || !data || data.length === 0) return null;
          return temVaga(comoInfoDeAgenda(data[0]), dia) ? format(dia, "yyyy-MM-dd") : null;
        }),
      );

      if (cancelado) return;
      setDiasComVaga(new Set(encontrados.filter((d): d is string => d !== null)));
    };

    void carregarDiasComVaga();
    return () => {
      cancelado = true;
    };
  }, [maxVisibleDays]);

  // A escolha automática pode cair num mês que já está à vista — e aí mexer no
  // calendário só atrapalha: na virada do mês ele pulava para o mês seguinte e
  // escondia os dias reserváveis que ainda restavam no mês atual.
  useEffect(() => {
    if (!selectedDate) return;
    if (!precisaTrocarDeMes(mesVisivel, selectedDate, janelaAtravessaOMes)) return;
    setMesVisivel(startOfMonth(selectedDate));
  }, [selectedDate, mesVisivel, janelaAtravessaOMes]);

  useEffect(() => {
    const autoSelectNextAvailable = async () => {
      let dateToTest = getMinBookableDate();
      let found = false;
      // Controle de janelas: cada janela tem WINDOW_SIZE dias.
      // Se a janela atual lotar inteira, expande +WINDOW_SIZE e mostra no calendário.
      let currentMaxVisible = WINDOW_SIZE; // dias visíveis a partir de hoje
      let currentWindowEnd = addDays(startOfDay(new Date()), currentMaxVisible);
      const maxWindows = 4; // tenta no máximo 4 janelas (28 dias no total)
      let windowsExpanded = 0;
      const absoluteMax = WINDOW_SIZE * maxWindows;
      let daysChecked = 0;

      while (!found && daysChecked < absoluteMax) {
        const dateStr = format(dateToTest, "yyyy-MM-dd");
        const { data, error } = await supabase.rpc("get_public_booking_info", { p_date: dateStr });

        if (!error && data && data.length > 0) {
          if (horariosLivres(comoInfoDeAgenda(data[0]), dateToTest).length > 0) {
            found = true;
            setSelectedDate(dateToTest);
            setIsAutoSelecting(false);
            return;
          }
        }

        const nextDay = addDays(dateToTest, 1);

        // Terminou a janela atual sem achar slot disponível → expande +WINDOW_SIZE
        if (
          windowsExpanded < maxWindows - 1 &&
          isAfter(startOfDay(nextDay), currentWindowEnd)
        ) {
          windowsExpanded++;
          currentMaxVisible += WINDOW_SIZE;
          currentWindowEnd = addDays(startOfDay(new Date()), currentMaxVisible);
          setMaxVisibleDays(currentMaxVisible); // calendário exibe mais datas
        }

        dateToTest = nextDay;
        daysChecked++;
      }

      setSelectedDate(getMinBookableDate());
      setIsAutoSelecting(false);
    };

    if (!selectedDate && isAutoSelecting) {
      autoSelectNextAvailable();
    }
  }, []); // Run once on mount if we are auto-selecting and have no date

  const handleBooking = async () => {
    if (!selectedDate) return;
    if (!selectedTime || selectedTime.trim() === "") {
      alert("Por favor, selecione um horário para prosseguir com o agendamento.");
      return;
    }
    
    setIsSubmitting(true);
    const dateStr = format(selectedDate, "yyyy-MM-dd");

    try {
      // UTMs como CONJUNTO (lib/utmCapture): se a URL trouxer qualquer utm_*,
      // vale só a URL (campo ausente = vazio); senão, o conjunto guardado.
      // Nunca mistura campo da URL com campo de cookie antigo.
      const utmSet = getAllUtms("?" + searchParams.toString());
      const getUtm = (key: keyof typeof utmSet) => (utmSet[key] || "").toLowerCase();

      const utmSource = getUtm('utm_source');
      const utmCampaign = getUtm('utm_campaign');
      const utmMedium = getUtm('utm_medium');
      const utmContent = getUtm('utm_content');
      const utmTerm = getUtm('utm_term');
      const paramOrigem = (searchParams.get('origem') || searchParams.get('via') || "").toLowerCase();
      const funnelOption = inferBookingVia({
        utmSource,
        utmCampaign,
        utmMedium,
        utmContent,
        utmTerm,
        origem: paramOrigem,
        isIndividual,
      });

      console.log('[Agendar] Booking UTM data:', { utmSource, utmCampaign, utmMedium, utmContent, utmTerm, paramOrigem, funnelOption });

      const scoreParam = searchParams.get('score');
      const leadScore = scoreParam ? parseInt(scoreParam, 10) : null;

      // O nome que ela escreveu em "Qual seu nome completo?" vale mais que o do
      // link: o link chega sem nome em alguns caminhos e a consulta nasce como
      // "Futura Aluna" — e esse nome segue pro monitoramento de consulta e pra
      // ficha dela quando vira aluna.
      const nomeDaConsulta = melhorNome(leadName, formResponse?.nome);

      const { data: bookedId, error } = await supabase.rpc("book_public_consultation_v2", {
        p_client_name: nomeDaConsulta,
        p_client_phone: leadPhone,
        p_date: dateStr,
        p_time: selectedTime,
        p_funnel: funnelOption,
        p_utm_source: utmSource || null,
        p_utm_campaign: utmCampaign || null,
        p_utm_medium: utmMedium || null,
        p_utm_content: utmContent || null,
        p_utm_term: utmTerm || null,
        p_lead_score: (leadScore && !isNaN(leadScore)) ? leadScore : null,
      });

      if (error) throw error;

      if (bookedId) {
        setBookedConsultationId(bookedId as string);
        // Amarra a resposta do formulário nesta consulta. Com o vínculo por ID,
        // o Banco de Dados não precisa adivinhar por telefone/nome pra saber
        // que a lead agendou. Falha aqui não pode atrapalhar o agendamento.
        // A LP unificada manda o ID na URL. A LP antiga não manda, mas esta
        // tela já carregou a resposta mais recente pelo WhatsApp para montar
        // a mensagem; usa esse fallback para não perder o vínculo.
        const formResponseId = searchParams.get("form_response_id") || searchParams.get("rid") || formResponse?.id;
        if (formResponseId) {
          supabase
            .rpc("link_form_response_to_consultation", {
              p_form_response_id: formResponseId,
              p_consultation_id: bookedId as string,
            })
            .then(({ error: linkErr }) => {
              if (linkErr) console.warn("Falha ao vincular formulário à consulta:", linkErr);
            });
        }
      }
      setIsSuccess(true);
    } catch (err: any) {
      console.error("Erro ao agendar:", err);
      alert(`Houve um erro ao agendar: ${err.message || JSON.stringify(err)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getWhatsAppLink = () => {
    let message = isIndividual
      ? `Olá! Fui qualificada e tenho interesse na *Consultoria Individual*! 🎉\n\n`
      : `Olá! Fui qualificada no formulário de avaliação! 🎉\n\n`;
    message += `*Horário Agendado:*\n📅 ${format(selectedDate!, "dd/MM/yyyy")} às 🕒 ${selectedTime}\n\n`;
    message += `*Nome:* ${leadName}\n`;
    message += `*WhatsApp:* ${leadPhone}\n\n`;
    message += `*Minhas respostas:*\n\n`;

    const r = formResponse;
    if (r) {
      const labels: Record<string, { q: string; opts?: Record<string, string> }> = {
        p1_objetivo: { q: "1. Objetivo principal", opts: { emagrecer: "Emagrecer", perder_gordura_definir: "Perder gordura e definir", definido_slim: "Ficar definido / slim", volume_muscular: "Ganhar volume muscular" } },
        p2_situacao: { q: "2. Situação atual" },
        p3_profissao: { q: "3. Profissão" },
        p5_estrategias: { q: "5. Sobre estratégias anteriores", opts: { nao_entregam: "Não entregam o que prometem", demoro_muito: "Demoro muito para ver resultado", consigo_resultado: "Consigo resultado sozinho(a)" } },
        p6_caneta: { q: "6. Caneta emagrecedora", opts: { uso_atual: "Uso atualmente", ja_usei: "Já usei", nunca_usei: "Nunca usei" } },
        p7_acompanhamento: { q: "7. Já teve acompanhamento", opts: { nutricional: "Nutricional", treino: "Treino", ambos: "Ambos", nunca: "Nunca tive" } },
        p8_investimento: { q: "8. Quanto já investiu por mês", opts: { abaixo_100: "Abaixo de R$ 100", "100_250": "R$ 100 - 250", "250_400": "R$ 250 - 400", "400_600": "R$ 400 - 600", "600_1000": "R$ 600 - 1000", acima_1000: "Acima de R$ 1000" } },
        p9_prioridade: { q: "9. Prioridade para começar", opts: { imediato: "Quero começar imediatamente", futuramente: "Futuramente", pensar: "Ainda preciso pensar" } },
      };
      const fmt = (k: string, v: any) => {
        if (!v) return "—";
        const o = labels[k]?.opts;
        return o?.[v] ?? String(v);
      };
      ["p1_objetivo", "p2_situacao", "p3_profissao"].forEach(k => {
        message += `*${labels[k].q}*\n${fmt(k, r[k])}\n\n`;
      });
      message += `*4. Dados físicos*\nAltura: ${r.p4_altura ?? "—"} cm\nPeso: ${r.p4_peso ?? "—"} kg\nIdade: ${r.p4_idade ?? "—"} anos\n\n`;
      ["p5_estrategias", "p6_caneta", "p7_acompanhamento", "p8_investimento", "p9_prioridade"].forEach(k => {
        message += `*${labels[k].q}*\n${fmt(k, r[k])}\n\n`;
      });
      // Score/nível são dados internos do funil — não vão na mensagem da SDR.
      // Continuam salvos em lead_form_responses pra consulta interna.
    } else {
      // Fallback: usa parâmetros da URL (caso o formResponse ainda não tenha sido carregado)
      searchParams.forEach((value, key) => {
        if (!key.startsWith("utm_") && !key.startsWith("cm_") && key !== "origem" && key !== "score") {
          message += `*${key}*\n${value}\n\n`;
        }
      });
    }

    return `https://api.whatsapp.com/send?phone=${sdrPhone}&text=${encodeURIComponent(message)}`;
  };

  const getGoogleCalendarUrl = () => {
    if (!selectedDate || !selectedTime) return "#";
    const startStr = formatLocalDateTime(selectedDate, selectedTime);
    const [h, m] = selectedTime.split(":").map(Number);
    const endMinutes = h * 60 + m + 30;
    const endH = String(Math.floor(endMinutes / 60)).padStart(2, '0');
    const endM = String(endMinutes % 60).padStart(2, '0');
    const endStr = formatLocalDateTime(selectedDate, `${endH}:${endM}`);
    
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=Avalia%C3%A7%C3%A3o+Individual&dates=${startStr}/${endStr}&ctz=America/Sao_Paulo&details=Sua+avalia%C3%A7%C3%A3o+est%C3%A1+confirmada.`;
  };

  const getIcsFile = () => {
    if (!selectedDate || !selectedTime) return "#";
    const startStr = formatLocalDateTime(selectedDate, selectedTime);
    const [h, m] = selectedTime.split(":").map(Number);
    const endMinutes = h * 60 + m + 30;
    const endH = String(Math.floor(endMinutes / 60)).padStart(2, '0');
    const endM = String(endMinutes % 60).padStart(2, '0');
    const endStr = formatLocalDateTime(selectedDate, `${endH}:${endM}`);
    
    const icsContent = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nURL:https://equipe.brenoxavier.com.br\nDTSTART;TZID=America/Sao_Paulo:${startStr}\nDTEND;TZID=America/Sao_Paulo:${endStr}\nSUMMARY:Avaliação Individual\nDESCRIPTION:Sua avaliação está confirmada.\nLOCATION:WhatsApp\nEND:VEVENT\nEND:VCALENDAR`;
    return `data:text/calendar;charset=utf8,${encodeURIComponent(icsContent)}`;
  };

  const handleAddCalendar = () => {
    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
    const isApple = /iPad|iPhone|iPod|Mac/.test(userAgent) && !(window as any).MSStream;
    
    if (isApple) {
      const link = document.createElement('a');
      link.href = getIcsFile();
      link.download = "avaliacao.ics";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      window.open(getGoogleCalendarUrl(), "_blank");
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-xl border-primary/20">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 bg-success/20 rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 className="w-10 h-10 text-success" />
            </div>
            <CardTitle className="text-2xl text-primary">Agendamento Confirmado!</CardTitle>
            <CardDescription className="text-base text-slate-800 pt-2">
              Seu horário para <strong>{format(selectedDate!, "dd/MM/yyyy")} às {selectedTime}</strong> foi reservado com sucesso.
            </CardDescription>

            <div className="flex flex-col items-center justify-center pt-4">
              <span className="text-xs font-bold text-slate-500 mb-2">ADICIONAR LEMBRETE:</span>
              <Button 
                variant="outline" 
                className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 w-full sm:w-auto" 
                onClick={handleAddCalendar}
              >
                <CalendarHeart className="w-4 h-4 mr-2" /> Adicionar ao Calendário
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 flex flex-col items-center text-center">
            <p className="text-sm font-bold text-slate-800 mt-4 leading-relaxed max-w-sm mx-auto uppercase">
              Agora é necessário enviar suas fotos no whatsapp para realizarmos a sua avaliação individual
            </p>
            
            <Button 
              size="lg" 
              className="w-full h-14 text-lg bg-[#25D366] hover:bg-[#1DA851] text-white shadow-lg shadow-[#25d366]/30 group"
              onClick={(e) => {
                const url = getWhatsAppLink();
                // Marca via fetch com keepalive — garantido pelo browser mesmo se a página sair.
                // Fallback com sendBeacon caso o keepalive falhe.
                if (bookedConsultationId) {
                  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
                  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
                  const endpoint = `${supabaseUrl}/rest/v1/rpc/mark_whatsapp_clicked`;
                  const body = JSON.stringify({ p_consultation_id: bookedConsultationId });
                  try {
                    fetch(endpoint, {
                      method: "POST",
                      keepalive: true,
                      headers: {
                        "Content-Type": "application/json",
                        apikey: anonKey,
                        Authorization: `Bearer ${anonKey}`,
                      },
                      body,
                    }).catch(() => {
                      // fallback
                      try {
                        const blob = new Blob([body], { type: "application/json" });
                        navigator.sendBeacon(`${endpoint}?apikey=${anonKey}`, blob);
                      } catch { /* ignora */ }
                    });
                  } catch {
                    try {
                      const blob = new Blob([body], { type: "application/json" });
                      navigator.sendBeacon(`${endpoint}?apikey=${anonKey}`, blob);
                    } catch { /* ignora */ }
                  }
                }
                // Abre em nova aba: preserva a página atual (e a request em voo) e evita bloqueio de popup por ser síncrono no click.
                window.open(url, "_blank", "noopener");
              }}
            >
              Concluir no WhatsApp
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex py-12 px-4 justify-center">
      <div className="w-full max-w-4xl grid md:grid-cols-[1fr_350px] gap-8">
        
        {/* Lado Esquerdo - Info da Consulta */}
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-primary tracking-tight">Agende sua Avaliação</h1>
            <p className="text-slate-500 mt-2 text-lg">
              Parabéns <strong>{leadName}</strong>, você foi qualificada! Agora só falta escolher o melhor horário para falarmos com você.
            </p>
          </div>
          
          <Card className="border-none shadow-md">
            <CardContent className="p-0 sm:flex">
              <div className="p-6 sm:border-r border-slate-100 flex-1">
                <div className="flex items-center gap-2 font-semibold text-lg flex-wrap mb-4 text-slate-700">
                  <CalendarHeart className="w-5 h-5 text-primary" />
                  <span>Selecione o Dia</span>
                  {isAutoSelecting && <Loader2 className="w-4 h-4 animate-spin text-primary/50 ml-2" />}
                </div>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  locale={ptBR}
                  month={mesVisivel}
                  onMonthChange={setMesVisivel}
                  // Quando a janela reservável atravessa a virada do mês, os dois
                  // meses aparecem juntos. No fim do mês quase tudo que dá pra
                  // marcar está no mês seguinte, e mostrar só o atual deixava a
                  // tela com um calendário inteiro apagado.
                  numberOfMonths={janelaAtravessaOMes ? 2 : 1}
                  classNames={{ months: "flex flex-col gap-6" }}
                  modifiers={{ comVaga: (date) => diasComVaga.has(format(date, "yyyy-MM-dd")) }}
                  // "!" porque o componente base marca todo dia como font-normal,
                  // e classe utilitária de mesma especificidade vence por ordem no
                  // CSS — sem isto a classe entrava no elemento e o peso continuava 400.
                  modifiersClassNames={{ comVaga: "!font-bold" }}
                  disabled={(date) => {
                    const d = startOfDay(date);
                    if (d < getMinBookableDate()) return true;
                    // Bloqueia datas além da janela atual (expande +7 automaticamente quando lota)
                    if (isAfter(d, addDays(startOfDay(new Date()), maxVisibleDays))) return true;
                    return false;
                  }}
                  className="rounded-md mx-auto w-full pb-0"
                />
                <p className="mt-2 text-center text-xs text-slate-500">
                  Em <span className="font-bold text-slate-700">negrito</span>, os dias com horário livre.
                </p>
              </div>

              {selectedDate && (
                <div className="p-6 bg-slate-50/50 sm:w-64">
                  <div className="flex items-center gap-2 font-semibold text-lg mb-4 text-slate-700">
                    <Clock className="w-5 h-5 text-primary" />
                    Horários
                  </div>
                  
                  {isLoadingSlots ? (
                    <div className="py-8 flex justify-center text-primary/50"><Loader2 className="w-6 h-6 animate-spin" /></div>
                  ) : isDayFull ? (
                    <div className="py-6 text-center text-sm text-amber-600 font-medium">
                      Dia lotado! Máximo de {maxDailyBookings} reuniões atingido. Escolha outro dia.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                      {availableSlots.map((time) => {
                        const isSelected = selectedTime === time;

                        return (
                          <Button
                            key={time}
                            variant={isSelected ? "default" : "outline"}
                            className={`w-full justify-center ${
                              isSelected ? 'bg-primary text-white shadow-md' : 'hover:border-primary/50'
                            }`}
                            onClick={() => setSelectedTime(time)}
                          >
                            {time}
                          </Button>
                        );
                      })}
                      {availableSlots.length === 0 && (
                        <div className="col-span-full py-6 text-center text-sm text-slate-500">
                          Nenhum horário disponível para esta data.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Lado Direito - Resumo */}
        <div className="sticky top-6 h-fit">
          <Card className="shadow-lg border-primary/20 overflow-hidden">
            <div className="h-2 bg-primary w-full" />
            <CardHeader className="bg-slate-50 border-b border-slate-100">
              <CardTitle className="text-xl">Resumo</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-3">
                <div className="flex gap-3 items-start">
                  <CalendarHeart className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-sm font-medium text-slate-500">Data</h4>
                    <p className="font-semibold text-slate-900">
                      {selectedDate ? format(selectedDate, "EEEE, dd 'de' MMMM", { locale: ptBR }) : "Nenhuma data"}
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-3 items-start">
                  <Clock className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-sm font-medium text-slate-500">Horário</h4>
                    <p className="font-semibold text-slate-900">
                      {selectedTime ? `${selectedTime} (Horário de Brasília)` : "Nenhum horário"}
                    </p>
                    {selectedTime && (
                      <p className="text-sm text-slate-500 mt-1 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" /> Duração: 30 minutos
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-100">
                <Button 
                  size="lg" 
                  className="w-full shadow-md" 
                  disabled={!selectedDate || isSubmitting}
                  onClick={handleBooking}
                >
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Confirmar Agendamento"}
                </Button>
                <p className="text-xs text-center text-slate-400 mt-3 px-2">
                  Você será redirecionada(o) ao WhatsApp para finalizar o envio das suas respostas da avaliação.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
