import { useCallback, useEffect, useState } from "react";
import { Ban, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { db, type CampanhaGrupos, type EnvioGrupo, type MensagemAgendada } from "@/lib/grupos";
import { statusDoDisparo } from "@/lib/disparoGrupos";

const ROTULO: Record<string, string> = {
  agendada: "Agendada", enviando: "Enviando", concluida: "Concluída", cancelada: "Cancelada", erro: "Erro", parcial: "Parcial",
};
const ROTULO_ENVIO: Record<EnvioGrupo["status"], string> = {
  pendente: "na fila", enviando: "enviando", enviado: "enviada", falhou: "erro", cancelado: "cancelada",
};
const COR_ENVIO: Record<EnvioGrupo["status"], string> = {
  pendente: "text-muted-foreground", enviando: "text-sky-400", enviado: "text-green-500", falhou: "text-destructive", cancelado: "text-muted-foreground line-through",
};

interface Grupo { id: string; mensagens: MensagemAgendada[] }

// Histórico dos disparos (mensagens com disparo_id), com status por grupo e cancelar o que ainda não saiu.
export function HistoricoDisparos({ campanhas, recarregar }: { campanhas: CampanhaGrupos[]; recarregar: number }) {
  const { toast } = useToast();
  const [disparos, setDisparos] = useState<Grupo[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [envios, setEnvios] = useState<Record<string, EnvioGrupo[]>>({});
  const [nomes, setNomes] = useState<Record<string, string>>({});

  const carregar = useCallback(async () => {
    const { data, error } = await db.from("grupos_mensagens").select("*").not("disparo_id", "is", null)
      .order("agendado_para", { ascending: false }).limit(150);
    if (error) { setDisparos([]); return; }
    const mapa = new Map<string, MensagemAgendada[]>();
    for (const m of (data ?? []) as MensagemAgendada[]) mapa.set(m.disparo_id!, [...(mapa.get(m.disparo_id!) ?? []), m]);
    setDisparos([...mapa].map(([id, mensagens]) => ({ id, mensagens })));
  }, []);
  useEffect(() => { carregar(); }, [carregar, recarregar]);
  useEffect(() => {
    if (!disparos.some((d) => d.mensagens.some((m) => m.status === "enviando" || m.status === "agendada"))) return;
    const t = setInterval(() => { carregar(); if (aberto) abrir(aberto, true); }, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disparos, aberto, carregar]);

  async function abrir(id: string, manter = false) {
    if (!manter && aberto === id) { setAberto(null); return; }
    setAberto(id);
    const d = disparos.find((x) => x.id === id);
    if (!d) return;
    const ids = d.mensagens.map((m) => m.id);
    const [{ data: ev }, { data: gs }] = await Promise.all([
      db.from("grupos_envios").select("*").in("mensagem_id", ids).order("proximo_em"),
      db.from("grupos_campanha_grupos").select("id, nome, chat_id").in("id", d.mensagens.flatMap((m) => m.grupos_alvo ?? [])),
    ]);
    setEnvios((e) => ({ ...e, [id]: (ev ?? []) as EnvioGrupo[] }));
    setNomes((n) => {
      const x = { ...n };
      for (const g of gs ?? []) x[g.id] = g.nome || g.chat_id || g.id;
      return x;
    });
  }

  async function cancelar(d: Grupo) {
    if (!confirm("Cancelar este disparo? O que ainda não saiu não sai mais.")) return;
    let erro = "";
    for (const m of d.mensagens.filter((x) => x.status === "agendada" || x.status === "enviando")) {
      const { error } = await db.rpc("grupos_cancelar_mensagem", { p_id: m.id });
      if (error) erro = error.message;
    }
    toast({ title: erro ? "Erro ao cancelar" : "Disparo cancelado", description: erro || undefined, variant: erro ? "destructive" : undefined });
    await carregar();
  }

  const nomeCampanha = (id: string) => {
    const c = campanhas.find((x) => x.id === id);
    return c ? (c.avulsa ? "Avulsos" : c.nome) : "campanha";
  };

  return (
    <div className="rounded-md border p-4 space-y-2" data-testid="historico-disparos">
      <div className="flex items-center gap-2">
        <p className="font-medium flex-1">Histórico de disparos</p>
        <Button size="icon" variant="ghost" onClick={carregar} title="Atualizar"><RefreshCw className="h-4 w-4" /></Button>
      </div>
      {!disparos.length && <p className="text-sm text-muted-foreground">Nenhum disparo ainda.</p>}
      {disparos.map((d) => {
        const m0 = d.mensagens[0];
        const st = statusDoDisparo(d.mensagens);
        const total = d.mensagens.reduce((t, m) => t + (m.total_grupos || (m.grupos_alvo?.length ?? 0)), 0);
        const enviados = d.mensagens.reduce((t, m) => t + m.enviados, 0);
        const falhas = d.mensagens.reduce((t, m) => t + m.falhas, 0);
        return (
          <div key={d.id} className="rounded-md border">
            <div className="flex flex-wrap items-center gap-2 p-3">
              <button type="button" onClick={() => abrir(d.id)} className="flex items-center gap-1 text-sm font-medium">
                {aberto === d.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {new Date(m0.agendado_para).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
              </button>
              <Badge variant="outline">{m0.tipo}</Badge>
              {m0.mencionar_todos && <Badge variant="secondary">@todos</Badge>}
              {m0.ptt && <Badge variant="secondary">nota de voz</Badge>}
              <Badge variant={st === "erro" ? "destructive" : st === "concluida" ? "default" : "secondary"}>{ROTULO[st]}</Badge>
              <span className="text-xs text-muted-foreground">{enviados}/{total} enviadas{falhas ? ` · ${falhas} erro(s)` : ""}</span>
              <span className="text-sm text-muted-foreground truncate flex-1 min-w-[120px]">{m0.texto ?? m0.nome_arquivo ?? ""}</span>
              {(st === "agendada" || st === "enviando") && (
                <Button size="sm" variant="ghost" onClick={() => cancelar(d)} title="Cancelar"><Ban className="h-4 w-4 mr-1" /> Cancelar</Button>
              )}
            </div>
            {d.mensagens.filter((m) => m.motivo).map((m) => <p key={m.id} className="px-3 pb-2 text-xs text-destructive">{nomeCampanha(m.campanha_id)}: {m.motivo}</p>)}
            {aberto === d.id && (
              <div className="border-t px-3 py-2 text-sm space-y-1">
                {d.mensagens.flatMap((m) => {
                  const linhas = (envios[d.id] ?? []).filter((e) => e.mensagem_id === m.id);
                  if (linhas.length) return linhas.map((e) => (
                    <div key={e.id} className="flex flex-wrap gap-2">
                      <span className="truncate max-w-[220px]">{nomes[e.grupo_id] ?? "grupo"}</span>
                      <span className={COR_ENVIO[e.status]}>{ROTULO_ENVIO[e.status]}</span>
                      <span className="text-xs text-muted-foreground">
                        {e.enviado_em ? new Date(e.enviado_em).toLocaleTimeString("pt-BR") : e.status === "pendente" ? `previsto ${new Date(e.proximo_em).toLocaleTimeString("pt-BR")}` : ""}
                      </span>
                      {e.erro && <span className="text-xs text-destructive">{e.erro}</span>}
                    </div>
                  ));
                  return (m.grupos_alvo ?? []).map((gid) => (
                    <div key={`${m.id}-${gid}`} className="flex flex-wrap gap-2">
                      <span className="truncate max-w-[220px]">{nomes[gid] ?? "grupo"}</span>
                      <span className="text-muted-foreground">{m.status === "agendada" ? "agendada" : ROTULO[m.status] ?? m.status}</span>
                    </div>
                  ));
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
