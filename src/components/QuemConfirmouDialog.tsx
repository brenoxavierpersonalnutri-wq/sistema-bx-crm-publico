import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, User, Users } from "lucide-react";

type Colega = { id: string; full_name: string | null };

interface Props {
  aberto: boolean;
  nomeLead: string;
  onEscolher: (userId: string) => void;
  onCancelar: () => void;
}

/**
 * Pergunta quem confirmou a consulta. O caminho rapido e um clique: o proprio
 * usuario logado ja aparece em destaque. "Foi outra pessoa" abre a equipe.
 * Sem essa autoria a metrica do SDR nao existe, por isso nao da pra pular.
 */
export function QuemConfirmouDialog({ aberto, nomeLead, onEscolher, onCancelar }: Props) {
  const [euId, setEuId] = useState<string | null>(null);
  const [euNome, setEuNome] = useState<string>("");
  const [equipe, setEquipe] = useState<Colega[]>([]);
  const [mostrandoEquipe, setMostrandoEquipe] = useState(false);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!aberto) { setMostrandoEquipe(false); return; }
    let vivo = true;
    (async () => {
      setCarregando(true);
      const { data: { user } } = await supabase.auth.getUser();
      const { data: perfis } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("approved", true)
        .order("full_name");
      if (!vivo) return;
      setEuId(user?.id ?? null);
      const meu = (perfis ?? []).find((p) => p.id === user?.id);
      setEuNome(meu?.full_name || user?.email || "você");
      setEquipe((perfis ?? []).filter((p) => p.id !== user?.id) as Colega[]);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [aberto]);

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onCancelar(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quem confirmou?</DialogTitle>
          <DialogDescription>
            Consulta de {nomeLead}. Essa resposta define de quem é a confirmação no relatório.
          </DialogDescription>
        </DialogHeader>

        {carregando ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !mostrandoEquipe ? (
          <div className="flex flex-col gap-2">
            <Button
              className="justify-start h-auto py-3"
              onClick={() => euId && onEscolher(euId)}
              disabled={!euId}
            >
              <User className="mr-2 h-4 w-4 shrink-0" />
              <span className="text-left">Fui eu — {euNome}</span>
            </Button>
            <Button
              variant="outline"
              className="justify-start h-auto py-3"
              onClick={() => setMostrandoEquipe(true)}
              disabled={equipe.length === 0}
            >
              <Users className="mr-2 h-4 w-4 shrink-0" />
              <span className="text-left">
                {equipe.length === 0 ? "Nenhum outro colaborador liberado" : "Foi outro colaborador"}
              </span>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
            {equipe.map((c) => (
              <Button
                key={c.id}
                variant="outline"
                className="justify-start"
                onClick={() => onEscolher(c.id)}
              >
                {c.full_name || "Sem nome"}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setMostrandoEquipe(false)}>
              ← Voltar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
