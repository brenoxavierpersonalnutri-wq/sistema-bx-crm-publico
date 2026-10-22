import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Smartphone, CheckCircle2, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { fetchAcessoDaAluna, liberarAcesso, alterarAcesso } from "@/lib/appAluna/store";
import { linkPublico } from "@/lib/linkPublico";

export function AcessoTab({ alunaId, nomeAluna }: { alunaId: string; nomeAluna: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [tocado, setTocado] = useState(false);

  const { data: acesso, isLoading } = useQuery({
    queryKey: ["acesso", alunaId],
    queryFn: () => fetchAcessoDaAluna(alunaId),
  });

  const emailAtual = tocado ? email : (acesso?.email ?? "");

  const liberar = useMutation({
    mutationFn: () => liberarAcesso(alunaId, emailAtual),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acesso", alunaId] });
      setTocado(false);
      toast.success("Acesso liberado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const alternar = useMutation({
    mutationFn: (ativo: boolean) => alterarAcesso(alunaId, ativo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acesso", alunaId] });
      toast.success("Acesso atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const linkApp = linkPublico("/aluna");

  const copiarConvite = async () => {
    const texto =
      `Oi, ${nomeAluna.split(" ")[0]}! Seu app está liberado.\n\n` +
      `Acesse: ${linkApp}\n` +
      `Entre com o e-mail: ${acesso?.email ?? emailAtual}\n\n` +
      `Na primeira vez, use "Criar acesso" para definir sua senha.`;
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Convite copiado");
    } catch {
      toast.error("Não consegui copiar. Copie manualmente o link: " + linkApp);
    }
  };

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold">Acesso ao app</h3>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ac-email">E-mail da aluna</Label>
            <div className="flex gap-2">
              <Input
                id="ac-email" type="email"
                value={emailAtual}
                onChange={(e) => { setTocado(true); setEmail(e.target.value); }}
                placeholder="aluna@email.com"
              />
              <Button
                disabled={!emailAtual.trim() || liberar.isPending}
                onClick={() => liberar.mutate()}
              >
                {acesso ? "Atualizar" : "Liberar"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Precisa ser o mesmo e-mail que ela vai usar para entrar no app.
            </p>
          </div>

          {acesso && (
            <>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
                {acesso.userId ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">Conta vinculada</p>
                      <p className="text-xs text-muted-foreground">
                        {acesso.ultimoAcesso
                          ? `Último acesso em ${new Date(acesso.ultimoAcesso).toLocaleDateString("pt-BR")}`
                          : "Ainda não abriu o app"}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <CircleAlert className="h-4 w-4 shrink-0 text-amber-600" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">Aguardando primeiro login</p>
                      <p className="text-xs text-muted-foreground">
                        A conta é vinculada sozinha assim que ela entrar com esse e-mail.
                      </p>
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Acesso ativo</p>
                  <p className="text-xs text-muted-foreground">
                    Desligue ao encerrar a consultoria — o app trava na hora.
                  </p>
                </div>
                <Switch
                  checked={acesso.ativo}
                  onCheckedChange={(v) => alternar.mutate(v)}
                  aria-label="Ativar ou desativar o acesso da aluna"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono text-[10px]">{linkApp}</Badge>
                <Button size="sm" variant="outline" className="gap-2" onClick={copiarConvite}>
                  <Copy className="h-3.5 w-3.5" /> Copiar convite
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
