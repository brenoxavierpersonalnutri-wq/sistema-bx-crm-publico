import { useState } from "react";
import { Consultation, ConsultationStatus, LeadQuality } from "@/types/consultation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface AddConsultationFormProps {
  onAdd: (consultation: Consultation) => void;
}

export function AddConsultationForm({ onAdd }: AddConsultationFormProps) {
  const [open, setOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [status, setStatus] = useState<ConsultationStatus>("convertido");
  const [leadQuality, setLeadQuality] = useState<LeadQuality>("morno");
  const [observation, setObservation] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) return;

    onAdd({
      id: `c-${Date.now()}`,
      clientName: clientName.trim(),
      clientPhone: clientPhone.trim() || null,
      date,
      startTime: null,
      endTime: null,
      status,
      leadQuality,
      observation: observation.trim(),
      attended: null,
      converted: null,
      closerObservation: "",
      receivedReminderMessages: null,
      via: null,
      ticketValue: null,
      paymentMethod: null,
      gaveSignal: null,
      signalValue: null,
      signalFollowUpDate: null,
      signalResiduePaid: null,
      negotiating: null,
    });

    setClientName("");
    setClientPhone("");
    setObservation("");
    setStatus("convertido");
    setLeadQuality("morno");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Nova Consulta
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Registrar Consulta</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="clientName">Nome do Cliente</Label>
            <Input
              id="clientName"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Nome completo"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientPhone">WhatsApp</Label>
            <Input
              id="clientPhone"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              placeholder="5511999999999"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">Data</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ConsultationStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="convertido">Convertido</SelectItem>
                  <SelectItem value="não convertido">Não Convertido</SelectItem>
                  <SelectItem value="no-show">No-Show</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Qualidade do Lead</Label>
              <Select value={leadQuality} onValueChange={(v) => setLeadQuality(v as LeadQuality)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quente">🔥 Quente</SelectItem>
                  <SelectItem value="morno">🌤 Morno</SelectItem>
                  <SelectItem value="frio">❄️ Frio</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="observation">Observação</Label>
            <Textarea
              id="observation"
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              placeholder="Motivo da não conversão, detalhes..."
              rows={3}
            />
          </div>

          <Button type="submit" className="w-full">
            Registrar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
