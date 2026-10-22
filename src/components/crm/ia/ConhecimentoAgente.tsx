// Aba "Base de conhecimento" da tela Treinar IA: perguntas e respostas, textos colados e arquivos.
// Tudo que está ativo entra no contexto do agente (o texto; o arquivo em si só fica guardado).
import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { arquivoDeTexto, db, subirArquivoConhecimento, type AgenteIA, type ItemConhecimentoDB } from "@/lib/crm/treinarIA";

interface Props {
  form: AgenteIA;
  set: <K extends keyof AgenteIA>(k: K, v: AgenteIA[K]) => void;
  /** avisa a página quando a lista muda (o simulador usa a mesma base) */
  onItens: (itens: ItemConhecimentoDB[]) => void;
}

export function ConhecimentoAgente({ form, set, onItens }: Props) {
  const { toast } = useToast();
  const [itens, setItens] = useState<ItemConhecimentoDB[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [subindo, setSubindo] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await db.from("crm_ai_conhecimento").select("*").eq("agent_id", form.id).order("ordem").order("created_at");
    if (error) toast({ title: "Base de conhecimento", description: error.message, variant: "destructive" });
    const lista = (data ?? []) as ItemConhecimentoDB[];
    setItens(lista);
    onItens(lista);
    setCarregando(false);
  }, [form.id, onItens, toast]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const novo = async (tipo: "faq" | "texto", extra: Partial<ItemConhecimentoDB> = {}) => {
    const { error } = await db.from("crm_ai_conhecimento").insert({ agent_id: form.id, tipo, ordem: itens.length, ...extra });
    if (error) return toast({ title: "Não salvou", description: error.message, variant: "destructive" });
    carregar();
  };

  const alterarLocal = (id: string, campo: keyof ItemConhecimentoDB, valor: unknown) =>
    setItens((l) => l.map((i) => (i.id === id ? { ...i, [campo]: valor } : i)));

  const salvar = async (it: ItemConhecimentoDB, mudanca: Partial<ItemConhecimentoDB> = {}) => {
    const alvo = { ...it, ...mudanca };
    const { error } = await db.from("crm_ai_conhecimento").update({
      titulo: alvo.titulo ?? null, pergunta: alvo.pergunta ?? null, resposta: alvo.resposta ?? null,
      conteudo: alvo.conteudo ?? null, ativo: alvo.ativo !== false, updated_at: new Date().toISOString(),
    }).eq("id", it.id);
    if (error) return toast({ title: "Não salvou", description: error.message, variant: "destructive" });
    const lista = itens.map((i) => (i.id === it.id ? alvo : i));
    setItens(lista);
    onItens(lista);
  };

  const apagar = async (it: ItemConhecimentoDB) => {
    if (!window.confirm("Apagar este item da base de conhecimento?")) return;
    const { error } = await db.from("crm_ai_conhecimento").delete().eq("id", it.id);
    if (error) return toast({ title: "Não apagou", description: error.message, variant: "destructive" });
    carregar();
  };

  const subir = async (f: File | undefined) => {
    if (!f) return;
    setSubindo(true);
    try {
      const path = await subirArquivoConhecimento(form.id, f);
      const conteudo = arquivoDeTexto(f) ? (await f.text()).slice(0, 60000) : "";
      await novo("texto", { tipo: "arquivo", titulo: f.name, file_name: f.name, file_path: path, conteudo } as Partial<ItemConhecimentoDB>);
      if (!conteudo) toast({ title: "Arquivo guardado", description: "PDF/Word: cole o texto principal no campo do item para a IA ler." });
    } catch (e) {
      toast({ title: "Upload falhou", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubindo(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-4 md:p-5 space-y-3" aria-label="Texto livre">
        <div>
          <h3 className="text-lg font-bold tracking-tight">Texto livre</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">Fatos, links e regras do negócio. Salva com o botão "Salvar agente".</p>
        </div>
        <Textarea aria-label="Texto livre (fatos, links, regras do negócio)" className="min-h-[140px] font-mono text-[13px]" value={form.base_conhecimento ?? ""} onChange={(e) => set("base_conhecimento", e.target.value)} />
      </section>

      <section className="rounded-xl border bg-card p-4 md:p-5 space-y-3" aria-label="Itens da base">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold tracking-tight">Itens da base{itens.length > 0 && <span className="ml-1.5 text-sm font-semibold text-muted-foreground tabular-nums">{itens.length}</span>}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">Perguntas e respostas, textos e arquivos. Salvam sozinhos ao sair do campo.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => novo("faq")}><Plus className="h-4 w-4 mr-1" /> Pergunta e resposta</Button>
        <Button size="sm" variant="outline" onClick={() => novo("texto")}><Plus className="h-4 w-4 mr-1" /> Texto colado</Button>
        <Button size="sm" variant="outline" onClick={() => arquivoRef.current?.click()} disabled={subindo}>
          {subindo ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileUp className="h-4 w-4 mr-1" />} Arquivo (PDF, Word, TXT)
        </Button>
        <input ref={arquivoRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.txt,.md,.csv,.json"
          onChange={(e) => subir(e.target.files?.[0])} aria-label="Enviar arquivo para a base de conhecimento" />
      </div>

      {carregando && <Loader2 className="h-4 w-4 animate-spin" />}
      {!carregando && !itens.length && <p className="text-sm text-muted-foreground">Nenhum item ainda.</p>}

      <ul className="space-y-2">
        {itens.map((it) => (
          <li key={it.id} className={`rounded-xl border bg-secondary p-3 space-y-2 ${it.ativo === false ? "opacity-60" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                {it.tipo === "faq" ? "Pergunta e resposta" : it.tipo === "arquivo" ? `Arquivo · ${it.file_name ?? ""}` : "Texto"}
              </span>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs">
                  <Switch checked={it.ativo !== false} onCheckedChange={(v) => salvar(it, { ativo: v })} /> usar
                </label>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => apagar(it)} aria-label="Apagar item"><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            {it.tipo === "faq" ? (
              <>
                <Input placeholder="Pergunta da lead" value={it.pergunta ?? ""} onChange={(e) => alterarLocal(it.id, "pergunta", e.target.value)} onBlur={() => salvar(it)} />
                <Textarea placeholder="Resposta certa" className="min-h-[60px]" value={it.resposta ?? ""} onChange={(e) => alterarLocal(it.id, "resposta", e.target.value)} onBlur={() => salvar(it)} />
              </>
            ) : (
              <>
                <Input placeholder="Título (opcional)" value={it.titulo ?? ""} onChange={(e) => alterarLocal(it.id, "titulo", e.target.value)} onBlur={() => salvar(it)} />
                <Textarea placeholder={it.tipo === "arquivo" ? "Cole aqui o texto do arquivo (é isto que a IA lê)" : "Texto"} className="min-h-[90px] text-xs"
                  value={it.conteudo ?? ""} onChange={(e) => alterarLocal(it.id, "conteudo", e.target.value)} onBlur={() => salvar(it)} />
              </>
            )}
          </li>
        ))}
      </ul>
      </section>
    </div>
  );
}
