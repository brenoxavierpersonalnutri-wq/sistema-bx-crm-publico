import { useState } from "react";
import { 
  Copy, Flame, CheckCircle2, ChevronDown, ChevronUp, Link as LinkIcon 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function WebhooksTab() {
  const { profile } = useAuth();
  const [openCard, setOpenCard] = useState<string | null>(null);

  const webhookUrl = `https://SEU_PROJECT_REF.supabase.co/functions/v1/webhook-receiver?token=${profile?.tracking_token || 'SEU_TOKEN'}`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("URL do Webhook copiada!");
  };

  const toggleInstructions = (platform: string) => {
    setOpenCard(openCard === platform ? null : platform);
  };

  const integrations = [
    {
      id: "hotmart",
      name: "Integração Hotmart",
      description: "Receber eventos de compras aprovadas.",
      icon: <Flame className="h-6 w-6 text-[#E94E27]" />,
      color: "border-[#E94E27]/20",
      activeColor: "bg-[#E94E27]/10 text-[#E94E27]",
      status: "Ativado", 
      instructions: [
        "Vá na aba Ferramentas no painel da Hotmart.",
        "Clique na ferramenta 'Webhooks' (API e Notificações).",
        "Adicione um novo webhook com as seguintes configurações:",
        "  • Produto: Todos os produtos",
        "  • Eventos: Compra Aprovada",
        "  • Versão: 2.0",
        "Cole o link abaixo como URL do webhook."
      ]
    },
    {
      id: "kiwify",
      name: "Integração Kiwify",
      description: "Receber eventos de pagamentos pagos.",
      icon: <div className="h-6 w-6 flex items-center justify-center rounded-full bg-[#1855F4] text-white font-bold text-xs" style={{ fontFamily: 'sans-serif'}}>K</div>,
      color: "border-[#1855F4]/20",
      activeColor: "bg-[#1855F4]/10 text-[#1855F4]",
      status: "Configurar", 
      instructions: [
        "Acesse o painel da Kiwify e vá em 'Apps' -> 'Webhooks'.",
        "Clique em 'Criar Webhook'.",
        "Configure as seguintes opções:",
        "  • Produto: Todos os produtos",
        "  • Eventos: Pagamento Aprovado (Order Paid)",
        "Cole o link abaixo no campo URL."
      ]
    },
    {
      id: "pagtrust",
      name: "Integração PagTrust",
      description: "Receber eventos de pagamentos aprovados.",
      icon: <div className="h-6 w-6 flex items-center justify-center rounded-full bg-[#00D4FF] text-white font-bold text-xs" style={{ fontFamily: 'sans-serif'}}>P</div>,
      color: "border-[#00D4FF]/20",
      activeColor: "bg-[#00D4FF]/10 text-[#00D4FF]",
      status: "Configurar",
      instructions: [
        "Acesse o painel da PagTrust e vá em 'Integrações' -> 'Webhooks/Postback'.",
        "Clique em 'Criar Webhook'.",
        "Configure as seguintes opções:",
        "  • Produto: Todos os produtos",
        "  • Eventos: Pagamento Aprovado / Venda Realizada",
        "Cole o link abaixo no campo de URL de envio."
      ]
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/50 pb-5">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Integrações (Webhooks)</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie suas integrações com gateways de pagamento para automatizar as vendas do LTV.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {integrations.map((integration) => (
          <div 
            key={integration.id}
            className={cn(
              "flex flex-col rounded-xl border bg-card/60 overflow-hidden transition-all duration-300",
              openCard === integration.id ? integration.color : "border-border/60 hover:border-primary/30"
            )}
          >
            <div className="p-6 flex flex-col items-center text-center space-y-3 relative">
              <div className="absolute top-4 right-4">
                {integration.status === "Ativado" ? (
                   <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", integration.activeColor)}>
                     {integration.status}
                   </span>
                ) : (
                   <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                     {integration.status}
                   </span>
                )}
              </div>
              
              <div className="h-12 w-12 rounded-full bg-secondary/80 flex items-center justify-center mb-1">
                 {integration.icon}
              </div>
              
              <h3 className="font-semibold text-base">{integration.name}</h3>
              <p className="text-xs text-muted-foreground line-clamp-2">
                Configure automaticamente para preencher seu rastreamento de LTV.
              </p>
              
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-xs group mt-4 w-full justify-between hover:bg-transparent hover:text-primary px-0"
                onClick={() => toggleInstructions(integration.id)}
              >
                <span>Ver instruções de instalação</span>
                {openCard === integration.id ? (
                   <ChevronUp className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                ) : (
                   <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                )}
              </Button>
            </div>

            {openCard === integration.id && (
              <div className="border-t border-border/60 bg-secondary/10 p-5 space-y-4">
                <div>
                   <p className="text-xs font-semibold mb-3">Como configurar:</p>
                   <ul className="text-xs space-y-2.5 text-muted-foreground">
                     {integration.instructions.map((step, i) => (
                       <li key={i} className="flex items-start gap-2">
                         {step.includes('•') ? (
                           <span className="ml-4">{step.replace('•', '—')}</span>
                         ) : (
                           <>
                             <span className="flex items-center justify-center shrink-0 w-4 h-4 rounded-full bg-primary/20 text-[9px] font-bold text-primary">
                               {i + 1}
                             </span>
                             <span className="pt-0.5">{step}</span>
                           </>
                         )}
                       </li>
                     ))}
                   </ul>
                </div>

                <div className="pt-3">
                  <p className="text-xs font-medium mb-1.5 flex items-center gap-1.5">
                    <LinkIcon className="h-3.5 w-3.5 text-primary" />
                    Sua URL de Webhook Privada
                  </p>
                  <div className="flex items-center gap-2">
                    <Input 
                      readOnly 
                      value={webhookUrl} 
                      className="bg-card font-mono text-[10px] h-8 truncate border-border/60 focus-visible:ring-0"
                    />
                    <Button 
                      size="icon" 
                      variant="secondary"
                      className="h-8 w-8 shrink-0 hover:bg-primary/20 hover:text-primary transition-colors"
                      onClick={() => copyToClipboard(webhookUrl)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        
        {/* Placeholder for future integrations */}
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-transparent p-6 text-center space-y-3 min-h-[250px] opacity-70 hover:opacity-100 transition-opacity cursor-pointer delay-100">
           <div className="h-10 w-10 rounded-full border border-border/60 bg-secondary/50 flex items-center justify-center text-muted-foreground">
             <span className="text-lg">+</span>
           </div>
           <div>
             <h3 className="text-sm font-medium">Adicionar Integração</h3>
             <p className="text-xs text-muted-foreground mt-1">Em breve novas plataformas.</p>
           </div>
        </div>
      </div>
    </div>
  );
}
