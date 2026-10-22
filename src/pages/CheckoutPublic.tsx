import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Lock, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { calcularLiquido, formatCardNumber, formatCPFCNPJ, formatCurrency, formatPhone } from "@/lib/gateway/formatters";
import { CopyButton } from "@/components/gateway/CopyButton";

type LinkData = {
  id: string;
  user_id: string;
  slug: string;
  nome_produto: string;
  descricao: string | null;
  valor: number;
  metodos_aceitos: string[];
  parcelamento_max: number;
  ativo: boolean;
  imagem_url: string | null;
  cor_tema: string;
};

const clienteSchema = z.object({
  nome: z.string().trim().min(2, "Nome obrigatório"),
  email: z.string().trim().email("Email inválido"),
  cpf: z.string().trim().min(11, "CPF/CNPJ obrigatório"),
  telefone: z.string().trim().optional(),
});

export default function CheckoutPublic() {
  const { linkId } = useParams<{ linkId: string }>();
  const [link, setLink] = useState<LinkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [metodo, setMetodo] = useState<"pix" | "cartao" | "boleto">("pix");
  const [parcelas, setParcelas] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [pago, setPago] = useState(false);

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  const [telefone, setTelefone] = useState("");

  // mock cartão
  const [cardNumber, setCardNumber] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvv, setCardCvv] = useState("");

  useEffect(() => {
    (async () => {
      if (!linkId) return;
      const { data } = await supabase
        .from("gateway_links")
        .select("*")
        .or(`id.eq.${linkId},slug.eq.${linkId}`)
        .eq("ativo", true)
        .maybeSingle();
      setLink(data as any);
      if (data) {
        const m = (data.metodos_aceitos as string[]) ?? ["pix"];
        setMetodo(m[0] as any);
      }
      setLoading(false);
    })();
  }, [linkId]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!link) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center">
        <div>
          <h1 className="font-display text-2xl font-bold">Link não encontrado</h1>
          <p className="text-sm text-muted-foreground mt-2">Esse link de pagamento não existe ou foi desativado.</p>
        </div>
      </div>
    );
  }

  const calc = calcularLiquido(Number(link.valor), metodo, parcelas);

  const finalizar = async () => {
    const parsed = clienteSchema.safeParse({ nome, email, cpf, telefone });
    if (!parsed.success) {
      toast({ title: "Dados inválidos", description: parsed.error.issues[0]?.message, variant: "destructive" });
      return;
    }
    setSubmitting(true);

    // Mock de geração — futura integração com InfinitePay
    const fakeGatewayId = `mock_${crypto.randomUUID()}`;
    const fakeQr = metodo === "pix" ? `00020126${fakeGatewayId.slice(0,10)}5204000053039865802BR6304ABCD` : null;
    const fakeBoleto = metodo === "boleto" ? "23793.38128 60082.602075 89000.063307 1 99990000010000" : null;

    const { error } = await supabase.from("gateway_transacoes").insert({
      user_id: link.user_id,
      link_id: link.id,
      cliente_nome: nome,
      cliente_email: email,
      cliente_cpf_cnpj: cpf,
      cliente_telefone: telefone || null,
      valor_bruto: Number(link.valor),
      taxa_percentual: calc.perc,
      taxa_fixa: calc.fixa,
      valor_liquido: calc.liquido,
      metodo,
      parcelas: metodo === "cartao" ? parcelas : 1,
      descricao: link.nome_produto,
      status: metodo === "cartao" ? "pago" : "pendente",
      gateway_id: fakeGatewayId,
      qr_code: fakeQr,
      codigo_barras: fakeBoleto,
      pago_em: metodo === "cartao" ? new Date().toISOString() : null,
    } as any);

    setSubmitting(false);
    if (error) {
      toast({ title: "Erro ao processar", description: error.message, variant: "destructive" });
      return;
    }
    setPago(true);
  };

  if (pago) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle2 className="h-14 w-14 mx-auto text-emerald-500" />
            <h1 className="text-2xl font-bold">
              {metodo === "cartao" ? "Pagamento aprovado!" : "Cobrança gerada!"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {metodo === "cartao"
                ? "Seu pagamento foi confirmado com sucesso."
                : metodo === "pix"
                ? "Use o QR code/código abaixo no app do seu banco para concluir."
                : "Use o boleto abaixo para pagar até o vencimento."}
            </p>

            {metodo === "pix" && (
              <div className="space-y-2 pt-2">
                <div className="bg-muted rounded p-4 text-xs break-all font-mono">{`00020126360014BR.GOV.BCB.PIX...${link.id.slice(0,8)}`}</div>
                <CopyButton text={`00020126360014BR.GOV.BCB.PIX...${link.id.slice(0,8)}`} label="Copiar código Pix" />
              </div>
            )}
            {metodo === "boleto" && (
              <div className="space-y-2 pt-2">
                <div className="bg-muted rounded p-4 text-xs break-all font-mono">23793.38128 60082.602075 89000.063307 1 99990000010000</div>
                <CopyButton text="23793381286008260207589000063307199990000010000" label="Copiar linha digitável" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="container max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <span className="font-display font-bold">Checkout</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-500" /> Pagamento seguro
          </span>
        </div>
      </header>

      <main className="container max-w-2xl mx-auto px-4 py-8 space-y-6">
        <Card>
          <CardContent className="p-6 space-y-2 text-center">
            {link.imagem_url && <img src={link.imagem_url} alt={link.nome_produto} className="mx-auto rounded-lg max-h-40" />}
            <h1 className="text-2xl font-bold">{link.nome_produto}</h1>
            {link.descricao && <p className="text-sm text-muted-foreground">{link.descricao}</p>}
            <p className="text-3xl font-bold text-emerald-600 pt-2">{formatCurrency(Number(link.valor))}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold text-sm uppercase text-muted-foreground">Seus dados</h2>
            <Input placeholder="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} />
            <Input placeholder="email@exemplo.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="CPF/CNPJ" value={cpf} onChange={(e) => setCpf(formatCPFCNPJ(e.target.value))} />
              <Input placeholder="Telefone" value={telefone} onChange={(e) => setTelefone(formatPhone(e.target.value))} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <Tabs value={metodo} onValueChange={(v) => setMetodo(v as any)}>
              <TabsList className="grid grid-cols-3 w-full">
                {link.metodos_aceitos.includes("pix") && <TabsTrigger value="pix">Pix</TabsTrigger>}
                {link.metodos_aceitos.includes("cartao") && <TabsTrigger value="cartao">Cartão</TabsTrigger>}
                {link.metodos_aceitos.includes("boleto") && <TabsTrigger value="boleto">Boleto</TabsTrigger>}
              </TabsList>

              <TabsContent value="pix" className="pt-4 text-sm text-muted-foreground space-y-2">
                <p>Ao confirmar, geramos um QR Code Pix para você pagar em segundos no app do seu banco.</p>
              </TabsContent>

              <TabsContent value="cartao" className="pt-4 space-y-3">
                <Input placeholder="Número do cartão" value={cardNumber} onChange={(e) => setCardNumber(formatCardNumber(e.target.value))} maxLength={19} />
                <Input placeholder="Nome impresso no cartão" value={cardName} onChange={(e) => setCardName(e.target.value.toUpperCase())} />
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="MM/AA" value={cardExp} onChange={(e) => setCardExp(e.target.value)} maxLength={5} />
                  <Input placeholder="CVV" value={cardCvv} onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, ""))} maxLength={4} />
                </div>
                <div>
                  <Label className="text-xs">Parcelas</Label>
                  <Select value={String(parcelas)} onValueChange={(v) => setParcelas(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: link.parcelamento_max }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}x de {formatCurrency(Number(link.valor) / n)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>

              <TabsContent value="boleto" className="pt-4 text-sm text-muted-foreground">
                Ao confirmar, geramos um boleto bancário com vencimento em 3 dias úteis.
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Button className="w-full h-12 text-base" onClick={finalizar} disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
          Pagar {formatCurrency(Number(link.valor))}
        </Button>

        <p className="text-center text-[11px] text-muted-foreground">
          Powered by Lovable Gateway · <Link to="/" className="underline">brenoxavier.com.br</Link>
        </p>
      </main>
    </div>
  );
}
