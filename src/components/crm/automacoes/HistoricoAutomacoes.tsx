// Histórico: um registro por envio/ação (crm_automacao_log) e o resumo da fila.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";
import { db } from "@/lib/crmAutomacoes";

interface Log {
  id: number;
  automacao_id: string | null;
  campanha_id: string | null;
  fluxo_id?: string | null;
  contact_phone: string;
  canal: string;
  tipo: string;
  status: "ok" | "erro";
  detalhe: string | null;
  created_at: string;
}

const CANAL: Record<string, string> = { whatsapp: "WhatsApp", oficial: "Oficial", crm: "CRM" };

export function HistoricoAutomacoes() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [fila, setFila] = useState<Record<string, number>>({});

  const carregar = useCallback(async () => {
    const { data } = await db.from("crm_automacao_log").select("*").order("created_at", { ascending: false }).limit(300);
    setLogs((data ?? []) as Log[]);
    const { data: a } = await db.from("crm_automacoes").select("id, nome");
    const { data: c } = await db.from("crm_campanhas").select("id, nome");
    const { data: f } = await db.from("crm_fluxos").select("id, nome"); // tabela da 20261023120000 (pode faltar)
    setNomes(Object.fromEntries([...(a ?? []), ...(c ?? []), ...(f ?? [])].map((x: { id: string; nome: string }) => [x.id, x.nome])));
    const contagem: Record<string, number> = {};
    for (const s of ["pendente", "enviando", "erro"]) {
      const { count } = await db.from("crm_automacao_fila").select("id", { count: "exact", head: true }).eq("status", s);
      contagem[s] = count ?? 0;
    }
    setFila(contagem);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-3 text-sm">
        <span>Fila: <b>{fila.pendente ?? 0}</b> pendentes · <b>{fila.enviando ?? 0}</b> enviando · <b>{fila.erro ?? 0}</b> com erro</span>
        <Button size="sm" variant="ghost" onClick={carregar}><RefreshCw className="mr-1 h-4 w-4" /> Atualizar</Button>
      </div>
      <div className="max-h-[55vh] overflow-y-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr className="text-left">
              <th className="p-2">Quando</th><th className="p-2">Origem</th><th className="p-2">Contato</th>
              <th className="p-2">Canal</th><th className="p-2">Tipo</th><th className="p-2">Status</th><th className="p-2">Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && <tr><td className="p-3 text-muted-foreground" colSpan={7}>Nada enviado ainda.</td></tr>}
            {logs.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-2 whitespace-nowrap">{new Date(l.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td className="p-2">{nomes[l.automacao_id ?? l.campanha_id ?? l.fluxo_id ?? ""] ?? (l.campanha_id ? "campanha" : l.fluxo_id ? "fluxo" : "automação")}</td>
                <td className="p-2">{l.contact_phone}</td>
                <td className="p-2">{CANAL[l.canal] ?? l.canal}</td>
                <td className="p-2">{l.tipo}</td>
                <td className="p-2"><Badge variant={l.status === "ok" ? "default" : "destructive"}>{l.status}</Badge></td>
                <td className="p-2 max-w-xs truncate" title={l.detalhe ?? ""}>{l.detalhe}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
