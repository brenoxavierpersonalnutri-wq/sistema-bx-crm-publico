// Aba "Prompt" da tela Treinar IA: prompt editável e histórico de versões (crm_ai_prompt_versoes).
// O modelo (Claude) fica na aba Configuração (ConfigAgente).
import { useCallback, useEffect, useState } from "react";
import { History, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { db, type AgenteIA, type VersaoPrompt } from "@/lib/crm/treinarIA";

interface Props {
  form: AgenteIA;
  set: <K extends keyof AgenteIA>(k: K, v: AgenteIA[K]) => void;
  /** muda depois de cada salvamento, para recarregar o histórico */
  versao: number;
}

export function PromptAgente({ form, set, versao }: Props) {
  const [versoes, setVersoes] = useState<VersaoPrompt[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data } = await db.from("crm_ai_prompt_versoes").select("id, prompt, created_at").eq("agent_id", form.id)
      .order("created_at", { ascending: false }).limit(30);
    setVersoes((data ?? []) as VersaoPrompt[]);
    setCarregando(false);
  }, [form.id]);

  useEffect(() => {
    carregar();
  }, [carregar, versao]);

  return (
    <div className="grid 2xl:grid-cols-[1fr_280px] gap-4">
      <div className="space-y-3">
        <section className="rounded-xl border bg-card p-4 md:p-5 space-y-3" aria-label="Prompt">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-lg font-bold tracking-tight">Prompt</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">Quem a IA é, como fala e o que faz em cada etapa.</p>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
              {(form.prompt ?? "").length.toLocaleString("pt-BR")} caracteres · {contarPalavras(form.prompt).toLocaleString("pt-BR")} palavras
            </span>
          </div>
          <Textarea className="min-h-[560px] font-mono text-[13px] leading-relaxed" value={form.prompt} onChange={(e) => set("prompt", e.target.value)} aria-label="Prompt do agente" />
          <p className="text-xs text-muted-foreground">
            O sistema acrescenta sozinho: base de conhecimento, exemplos aprovados, políticas, dados do contato e as marcações ([TRANSFERIR], [LINK_AGENDAMENTO], [IMAGEM:...]).
          </p>
        </section>
      </div>

      <aside className="rounded-xl border bg-card p-4 space-y-2 h-fit" aria-label="Histórico de versões do prompt">
        <h4 className="text-base font-bold tracking-tight flex items-center gap-1.5">
          <History className="h-4 w-4" /> Versões anteriores {carregando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </h4>
        {!versoes.length && !carregando && <p className="text-xs text-muted-foreground">Nenhuma ainda. Cada vez que você salva um prompt diferente, o anterior fica aqui.</p>}
        <ul className="space-y-1.5 max-h-[520px] overflow-y-auto">
          {versoes.map((v) => (
            <li key={v.id} className="rounded-lg border bg-secondary p-2.5 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <button type="button" className="text-left hover:underline" onClick={() => setAberta(aberta === v.id ? null : v.id)}>
                  {new Date(v.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </button>
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => set("prompt", v.prompt)} title="Coloca esta versão no editor (salve para valer)">
                  <RotateCcw className="h-3 w-3 mr-1" /> Restaurar
                </Button>
              </div>
              {aberta === v.id && <pre className="whitespace-pre-wrap text-[11px] max-h-60 overflow-y-auto bg-muted/40 p-1.5 rounded">{v.prompt}</pre>}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

const contarPalavras = (t: string | null | undefined) => (t ?? "").trim().split(/\s+/).filter(Boolean).length;
