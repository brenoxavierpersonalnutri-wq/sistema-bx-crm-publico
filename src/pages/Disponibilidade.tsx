import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, Plus, Trash2, Save, ArrowLeft, CalendarIcon, Copy, Users } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Json } from "@/integrations/supabase/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DestinoDasLeads } from "@/components/DestinoDasLeads";
import { GrupoDasDesqualificadas } from "@/components/GrupoDasDesqualificadas";

// Type definitions
export interface TimeRange {
  start: string;
  end: string;
}

export type WeeklyAvailability = Record<string, TimeRange[]>;
export type OverrideAvailability = Record<string, TimeRange[]>;

const DAYS_OF_WEEK = [
  { id: "0", label: "Domingo", short: "DOM" },
  { id: "1", label: "Segunda", short: "SEG" },
  { id: "2", label: "Terça", short: "TER" },
  { id: "3", label: "Quarta", short: "QUA" },
  { id: "4", label: "Quinta", short: "QUI" },
  { id: "5", label: "Sexta", short: "SEX" },
  { id: "6", label: "Sábado", short: "SÁB" },
];

export default function Disponibilidade() {
  const { user, isAdmin } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [weekly, setWeekly] = useState<WeeklyAvailability>({});
  const [overrides, setOverrides] = useState<OverrideAvailability>({});
  const [slotGapMinutes, setSlotGapMinutes] = useState(60);
  const [maxDailyBookings, setMaxDailyBookings] = useState(12);
  // Quantas reuniões simultâneas esse closer aceita no mesmo horário.
  // 1 = comportamento clássico (slot fecha no primeiro agendamento).
  // N = slot só fecha quando N pessoas agendaram naquele horário.
  // Compõe a capacidade total do dia somando todos closers ativos.
  const [concurrentCapacity, setConcurrentCapacity] = useState(1);
  
  // Closer selector (admin only)
  const [closers, setClosers] = useState<{ id: string; full_name: string }[]>([]);
  const [selectedCloserId, setSelectedCloserId] = useState<string | null>(null);
  const [showAddCloserDialog, setShowAddCloserDialog] = useState(false);
  const [availableProfiles, setAvailableProfiles] = useState<{ id: string; full_name: string }[]>([]);
  const [closerToRemove, setCloserToRemove] = useState<{ id: string; full_name: string } | null>(null);
  
  // State for overrides tab
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedDateRanges, setSelectedDateRanges] = useState<TimeRange[]>([]);

  const fetchClosers = async () => {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, is_closer' as any)
      .eq('approved', true)
      .order('full_name');

    if (profiles) {
      const closerList = (profiles as any[]).filter((p: any) => p.is_closer === true);
      setClosers(closerList.map(p => ({ id: p.id, full_name: p.full_name })));
      if (!selectedCloserId && closerList.length > 0) {
        setSelectedCloserId(closerList[0].id);
      }
    }
  };

  // Load closers for admin, or set own id for non-admin
  useEffect(() => {
    if (isAdmin) {
      fetchClosers();
    } else {
      setSelectedCloserId(user?.id || null);
    }
  }, [isAdmin, user?.id]);

  useEffect(() => {
    if (selectedCloserId) {
      loadAvailability(selectedCloserId);
    }
  }, [selectedCloserId]);

  const loadAvailability = async (targetUserId: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('availability_weekly, availability_overrides')
        .eq('id', targetUserId)
        .single();

      if (error) throw error;
      
      const { data: settingsData } = await supabase
        .from('profiles')
        .select('slot_gap_minutes, max_daily_bookings, concurrent_capacity' as any)
        .eq('id', targetUserId)
        .single() as any;

      setSlotGapMinutes(settingsData?.slot_gap_minutes ?? 60);
      // Campo removido da UI — teto alto fixo pra que vagas-simultâneas seja
      // o controle real. Lê o que estiver no banco pra não regredir caso o
      // admin tenha setado algo manualmente; senão usa 100.
      setMaxDailyBookings(settingsData?.max_daily_bookings ?? 100);
      setConcurrentCapacity(settingsData?.concurrent_capacity ?? 1);

      if (data?.availability_weekly) {
        setWeekly(data.availability_weekly as unknown as WeeklyAvailability);
      } else {
        const defaultWeekly: WeeklyAvailability = {
          "0": [],
          "1": [{ start: "09:00", end: "18:00" }],
          "2": [{ start: "09:00", end: "18:00" }],
          "3": [{ start: "09:00", end: "18:00" }],
          "4": [{ start: "09:00", end: "18:00" }],
          "5": [{ start: "09:00", end: "18:00" }],
          "6": []
        };
        setWeekly(defaultWeekly);
      }
      
      if (data?.availability_overrides) {
        setOverrides(data.availability_overrides as unknown as OverrideAvailability);
      } else {
        setOverrides({});
      }
    } catch (err) {
      console.error("Erro ao carregar agenda:", err);
      toast.error("Erro ao carregar configurações de disponibilidade.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    const targetId = selectedCloserId || user?.id;
    if (!targetId) return;
    setIsSaving(true);
    try {
      // max_daily_bookings é forçado pra 100 (teto bem alto) — a UI deixou
      // de exibir esse campo pra evitar confusão. A capacidade real do dia
      // vem da combinação vagas-simultâneas × slots disponíveis.
      const effectiveMaxDaily = 100;
      const { error } = await supabase
        .from('profiles')
        .update({
          availability_weekly: weekly as unknown as Json,
          availability_overrides: overrides as unknown as Json,
          slot_gap_minutes: slotGapMinutes,
          max_daily_bookings: effectiveMaxDaily,
          concurrent_capacity: concurrentCapacity,
        } as any)
        .eq('id', targetId);

      if (error) throw error;
      
      const closerName = closers.find(c => c.id === targetId)?.full_name || 'sua';
      toast.success(`Disponibilidade de ${closerName} salva com sucesso!`);
    } catch (err) {
      console.error("Erro ao salvar agenda:", err);
      toast.error("Houve um erro ao salvar as configurações.");
    } finally {
      setIsSaving(false);
    }
  };

  // --- WEEKLY HANDLERS ---
  const toggleDay = (dayId: string, enabled: boolean) => {
    setWeekly(prev => ({
      ...prev,
      [dayId]: enabled ? [{ start: "09:00", end: "18:00" }] : []
    }));
  };

  const updateRange = (dayId: string, index: number, field: 'start' | 'end', value: string) => {
    const newRanges = [...(weekly[dayId] || [])];
    if (newRanges[index]) {
      newRanges[index] = { ...newRanges[index], [field]: value };
      setWeekly(prev => ({ ...prev, [dayId]: newRanges }));
    }
  };

  const addRange = (dayId: string) => {
    const newRanges = [...(weekly[dayId] || [])];
    newRanges.push({ start: "14:00", end: "18:00" });
    setWeekly(prev => ({ ...prev, [dayId]: newRanges }));
  };

  const removeRange = (dayId: string, index: number) => {
    const newRanges = [...(weekly[dayId] || [])];
    newRanges.splice(index, 1);
    setWeekly(prev => ({ ...prev, [dayId]: newRanges }));
  };

  const copyMondayToAll = () => {
    const mondaySlots = weekly["1"] || [];
    setWeekly(prev => ({
      ...prev,
      "2": [...mondaySlots],
      "3": [...mondaySlots],
      "4": [...mondaySlots],
      "5": [...mondaySlots],
    }));
    toast.success("Horários de Segunda copiados para a semana (Ter-Sex).");
  };

  // --- OVERRIDE HANDLERS ---
  const handleSelectOverrideDate = (date: Date | undefined) => {
    setSelectedDate(date);
    if (date) {
      const dateStr = format(date, "yyyy-MM-dd");
      if (overrides[dateStr]) {
        setSelectedDateRanges(overrides[dateStr]);
      } else {
        // By default, if creating a new override, maybe start with empty (unavailable) or normal hours
        setSelectedDateRanges([]);
      }
    } else {
      setSelectedDateRanges([]);
    }
  };

  const saveOverride = () => {
    if (!selectedDate) return;
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    setOverrides(prev => ({
      ...prev,
      [dateStr]: selectedDateRanges
    }));
    toast.success(`Exceção para ${format(selectedDate, "dd/MM/yyyy")} adicionada à lista.`);
  };

  const removeOverride = (dateStr: string) => {
    const newOverrides = { ...overrides };
    delete newOverrides[dateStr];
    setOverrides(newOverrides);
    toast.success(`Exceção removida.`);
  };

  // --- RENDER ---
  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      <header className="bg-white border-b sticky top-0 z-10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-semibold text-slate-800">Disponibilidade</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving} className="gap-2">
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar Alterações
        </Button>
      </header>

      <main className="max-w-4xl mx-auto mt-8 px-4">
        {/* Closer selector for admins */}
        {isAdmin && (
          <div className="bg-white rounded-lg border shadow-sm p-4 mb-6">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Users className="w-4 h-4" />
                Agenda de:
              </div>
              {closers.length > 0 ? (
                <Select value={selectedCloserId || ''} onValueChange={setSelectedCloserId}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="Selecione o closer" />
                  </SelectTrigger>
                  <SelectContent>
                    {closers.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.full_name || 'Sem nome'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-sm text-muted-foreground">Nenhum closer cadastrado</span>
              )}
              
              {/* Remove closer button */}
              {selectedCloserId && closers.length > 0 && (
                <Button 
                  variant="ghost" 
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    const closer = closers.find(c => c.id === selectedCloserId);
                    if (closer) setCloserToRemove(closer);
                  }}
                  title="Remover closer"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}

              <Button 
                variant="outline" 
                size="sm" 
                className="gap-1 text-xs"
                onClick={async () => {
                  // Fetch non-closer approved profiles (excluding admins)
                  const { data: adminRoles } = await supabase.from('user_roles').select('user_id').eq('role', 'admin');
                  const adminIds = new Set(adminRoles?.map(r => r.user_id) || []);
                  const { data: profiles } = await supabase.from('profiles').select('id, full_name, is_closer' as any).eq('approved', true).order('full_name');
                  if (profiles) {
                    const available = (profiles as any[]).filter(p => !p.is_closer && !adminIds.has(p.id));
                    setAvailableProfiles(available.map(p => ({ id: p.id, full_name: p.full_name })));
                  }
                  setShowAddCloserDialog(true);
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                Adicionar Closer
              </Button>
            </div>

            {/* Add Closer Dialog */}
            <Dialog open={showAddCloserDialog} onOpenChange={setShowAddCloserDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Adicionar Closer</DialogTitle>
                  <DialogDescription>Selecione um colaborador para designar como closer.</DialogDescription>
                </DialogHeader>
                {availableProfiles.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">Nenhum colaborador disponível para adicionar.</p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {availableProfiles.map(p => (
                      <Button
                        key={p.id}
                        variant="outline"
                        className="w-full justify-start"
                        onClick={async () => {
                          const { error } = await supabase.from('profiles').update({ is_closer: true } as any).eq('id', p.id);
                          if (error) {
                            toast.error("Erro ao adicionar closer.");
                          } else {
                            toast.success(`${p.full_name} adicionado como closer!`);
                            setShowAddCloserDialog(false);
                            setSelectedCloserId(p.id);
                            fetchClosers();
                          }
                        }}
                      >
                        {p.full_name}
                      </Button>
                    ))}
                  </div>
                )}
              </DialogContent>
            </Dialog>

            {/* Remove Closer Confirmation */}
            <AlertDialog open={!!closerToRemove} onOpenChange={(open) => !open && setCloserToRemove(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remover closer</AlertDialogTitle>
                  <AlertDialogDescription>
                    Tem certeza que deseja remover <strong>{closerToRemove?.full_name}</strong> como closer? A agenda pública não usará mais a disponibilidade desta pessoa.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={async () => {
                      if (!closerToRemove) return;
                      const { error } = await supabase.from('profiles').update({ is_closer: false } as any).eq('id', closerToRemove.id);
                      if (error) {
                        toast.error("Erro ao remover closer.");
                      } else {
                        toast.success(`${closerToRemove.full_name} removido como closer.`);
                        setCloserToRemove(null);
                        if (selectedCloserId === closerToRemove.id) {
                          setSelectedCloserId(null);
                        }
                        fetchClosers();
                      }
                    }}
                  >
                    Remover
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {/* Para onde a lead vai depois do formulário. Fica junto da agenda
            porque é a mesma configuração do atendimento: o horário que ela
            marca e o WhatsApp que recebe ela. */}
        <div className="bg-white rounded-lg border shadow-sm p-5 mb-6 space-y-6">
          <DestinoDasLeads />
          <div className="border-t pt-6">
            <GrupoDasDesqualificadas />
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
          <div className="bg-white rounded-lg border shadow-sm">
            <Tabs defaultValue="weekly" className="w-full">
              <div className="border-b px-6 pt-4">
                <TabsList className="bg-transparent space-x-4">
                  <TabsTrigger 
                    value="weekly" 
                    className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary rounded-none shadow-none bg-transparent font-medium pb-3"
                  >
                    Horários semanais
                  </TabsTrigger>
                  <TabsTrigger 
                    value="overrides" 
                    className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary rounded-none shadow-none bg-transparent font-medium pb-3"
                  >
                    Datas e horários específicos
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* HORÁRIOS SEMANAIS TAB */}
              <TabsContent value="weekly" className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-700">Horários padrão</h2>
                    <p className="text-sm text-slate-500">Defina quando você normalmente está disponível para reuniões.</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={copyMondayToAll} className="gap-2 text-xs">
                    <Copy className="h-3.5 w-3.5" />
                    Clonar os horarios de segunda a sexta
                  </Button>
                </div>

                <div className="space-y-6">
                  {DAYS_OF_WEEK.map((day) => {
                    const ranges = weekly[day.id] || [];
                    const isEnabled = ranges.length > 0;

                    return (
                      <div key={day.id} className="flex max-sm:flex-col items-start gap-4 py-2 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 p-2 rounded-lg transition-colors">
                        
                        <div className="flex items-center gap-4 w-32 shrink-0 pt-1">
                          <Switch 
                            checked={isEnabled}
                            onCheckedChange={(checked) => toggleDay(day.id, checked)}
                          />
                          <span className={`font-medium text-sm ${isEnabled ? 'text-slate-800' : 'text-slate-400'}`}>
                            {day.short}
                          </span>
                        </div>

                        <div className="flex-1 space-y-3">
                          {!isEnabled ? (
                            <div className="text-sm text-slate-400 py-1">Indisponível</div>
                          ) : (
                            ranges.map((range, index) => (
                              <div key={index} className="flex items-center gap-3">
                                <Input 
                                  type="time" 
                                  value={range.start} 
                                  onChange={(e) => updateRange(day.id, index, 'start', e.target.value)}
                                  className="w-28 text-center text-sm font-medium h-9"
                                />
                                <span className="text-slate-400">-</span>
                                <Input 
                                  type="time" 
                                  value={range.end} 
                                  onChange={(e) => updateRange(day.id, index, 'end', e.target.value)}
                                  className="w-28 text-center text-sm font-medium h-9"
                                />
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => removeRange(day.id, index)}
                                  className="h-8 w-8 text-slate-400 hover:text-destructive"
                                  title="Remover intervalo"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            ))
                          )}
                        </div>

                        {isEnabled && (
                          <div className="pt-0.5">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              onClick={() => addRange(day.id)}
                              className="h-8 w-8 text-slate-400 hover:text-primary"
                              title="Adicionar intervalo"
                            >
                              <Plus className="w-5 h-5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </TabsContent>

              {/* DATAS ESPECÍFICAS TAB */}
              <TabsContent value="overrides" className="p-6">
                <div className="mb-6">
                  <h2 className="text-sm font-semibold text-slate-700">Ajustar horários em datas específicas</h2>
                  <p className="text-sm text-slate-500">Adicione exceções aos seus dias regulares, como feriados ou emendas.</p>
                </div>

                <div className="flex flex-col md:flex-row gap-8">
                  {/* Calendar Extractor */}
                  <div className="bg-slate-50 border rounded-lg p-4 h-fit">
                    <h3 className="font-medium text-sm mb-3 text-center">Selecionar a data</h3>
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={handleSelectOverrideDate}
                      locale={ptBR}
                      className="bg-white rounded-md border"
                    />
                  </div>

                  {/* Editor */}
                  <div className="flex-1 space-y-6">
                    {selectedDate ? (
                      <div className="bg-slate-50 border rounded-lg p-5 space-y-4">
                        <div className="flex items-center gap-2 border-b pb-3">
                          <CalendarIcon className="w-5 h-5 text-primary" />
                          <h3 className="font-medium text-slate-800">
                            Exceção para: {format(selectedDate, "dd 'de' MMMM, yyyy", { locale: ptBR })}
                          </h3>
                        </div>

                        {selectedDateRanges.length === 0 ? (
                          <div className="text-sm text-slate-500 py-2">
                            A data atual ficará como <strong>Indisponível</strong>.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Horários permitidos neste dia</label>
                            {selectedDateRanges.map((range, idx) => (
                              <div key={idx} className="flex items-center gap-3">
                                <Input 
                                  type="time" 
                                  value={range.start} 
                                  onChange={(e) => {
                                    const newRanges = [...selectedDateRanges];
                                    newRanges[idx].start = e.target.value;
                                    setSelectedDateRanges(newRanges);
                                  }}
                                  className="w-28 text-center"
                                />
                                <span className="text-slate-400">-</span>
                                <Input 
                                  type="time" 
                                  value={range.end} 
                                  onChange={(e) => {
                                    const newRanges = [...selectedDateRanges];
                                    newRanges[idx].end = e.target.value;
                                    setSelectedDateRanges(newRanges);
                                  }}
                                  className="w-28 text-center"
                                />
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => {
                                    const newRanges = [...selectedDateRanges];
                                    newRanges.splice(idx, 1);
                                    setSelectedDateRanges(newRanges);
                                  }}
                                  className="text-slate-400 hover:text-destructive"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-3 pt-4 border-t border-slate-200 border-dashed justify-between">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => setSelectedDateRanges([...selectedDateRanges, { start: "09:00", end: "18:00" }])}
                            className="gap-1.5"
                          >
                            <Plus className="w-3.5 h-3.5" /> Adicionar horário
                          </Button>
                          
                          <Button size="sm" onClick={saveOverride} className="bg-primary">
                            Aplicar à data
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center p-8 border-2 border-dashed border-slate-200 rounded-lg text-slate-400 text-sm">
                        Selecione um dia no calendário ao lado para adicionar uma exceção.
                      </div>
                    )}

                    {/* Lst of Overrides */}
                    {Object.keys(overrides).length > 0 && (
                      <div className="mt-8">
                        <h3 className="font-semibold text-sm mb-4">Exceções Salvas</h3>
                        <div className="space-y-3">
                          {Object.entries(overrides).sort((a,b) => a[0].localeCompare(b[0])).map(([dateStr, ranges]) => {
                            const dateObj = parseISO(dateStr);
                            return (
                              <div key={dateStr} className="flex items-center justify-between p-3 border rounded-lg bg-white shadow-sm">
                                <div>
                                  <div className="font-medium text-sm text-slate-800">
                                    {format(dateObj, "dd 'de' MMM, yyyy", { locale: ptBR })}
                                  </div>
                                  <div className="text-xs text-slate-500 mt-0.5">
                                    {ranges.length === 0 ? (
                                      <span className="text-amber-600 font-medium">Indisponível (Fechado)</span>
                                    ) : (
                                      ranges.map(r => `${r.start} às ${r.end}`).join(' | ')
                                    )}
                                  </div>
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => removeOverride(dateStr)} className="text-slate-400 hover:text-destructive">
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* CONFIGURAÇÕES DE AGENDAMENTO */}
          <div className="bg-white rounded-lg border shadow-sm mt-6 p-6">
            <h2 className="text-sm font-semibold text-slate-700 mb-1">Configurações de Agendamento</h2>
            <p className="text-sm text-slate-500 mb-6">Defina o espaçamento entre reuniões e a capacidade simultânea de cada horário.</p>

            <div className="grid sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Espaçamento entre reuniões (minutos)</label>
                <p className="text-xs text-slate-400">Ex: 60 = próximo horário livre só 1h após cada reunião</p>
                <Input
                  type="number"
                  min={30}
                  max={180}
                  step={15}
                  value={slotGapMinutes}
                  onChange={(e) => setSlotGapMinutes(parseInt(e.target.value) || 60)}
                  className="w-32"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  Vagas simultâneas por horário
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    novo
                  </span>
                </label>
                <p className="text-xs text-slate-400">
                  1 = slot fecha no 1º agendamento. 2+ = aceita várias pessoas no MESMO horário.
                  Soma com os outros closers ativos.
                </p>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  value={concurrentCapacity}
                  onChange={(e) => setConcurrentCapacity(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                  className="w-32"
                />
              </div>
            </div>

            {/*
              Campo "Máximo de reuniões por dia" foi removido da UI: confundia
              o time e a capacidade real é controlada pela combinação
              vagas-simultâneas × slots disponíveis. Internamente mantemos
              maxDailyBookings em 100 (teto bem alto) pra não fechar dias
              cedo demais e pra não quebrar a RPC que ainda lê esse campo.
            */}
          </div>
        </>
        )}
      </main>
    </div>
  );
}
