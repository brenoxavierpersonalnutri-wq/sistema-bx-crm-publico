import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAlunaAuth } from "@/hooks/useAlunaAuth";

export function AlunaProtectedRoute({ children }: { children: ReactNode }) {
  const { session, perfil, loading, semAcesso, sair } = useAlunaAuth();

  if (loading) {
    return (
      <div className="dark flex min-h-[100dvh] items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) return <Navigate to="/aluna/entrar" replace />;

  // Logada, mas o e-mail não bate com nenhuma aluna liberada pelo time.
  if (semAcesso || !perfil) {
    return (
      <div className="dark flex min-h-[100dvh] items-center justify-center bg-background px-6 text-foreground">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <ShieldAlert className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-display text-lg font-bold">Acesso ainda não liberado</h1>
            <p className="text-sm text-muted-foreground">
              Seu e-mail não está vinculado a nenhuma consultoria ativa. Fale com
              a equipe para liberar seu app.
            </p>
          </div>
          <Button variant="outline" className="w-full" onClick={() => void sair()}>
            Entrar com outro e-mail
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
