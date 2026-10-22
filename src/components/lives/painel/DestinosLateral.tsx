// Destinos no painel: o que já está conectado (por live) e o atalho para conectar um novo.
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IconeDestino } from "@/components/lives/painel/IconeDestino";
import { PainelDestinos } from "@/components/lives/estudio/PainelDestinos";
import type { LiveDestino } from "@/lib/lives/api";
import { acaoLive } from "@/lib/lives/acoes";
import type { LiveRoomExtra } from "@/lib/lives/painel";

export type DestinoComSala = LiveDestino & { room_id: string };

export function DestinosLateral({ destinos, salas, recarregar }: { destinos: DestinoComSala[]; salas: LiveRoomExtra[]; recarregar: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [salaId, setSalaId] = useState<string>("");
  const sala = salas.find((s) => s.id === salaId) ?? null;
  const nomeSala = (id: string) => salas.find((s) => s.id === id)?.titulo ?? "—";

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Destinos</h2>
        <Button size="sm" variant="outline" onClick={() => { setSalaId(salas[0]?.id ?? ""); setAberto(true); }} disabled={!salas.length}>
          <Plus className="h-4 w-4 mr-1" />Conectar
        </Button>
      </div>
      {!salas.length && <p className="text-xs text-muted-foreground">Crie uma live para conectar destinos a ela.</p>}
      <ul className="space-y-2">
        {destinos.map((d) => (
          <li key={d.id} className="flex items-center gap-3">
            <IconeDestino tipo={d.tipo} noAr={d.no_ar} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{d.nome}</div>
              <div className="truncate text-[11px] text-muted-foreground">{nomeSala(d.room_id)} · {d.modo === "youtube_api" ? "YouTube conectado" : `chave ${d.chave_final}`}</div>
            </div>
            <Switch
              checked={d.ativo}
              aria-label={`Ativar ${d.nome}`}
              onCheckedChange={async (v) => {
                if (await acaoLive("destino-ativo", { destino_id: d.id, ativo: v })) recarregar();
              }}
            />
          </li>
        ))}
        {salas.length > 0 && !destinos.length && <li className="text-xs text-muted-foreground">Nenhum destino conectado ainda.</li>}
      </ul>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-screen overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conectar destino</DialogTitle>
            <DialogDescription>Cada live tem os próprios destinos. Escolha a live e conecte o canal do YouTube ou cole a chave de transmissão.</DialogDescription>
          </DialogHeader>
          <Select value={salaId} onValueChange={setSalaId}>
            <SelectTrigger><SelectValue placeholder="Escolha a live" /></SelectTrigger>
            <SelectContent>
              {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.titulo}</SelectItem>)}
            </SelectContent>
          </Select>
          {sala && <PainelDestinos sala={sala} destinos={destinos.filter((d) => d.room_id === sala.id)} recarregar={recarregar} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
