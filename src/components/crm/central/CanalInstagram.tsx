// Central de Automação > Instagram Direct: contas conectadas como um "canal" ao lado dos números de WhatsApp.
// "Conectar Instagram" pede à instagram-oauth a URL do login da Meta e abre; o token volta para a função,
// nunca para cá. Admin vê os dados pra colar no painel do app (webhook, token de verificação, redirect).
import { useCallback, useEffect, useState } from "react";
import { Copy, Instagram, Loader2, Plug, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => any };

export interface ContaInstagram {
  id: string;
  username: string;
  nome: string;
  foto_url: string | null;
  status: string;
  webhook_assinado: boolean;
  token_expira_em: string | null;
  ultimo_erro: string | null;
}

interface DadosMeta {
  webhook_url: string;
  verify_token: string;
  oauth_redirect_uri: string;
  deauthorize_url: string;
  data_deletion_url: string;
  human_agent: string;
}

const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "?");

export const AVISO_FUNCAO_FORA =
  "Instagram ainda não configurado: falta publicar a função instagram-oauth no servidor (ela ainda não está no ar).";

/** Traduz o erro do supabase.functions.invoke em mensagem que o atendente entende. */
export async function mensagemErroFuncao(error: unknown): Promise<string> {
  const e = error as { name?: string; message?: string; context?: Response };
  // FunctionsFetchError/RelayError: a requisição nem chegou (função não publicada, CORS do 404, rede)
  if (e?.name === "FunctionsFetchError" || e?.name === "FunctionsRelayError" || /Failed to send a request/i.test(String(e?.message))) {
    return AVISO_FUNCAO_FORA;
  }
  const ctx = e?.context;
  if (ctx && ctx.status === 404) return AVISO_FUNCAO_FORA;
  const j = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
  return String(j?.error ?? e?.message ?? "falhou");
}

async function chamar(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("instagram-oauth", { body });
  if (error) throw new Error(await mensagemErroFuncao(error));
  return (data ?? {}) as Record<string, unknown>;
}

export function CanalInstagram() {
  const [contas, setContas] = useState<ContaInstagram[] | null>(null);
  const [dadosMeta, setDadosMeta] = useState<DadosMeta | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  // null = conferindo; [] = pronto; ["..."] = o que falta (mostrado em cima do botão)
  const [faltam, setFaltam] = useState<string[] | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await db.from("ig_contas")
      .select("id, username, nome, foto_url, status, webhook_assinado, token_expira_em, ultimo_erro")
      .order("conectado_em");
    setContas(error ? [] : ((data ?? []) as ContaInstagram[]));
    const r = await db.rpc("instagram_dados_meta");
    setDadosMeta(r?.error ? null : (r?.data as DadosMeta | null));
    try {
      const st = await chamar({ acao: "status" });
      setFaltam(Array.isArray(st.faltam) ? (st.faltam as string[]) : []);
    } catch (e) {
      setFaltam([e instanceof Error ? e.message : AVISO_FUNCAO_FORA]);
    }
  }, []);

  useEffect(() => {
    carregar();
    // volta do login da Meta: /crm/central?instagram=ok|erro&motivo=...
    const p = new URLSearchParams(window.location.search);
    const st = p.get("instagram");
    if (st) {
      toast({
        title: st === "ok" ? "Instagram conectado" : "Instagram não conectou",
        description: p.get("motivo") ?? undefined,
        variant: st === "ok" ? undefined : "destructive",
      });
      p.delete("instagram");
      p.delete("motivo");
      const q = p.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    }
  }, [carregar]);

  const conectar = async () => {
    setOcupado("conectar");
    try {
      const r = await chamar({ acao: "iniciar" });
      if (typeof r.url !== "string" || !r.url.startsWith("https://www.instagram.com/")) throw new Error("URL de login inválida");
      window.location.assign(r.url);
    } catch (e) {
      toast({ title: "Não abriu o login do Instagram", description: e instanceof Error ? e.message : "", variant: "destructive" });
      setOcupado(null);
    }
  };

  const acao = async (acaoNome: "renovar" | "reassinar" | "desconectar", conta: ContaInstagram) => {
    if (acaoNome === "desconectar" && !window.confirm(`Desconectar @${conta.username} do CRM? O Direct para de chegar aqui.`)) return;
    setOcupado(`${acaoNome}:${conta.id}`);
    try {
      const r = await chamar({ acao: acaoNome, conta_id: conta.id });
      toast({ title: r.ok === false ? "A Meta recusou" : "Feito" });
      await carregar();
    } catch (e) {
      toast({ title: "Não deu", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setOcupado(null);
    }
  };

  const copiar = (rotulo: string, valor: string) => {
    navigator.clipboard?.writeText(valor).then(
      () => toast({ title: `${rotulo} copiado` }),
      () => toast({ title: "Não copiou", variant: "destructive" }),
    );
  };

  return (
    <section aria-label="Instagram Direct" className="rounded-xl border bg-card p-3 space-y-3" data-testid="canal-instagram">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <Instagram className="h-4 w-4 text-pink-600" /> Instagram Direct
        </div>
        <Button size="sm" className="h-8" onClick={conectar} disabled={ocupado === "conectar"}>
          {ocupado === "conectar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
          <span className="ml-1.5">Conectar Instagram</span>
        </Button>
      </div>

      {faltam && faltam.length > 0 && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" data-testid="instagram-falta">
          {faltam.length === 1 && faltam[0].startsWith("Instagram ainda não configurado")
            ? faltam[0]
            : <>Instagram ainda não configurado: falta {faltam.join(" e ")}.</>}
        </div>
      )}

      {contas === null ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</p>
      ) : contas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma conta conectada. Depois de conectar, o Direct aparece na tela Conversas com o selo do Instagram e os mesmos Roteiros.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {contas.map((c) => (
            <li key={c.id} className="rounded-lg border p-3 flex gap-3" data-testid="conta-instagram">
              {c.foto_url ? (
                <img src={c.foto_url} alt="" className="h-10 w-10 rounded-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center"><Instagram className="h-5 w-5" /></div>
              )}
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium truncate">@{c.username || "conta"}</div>
                <div className={c.status === "conectado" && c.webhook_assinado ? "text-success" : "text-amber-700 dark:text-amber-400"}>
                  {c.status === "conectado" ? (c.webhook_assinado ? "Recebendo o Direct" : "Conectada, webhook pendente") : c.status}
                </div>
                <div className="text-xs text-muted-foreground">Token vale até {fmtData(c.token_expira_em)}</div>
                {c.ultimo_erro && <div className="text-xs text-amber-700 dark:text-amber-400">{c.ultimo_erro}</div>}
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!ocupado} onClick={() => acao("reassinar", c)}>
                    <RefreshCw className="h-3 w-3 mr-1" /> Webhook
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!ocupado} onClick={() => acao("renovar", c)}>
                    Renovar token
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" disabled={!!ocupado} onClick={() => acao("desconectar", c)}>
                    Desconectar
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dadosMeta && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Dados para colar no app da Meta (só admin)</summary>
          <dl className="mt-2 grid gap-1.5">
            {([
              ["URL de callback do webhook", dadosMeta.webhook_url],
              ["Token de verificação", dadosMeta.verify_token],
              ["URI de redirecionamento do OAuth", dadosMeta.oauth_redirect_uri],
              ["URL de cancelamento de autorização", dadosMeta.deauthorize_url],
              ["URL de exclusão de dados", dadosMeta.data_deletion_url],
            ] as const).map(([rotulo, valor]) => (
              <div key={rotulo} className="flex items-center gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0 w-56">{rotulo}</dt>
                <dd className="font-mono text-xs truncate flex-1">{rotulo === "Token de verificação" ? `${valor.slice(0, 6)}…` : valor}</dd>
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => copiar(rotulo, valor)} aria-label={`Copiar ${rotulo}`}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <div className="text-xs text-muted-foreground">
              Resposta fora das 24 h (Human Agent): {dadosMeta.human_agent === "sim" ? "ligada" : "desligada até a Meta aprovar"}.
            </div>
          </dl>
        </details>
      )}
    </section>
  );
}
