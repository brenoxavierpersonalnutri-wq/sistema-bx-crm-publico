// Painel "Roteiro" do chat: mostra os roteiros da etapa do contato, com as
// variáveis já trocadas, e um botão Enviar por passo. Envio manual, um contato
// e um passo por clique (nada de disparo em massa). Também mostra e controla o
// agente de IA deste contato (pausar, retomar, trocar).
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Send, Check, FileText, Image as ImageIcon, Mic, MessageSquare, Clock, Bot } from "lucide-react";
import { useEtapas } from "@/hooks/useEtapas";
import {
  aplicarVariaveis,
  db,
  enviarPasso,
  formatarAtraso,
  passoEnviavel,
  variaveisPendentes,
  type PassoRoteiro,
  type Roteiro,
} from "@/lib/crmRoteiros";
import { assumirHumano, transferirParaIA } from "@/lib/crm/roboIA";

interface Contato {
  phone: string;
  name: string | null;
  stage: string;
  ai_agent_slug: string | null;
  ai_pausado: boolean | null;
  ai_pausado_motivo: string | null;
}

const iconeTipo = { text: MessageSquare, image: ImageIcon, audio: Mic, document: FileText };

/** `numeroId`: a conversa daquele número; o envio direto sai por ele. */
export function RoteiroPainel({ phone, numeroId = null }: { phone: string; numeroId?: string | null }) {
  const { colunas: KANBAN_COLUMNS } = useEtapas(); // etapas de crm_etapas (ativas)
  const { toast } = useToast();
  const [contato, setContato] = useState<Contato | null>(null);
  const [roteiros, setRoteiros] = useState<Roteiro[]>([]);
  const [passos, setPassos] = useState<PassoRoteiro[]>([]);
  const [agentes, setAgentes] = useState<{ slug: string; nome: string; ativo: boolean }[]>([]);
  const [roteiroId, setRoteiroId] = useState<string>("");
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [editados, setEditados] = useState<Record<string, string>>({});
  const [enviados, setEnviados] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = async () => {
    setCarregando(true);
    let qc = db
      .from("whatsapp_contacts")
      .select("phone, name, stage, ai_agent_slug, ai_pausado, ai_pausado_motivo")
      .eq("phone", phone);
    if (numeroId) qc = qc.eq("numero_id", numeroId);
    const { data: cs } = await qc.limit(1);
    const c = cs?.[0] ?? null;
    setContato(c);
    const stage = c?.stage ?? "leads";
    const [{ data: rs }, { data: ags }, { data: env }] = await Promise.all([
      db.from("crm_roteiros").select("*").eq("stage", stage).eq("ativo", true).order("ordem"),
      db.from("crm_ai_agents").select("slug, nome, ativo").order("nome"),
      db.from("crm_roteiro_envios").select("passo_id").eq("contact_phone", phone),
    ]);
    const lista = (rs ?? []) as Roteiro[];
    setRoteiros(lista);
    setAgentes(ags ?? []);
    setEnviados(new Set(((env ?? []) as { passo_id: string }[]).map((e) => e.passo_id)));
    const preferido = lista.find((r) => r.funil === c?.ai_agent_slug) ?? lista[0];
    setRoteiroId(preferido?.id ?? "");
    if (lista.length) {
      const { data: ps } = await db
        .from("crm_roteiro_passos")
        .select("*")
        .in("roteiro_id", lista.map((r) => r.id))
        .order("ordem");
      setPassos((ps ?? []) as PassoRoteiro[]);
    } else {
      setPassos([]);
    }
    setCarregando(false);
  };

  useEffect(() => {
    setEditados({});
    setExtras({});
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, numeroId]);

  const passosDoRoteiro = useMemo(
    () => passos.filter((p) => p.roteiro_id === roteiroId).sort((a, b) => a.ordem - b.ordem),
    [passos, roteiroId],
  );

  const textoDe = (p: PassoRoteiro) =>
    editados[p.id] ?? aplicarVariaveis(p.conteudo || "", { name: contato?.name, phone }, extras);

  const pendentes = useMemo(() => {
    const s = new Set<string>();
    for (const p of passosDoRoteiro) {
      for (const v of variaveisPendentes(aplicarVariaveis(p.conteudo || "", { name: contato?.name, phone }))) s.add(v);
    }
    return [...s];
  }, [passosDoRoteiro, contato?.name, phone]);

  const enviar = async (p: PassoRoteiro) => {
    if (enviando) return;
    const texto = textoDe(p);
    const falta = variaveisPendentes(texto);
    if (falta.length) {
      toast({ title: "Falta preencher", description: falta.map((v) => `{${v}}`).join(", "), variant: "destructive" });
      return;
    }
    if (enviados.has(p.id) && !window.confirm("Este passo já foi enviado para este contato. Enviar de novo?")) return;
    setEnviando(p.id);
    try {
      await enviarPasso(phone, p, texto, numeroId);
      setEnviados((s) => new Set(s).add(p.id));
      toast({ title: "Enviado", description: p.rotulo || undefined });
    } catch (e) {
      toast({ title: "Erro ao enviar", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setEnviando(null);
    }
  };

  const atualizarIA = async (patch: Partial<Contato> & { ai_atribuido_em?: string }) => {
    // mesmo caminho do botão "Transferir para IA" / "Assumir (humano)" do chat: fica no histórico de trocas
    // (crm_ai_eventos). Banco sem a migration 20261103100000: grava direto, como antes.
    try {
      if (patch.ai_agent_slug && patch.ai_pausado === false) {
        await transferirParaIA(numeroId, phone, patch.ai_agent_slug);
        setContato((c) => (c ? { ...c, ...patch } : c));
        return;
      }
      if (patch.ai_pausado === true) {
        await assumirHumano(numeroId, phone);
        setContato((c) => (c ? { ...c, ai_pausado: true, ai_pausado_motivo: "humano assumiu" } : c));
        return;
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (!/Falta rodar a migration/.test(m)) {
        toast({ title: "Erro", description: m, variant: "destructive" });
        return;
      }
    }
    let q = db.from("whatsapp_contacts").update(patch).eq("phone", phone);
    if (numeroId) q = q.eq("numero_id", numeroId);
    const { error } = await q;
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else setContato((c) => (c ? { ...c, ...patch } : c));
  };

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const etapa = KANBAN_COLUMNS.find((k) => k.id === contato?.stage)?.title ?? contato?.stage ?? "Leads";
  const agenteAtual = agentes.find((a) => a.slug === contato?.ai_agent_slug);

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-md border p-3 space-y-2 bg-muted/30">
        <div className="flex items-center gap-2 font-medium">
          <Bot className="h-4 w-4" /> Agente de IA deste contato
        </div>
        <Select
          value={contato?.ai_agent_slug ?? "nenhum"}
          onValueChange={(v) =>
            atualizarIA({
              ai_agent_slug: v === "nenhum" ? null : v,
              ai_pausado: false,
              ai_pausado_motivo: null,
              ai_atribuido_em: new Date().toISOString(),
            })
          }
        >
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="nenhum">Nenhum (atribui pelo gatilho)</SelectItem>
            {agentes.map((a) => (
              <SelectItem key={a.slug} value={a.slug}>
                {a.nome}{a.ativo ? "" : " (desligado)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {contato?.ai_agent_slug && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {contato.ai_pausado
                ? `Pausado${contato.ai_pausado_motivo ? `: ${contato.ai_pausado_motivo}` : ""}`
                : agenteAtual?.ativo
                ? "Respondendo"
                : "Agente desligado na configuração"}
            </span>
            {contato.ai_pausado ? (
              <Button size="sm" variant="outline" className="h-7"
                onClick={() => atualizarIA({ ai_agent_slug: contato.ai_agent_slug, ai_pausado: false, ai_pausado_motivo: null, ai_atribuido_em: new Date().toISOString() })}>
                Retomar IA
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7"
                onClick={() => atualizarIA({ ai_pausado: true, ai_pausado_motivo: "pausado manualmente" })}>
                Pausar IA
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Etapa: <strong className="text-foreground">{etapa}</strong></span>
        <Button size="sm" variant="ghost" className="h-7" onClick={carregar}>Atualizar</Button>
      </div>

      {!roteiros.length ? (
        <p className="text-muted-foreground">Nenhum roteiro ativo para esta etapa. Crie em "Roteiros" no topo do CRM.</p>
      ) : (
        <>
          {roteiros.length > 1 && (
            <Select value={roteiroId} onValueChange={setRoteiroId}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {roteiros.map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {roteiros.find((r) => r.id === roteiroId)?.descricao && (
            <p className="text-xs text-muted-foreground">{roteiros.find((r) => r.id === roteiroId)?.descricao}</p>
          )}

          {pendentes.length > 0 && (
            <div className="rounded-md border p-3 space-y-2">
              <div className="text-xs font-medium">Variáveis desta conversa</div>
              {pendentes.map((v) => (
                <div key={v} className="flex items-center gap-2">
                  <span className="text-xs w-32 shrink-0 font-mono">{`{${v}}`}</span>
                  <Input className="h-7" value={extras[v.toLowerCase()] ?? ""}
                    onChange={(e) => setExtras((x) => ({ ...x, [v.toLowerCase()]: e.target.value }))} />
                </div>
              ))}
            </div>
          )}

          <ol className="space-y-3">
            {passosDoRoteiro.map((p, i) => {
              const Icone = iconeTipo[p.tipo] ?? MessageSquare;
              const texto = textoDe(p);
              const ok = passoEnviavel(p, texto);
              return (
                <li key={p.id} className="rounded-md border p-3 space-y-2 bg-background">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="shrink-0">{i + 1}</Badge>
                    <Icone className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium truncate">{p.rotulo || "Passo"}</span>
                    {enviados.has(p.id) && <Check className="h-4 w-4 text-green-600 shrink-0" aria-label="já enviado" />}
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatarAtraso(p.atraso_segundos)}</span>
                    {p.aguarda_resposta && <span>após a resposta da lead</span>}
                  </div>
                  {p.tipo !== "text" && (
                    p.media_url ? (
                      p.tipo === "image" ? (
                        <img src={p.media_url} alt={p.rotulo || "imagem do roteiro"} className="max-h-32 rounded" loading="lazy" />
                      ) : p.tipo === "audio" ? (
                        <audio controls src={p.media_url} className="w-full h-8" />
                      ) : (
                        <a href={p.media_url} target="_blank" rel="noopener noreferrer" className="underline text-xs">
                          {p.file_name || "abrir arquivo"}
                        </a>
                      )
                    ) : (
                      <p className="text-xs text-destructive">Sem arquivo: suba no editor de roteiros.</p>
                    )
                  )}
                  {(p.tipo === "text" || texto) && (
                    <Textarea
                      value={texto}
                      placeholder={p.tipo === "text" ? "" : "Legenda (opcional)"}
                      onChange={(e) => setEditados((x) => ({ ...x, [p.id]: e.target.value }))}
                      className="min-h-[60px] text-[13px]"
                    />
                  )}
                  <Button size="sm" className="w-full h-8" disabled={!ok || enviando !== null} onClick={() => enviar(p)}>
                    {enviando === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-1" /> Enviar</>}
                  </Button>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
