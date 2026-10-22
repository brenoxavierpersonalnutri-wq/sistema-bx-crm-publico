import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { Clock, LogOut } from "lucide-react";

export default function PendingApproval() {
  const { signOut, user } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <div className="flex justify-center mb-2">
            <div className="p-3 rounded-full bg-warning/10">
              <Clock className="h-6 w-6 text-warning" />
            </div>
          </div>
          <CardTitle className="font-display text-xl">Aguardando Aprovação</CardTitle>
          <CardDescription>
            Sua conta ({user?.email}) foi criada mas ainda não foi aprovada pelo administrador. Aguarde a liberação.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full gap-2" onClick={signOut}>
            <LogOut className="h-4 w-4" />
            Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
