// "Canal do YouTube": aparece só com mais de um canal conectado (um canal = nada a escolher).
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ContaYoutube } from "@/lib/lives/youtube";

export function SeletorCanalYt({ contas, valor, onChange, id = "canal-yt" }: {
  contas: ContaYoutube[];
  valor: string;
  onChange: (id: string) => void;
  id?: string;
}) {
  if (contas.length < 2) return null;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">Canal do YouTube</Label>
      <Select value={valor || undefined} onValueChange={onChange}>
        <SelectTrigger id={id} aria-label="Canal do YouTube"><SelectValue placeholder="Escolha o canal" /></SelectTrigger>
        <SelectContent>
          {contas.map((c) => <SelectItem key={c.id} value={c.id}>{c.titulo || "Canal"}{c.padrao ? " (padrão)" : ""}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
