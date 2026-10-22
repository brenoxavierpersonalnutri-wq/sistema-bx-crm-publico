// Controle do robô de IA no cabeçalho do chat (18/10/2026): selo de quem atende, "Transferir para IA" (escolhe um
// agente de atendimento do MESMO número da conversa), "Assumir (humano)" e o log da IA desta conversa.
// O estado mora em whatsapp_contacts (ai_agent_slug + ai_pausado) — o mesmo campo de "Tags e agente".
import { useCallback, useEffect, useState } from "react";
import { Bot, History, Loader2, UserRound } from "lucide-react";
import { SeloIA } from "./SeloIA";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import type { ContatoCRM } from "@/lib/crm/conversas";
import {
  agentesCompativeis,
  assumirHumano,
  eventosDaConversa,
  listarAgentesAtendimento,
  quemAtende,
  ROTULO_EVENTO,
  roboDoNumero,
  transferirParaIA,
  type AgenteAtendimento,
  type EventoIA,
} from "@/lib/crm/roboIA";

interface Props {
  contato: ContatoCRM;
  onContatoAtualizado?: (id: string, patch: Partial<ContatoCRM>) => void;
  /** cabeçalho estreito: só ícones */
  compacto?: boolean;
}

export function ControleIA({ contato, onContatoAtualizado, compacto }: Props) {
  const { toast } = useToast();
  const [aberto, setAberto] = useState(false);
  const [agentes, setAgentes] = useState<AgenteAtendimento[] | null>(null);
  const [robo, setRobo] = useState<boolean | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [logAberto, setLogAberto] = useState(false);
  const numeroId = contato.numero_id ?? null;
  const atendidoPorIA = quemAtende(contato) !== "humano";

  const carregar = useCallback(async () => {
    try {
      const [ags, r] = await Promise.all([listarAgentesAtendimento(), roboDoNumero(numeroId)]);
      setAgentes(ags);
      setRobo(r);
    } catch (e) {
      setAgentes([]);
      toast({ title: "Agentes", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }, [numeroId, toast]);

  useEffect(() => { if (aberto) carregar(); }, [aberto, carregar]);

  const transferir = async (a: AgenteAtendimento) => {
    setOcupado(true);
    try {
      await transferirParaIA(numeroId, contato.phone, a.slug);
      onContatoAtualizado?.(contato.id, { ai_agent_slug: a.slug, ai_pausado: false, ai_pausado_motivo: null, ai_precisa_humano: false });
      setAberto(false);
      toast({
        title: `Conversa com a IA (${a.nome})`,
        description: robo ? "Ela responde a próxima mensagem da lead e devolve para humano quando precisar." : "O robô deste número está DESLIGADO: nada sai até ligar em Agente IA.",
      });
    } catch (e) {
      toast({ title: "Não transferiu", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setOcupado(false);
    }
  };

  const assumir = async () => {
    setOcupado(true);
    try {
      await assumirHumano(numeroId, contato.phone);
      onContatoAtualizado?.(contato.id, { ai_pausado: true, ai_pausado_motivo: "humano assumiu", ai_precisa_humano: false });
      toast({ title: "Você assumiu a conversa", description: "A IA não responde mais aqui até transferir de novo." });
    } catch (e) {
      toast({ title: "Não assumiu", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setOcupado(false);
    }
  };

  const compativeis = agentes ? agentesCompativeis(agentes, numeroId) : [];

  return (
    <div className="flex items-center gap-1 shrink-0">
      <SeloIA contato={contato} className={compacto ? "hidden sm:inline-flex" : ""} />
      {atendidoPorIA || contato.ai_precisa_humano ? (
        <Button size="sm" variant="outline" onClick={assumir} disabled={ocupado} className="h-8 gap-1 text-xs" data-testid="assumir-humano">
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
          <span className={compacto ? "sr-only" : ""}>Assumir (humano)</span>
        </Button>
      ) : null}
      {!atendidoPorIA && (
        <Popover open={aberto} onOpenChange={setAberto}>
          <PopoverTrigger asChild>
            <Button size="sm" className="h-8 gap-1 text-xs bg-violet-600 hover:bg-violet-700 text-white" disabled={ocupado} data-testid="transferir-ia">
              <Bot className="h-4 w-4" />
              <span className={compacto ? "sr-only" : ""}>Transferir para IA</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 space-y-2 text-sm">
            <p className="font-medium">Quem atende esta conversa?</p>
            {agentes === null ? (
              <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</p>
            ) : !numeroId ? (
              <p className="text-muted-foreground">Conversa sem número do WhatsApp: a IA não atende aqui.</p>
            ) : compativeis.length === 0 ? (
              <p className="text-muted-foreground">Nenhum agente de atendimento responde neste número. Escolha o número do agente em CRM &gt; Agente IA.</p>
            ) : (
              <div className="space-y-1">
                {compativeis.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => transferir(a)}
                    disabled={ocupado}
                    className="w-full text-left rounded-md border px-3 py-2 hover:bg-muted/60 disabled:opacity-50"
                  >
                    <span className="font-medium block">{a.nome}</span>
                    <span className="text-xs text-muted-foreground">{a.ativo ? "também assume conversas novas sozinho" : "só nas conversas que você transferir"}</span>
                  </button>
                ))}
              </div>
            )}
            {robo === false && (
              <p className="text-xs rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 p-2">
                O robô de IA deste número está desligado: a conversa fica marcada para a IA, mas nada sai até ligar em CRM &gt; Agente IA.
              </p>
            )}
          </PopoverContent>
        </Popover>
      )}
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setLogAberto(true)} aria-label="Log da IA nesta conversa" title="Log da IA">
        <History className="h-4 w-4" />
      </Button>
      <LogIA aberto={logAberto} onFechar={() => setLogAberto(false)} contato={contato} />
    </div>
  );
}

function LogIA({ aberto, onFechar, contato }: { aberto: boolean; onFechar: () => void; contato: ContatoCRM }) {
  const [eventos, setEventos] = useState<EventoIA[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!aberto) return;
    setEventos(null);
    setErro(null);
    eventosDaConversa(contato.phone, contato.numero_id ?? null).then(setEventos).catch((e) => setErro(e instanceof Error ? e.message : String(e)));
  }, [aberto, contato.phone, contato.numero_id]);
  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-3">
          <SheetTitle className="flex items-center gap-2"><Bot className="h-4 w-4" /> Log da IA</SheetTitle>
          <SheetDescription>
            Quem atende agora: <b>{quemAtende(contato) === "humano" ? "humano" : `IA (${contato.ai_agent_slug})`}</b>
            {contato.ai_pausado_motivo ? ` · ${contato.ai_pausado_motivo}` : ""}
          </SheetDescription>
        </SheetHeader>
        {erro && <p className="text-sm text-destructive">{erro}</p>}
        {!eventos && !erro && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</p>}
        {eventos && eventos.length === 0 && <p className="text-sm text-muted-foreground">Nada registrado nesta conversa ainda.</p>}
        <ol className="space-y-2">
          {(eventos ?? []).map((e) => (
            <li key={e.id} className="rounded-md border p-2.5 text-sm space-y-1" data-testid="evento-ia">
              <div className="flex items-center justify-between gap-2">
                <Badge variant={e.tipo === "transferido" || e.tipo.startsWith("falha") ? "destructive" : "secondary"}>{ROTULO_EVENTO[e.tipo] ?? e.tipo}</Badge>
                <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("pt-BR")}</span>
              </div>
              {e.detalhe && <p className="text-xs">{e.detalhe}</p>}
              {e.mensagem && <p className="text-xs whitespace-pre-wrap rounded bg-muted/60 p-2">{e.mensagem}</p>}
              {(e.modelo || e.tokens_entrada || e.tokens_saida) && (
                <p className="text-[11px] text-muted-foreground">
                  {e.modelo ?? ""}{e.tokens_entrada || e.tokens_saida ? ` · ${e.tokens_entrada ?? 0} tokens de entrada, ${e.tokens_saida ?? 0} de saída` : ""}
                  {e.custo_estimado_usd != null ? ` · ~US$ ${Number(e.custo_estimado_usd).toFixed(4)}` : ""}
                </p>
              )}
            </li>
          ))}
        </ol>
      </SheetContent>
    </Sheet>
  );
}
