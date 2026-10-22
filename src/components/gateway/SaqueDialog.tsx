import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/gateway/formatters";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  saldoDisponivel: number;
  onCreated: () => void;
};

export function SaqueDialog({ open, onOpenChange, saldoDisponivel, onCreated }: Props) {
  const { session } = useAuth();
  const [valor, setValor] = useState("");
  const [chavePix, setChavePix] = useState("");
  const [observacao, setObservacao] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!session?.user) return;
    const v = parseFloat(valor.replace(",", "."));
    if (!v || v <= 0) return toast({ title: "Valor inválido", variant: "destructive" });
    if (v > saldoDisponivel) return toast({ title: "Saldo insuficiente", variant: "destructive" });
    if (!chavePix.trim()) return toast({ title: "Informe a chave Pix", variant: "destructive" });

    setLoading(true);
    const { error } = await supabase.from("gateway_saques").insert({
      user_id: session.user.id,
      valor: v,
      dados_bancarios: { tipo: "pix", chave: chavePix.trim() },
      observacao: observacao.trim() || null,
    });
    setLoading(false);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: "Saque solicitado", description: "Em até 1 dia útil." });
    setValor(""); setChavePix(""); setObservacao("");
    onOpenChange(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Solicitar saque</DialogTitle>
          <DialogDescription>Saldo disponível: <strong>{formatCurrency(saldoDisponivel)}</strong></DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Valor (R$)</Label>
            <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" inputMode="decimal" />
          </div>
          <div>
            <Label>Chave Pix</Label>
            <Input value={chavePix} onChange={(e) => setChavePix(e.target.value)} placeholder="CPF, e-mail, telefone ou aleatória" />
          </div>
          <div>
            <Label>Observação (opcional)</Label>
            <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
          </div>
          <Button className="w-full" onClick={submit} disabled={loading}>
            {loading ? "Enviando..." : "Solicitar saque"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
