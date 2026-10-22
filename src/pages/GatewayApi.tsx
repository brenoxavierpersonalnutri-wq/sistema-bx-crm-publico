import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { CopyButton } from "@/components/gateway/CopyButton";

type ApiKey = {
  id: string;
  nome: string;
  key_prefix: string;
  ativo: boolean;
  ultimo_uso: string | null;
  created_at: string;
};

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "");
  return `bg_live_${b64}`;
}

export default function GatewayApi() {
  const { session } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [novaKey, setNovaKey] = useState<string | null>(null);

  const load = async () => {
    if (!session?.user) return;
    const { data } = await supabase
      .from("gateway_api_keys")
      .select("id,nome,key_prefix,ativo,ultimo_uso,created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });
    setKeys(data ?? []);
  };
  useEffect(() => { load(); }, [session?.user?.id]);

  const criar = async () => {
    if (!nome.trim() || !session?.user) return;
    const key = generateKey();
    const hash = await sha256(key);
    const { error } = await supabase.from("gateway_api_keys").insert({
      user_id: session.user.id,
      nome: nome.trim(),
      key_prefix: key.slice(0, 12),
      key_hash: hash,
    });
    if (error) { toast.error("Erro ao criar key"); return; }
    setNovaKey(key);
    setNome("");
    load();
  };

  const revogar = async (id: string) => {
    if (!confirm("Revogar esta API key? Não poderá ser revertido.")) return;
    await supabase.from("gateway_api_keys").update({ ativo: false, revoked_at: new Date().toISOString() }).eq("id", id);
    toast.success("Key revogada");
    load();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/60">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/gateway/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <div>
              <h1 className="font-display text-xl font-bold">API & Integrações</h1>
              <p className="text-xs text-muted-foreground">Gere chaves para integrar com sistemas externos</p>
            </div>
          </div>
          <Button className="gap-2" onClick={() => { setOpen(true); setNovaKey(null); }}>
            <Plus className="h-4 w-4" /> Nova API Key
          </Button>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8 space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Suas API Keys</CardTitle></CardHeader>
          <CardContent>
            {keys.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma API key criada ainda.</p>
            ) : (
              <div className="space-y-2">
                {keys.map((k) => (
                  <div key={k.id} className="flex items-center justify-between p-3 rounded-lg border bg-card/40">
                    <div className="flex items-center gap-3">
                      <KeyRound className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-sm">{k.nome}</p>
                        <p className="text-xs text-muted-foreground font-mono">{k.key_prefix}••••••••</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded ${k.ativo ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"}`}>
                        {k.ativo ? "Ativa" : "Revogada"}
                      </span>
                      {k.ativo && (
                        <Button size="icon" variant="ghost" onClick={() => revogar(k.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Documentação</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">Use sua API key no header <code className="text-xs bg-muted px-1 py-0.5 rounded">Authorization: Bearer &lt;sua_key&gt;</code></p>
            <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">{`POST /functions/v1/gateway-criar-cobranca
Content-Type: application/json
Authorization: Bearer bg_live_...

{
  "cliente_nome": "João",
  "cliente_email": "joao@x.com",
  "valor_bruto": 100.00,
  "metodo": "pix",
  "descricao": "Produto X"
}`}</pre>
          </CardContent>
        </Card>
      </main>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{novaKey ? "API Key criada" : "Nova API Key"}</DialogTitle></DialogHeader>
          {novaKey ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">⚠️ Copie agora — não será exibida novamente.</p>
              <div className="flex items-center gap-2 p-3 bg-muted rounded font-mono text-xs break-all">
                <span className="flex-1">{novaKey}</span>
                <CopyButton text={novaKey} />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label>Nome de identificação</Label>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex: Integração Webhook X" />
              </div>
            </div>
          )}
          <DialogFooter>
            {novaKey ? (
              <Button onClick={() => setOpen(false)}>Fechar</Button>
            ) : (
              <Button onClick={criar} disabled={!nome.trim()}>Gerar key</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
