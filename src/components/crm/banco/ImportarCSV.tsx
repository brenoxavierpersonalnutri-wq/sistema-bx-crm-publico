// Aba "Importar CSV" do Banco de dados: a única porta MANUAL da base (export do SellFlux ou da PagTrust).
// Mesmo upsert da antiga tela Base de leads (origem + id do CSV; rodar de novo o mesmo arquivo só atualiza).
// Abaixo, o histórico por origem: quantas linhas e quando entrou a última (as automáticas incluídas).
import { useCallback, useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { emLotes, linhaParaLead } from "@/lib/baseLeads";
import { rotuloOrigem } from "@/lib/crm/bancoAbas";
import { lerResumoOrigens, type ResumoOrigem } from "./dadosBanco";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const horaBR = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const AUTOMATICAS = new Set(["avaliacao", "individual", "agendamento", "compra", "aluna", "crm_whatsapp", "grupo_whatsapp"]);

export function ImportarCSV() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [resumo, setResumo] = useState<ResumoOrigem[] | null | undefined>(undefined);

  const recarregar = useCallback(async () => setResumo(await lerResumoOrigens()), []);
  useEffect(() => { recarregar(); }, [recarregar]);

  async function importar(arquivo: File) {
    setOcupado("Lendo o CSV...");
    try {
      const texto = await arquivo.text();
      const lido = Papa.parse<Record<string, string>>(texto, { header: true, skipEmptyLines: true });
      const unicos = new Map<string, NonNullable<ReturnType<typeof linhaParaLead>>>();
      let descartadas = 0;
      for (const r of lido.data) {
        const l = linhaParaLead(r);
        if (!l) descartadas++;
        else unicos.set(l.origem_id, l);
      }
      const linhas = [...unicos.values()];
      const lotes = emLotes(linhas, 500);
      for (let i = 0; i < lotes.length; i++) {
        setOcupado(`Importando lote ${i + 1} de ${lotes.length}...`);
        const { error } = await db.from("base_leads").upsert(lotes[i], { onConflict: "origem,origem_id" });
        if (error) throw new Error(`Lote ${i + 1}: ${error.message}`);
      }
      toast({ title: "Importação concluída", description: `${linhas.length} leads (${descartadas} linhas sem id descartadas). Aparecem em Pessoas na próxima atualização (até 10 min).` });
      await recarregar();
    } catch (e) {
      toast({ title: "Falha na importação", description: (e as Error).message, variant: "destructive" });
    } finally {
      setOcupado(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="space-y-4" aria-label="Importar CSV">
      <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
        <div>
          <h3 className="font-semibold">Importar CSV do SellFlux ou da PagTrust</h3>
          <p className="text-sm text-muted-foreground">
            Colunas esperadas: id, name, phone, email, tags, nome-do-produto, status, created_at. Id começando com "pagtrust:" entra como PagTrust; o resto, como SellFlux.
            Importar o mesmo arquivo de novo só atualiza (não duplica). Formulário, agendamento, compra, aluna e WhatsApp entram sozinhos, sem CSV.
          </p>
        </div>
        <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="arquivo-csv" onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])} />
        <Button onClick={() => inputRef.current?.click()} disabled={!!ocupado}>
          <Upload className="mr-2 h-4 w-4" /> Escolher arquivo CSV
        </Button>
        {ocupado && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{ocupado}</p>}
      </div>

      <div className="rounded-xl border bg-card overflow-auto">
        <div className="px-4 pt-3 text-sm font-medium">Histórico por origem</div>
        {resumo === undefined ? (
          <p className="p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando...</p>
        ) : resumo === null ? (
          <p className="p-4 text-sm text-muted-foreground">O histórico aparece depois que a migration 20261122150000 rodar no banco.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="p-2 pl-4">Origem</th><th className="p-2">Como entra</th><th className="p-2 text-right">Registros</th><th className="p-2">Última entrada na base</th><th className="p-2">Lead mais recente</th></tr>
            </thead>
            <tbody>
              {resumo.map((r) => (
                <tr key={r.origem} className="border-t" data-testid="linha-historico">
                  <td className="p-2 pl-4">{rotuloOrigem(r.origem)}</td>
                  <td className="p-2 text-xs text-muted-foreground">{AUTOMATICAS.has(r.origem) || r.origem.startsWith("webhook:") ? "automático" : "CSV"}</td>
                  <td className="p-2 text-right tabular-nums">{r.linhas.toLocaleString("pt-BR")}</td>
                  <td className="p-2 whitespace-nowrap">{horaBR(r.ultimo_importado)}</td>
                  <td className="p-2 whitespace-nowrap">{horaBR(r.ultima_entrada)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
