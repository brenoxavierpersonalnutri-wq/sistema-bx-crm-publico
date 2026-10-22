import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Clock, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

// All possible slots from 8am to 8pm
const ALL_POSSIBLE_SLOTS = [
  "08:00", "09:00", "10:00", "11:00", "12:00", 
  "13:00", "14:00", "15:00", "16:00", "17:00", 
  "18:00", "19:00", "20:00"
];

export function AvailabilitySettings() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open && user?.id) {
      loadAvailability();
    }
  }, [open, user?.id]);

  const loadAvailability = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('available_slots_json')
        .eq('id', user?.id)
        .single();

      if (error) throw error;

      if (data?.available_slots_json && Array.isArray(data.available_slots_json)) {
        setSlots(data.available_slots_json as string[]);
      } else {
        // Fallback default
        setSlots(["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"]);
      }
    } catch (err) {
      console.error("Erro ao carregar agenda:", err);
      toast.error("Erro ao carregar sua agenda.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user?.id) return;
    setIsSaving(true);
    try {
      // Sort slots chronologically before saving
      const sortedSlots = [...slots].sort();
      
      const { error } = await supabase
        .from('profiles')
        .update({ available_slots_json: sortedSlots })
        .eq('id', user.id);

      if (error) throw error;
      
      toast.success("Agenda atualizada com sucesso!");
      setOpen(false);
    } catch (err) {
      console.error("Erro ao salvar agenda:", err);
      toast.error("Houve um erro ao salvar a agenda.");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSlot = (time: string, checked: boolean) => {
    if (checked) {
      if (!slots.includes(time)) {
        setSlots([...slots, time]);
      }
    } else {
      setSlots(slots.filter(s => s !== time));
    }
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Clock className="w-4 h-4" />
          Minha Agenda Dinâmica
        </Button>
      </DialogTrigger>
      
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Configurar Horários de Atendimento</DialogTitle>
          <DialogDescription>
            Defina os horários em que você estará disponível para agendamentos. Ao ativar ou desativar aqui, a página pública será atualizada automaticamente.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6 py-4">
            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              <div className="grid grid-cols-2 gap-4">
                {ALL_POSSIBLE_SLOTS.map((time) => {
                  const isEnabled = slots.includes(time);
                  return (
                    <div 
                      key={time} 
                      className={`flex items-center justify-between p-3 rounded-md border ${
                        isEnabled ? 'border-primary/50 bg-primary/5' : 'border-border/50 bg-card/50'
                      }`}
                    >
                      <label htmlFor={`slot-${time}`} className={`text-sm font-medium ${isEnabled ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {time}
                      </label>
                      <Switch 
                        id={`slot-${time}`}
                        checked={isEnabled}
                        onCheckedChange={(checked) => toggleSlot(time, checked)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <Button className="w-full gap-2 mt-4" onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isSaving ? 'Salvando...' : 'Salvar Minha Agenda'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
