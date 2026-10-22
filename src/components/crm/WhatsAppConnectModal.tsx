import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MessageCircle, RefreshCcw, CheckCircle2, QrCode, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { buscarStatusWhatsApp, type StatusWhatsApp } from "@/hooks/useProvedorWhatsApp";

interface WhatsAppConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** chamado quando o status muda, pro botão do cabeçalho do CRM acompanhar */
  onStatus?: (s: StatusWhatsApp) => void;
}

/**
 * Conexão do WhatsApp pelo OpenWA (VPS), o único provedor desde 17/10/2026.
 * Mostra o status da sessão; se ela estiver esperando pareamento, mostra o QR (lido pelo proxy)
 * e acompanha até conectar. Desconectar é na tela Conexões (/crm/conexoes); iniciar a sessão, no painel do OpenWA.
 */
export function WhatsAppConnectModal({ isOpen, onClose, onStatus }: WhatsAppConnectModalProps) {
  const [status, setStatus] = useState<StatusWhatsApp | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [pareando, setPareando] = useState(false);
  const [importando, setImportando] = useState(false);
  const { toast } = useToast();

  const ler = useCallback(
    async (action: "status" | "qr") => {
      try {
        const s = await buscarStatusWhatsApp(action);
        setStatus(s);
        onStatus?.(s);
        return s;
      } catch (e) {
        const s: StatusWhatsApp = {
          provider: "openwa", connected: false, state: "erro", phone: null, qr: null,
          aviso: e instanceof Error ? e.message : "Falha ao falar com o servidor",
        };
        setStatus(s);
        return s;
      }
    },
    [onStatus],
  );

  useEffect(() => {
    if (!isOpen) {
      setPareando(false);
      return;
    }
    setCarregando(true);
    ler("status").finally(() => setCarregando(false));
  }, [isOpen, ler]);

  // Enquanto o QR está na tela: relê a cada 5 s (o QR do WhatsApp gira sozinho) até conectar.
  useEffect(() => {
    if (!isOpen || !pareando) return;
    const id = setInterval(async () => {
      const s = await ler("qr");
      if (s.connected) {
        setPareando(false);
        toast({ title: "WhatsApp conectado", description: "As mensagens novas passam a aparecer no CRM." });
      }
    }, 5000);
    return () => clearInterval(id);
  }, [isOpen, pareando, ler, toast]);

  const gerarQr = async () => {
    setCarregando(true);
    const s = await ler("qr");
    setCarregando(false);
    if (s.connected) return;
    if (s.qr) setPareando(true);
    else toast({ title: "QR indisponível", description: s.aviso ?? `Sessão em ${s.state ?? "estado desconhecido"}`, variant: "destructive" });
  };

  const importarRecentes = async () => {
    if (importando) return;
    setImportando(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-import-history", { body: { chats: 20, limit: 50 } });
      if (error) throw error;
      toast({
        title: "Histórico importado",
        description: `${data?.imported ?? 0} mensagem(ns) de ${data?.chats ?? 0} conversa(s)` +
          (data?.restantes ? `; faltaram ${data.restantes}, rode de novo` : "") + ".",
      });
    } catch (err) {
      toast({ title: "Erro ao importar", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setImportando(false);
    }
  };

  const conectado = status?.connected === true;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-green-500" />
            Conexão WhatsApp (OpenWA)
          </DialogTitle>
          <DialogDescription>
            O número do CRM roda no OpenWA da VPS. Aqui você vê a sessão e, se ela pedir, lê o QR.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center p-8 bg-muted/20 rounded-xl border border-border mt-2 min-h-[320px] text-center">
          {carregando && !status && (
            <>
              <RefreshCcw className="h-10 w-10 text-muted-foreground animate-spin mb-4" />
              <p className="text-sm text-muted-foreground">Lendo a sessão...</p>
            </>
          )}

          {status && pareando && status.qr && !conectado && (
            <>
              <div className="bg-white p-4 rounded-xl border shadow-sm mb-4">
                <img src={status.qr} alt="QR Code do WhatsApp" className="h-48 w-48 object-contain" />
              </div>
              <h4 className="text-lg font-semibold mb-1">Leia o QR Code</h4>
              <p className="text-sm text-muted-foreground max-w-[280px]">
                No celular do número do CRM: WhatsApp, Aparelhos conectados, Conectar aparelho.
              </p>
            </>
          )}

          {status && !(pareando && status.qr && !conectado) && (
            <>
              <div className={`h-24 w-24 rounded-full flex items-center justify-center mb-6 ${conectado ? "bg-green-500/20" : "bg-destructive/10"}`}>
                {conectado
                  ? <CheckCircle2 className="h-12 w-12 text-green-600" />
                  : <MessageCircle className="h-10 w-10 text-destructive" />}
              </div>
              <h4 className="text-lg font-semibold mb-2">{conectado ? "Conectado" : "Desconectado"}</h4>
              <p className="text-sm text-muted-foreground mb-1">
                Sessão: <code className="text-xs">{status.state ?? "desconhecido"}</code>
                {status.phone ? <> · número final {status.phone.slice(-4)}</> : null}
              </p>
              {status.aviso && <p className="text-xs text-muted-foreground mb-2 max-w-[300px]">{status.aviso}</p>}
              <p className="text-xs text-muted-foreground mb-6 max-w-[300px]">
                Para desconectar ou trocar o número, use a tela Conexões do CRM.
              </p>
              <div className="flex flex-col gap-2 w-full">
                {!conectado && (
                  <Button onClick={gerarQr} disabled={carregando} className="w-full">
                    <QrCode className="h-4 w-4 mr-2" />
                    Mostrar QR Code
                  </Button>
                )}
                {conectado && (
                  <Button onClick={importarRecentes} disabled={importando} variant="outline" className="w-full">
                    <Download className="h-4 w-4 mr-2" />
                    {importando ? "Importando..." : "Importar conversas recentes"}
                  </Button>
                )}
                <Button onClick={() => ler("status")} variant="outline" className="w-full">
                  <RefreshCcw className="h-4 w-4 mr-2" />
                  Atualizar status
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
