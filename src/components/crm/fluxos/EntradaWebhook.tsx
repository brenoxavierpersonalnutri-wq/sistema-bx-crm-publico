// Gatilho "Webhook / API (entrada)": URL própria do fluxo (edge function fluxo-entrada), mapeamento de campos
// a partir da última requisição recebida (amostra, igual ao SellFlux), tags fixas, assinatura opcional.
// URL e token só para admin (RLS de crm_fluxo_entradas).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Copy, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { SeletorTags } from "@/components/crm/SeletorTags";
import {
  CAMPOS_MAPEAVEIS,
  chavesDoCorpo,
  extrairLead,
  fmtData,
  urlEntrada,
  type EntradaFluxo,
  type MapeamentoEntrada,
} from "@/lib/crm/fluxosConstrutor";
import { useFluxos } from "./contexto";

const BASE_FUNCOES = `${String(import.meta.env.VITE_SUPABASE_URL ?? "https://SEU_PROJECT_REF.supabase.co").replace(/\/+$/, "")}/functions/v1`;
const AUTO = "__auto__";

const STATUS: Record<string, string> = {
  ok: "recebida e gravada", erro: "recebida com erro", recusado: "recusada (assinatura)", limite: "limite por minuto", rascunho: "recebida (fluxo em rascunho: só a amostra)",
};

export function EntradaWebhook({ fluxoId, fluxoNome }: { fluxoId: string; fluxoNome: string }) {
  const { fonte } = useFluxos();
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [e, setE] = useState<EntradaFluxo | null | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const podeVer = fonte.demo || isAdmin;

  const carregar = useCallback(async () => {
    setAtualizando(true);
    try { setE(await fonte.entrada(fluxoId, fluxoNome)); setErro(null); }
    catch (x) { setErro(x instanceof Error ? x.message : "falha ao ler a entrada"); }
    finally { setAtualizando(false); }
  }, [fonte, fluxoId, fluxoNome]);
  useEffect(() => { if (podeVer) carregar(); }, [podeVer, carregar]);

  const chaves = useMemo(() => chavesDoCorpo(e?.ultima_amostra ?? null), [e?.ultima_amostra]);
  const previa = useMemo(() => (e?.ultima_amostra ? extrairLead(e.ultima_amostra, e.mapeamento, e.tags) : null), [e]);

  if (!podeVer) return <p className="rounded-md border p-2.5 text-xs text-muted-foreground">Só administrador vê e configura a URL de entrada (ela leva o token do fluxo).</p>;
  if (erro) return <p className="rounded-md border border-destructive/40 p-2.5 text-xs text-destructive">{erro}. Rode a migration 20261030100000 se a tabela crm_fluxo_entradas ainda não existe.</p>;
  if (e === undefined) return <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Carregando a URL...</p>;
  if (e === null) return <p className="rounded-md border p-2.5 text-xs text-muted-foreground">Sem permissão para criar a URL (só administrador).</p>;

  const url = urlEntrada(BASE_FUNCOES, e.id_publico, e.token);
  const copiar = async (texto: string, oque: string) => {
    try { await navigator.clipboard.writeText(texto); toast({ title: `${oque} copiado` }); }
    catch { toast({ title: "Não copiou", description: "Selecione e copie à mão.", variant: "destructive" }); }
  };
  const salvar = async (patch: Partial<Pick<EntradaFluxo, "mapeamento" | "tags" | "ativo">>) => {
    setE({ ...e, ...patch });
    try { await fonte.salvarEntrada(fluxoId, patch); }
    catch (x) { toast({ title: "Não salvou", description: x instanceof Error ? x.message : String(x), variant: "destructive" }); }
  };
  const mapear = (campo: keyof MapeamentoEntrada, chave: string) => salvar({ mapeamento: { ...e.mapeamento, [campo]: chave === AUTO ? null : chave } });
  const trocarToken = async () => {
    if (!window.confirm("Gerar token novo? A URL antiga para de funcionar na hora.")) return;
    try { const token = await fonte.novoTokenEntrada(fluxoId); setE({ ...e, token }); toast({ title: "Token novo gerado", description: "Atualize a URL no sistema que envia." }); }
    catch (x) { toast({ title: "Não trocou", description: x instanceof Error ? x.message : String(x), variant: "destructive" }); }
  };
  const assinatura = async (ligar: boolean) => {
    try { const s = await fonte.assinaturaEntrada(fluxoId, ligar); setE({ ...e, segredo_assinatura: s }); }
    catch (x) { toast({ title: "Não mudou a assinatura", description: x instanceof Error ? x.message : String(x), variant: "destructive" }); }
  };
  const exemplo = `curl -X POST '${url}' -H 'Content-Type: application/json' -d '{"nome":"Maria","telefone":"31999998888","email":"maria@exemplo.com","tags":"lead-site"}'`;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>URL de entrada deste fluxo</Label>
        <div className="flex gap-1.5">
          <code className="min-w-0 flex-1 truncate rounded border bg-muted/40 px-2 py-1.5 text-[11px]" title={url}>{url}</code>
          <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => copiar(url, "URL")} aria-label="Copiar URL"><Copy className="h-3.5 w-3.5" /></Button>
        </div>
        <p className="text-xs text-muted-foreground">POST com JSON ou formulário: nome, telefone, email, tags e o que mais vier (vira {"{dados.campo}"} nas mensagens). Telefone BR é normalizado (55 + DDD + número).</p>
        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
          <label className="flex items-center gap-1.5"><Switch checked={e.ativo} onCheckedChange={(v) => salvar({ ativo: v })} />Recebendo</label>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => copiar(exemplo, "Exemplo curl")}><Copy className="mr-1 h-3 w-3" />Copiar exemplo</Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={trocarToken}><KeyRound className="mr-1 h-3 w-3" />Trocar token</Button>
        </div>
      </div>

      <div className="space-y-2 rounded-md border p-2.5">
        <div className="flex items-center justify-between">
          <Label>Última requisição recebida</Label>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={carregar} disabled={atualizando}>
            <RefreshCw className={`mr-1 h-3 w-3 ${atualizando ? "animate-spin" : ""}`} />Atualizar
          </Button>
        </div>
        {e.ultima_em ? (
          <>
            <p className="text-xs text-muted-foreground">{fmtData(e.ultima_em)} · {STATUS[e.ultimo_status ?? ""] ?? e.ultimo_status} · {e.total.toLocaleString("pt-BR")} no total</p>
            {e.ultimo_erro && <p className="text-xs text-destructive">{e.ultimo_erro}</p>}
            <pre className="max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[11px] leading-snug">{JSON.stringify(e.ultima_amostra, null, 2)}</pre>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Nada recebido ainda. Mande um POST de teste (o fluxo pode estar em rascunho: ele só guarda a amostra) e clique em Atualizar para mapear os campos.</p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Mapeamento de campos</Label>
        {CAMPOS_MAPEAVEIS.map(({ campo, rotulo, obrigatorio }) => {
          const atual = String(e.mapeamento[campo] ?? "");
          const opcoes = atual && !chaves.some((c) => c.chave === atual) ? [{ chave: atual, exemplo: "" }, ...chaves] : chaves;
          return (
            <div key={campo} className="grid grid-cols-[8.5rem_1fr] items-center gap-2">
              <span className="text-xs">{rotulo}{obrigatorio && <span className="text-destructive"> *</span>}</span>
              <Select value={atual || AUTO} onValueChange={(v) => mapear(campo, v)}>
                <SelectTrigger className="h-8 text-xs" aria-label={`Chave do campo ${rotulo}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>{campo === "evento" ? "Não usar" : "Automático (nomes comuns)"}</SelectItem>
                  {opcoes.map((c) => <SelectItem key={c.chave} value={c.chave}><span className="font-mono">{c.chave}</span>{c.exemplo && <span className="ml-1.5 text-muted-foreground">= {c.exemplo.slice(0, 30)}</span>}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          );
        })}
        {previa && (
          "lead" in previa
            ? <p className="rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-800 dark:text-emerald-300">Com a amostra: telefone {previa.lead.telefone}{previa.lead.nome ? ` · ${previa.lead.nome}` : ""}{previa.lead.email ? ` · ${previa.lead.email}` : ""}{previa.lead.tags.length ? ` · tags ${previa.lead.tags.join(", ")}` : ""}{previa.lead.evento ? ` · evento ${previa.lead.evento}` : ""}</p>
            : <p className="rounded-md bg-destructive/5 p-2 text-xs text-destructive">Com a amostra: {(previa as { erro: string }).erro}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label>Tags em todo lead desta URL</Label>
        <SeletorTags multiplo valor={e.tags} onMudar={(t) => salvar({ tags: t })} fonte={{ listar: fonte.tags, criar: fonte.criarTag }} placeholder="Nenhuma (opcional)" />
        <p className="text-xs text-muted-foreground">Somam com as tags que vierem no corpo. O contato também entra na base com a origem <span className="font-mono">{e.origem}</span>.</p>
      </div>

      <div className="space-y-1 rounded-md border p-2.5">
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>Exigir assinatura (HMAC-SHA256)</span>
          <Switch checked={!!e.segredo_assinatura} onCheckedChange={assinatura} />
        </label>
        {e.segredo_assinatura ? (
          <div className="space-y-1">
            <div className="flex gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded border bg-muted/40 px-2 py-1 text-[11px]">{e.segredo_assinatura}</code>
              <Button type="button" size="icon" variant="outline" className="h-7 w-7 shrink-0" onClick={() => copiar(e.segredo_assinatura!, "Segredo")} aria-label="Copiar segredo"><Copy className="h-3 w-3" /></Button>
            </div>
            <p className="text-xs text-muted-foreground">Quem envia manda o header <span className="font-mono">x-assinatura: sha256=&lt;hex&gt;</span> = HMAC-SHA256 do corpo cru com este segredo. Sem ele, a requisição é recusada.</p>
          </div>
        ) : <p className="text-xs text-muted-foreground">Opcional. O token da URL já protege; a assinatura prova que o corpo não foi alterado. Limite: {e.limite_minuto} requisições por minuto.</p>}
      </div>
    </div>
  );
}
