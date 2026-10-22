import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, ExternalLink, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function PagamentoSucesso() {
  const [params] = useSearchParams();
  const receiptUrl = params.get("receipt_url");
  const orderNsu = params.get("order_nsu");
  const slug = params.get("slug");
  const captureMethod = params.get("capture_method");
  const transactionNsu = params.get("transaction_nsu");

  const metodoLabel = captureMethod === "pix" ? "Pix"
    : captureMethod === "credit_card" ? "Cartão de crédito"
    : captureMethod || "—";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center space-y-6">
          <div className="flex justify-center">
            <div className="rounded-full bg-emerald-500/10 p-4">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="font-display text-2xl font-bold">Pagamento confirmado</h1>
            <p className="text-sm text-muted-foreground">
              Recebemos a confirmação do seu pagamento. Obrigado!
            </p>
          </div>

          <div className="text-left text-sm space-y-2 bg-muted/30 rounded-lg p-4">
            <div className="flex justify-between"><span className="text-muted-foreground">Método</span><span className="font-medium">{metodoLabel}</span></div>
            {slug && <div className="flex justify-between"><span className="text-muted-foreground">Fatura</span><span className="font-mono text-xs">{slug}</span></div>}
            {orderNsu && <div className="flex justify-between"><span className="text-muted-foreground">Pedido</span><span className="font-mono text-xs truncate max-w-[180px]">{orderNsu}</span></div>}
            {transactionNsu && <div className="flex justify-between"><span className="text-muted-foreground">Transação</span><span className="font-mono text-xs truncate max-w-[180px]">{transactionNsu}</span></div>}
          </div>

          <div className="flex flex-col gap-2">
            {receiptUrl && (
              <Button asChild className="gap-2">
                <a href={receiptUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" /> Ver comprovante
                </a>
              </Button>
            )}
            <Button asChild variant="ghost" className="gap-2">
              <Link to="/"><ArrowLeft className="h-4 w-4" /> Voltar</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
