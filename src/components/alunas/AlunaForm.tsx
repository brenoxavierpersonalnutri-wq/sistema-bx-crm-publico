import { useState } from "react";
import { format, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CalendarWithShortcuts } from "@/components/ui/calendar-with-shortcuts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Aluna, ProgramType, PaymentMethod, PlanDuration, OrigemLead, PROGRAM_LABELS, PAYMENT_LABELS, DURATION_LABELS, ORIGEM_LABELS } from "@/lib/alunaTypes";
import { cn } from "@/lib/utils";

interface AlunaFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (aluna: Aluna) => void;
  aluna?: Aluna | null;
}

export function AlunaForm({ open, onClose, onSave, aluna }: AlunaFormProps) {
  const [nomeCompleto, setNomeCompleto] = useState(aluna?.nomeCompleto || "");
  const [programa, setPrograma] = useState<ProgramType>(aluna?.programa || "consultoria_slim");
  const [dataCompra, setDataCompra] = useState<Date | undefined>(
    aluna?.dataCompra ? new Date(aluna.dataCompra) : new Date()
  );
  const [duracaoPlano, setDuracaoPlano] = useState<PlanDuration>(aluna?.duracaoPlano || "1");
  const [formaPagamento, setFormaPagamento] = useState<PaymentMethod>(aluna?.formaPagamento || "pix");
  const [pago, setPago] = useState(aluna?.pago ?? true);
  const [deuSinal, setDeuSinal] = useState(aluna?.deuSinal ?? false);
  const [valorSinal, setValorSinal] = useState(aluna?.valorSinal?.toString() || "");
  const [dataCobrancaSinal, setDataCobrancaSinal] = useState<Date | undefined>(
    aluna?.dataCobrancaSinal ? new Date(aluna.dataCobrancaSinal) : undefined
  );
  const [telefone, setTelefone] = useState(aluna?.telefone || "");
  const [origemLead, setOrigemLead] = useState<OrigemLead>(aluna?.origemLead || "instagram");
  const [fotosAnamnese, setFotosAnamnese] = useState(aluna?.fotosAnamnese ?? false);
  const [dataFotosAnamnese, setDataFotosAnamnese] = useState<Date | undefined>(
    aluna?.dataFotosAnamnese ? new Date(aluna.dataFotosAnamnese) : undefined
  );
  const [liberouTreinoDieta, setLiberouTreinoDieta] = useState(aluna?.liberouTreinoDieta ?? false);
  const [liberouFotos, setLiberouFotos] = useState(aluna?.liberouFotos ?? false);
  const [residuoPago, setResiduoPago] = useState(aluna?.residuoPago ?? false);

  // Popover states for auto-close
  const [popoverCompraOpen, setPopoverCompraOpen] = useState(false);
  const [popoverSinalOpen, setPopoverSinalOpen] = useState(false);
  const [popoverFotosOpen, setPopoverFotosOpen] = useState(false);

  const dataVencimento = dataCompra ? addMonths(dataCompra, parseInt(duracaoPlano)) : null;

  const handleSave = () => {
    if (!nomeCompleto.trim() || !dataCompra) return;

    const saved: Aluna = {
      id: aluna?.id || crypto.randomUUID(),
      nomeCompleto: nomeCompleto.trim(),
      programa,
      dataCompra: dataCompra.toISOString(),
      duracaoPlano,
      dataVencimento: dataVencimento!.toISOString(),
      formaPagamento,
      pago,
      deuSinal: deuSinal || undefined,
      valorSinal: deuSinal && valorSinal ? parseFloat(valorSinal) : undefined,
      dataCobrancaSinal: deuSinal && dataCobrancaSinal ? dataCobrancaSinal.toISOString() : undefined,
      telefone: telefone || undefined,
      origemLead,
      fotosAnamnese: fotosAnamnese || undefined,
      dataFotosAnamnese: fotosAnamnese && dataFotosAnamnese ? dataFotosAnamnese.toISOString() : undefined,
      liberouTreinoDieta: liberouTreinoDieta || undefined,
      liberouFotos: liberouFotos || undefined,
      residuoPago: deuSinal ? residuoPago : undefined,
    };

    onSave(saved);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{aluna ? "Editar Aluna" : "Nova Aluna"}</DialogTitle>
          <DialogDescription>
            {aluna ? "Atualize os dados da aluna." : "Preencha os dados para cadastrar uma nova aluna."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="nome">Nome Completo *</Label>
            <Input id="nome" value={nomeCompleto} onChange={(e) => setNomeCompleto(e.target.value)} placeholder="Nome completo da aluna" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="telefone">Telefone (WhatsApp)</Label>
              <Input id="telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(00) 00000-0000" />
            </div>
            <div>
              <Label>Origem do Lead</Label>
              <Select value={origemLead} onValueChange={(v) => setOrigemLead(v as OrigemLead)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ORIGEM_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Programa</Label>
            <Select value={programa} onValueChange={(v) => setPrograma(v as ProgramType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PROGRAM_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data de Compra</Label>
              <Popover open={popoverCompraOpen} onOpenChange={setPopoverCompraOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dataCompra && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dataCompra ? format(dataCompra, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarWithShortcuts
                    selected={dataCompra}
                    onSelect={(date) => {
                      setDataCompra(date);
                      setPopoverCompraOpen(false);
                    }}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Duração do Plano</Label>
              <Select value={duracaoPlano} onValueChange={(v) => setDuracaoPlano(v as PlanDuration)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DURATION_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {dataVencimento && (
            <div className="rounded-lg bg-muted p-3">
              <p className="text-sm text-muted-foreground">
                Data de Vencimento: <span className="font-semibold text-foreground">{format(dataVencimento, "dd/MM/yyyy", { locale: ptBR })}</span>
              </p>
            </div>
          )}

          <div>
            <Label>Forma de Pagamento</Label>
            <Select value={formaPagamento} onValueChange={(v) => setFormaPagamento(v as PaymentMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PAYMENT_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Switch id="pago" checked={pago} onCheckedChange={setPago} disabled={deuSinal} />
            <Label htmlFor="pago" className={deuSinal ? "text-muted-foreground" : ""}>
              Pagamento total realizado {deuSinal && "(desabilitado — aluna deu sinal)"}
            </Label>
          </div>

          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Switch id="sinal" checked={deuSinal} onCheckedChange={(v) => { setDeuSinal(v); if (v) setPago(false); }} />
              <Label htmlFor="sinal" className="font-medium">Aluna deu sinal</Label>
            </div>
            {deuSinal && (
              <div className="space-y-3 pt-1">
                <div>
                  <Label htmlFor="valorSinal">Valor do Sinal (R$)</Label>
                  <Input id="valorSinal" type="number" step="0.01" min="0" value={valorSinal} onChange={(e) => setValorSinal(e.target.value)} placeholder="Ex: 150.00" />
                </div>
                <div>
                  <Label>Data para Cobrar Restante</Label>
                  <Popover open={popoverSinalOpen} onOpenChange={setPopoverSinalOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dataCobrancaSinal && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dataCobrancaSinal ? format(dataCobrancaSinal, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar data de cobrança"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarWithShortcuts
                        selected={dataCobrancaSinal}
                        onSelect={(date) => {
                          setDataCobrancaSinal(date);
                          setPopoverSinalOpen(false);
                        }}
                        initialFocus
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="flex items-center gap-3 mt-4 pt-2 border-t border-border">
                  <Switch id="residuoPago" checked={residuoPago} onCheckedChange={setResiduoPago} />
                  <Label htmlFor="residuoPago" className="font-medium">Restante (resíduo) já foi pago</Label>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border p-4 space-y-3">
            <p className="text-sm font-semibold text-foreground">Controle de Treino e Dieta</p>
            <div className="flex items-center gap-3">
              <Switch id="fotosAnamnese" checked={fotosAnamnese} onCheckedChange={setFotosAnamnese} />
              <Label htmlFor="fotosAnamnese">Fotos / Anamnese / MFIT enviados</Label>
            </div>
            {fotosAnamnese && (
              <div>
                <Label>Data do envio</Label>
                <Popover open={popoverFotosOpen} onOpenChange={setPopoverFotosOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dataFotosAnamnese && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dataFotosAnamnese ? format(dataFotosAnamnese, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarWithShortcuts
                      selected={dataFotosAnamnese}
                      onSelect={(date) => {
                        setDataFotosAnamnese(date);
                        setPopoverFotosOpen(false);
                      }}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}
            <div className="flex items-center gap-3">
              <Switch id="liberouTreino" checked={liberouTreinoDieta} onCheckedChange={setLiberouTreinoDieta} />
              <Label htmlFor="liberouTreino">Liberou treino e dieta</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="liberouFotos" checked={liberouFotos} onCheckedChange={setLiberouFotos} />
              <Label htmlFor="liberouFotos">Liberou fotos</Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!nomeCompleto.trim()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
