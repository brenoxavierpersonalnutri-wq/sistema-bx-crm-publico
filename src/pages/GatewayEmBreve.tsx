import { Link } from "react-router-dom";
import { ArrowLeft, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function GatewayEmBreve({ titulo }: { titulo: string }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/60">
        <div className="container max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/gateway/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <h1 className="font-display text-xl font-bold">{titulo}</h1>
        </div>
      </header>
      <main className="container max-w-4xl mx-auto px-4 py-16">
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <Wrench className="h-10 w-10 mx-auto text-muted-foreground" />
            <h2 className="text-lg font-semibold">Em breve</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Esta seção será implementada na Fase 2 do módulo Gateway, junto com a integração InfinitePay.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
