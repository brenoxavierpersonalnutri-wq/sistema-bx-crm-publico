import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { db, ocupacao, type CampanhaGrupos, type GrupoLinha, type MensagemAgendada } from "@/lib/grupos";

interface Clique { grupo_id: string | null; resultado: string; telefone_e164: string | null; created_at: string }

const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

// Relatório da campanha: cliques no link (por grupo, por dia, lotado/pausado), leads com telefone,
// mensagens enviadas/falhas e o último tick do disparador.
export function RelatorioGrupos({ campanha }: { campanha: CampanhaGrupos }) {
  const [carregando, setCarregando] = useState(true);
  const [cliques, setCliques] = useState<Clique[]>([]);
  const [grupos, setGrupos] = useState<GrupoLinha[]>([]);
  const [msgs, setMsgs] = useState<MensagemAgendada[]>([]);
  const [estado, setEstado] = useState<{ ultimo_tick: string | null; ultimo_resultado: Record<string, unknown> | null } | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true);
      const todos: Clique[] = [];
      for (let de = 0; de < 50_000; de += 1000) {
        const { data } = await db.from("grupos_cliques").select("grupo_id, resultado, telefone_e164, created_at")
          .eq("campanha_id", campanha.id).order("created_at", { ascending: true }).range(de, de + 999);
        todos.push(...((data ?? []) as Clique[]));
        if (!data || data.length < 1000) break;
      }
      const [{ data: gs }, { data: ms }, { data: est }] = await Promise.all([
        db.from("grupos_campanha_grupos").select("*").eq("campanha_id", campanha.id).order("ordem"),
        db.from("grupos_mensagens").select("*").eq("campanha_id", campanha.id),
        db.from("grupos_disparo_estado").select("ultimo_tick, ultimo_resultado").eq("id", 1).maybeSingle(),
      ]);
      if (!vivo) return;
      setCliques(todos);
      setGrupos((gs ?? []) as GrupoLinha[]);
      setMsgs((ms ?? []) as MensagemAgendada[]);
      setEstado(est ?? null);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [campanha.id]);

  if (carregando) return <Loader2 className="h-4 w-4 animate-spin" />;

  const porGrupo = new Map<string, number>();
  const porDia = new Map<string, number>();
  let lotado = 0, pausado = 0;
  const telefones = new Set<string>();
  for (const c of cliques) {
    if (c.grupo_id) porGrupo.set(c.grupo_id, (porGrupo.get(c.grupo_id) ?? 0) + 1);
    if (c.resultado === "lotado") lotado++;
    if (c.resultado === "pausado") pausado++;
    if (c.telefone_e164) telefones.add(c.telefone_e164);
    const d = dia(c.created_at);
    porDia.set(d, (porDia.get(d) ?? 0) + 1);
  }
  const dias = [...porDia.entries()].slice(-14);
  const maxDia = Math.max(1, ...dias.map(([, n]) => n));
  const entradas = grupos.reduce((s, g) => s + (g.entradas ?? 0), 0);
  const saidas = grupos.reduce((s, g) => s + (g.saidas ?? 0), 0);
  const enviados = msgs.reduce((s, m) => s + m.enviados, 0);
  const falhas = msgs.reduce((s, m) => s + m.falhas, 0);
  const cartao = "rounded-md border p-3";

  return (
    <div className="space-y-5">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-6">
        <div className={cartao}><div className="text-2xl font-bold">{cliques.length}</div><div className="text-xs text-muted-foreground">cliques no link</div></div>
        <div className={cartao}><div className="text-2xl font-bold">{telefones.size}</div><div className="text-xs text-muted-foreground">leads com telefone</div></div>
        <div className={cartao}><div className="text-2xl font-bold">{entradas}<span className="text-sm text-destructive"> −{saidas}</span></div><div className="text-xs text-muted-foreground">entradas / saídas (eventos)</div></div>
        <div className={cartao}><div className="text-2xl font-bold">{lotado + pausado}</div><div className="text-xs text-muted-foreground">sem vaga / pausado</div></div>
        <div className={cartao}><div className="text-2xl font-bold">{msgs.filter((m) => m.status === "concluida").length}/{msgs.length}</div><div className="text-xs text-muted-foreground">mensagens concluídas</div></div>
        <div className={cartao}><div className="text-2xl font-bold">{enviados}<span className="text-sm text-destructive">{falhas ? ` +${falhas} falha(s)` : ""}</span></div><div className="text-xs text-muted-foreground">envios a grupo</div></div>
      </div>

      <div>
        <p className="font-medium text-sm mb-2">Por grupo</p>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr><th className="py-1">Grupo</th><th>Cliques</th><th>Entradas</th><th>Saídas</th><th>Participantes</th><th>Ocupação</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <tr key={g.id} className="border-t">
                <td className="py-1 truncate max-w-[240px]">{g.nome || g.link_convite}{g.criado_pelo_crm ? <span className="text-xs text-muted-foreground"> · criado pelo CRM</span> : null}</td>
                <td>{porGrupo.get(g.id) ?? 0}</td>
                <td className="text-green-600">{g.entradas ?? 0}</td>
                <td className="text-destructive">{g.saidas ?? 0}</td>
                <td>{g.participantes ?? "-"}{g.participantes_em ? <span className="text-xs text-muted-foreground"> ({new Date(g.participantes_em).toLocaleTimeString("pt-BR", { timeStyle: "short" })})</span> : null}</td>
                <td>{Math.round((ocupacao(g) / campanha.limite_por_grupo) * 100)}%</td>
                <td className="text-xs">{g.travado === true ? "fechado" : g.travado === false ? "aberto" : "-"}{!g.ativo ? " · inativo" : g.cheio ? " · cheio" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dias.length > 0 && (
        <div>
          <p className="font-medium text-sm mb-2">Cliques por dia</p>
          <div className="flex items-end gap-1 h-28">
            {dias.map(([d, n]) => (
              <div key={d} className="flex flex-col items-center gap-1 flex-1 min-w-0" title={`${d}: ${n}`}>
                <span className="text-[10px] text-muted-foreground">{n}</span>
                <div className="w-full bg-primary/70 rounded-t" style={{ height: `${(n / maxDia) * 80}px` }} />
                <span className="text-[10px] text-muted-foreground">{d}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Disparador: último tick {estado?.ultimo_tick ? new Date(estado.ultimo_tick).toLocaleString("pt-BR") : "nunca"}
        {estado?.ultimo_resultado?.erro_allowlist ? ` · ERRO no proxy: ${String(estado.ultimo_resultado.erro_allowlist)}` : ""}
        {estado?.ultimo_resultado?.erro_criacao ? ` · ERRO na criação: ${String(estado.ultimo_resultado.erro_criacao)}` : ""}
        {entradas + saidas === 0 ? " · Entradas/saídas dependem dos eventos group.join/leave ligados no webhook da VPS." : ""}
      </p>
    </div>
  );
}
