import { Link } from "react-router-dom";
import {
  Link2, ArrowLeft, LogOut, Layers, Zap, Gauge
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { RotatorTab } from "@/components/pagetest/RotatorTab";
import { WebhooksTab } from "@/components/pagetest/WebhooksTab";
import { PageSpeedTab } from "@/components/pagetest/PageSpeedTab";
import { useAuth } from "@/hooks/useAuth";

export default function PageTest() {
  const { signOut, profile } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Link2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Central de Integrações</h1>
              <p className="text-xs text-muted-foreground">Link Master e Webhooks</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-2" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8 space-y-8">
        <div className="space-y-3">
          <h2 className="text-2xl font-bold tracking-tight">
            Gerencie seus <span className="text-primary">Links e Integrações</span>
          </h2>
          <p className="text-muted-foreground">Crie projetos de teste A/B para redirecionamento, e automatize o recebimento de webhooks.</p>
        </div>

        <Tabs defaultValue="rotator" className="w-full">
          <TabsList className="bg-secondary mb-4 flex-wrap h-auto p-1">
            <TabsTrigger value="rotator" className="gap-1.5 text-xs"><Link2 className="h-3.5 w-3.5" /> Link Master (Rotador)</TabsTrigger>
            <TabsTrigger value="desempenho" className="gap-1.5 text-xs"><Gauge className="h-3.5 w-3.5" /> Conexão e Velocidade</TabsTrigger>
            <TabsTrigger value="webhooks" className="gap-1.5 text-xs"><Zap className="h-3.5 w-3.5" /> Integrações (Webhooks)</TabsTrigger>
            <TabsTrigger value="config" className="gap-1.5 text-xs"><Layers className="h-3.5 w-3.5" /> Pixel de Rastreio</TabsTrigger>
          </TabsList>

          <TabsContent value="rotator" className="mt-4">
            <RotatorTab />
          </TabsContent>

          <TabsContent value="desempenho" className="mt-4">
            <PageSpeedTab />
          </TabsContent>

          <TabsContent value="webhooks" className="mt-4">
            <WebhooksTab />
          </TabsContent>

          <TabsContent value="config" className="space-y-6 mt-4">
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Layers className="h-5 w-5 text-primary" /> Seu Script de Rastreamento (FunnelTrack)
              </h2>
              <p className="mt-1 text-sm text-muted-foreground pb-4 border-b border-border/50">
                Cole este código dentro da tag <code>&lt;head&gt;</code> de todas as páginas do seu site (landing pages, checkout, obrigado). É ele quem enviará as informações de cliques e leads para a ferramenta.
              </p>
              <div className="mt-6 relative">
                <pre className="p-4 rounded-lg bg-secondary/30 border border-border border-dashed text-xs text-secondary-foreground overflow-x-auto">
{`<!-- BXMetrics Tracking Pixel -->
<script>
  window.FUNNEL_TRACK_TOKEN = '${profile?.tracking_token || 'TOKEN_NAO_ENCONTRADO_ATUALIZE_O_BANCO'}';
  window.FUNNEL_TRACK_API_URL = 'https://SEU_PROJECT_REF.supabase.co/functions/v1/funnel-track';
</script>
<script src="${window.location.origin}/track.js" async defer></script>
<!-- End Tracking -->`}
                </pre>
                <Button size="sm" className="absolute top-2 right-2" variant="secondary" onClick={() => {
                  navigator.clipboard.writeText(`<!-- BXMetrics Tracking Pixel -->
<script>
  window.FUNNEL_TRACK_TOKEN = '${profile?.tracking_token || 'SEU_TOKEN'}';
  window.FUNNEL_TRACK_API_URL = 'https://SEU_PROJECT_REF.supabase.co/functions/v1/funnel-track';
</script>
<script src="${window.location.origin}/track.js" async defer></script>
<!-- End Tracking -->`);
                }}>Copiar Script</Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
