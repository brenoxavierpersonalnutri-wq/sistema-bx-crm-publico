import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Dumbbell, UtensilsCrossed, Replace, MessageSquareHeart, TrendingUp, PlaySquare, LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAlunaAuth } from "@/hooks/useAlunaAuth";
import { cn } from "@/lib/utils";

const ABAS = [
  { to: "/aluna", label: "Treino", icon: Dumbbell, exact: true },
  { to: "/aluna/dieta", label: "Dieta", icon: UtensilsCrossed },
  { to: "/aluna/substituicoes", label: "Trocas", icon: Replace },
  { to: "/aluna/conteudos", label: "Aulas", icon: PlaySquare },
  { to: "/aluna/feedback", label: "Feedback", icon: MessageSquareHeart },
  { to: "/aluna/evolucao", label: "Evolução", icon: TrendingUp },
];

const primeiroNome = (nome?: string | null) => (nome ?? "").trim().split(" ")[0] || "";

/**
 * `largura` existe por causa da área de conteúdos: o resto do app é feito pro
 * celular e fica melhor estreito, mas as prateleiras de aula precisam da tela
 * inteira no desktop pra não virar uma coluna magra no meio do monitor.
 */
export function AlunaShell({
  children,
  titulo,
  largura = "estreita",
  semPadding = false,
}: {
  children: ReactNode;
  titulo?: string;
  largura?: "estreita" | "cheia";
  semPadding?: boolean;
}) {
  const maxW = largura === "cheia" ? "max-w-6xl" : "max-w-lg";
  const { perfil, sair } = useAlunaAuth();
  const { pathname } = useLocation();

  return (
    // O app da aluna tem identidade própria: escuro, sóbrio, feito para o
    // celular. `dark` fica preso aqui para não vazar no painel do time.
    <div className="dark min-h-[100dvh] bg-background text-foreground">
      <div className={cn("mx-auto flex min-h-[100dvh] w-full flex-col", maxW)}>
        <header className="sticky top-0 z-20 border-b border-white/5 bg-background/80 px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              {titulo ? (
                <h1 className="truncate font-display text-xl font-bold tracking-tight">{titulo}</h1>
              ) : (
                <>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Consultoria Breno Xavier
                  </p>
                  <h1 className="truncate font-display text-xl font-bold tracking-tight">
                    Oi, {primeiroNome(perfil?.nomeCompleto)}
                  </h1>
                </>
              )}
            </div>
            <Button
              size="icon" variant="ghost"
              className="shrink-0 text-muted-foreground"
              aria-label="Sair do app"
              onClick={() => void sair()}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <main className={cn("flex-1 pb-32", semPadding ? "pt-0" : "px-5 pt-5")}>{children}</main>

        <nav
          aria-label="Navegação principal"
          className={cn(
            "fixed inset-x-0 bottom-0 z-30 mx-auto w-full border-t border-white/5 bg-background/90 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl",
            maxW,
          )}
        >
          <ul className="flex items-stretch justify-between">
            {ABAS.map((aba) => {
              const ativa = aba.exact ? pathname === aba.to : pathname.startsWith(aba.to);
              const Icone = aba.icon;
              return (
                <li key={aba.to} className="flex-1">
                  <NavLink
                    to={aba.to}
                    end={aba.exact}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors",
                      ativa ? "text-accent" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icone className={cn("h-5 w-5", ativa && "drop-shadow-[0_0_10px_hsl(var(--accent)/0.5)]")} />
                    {aba.label}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
