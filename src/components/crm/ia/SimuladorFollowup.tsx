// Simulador do agente de follow-up (tela Agente IA): escolhe uma conversa real e mostra a mensagem que o agente
// mandaria agora (ai-agent-simular, modo "followup"). Nada é enviado nem gravado.
import { useEffect, useState } from "react";
import { Loader2, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErroIA } from "@/lib/crm/iaClaude";
import { db, INSTRUCOES_TENTATIVA_PADRAO, type AgenteIA } from "@/lib/crm/treinarIA";

interface Conversa { phone: string; name: string | null; stage: string | null }
type Resultado = { enviaria: true; texto: string } | { enviaria: false; motivo: string; falha_ia?: boolean };

/** Termo de busca seguro para o filtro .or() do PostgREST (vírgula e parêntese quebram a sintaxe). */
export const termoBusca = (q: string) => q.replace(/[,()%*\\]/g, " ").trim().slice(0, 60);

export function SimuladorFollowup({ form }: { form: AgenteIA }) {
  const { toast } = useToast();
  const [busca, setBusca] = useState("");
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [escolhida, setEscolhida] = useState<Conversa | null>(null);
  const [tentativa, setTentativa] = useState(1);
  const [instrucao, setInstrucao] = useState(INSTRUCOES_TENTATIVA_PADRAO[0]);
  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState<(Resultado & { usadas: number }) | null>(null);

  useEffect(() => {
    const t = window.setTimeout(async () => {
      const termo = termoBusca(busca);
      let q = db.from("whatsapp_contacts").select("phone, name, stage").not("phone", "like", "%@g.us").order("updated_at", { ascending: false }).limit(8);
      if (termo) q = q.or(`name.ilike.%${termo}%,phone.ilike.%${termo}%`);
      const { data } = await q;
      const vistos = new Set<string>();
      setConversas(((data ?? []) as Conversa[]).filter((c) => !vistos.has(c.phone) && vistos.add(c.phone)));
    }, 300);
    return () => window.clearTimeout(t);
  }, [busca]);

  const trocarTentativa = (n: number) => {
    setTentativa(n);
    setInstrucao(INSTRUCOES_TENTATIVA_PADRAO[n - 1] ?? "");
  };

  const gerar = async () => {
    if (!escolhida || gerando) return;
    setGerando(true);
    setResultado(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-agent-simular", {
        body: {
          modo: "followup",
          agente: {
            id: form.id, slug: form.slug, nome: form.nome, prompt: form.prompt, modelo: form.modelo, politicas: form.politicas,
            base_conhecimento: form.base_conhecimento, historico_mensagens: form.historico_mensagens,
          },
          contato_phone: escolhida.phone,
          tentativa,
          instrucao,
        },
      });
      if (error || data?.error) throw new Error(await mensagemErroIA(error, data));
      setResultado({ ...(data.followup as Resultado), usadas: Number(data.historico_usado) || 0 });
    } catch (e) {
      toast({ title: "Erro no teste", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="busca-conversa">Conversa</Label>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input id="busca-conversa" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou telefone" className="pl-8" />
        </div>
        <ul className="max-h-48 overflow-y-auto rounded-md border divide-y" aria-label="Conversas">
          {conversas.map((c) => (
            <li key={c.phone}>
              <button type="button" onClick={() => { setEscolhida(c); setResultado(null); }} aria-pressed={escolhida?.phone === c.phone}
                className={`w-full px-2.5 py-1.5 text-left text-sm ${escolhida?.phone === c.phone ? "bg-primary/10" : "hover:bg-muted/50"}`}>
                <span className="font-medium">{c.name || c.phone}</span>
                <span className="ml-2 text-xs text-muted-foreground">{c.phone}{c.stage ? ` · ${c.stage}` : ""}</span>
              </button>
            </li>
          ))}
          {!conversas.length && <li className="p-2.5 text-xs text-muted-foreground">Nenhuma conversa encontrada.</li>}
        </ul>
      </div>

      <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
        <div className="space-y-1">
          <Label>Tentativa</Label>
          <Select value={String(tentativa)} onValueChange={(v) => trocarTentativa(Number(v))}>
            <SelectTrigger aria-label="Tentativa"><SelectValue /></SelectTrigger>
            <SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}ª</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="instrucao-teste">Instrução da tentativa (opcional)</Label>
          <Textarea id="instrucao-teste" rows={2} value={instrucao} onChange={(e) => setInstrucao(e.target.value)} maxLength={500} />
        </div>
      </div>

      <Button onClick={gerar} disabled={!escolhida || gerando} className="w-full">
        {gerando ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
        Ver a mensagem que seria enviada (não envia)
      </Button>

      {resultado && (
        <div className={`rounded-lg border p-3 text-sm ${resultado.enviaria ? "border-green-600/40" : "border-amber-600/40"}`} data-testid="resultado-followup">
          {"texto" in resultado ? (
            <>
              <p className="text-xs text-muted-foreground mb-1">Para {escolhida?.name || escolhida?.phone} · leu {resultado.usadas} mensagens da conversa</p>
              <p className="whitespace-pre-wrap rounded-md bg-muted p-2.5">{resultado.texto}</p>
            </>
          ) : (
            <p><b>Não mandaria:</b> {resultado.motivo}{resultado.falha_ia ? " (falha da IA: no fluxo, nada sai e o log registra)" : ""}</p>
          )}
        </div>
      )}
    </div>
  );
}
