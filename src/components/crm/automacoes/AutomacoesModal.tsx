// Tela "Automações" do CRM: regras por gatilho, fluxos de várias etapas (como o Full Funnel),
// templates oficiais, campanhas com ritmo, histórico e limites.
// Tudo nasce desligado; quem envia é a edge function crm-automacoes (pg_cron, 1/min).
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RegrasAutomacao } from "./RegrasAutomacao";
import { CampanhasEnvio } from "./CampanhasEnvio";
import { HistoricoAutomacoes } from "./HistoricoAutomacoes";
import { LimitesEnvio } from "./LimitesEnvio";
import { FluxosEditor } from "./FluxosEditor";
import { TemplatesOficiais } from "./TemplatesOficiais";

export function AutomacoesModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Automações</DialogTitle>
          <DialogDescription>
            Regras "quando X, faça Y" e campanhas com ritmo controlado. Nada sai enquanto o envio não oficial estiver
            desligado na aba Limites.
          </DialogDescription>
        </DialogHeader>
        {isOpen && (
          <Tabs defaultValue="regras">
            <TabsList>
              <TabsTrigger value="regras">Regras</TabsTrigger>
              <TabsTrigger value="fluxos">Fluxos</TabsTrigger>
              <TabsTrigger value="templates">Templates oficiais</TabsTrigger>
              <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
              <TabsTrigger value="historico">Histórico</TabsTrigger>
              <TabsTrigger value="limites">Limites e envio</TabsTrigger>
            </TabsList>
            <TabsContent value="regras"><RegrasAutomacao /></TabsContent>
            <TabsContent value="fluxos"><FluxosEditor /></TabsContent>
            <TabsContent value="templates"><TemplatesOficiais /></TabsContent>
            <TabsContent value="campanhas"><CampanhasEnvio /></TabsContent>
            <TabsContent value="historico"><HistoricoAutomacoes /></TabsContent>
            <TabsContent value="limites"><LimitesEnvio /></TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
