import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";

const cards = [
  {
    icon: "🔥",
    title: "Webinar — Venda",
    description: "Aula ao vivo com oferta especial",
    to: "/webinar/sala?tipo=venda",
    color: "#00ff00",
  },
  {
    icon: "🎁",
    title: "Webinar — Avaliação",
    description: "Aula ao vivo + agendamento gratuito",
    to: "/webinar/sala?tipo=avaliacao",
    color: "#FFD700",
  },
  {
    icon: "📊",
    title: "Analytics / Métricas",
    description: "Análise de performance e comparações",
    to: "/webinar/analytics",
    color: "#4169E1",
  },
  {
    icon: "🛠️",
    title: "Debug / Testes",
    description: "Página de testes do sistema",
    to: "/webinar/debug",
    color: "#888888",
  },
];

export default function WebinarHub() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm">
        <div className="container max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <nav className="text-sm text-muted-foreground">
            <Link to="/" className="hover:text-foreground transition">Equipe</Link>
            <span className="mx-2 opacity-50">›</span>
            <span className="text-foreground font-medium">Webinar</span>
          </nav>
          <Link to="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <ChevronLeft className="h-4 w-4" />
              Voltar
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-3xl space-y-6">
          <div className="text-center space-y-2">
            <h1 className="font-display text-3xl font-bold tracking-tight">Webinar</h1>
            <p className="text-sm text-muted-foreground">Escolha uma das opções abaixo</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {cards.map((c) => (
              <Link key={c.to} to={c.to}>
                <Card
                  className="group cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] h-full"
                  style={{ borderColor: "hsl(var(--border))" }}
                >
                  <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                    <div
                      className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl transition-transform group-hover:scale-110"
                      style={{
                        background: `${c.color}1a`,
                        boxShadow: `0 0 0 1px ${c.color}33`,
                      }}
                    >
                      {c.icon}
                    </div>
                    <div>
                      <h3 className="font-semibold text-base" style={{ color: c.color }}>
                        {c.title}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">{c.description}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
