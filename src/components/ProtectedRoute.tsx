import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { podeAbrirRota } from "@/lib/modules";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ValidandoAcesso } from "@/components/ValidandoAcesso";

export function ProtectedRoute({ children, requireAdmin }: { children: ReactNode; requireAdmin?: boolean }) {
  const { session, profile, isAdmin, allowedModules, loading, accessError, refreshAuth } = useAuth();
  const location = useLocation();

  if (loading) return <ValidandoAcesso />;

  if (!session) return <Navigate to="/login" replace />;
  if (accessError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-sm space-y-4">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h1 className="text-base font-semibold">Falha ao validar seu acesso</h1>
            <p className="text-sm text-muted-foreground">{accessError}</p>
          </div>
          <Button onClick={() => void refreshAuth()} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }
  if (profile && !profile.approved) return <Navigate to="/pending" replace />;
  if (requireAdmin && !isAdmin) return <Navigate to="/" replace />;

  // Admins bypass module check
  if (!podeAbrirRota(location.pathname, isAdmin, allowedModules)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
