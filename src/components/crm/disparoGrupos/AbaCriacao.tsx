import { useEffect, useState } from "react";
import { CalendarClock, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { db, numeroCriaGrupo, type CampanhaGrupos, type NumeroWhatsApp } from "@/lib/grupos";
import { problemasAgendarCriacao } from "@/lib/disparoGrupos";
import { FluxoGrupo } from "@/components/crm/grupos/FluxoGrupo";

const paraInputLocal = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Aba Programação de criação: criar o próximo grupo agora, agendar a criação, ver a fila e os erros.
// Só o número Grupos 1 (OpenWA Baileys) cria grupo; nos outros, a aba explica e não deixa criar.
export function AbaCriacao({ campanha, numeros, onSalvo }: { campanha: CampanhaGrupos; numeros: NumeroWhatsApp[]; onSalvo: () => Promise<void> }) {
  const { toast } = useToast();
  const numero = numeros.find((n) => n.id === campanha.numero_id);
  const criaGrupo = numeroCriaGrupo(numero?.sessao);
  const [quando, setQuando] = useState(paraInputLocal(campanha.criacao_agendada_para) || paraInputLocal(new Date(Date.now() + 30 * 60_000).toISOString()));
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (campanha.criacao_agendada_para) setQuando(paraInputLocal(campanha.criacao_agendada_para)); }, [campanha.criacao_agendada_para]);

  const problemas = problemasAgendarCriacao(quando, criaGrupo, campanha);

  async function gravar(valor: string | null) {
    setSalvando(true);
    const { error } = await db.from("grupos_campanhas").update({ criacao_agendada_para: valor, updated_at: new Date().toISOString() }).eq("id", campanha.id);
    setSalvando(false);
    if (error) { toast({ title: "Não deu para salvar", description: error.message, variant: "destructive" }); return; }
    toast({ title: valor ? "Criação agendada" : "Agendamento cancelado" });
    await onSalvo();
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-md border p-4 space-y-3">
        <p className="font-medium">Agendar criação do próximo grupo</p>
        {campanha.criacao_agendada_para ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <CalendarClock className="h-4 w-4" />
            Agendada para <b>{new Date(campanha.criacao_agendada_para).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</b>
            <Button size="sm" variant="ghost" onClick={() => gravar(null)} disabled={salvando}><X className="h-4 w-4 mr-1" /> Cancelar</Button>
          </div>
        ) : <p className="text-xs text-muted-foreground">Nenhuma criação agendada. O disparador cria uma vez no horário (depois volta ao normal).</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Input className="w-56" type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} aria-label="Data e hora da criação" />
          <Button onClick={() => gravar(new Date(quando).toISOString())} disabled={salvando || problemas.length > 0}>
            {salvando && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Agendar criação
          </Button>
        </div>
        {problemas.length > 0 && <ul className="text-xs text-destructive list-disc pl-4">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>}
      </div>
      <FluxoGrupo key={`${campanha.id}-${campanha.updated_at ?? ""}`} campanha={campanha} partes={["criarAgora"]} criaGrupo={criaGrupo} onSalvo={() => { void onSalvo(); }} />
    </div>
  );
}
