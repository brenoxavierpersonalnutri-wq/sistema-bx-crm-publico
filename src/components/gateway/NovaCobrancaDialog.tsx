import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, ChevronDown, Copy, Check, MessageCircle, ExternalLink } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { formatCPFCNPJ, formatCurrency, formatPhone } from "@/lib/gateway/formatters";

const schema = z.object({
  descricao: z.string().trim().min(2, "Informe a descrição do produto").max(500),
  valor: z.number().positive("Valor inválido"),
  metodo: z.enum(["pix", "cartao", "boleto", "todos"]),
});

type Metodo = "pix" | "cartao" | "boleto" | "todos";

export function NovaCobrancaDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (v: boolean) => void; onCreated?: () => void }) {
  const { session } = useAuth();
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState<string>("");
  const [metodo, setMetodo] = useState<Metodo>("todos");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [campanhaId, setCampanhaId] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [knowsClient, setKnowsClient] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  const [telefone, setTelefone] = useState("");
  const [loading, setLoading] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setDescricao(""); setValor(""); setMetodo("todos");
      setAdvancedOpen(false); setCampanhaId(""); setVencimento("");
      setKnowsClient(false); setNome(""); setEmail(""); setCpf(""); setTelefone("");
      setGeneratedUrl(null); setCopied(false);
    }
  }, [open]);

  const valorNum = Number(valor.replace(",", ".")) || 0;

  const submit = async () => {
    const parsed = schema.safeParse({ descricao, valor: valorNum, metodo });
    if (!parsed.success) {
      toast({ title: "Verifique os dados", description: parsed.error.issues[0]?.message, variant: "destructive" });
      return;
    }
    if (!session?.user) return;
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("gateway-criar-cobranca", {
      body: {
        descricao,
        valor_bruto: valorNum,
        metodo,
        parcelas: 1,
        order_nsu: campanhaId.trim() || undefined,
        vencimento: vencimento || undefined,
        copy_origem: campanhaId.trim() || undefined,
        ...(knowsClient ? {
          cliente_nome: nome || undefined,
          cliente_email: email || undefined,
          cliente_cpf_cnpj: cpf || undefined,
          cliente_telefone: telefone || undefined,
        } : {}),
      },
    });
    setLoading(false);
    if (error || (data as any)?.error) {
      const msg = (data as any)?.error || error?.message || "Erro desconhecido";
      toast({ title: "Erro ao gerar link", description: String(msg), variant: "destructive" });
      return;
    }
    const paymentUrl = (data as any)?.payment_url;
    if (paymentUrl) {
      setGeneratedUrl(paymentUrl);
      onCreated?.();
    } else {
      toast({ title: "Link gerado", description: "Mas não foi retornado URL." });
      onOpenChange(false);
    }
  };

  const copyLink = async () => {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const shareWhatsapp = () => {
    if (!generatedUrl) return;
    const msg = `Olá! Segue o link de pagamento${descricao ? ` para ${descricao}` : ""}:\n\n${generatedUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  };

  const qrUrl = generatedUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(generatedUrl)}`
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{generatedUrl ? "Link gerado" : "Novo link de pagamento"}</DialogTitle>
        </DialogHeader>

        {generatedUrl ? (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <Label className="text-xs uppercase text-muted-foreground">Link de pagamento</Label>
              <div className="flex gap-2">
                <Input readOnly value={generatedUrl} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={copyLink}>
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {qrUrl && (
              <div className="flex flex-col items-center gap-2 rounded-lg border p-4">
                <Label className="text-xs uppercase text-muted-foreground">QR Code</Label>
                <img src={qrUrl} alt="QR Code do link de pagamento" className="rounded" width={220} height={220} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={shareWhatsapp} className="gap-2">
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </Button>
              <Button variant="outline" onClick={() => window.open(generatedUrl, "_blank", "noopener")} className="gap-2">
                <ExternalLink className="h-4 w-4" /> Abrir
              </Button>
            </div>

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)} className="w-full">Fechar</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Descrição do produto *</Label>
                <Input
                  placeholder="Ex: Avaliação Postural e Metabólica"
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Valor (R$) *</Label>
                <Input
                  placeholder="297,00"
                  inputMode="decimal"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Método de pagamento</Label>
                <RadioGroup value={metodo} onValueChange={(v) => setMetodo(v as Metodo)} className="grid grid-cols-4 gap-2">
                  {[
                    { v: "todos", l: "Todos" },
                    { v: "pix", l: "Pix" },
                    { v: "cartao", l: "Cartão" },
                    { v: "boleto", l: "Boleto" },
                  ].map((m) => (
                    <Label key={m.v} className={`flex items-center justify-center gap-1.5 border rounded-lg p-2 cursor-pointer text-sm ${metodo === m.v ? "border-primary bg-primary/5" : ""}`}>
                      <RadioGroupItem value={m.v} className="sr-only" />
                      <span>{m.l}</span>
                    </Label>
                  ))}
                </RadioGroup>
              </div>

              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between px-2">
                    <span className="text-sm text-muted-foreground">Opções avançadas</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Identificador da campanha</Label>
                    <Input
                      placeholder="seg_avaliacao_provasocial_20260518"
                      value={campanhaId}
                      onChange={(e) => setCampanhaId(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Usado pra rastrear UTM ponta-a-ponta no webhook.</p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Data de expiração (opcional)</Label>
                    <Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
                  </div>

                  <div className="flex items-start gap-2 pt-1">
                    <Checkbox id="knows-client" checked={knowsClient} onCheckedChange={(v) => setKnowsClient(!!v)} className="mt-0.5" />
                    <Label htmlFor="knows-client" className="text-sm cursor-pointer leading-tight">
                      Conheço o cliente, quero pré-preencher os dados
                    </Label>
                  </div>

                  {knowsClient && (
                    <div className="space-y-2 pl-6">
                      <Input placeholder="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} />
                      <Input placeholder="email@cliente.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                      <div className="grid grid-cols-2 gap-2">
                        <Input placeholder="CPF/CNPJ" value={cpf} onChange={(e) => setCpf(formatCPFCNPJ(e.target.value))} />
                        <Input placeholder="Telefone" value={telefone} onChange={(e) => setTelefone(formatPhone(e.target.value))} />
                      </div>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>

              {valorNum > 0 && (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                  Valor cobrado: <span className="font-semibold text-foreground">{formatCurrency(valorNum)}</span>
                  {metodo === "todos" && <p className="text-xs mt-1">Taxa varia conforme o método escolhido pelo cliente.</p>}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={submit} disabled={loading} className="gap-2">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Gerar Link de Pagamento
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
