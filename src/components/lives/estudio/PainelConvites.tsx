// Convites para o estúdio: o link aparece uma vez; o banco guarda só o hash.
import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { db } from "@/lib/lives/api";
import { acaoLive } from "@/lib/lives/acoes";

export interface Convite { id: string; nome_convidado: string; expira_em: string; usado_em: string | null; revogado: boolean }

export function PainelConvites({ roomId, convites, recarregar }: { roomId: string; convites: Convite[]; recarregar: () => void }) {
  const [nome, setNome] = useState("");
  const [link, setLink] = useState<string | null>(null);

  const criar = async () => {
    const r = await acaoLive<{ url: string }>("criar-convite", { room_id: roomId, nome: nome || "Convidado", horas: 24 });
    if (!r?.url) return;
    setLink(r.url);
    setNome("");
    recarregar();
  };
  const revogar = async (c: Convite) => {
    await db.from("live_invites").update({ revogado: true }).eq("id", c.id);
    recarregar();
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input className="h-8" placeholder="Nome do convidado" value={nome} onChange={(e) => setNome(e.target.value)} />
        <Button size="sm" onClick={criar}>Gerar link</Button>
      </div>
      {link && (
        <div className="rounded border p-2 text-xs space-y-1">
          <p className="text-muted-foreground">Copie agora: este link não aparece de novo.</p>
          <div className="flex gap-2 items-center">
            <code className="truncate flex-1">{link}</code>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { navigator.clipboard.writeText(link); toast.success("Copiado"); }}><Copy className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      )}
      {convites.map((c) => (
        <div key={c.id} className="flex items-center justify-between text-sm">
          <div>
            <div>{c.nome_convidado}</div>
            <div className="text-[11px] text-muted-foreground">
              {c.revogado ? "revogado" : new Date(c.expira_em) < new Date() ? "expirado" : `vale até ${new Date(c.expira_em).toLocaleString("pt-BR")}`}
              {c.usado_em ? " · já entrou" : ""}
            </div>
          </div>
          {!c.revogado && <Button size="sm" variant="ghost" onClick={() => revogar(c)}>Revogar</Button>}
        </div>
      ))}
    </div>
  );
}
