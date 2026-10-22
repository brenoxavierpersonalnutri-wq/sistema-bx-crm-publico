import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { db, type CampanhaGrupos } from "@/lib/grupos";
import { FluxoGrupo } from "@/components/crm/grupos/FluxoGrupo";
import { RelatorioGrupos } from "@/components/crm/grupos/RelatorioGrupos";

interface Evento { id: number; grupo_id: string; tipo: "entrada" | "saida"; quantidade: number; boas_vindas_pendente: boolean; created_at: string }

// Aba Membros/eventos: entradas e saídas por grupo (webhook group.join/leave), boas-vindas e relatório.
export function AbaMembros({ campanha, onSalvo }: { campanha: CampanhaGrupos; onSalvo: () => Promise<void> }) {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});

  const carregar = useCallback(async () => {
    const [{ data: ev }, { data: gs }] = await Promise.all([
      // sem a coluna participantes (a tela não lê ids de quem entrou)
      db.from("grupos_membros_eventos").select("id, grupo_id, tipo, quantidade, boas_vindas_pendente, created_at")
        .eq("campanha_id", campanha.id).order("created_at", { ascending: false }).limit(100),
      db.from("grupos_campanha_grupos").select("id, nome, chat_id").eq("campanha_id", campanha.id),
    ]);
    setEventos((ev ?? []) as Evento[]);
    const n: Record<string, string> = {};
    for (const g of gs ?? []) n[g.id] = g.nome || g.chat_id || g.id;
    setNomes(n);
  }, [campanha.id]);
  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-4 space-y-2 max-w-3xl">
        <div className="flex items-center gap-2">
          <p className="font-medium flex-1">Entradas e saídas (últimas 100)</p>
          <Button size="icon" variant="ghost" onClick={carregar} title="Atualizar"><RefreshCw className="h-4 w-4" /></Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Vem dos eventos do WhatsApp ligados na VPS (vale para grupos novos e importados). Sem eventos aqui: o webhook de grupo do número ainda não foi ligado.
        </p>
        {!eventos.length && <p className="text-sm text-muted-foreground">Nenhum evento ainda.</p>}
        <div className="max-h-72 overflow-y-auto text-sm space-y-1">
          {eventos.map((e) => (
            <div key={e.id} className="flex flex-wrap gap-2">
              <span className="text-xs text-muted-foreground w-28">{new Date(e.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
              <span className={e.tipo === "entrada" ? "text-green-500" : "text-amber-500"}>{e.tipo === "entrada" ? `+${e.quantidade} entrou` : `-${e.quantidade} saiu`}</span>
              <span className="truncate max-w-[240px]">{nomes[e.grupo_id] ?? "grupo"}</span>
              {e.boas_vindas_pendente && <span className="text-xs text-muted-foreground">boas-vindas na fila</span>}
            </div>
          ))}
        </div>
      </div>
      <FluxoGrupo key={`bv-${campanha.id}-${campanha.updated_at ?? ""}`} campanha={campanha} partes={["boasvindas"]} onSalvo={() => { void onSalvo(); }} />
      <RelatorioGrupos campanha={campanha} />
    </div>
  );
}
