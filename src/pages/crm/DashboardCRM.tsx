// /crm — Dashboard do CRM: conversas, mensagens, funil por etapa, não respondidas, disparos e números.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, Clock, Database, Loader2, MessageSquarePlus, PauseCircle,
  RefreshCw, Send, Workflow, XCircle,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Button } from "@/components/ui/button";
import { useEtapas } from "@/hooks/useEtapas";
import { COR_ESTADO_NUMERO } from "@/components/crm/layout/corEstado";
import { useDashboardCRM } from "@/hooks/useDashboardCRM";
import { formatarTelefone } from "@/lib/crm/central";
import { PERIODOS, fmtPct, inicioDoPeriodo, montarFunil, tempoDesde, type PeriodoDashboard } from "@/lib/crm/dashboard";
import { FunilOrigemIA } from "@/components/crm/ia/FunilOrigemIA";
import { contarPrecisaHumano } from "@/lib/crm/roboIA";

const CORES_ETAPA = ["hsl(var(--primary))", "#0ea5e9", "#f59e0b", "#8b5cf6", "#10b981", "#a1a1aa"];
const HORAS_OPCOES = [2, 6, 24];
const num = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("pt-BR"));

function Cartao({ titulo, children, className = "", acao }: { titulo: string; children: React.ReactNode; className?: string; acao?: React.ReactNode }) {
  return (
    <section className={`rounded-xl border bg-card p-4 md:p-5 ${className}`} aria-label={titulo}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className="text-base font-bold tracking-tight">{titulo}</h3>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Numero({ rotulo, valor, Icone, destaque }: { rotulo: string; valor: string; Icone: typeof Send; destaque?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 md:p-5">
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{rotulo}</span>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-secondary">
          <Icone className={`h-4 w-4 ${destaque ?? "text-primary"}`} />
        </span>
      </div>
      <div className="mt-2 text-3xl font-bold tracking-tight tabular-nums">{valor}</div>
    </div>
  );
}

/** Conversas que a IA passou para o humano e ninguém atendeu ainda (some sem a migration do robô). */
function PrecisaHumano({ versao }: { versao: unknown }) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let vivo = true;
    contarPrecisaHumano().then((v) => { if (vivo) setN(v); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [versao]);
  if (n === null) return null;
  return (
    <Link
      to="/crm/conversas"
      data-testid="dashboard-precisa-humano"
      className={`flex items-center justify-between gap-3 rounded-xl border p-4 shadow-sm ${n ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" : "bg-card"}`}
    >
      <span className="text-sm">
        <b className="text-2xl tabular-nums mr-2">{n.toLocaleString("pt-BR")}</b>
        {n === 1 ? "conversa precisa de humano" : "conversas precisam de humano"} (a IA transferiu e ninguém respondeu)
      </span>
      <span className="text-xs text-muted-foreground">Abrir conversas</span>
    </Link>
  );
}

export default function DashboardCRM() {
  const [periodo, setPeriodo] = useState<PeriodoDashboard>("7d");
  const [horas, setHoras] = useState(6);
  const { dados, carregando, recarregar } = useDashboardCRM(periodo, horas);
  const { colunas: KANBAN_COLUMNS } = useEtapas(); // etapas ativas de crm_etapas
  // memorizado: inicioDoPeriodo usa o relógio, e um ISO novo a cada render refaria a busca sem parar
  const desdeIA = useMemo(() => inicioDoPeriodo(periodo), [periodo]);
  const rotuloPeriodo = PERIODOS.find((p) => p.id === periodo)?.rotulo.toLowerCase();

  const funil = dados ? montarFunil(dados.novosPorEtapa, KANBAN_COLUMNS) : [];
  const topoFunil = Math.max(1, funil[0]?.alcancaram ?? 0);
  const fatias = dados
    ? [
        ...KANBAN_COLUMNS.map((c) => ({ nome: c.title, valor: dados.distribuicao[c.id] ?? 0 })),
        ...(dados.distribuicaoOutras ? [{ nome: "Outras etapas", valor: dados.distribuicaoOutras }] : []),
      ]
    : [];
  const totalDist = fatias.reduce((s, f) => s + f.valor, 0);

  return (
    <div className="px-4 py-5 md:px-8 md:py-7 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border bg-card p-0.5" role="tablist" aria-label="Período">
            {PERIODOS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={periodo === p.id}
                onClick={() => setPeriodo(p.id)}
                className={`h-8 px-3 rounded-md text-sm transition-colors ${periodo === p.id ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"}`}
              >
                {p.rotulo}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="h-8" onClick={recarregar} disabled={carregando} title="Atualizar">
            {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {!dados ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
      ) : (
        <>
          <PrecisaHumano versao={dados} />
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Numero rotulo={`Conversas novas (${rotuloPeriodo})`} valor={num(dados.conversasNovas)} Icone={MessageSquarePlus} />
            <Numero rotulo="Mensagens recebidas" valor={num(dados.recebidas)} Icone={ArrowDownLeft} destaque="text-sky-500" />
            <Numero rotulo="Mensagens enviadas" valor={num(dados.enviadas)} Icone={ArrowUpRight} destaque="text-emerald-500" />
            <Numero rotulo="Novos na base de leads" valor={num(dados.baseLeadsNovos)} Icone={Database} />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Cartao titulo={`Funil: leads novos (${rotuloPeriodo}) por etapa`} className="lg:col-span-2">
              <ol className="space-y-2" aria-label="Funil por etapa">
                {funil.map((e, i) => (
                  <li key={e.id} data-testid="etapa-funil">
                    {i > 0 && (
                      <div className="pl-2 text-[11px] text-muted-foreground" title="Dos que chegaram na etapa anterior, quantos chegaram até aqui">
                        ↓ {fmtPct(e.conversao)}
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-sm truncate">{e.titulo}</span>
                      <div className="flex-1 h-7 rounded-md bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-md flex items-center justify-end pr-2 text-xs font-medium text-primary-foreground transition-all"
                          style={{ width: `${Math.max(e.alcancaram ? 6 : 0, (e.alcancaram / topoFunil) * 100)}%`, background: CORES_ETAPA[i] }}
                        >
                          {e.alcancaram || ""}
                        </div>
                      </div>
                      <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{e.naEtapa} parado(s)</span>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-muted-foreground">
                Barra = contatos criados no período que chegaram até a etapa (os que estão nela e nas seguintes). Grupos não entram.
              </p>
            </Cartao>

            <Cartao titulo="Distribuição por etapa (todos os contatos)">
              {totalDist === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum contato ainda.</p>
              ) : (
                <>
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={fatias} dataKey="valor" nameKey="nome" innerRadius="60%" outerRadius="90%" paddingAngle={2} stroke="none">
                          {fatias.map((_, i) => <Cell key={i} fill={CORES_ETAPA[i % CORES_ETAPA.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => v.toLocaleString("pt-BR")} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {fatias.map((f, i) => (
                      <li key={f.nome} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: CORES_ETAPA[i % CORES_ETAPA.length] }} />
                          <span className="truncate">{f.nome}</span>
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {f.valor.toLocaleString("pt-BR")} · {fmtPct(f.valor / totalDist)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Cartao>
          </div>

          <FunilOrigemIA desde={desdeIA} />

          <div className="grid gap-3 lg:grid-cols-3">
            <Cartao
              titulo={`Sem resposta há mais de ${horas} h`}
              acao={
                <select
                  aria-label="Horas sem resposta"
                  value={horas}
                  onChange={(e) => setHoras(Number(e.target.value))}
                  className="h-7 rounded-md border bg-background px-2 text-xs"
                >
                  {HORAS_OPCOES.map((h) => <option key={h} value={h}>{h} h</option>)}
                </select>
              }
            >
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-bold tabular-nums ${dados.semResposta.length ? "text-amber-600" : ""}`}>{dados.semResposta.length}</span>
                <span className="text-xs text-muted-foreground">conversa(s) com a última mensagem do cliente</span>
              </div>
              <ul className="mt-3 divide-y text-sm">
                {dados.semResposta.slice(0, 6).map((s) => (
                  <li key={s.phone}>
                    <Link to={`/crm/conversas?abrir=${encodeURIComponent(s.phone)}`} className="flex items-center justify-between gap-2 py-1.5 hover:underline">
                      <span className="truncate">{s.nome && s.nome !== s.phone ? s.nome : formatarTelefone(s.phone)}</span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0"><Clock className="h-3 w-3" />{tempoDesde(s.horas)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Olha as conversas com movimento nos últimos 7 dias{dados.semRespostaParcial ? " (janela cheia: pode haver mais)" : ""}.
              </p>
            </Cartao>

            <Cartao titulo={`Disparos e automações (${rotuloPeriodo})`} acao={<Link to="/crm/automacao" className="text-xs text-primary hover:underline">Abrir</Link>}>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs text-muted-foreground flex items-center gap-1"><Send className="h-3 w-3" />Enviados</div><div className="text-2xl font-bold tabular-nums">{num(dados.disparosOk)}</div></div>
                <div><div className="text-xs text-muted-foreground flex items-center gap-1"><XCircle className="h-3 w-3" />Falhas</div><div className={`text-2xl font-bold tabular-nums ${dados.disparosFalha ? "text-red-600" : ""}`}>{num(dados.disparosFalha)}</div></div>
                <div><div className="text-xs text-muted-foreground flex items-center gap-1"><PauseCircle className="h-3 w-3" />Campanhas pausadas</div><div className="text-2xl font-bold tabular-nums">{num(dados.campanhasPausadas)}</div></div>
                <div><div className="text-xs text-muted-foreground flex items-center gap-1"><Workflow className="h-3 w-3" />Ligados</div><div className="text-sm mt-1"><b className="tabular-nums">{num(dados.automacoesLigadas)}</b> automações · <b className="tabular-nums">{num(dados.fluxosLigados)}</b> fluxos</div></div>
              </div>
              {dados.envioPausado && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" />Envio automático pausado no número principal.</p>
              )}
            </Cartao>

            <Cartao titulo="Números de WhatsApp" acao={<Link to="/crm/conexoes" className="text-xs text-primary hover:underline">Conexões</Link>}>
              <ul className="space-y-2 text-sm">
                {dados.numeros.map((n) => {
                  const st = dados.status.get(n.id);
                  return (
                    <li key={n.id} className="flex items-center justify-between gap-2" title={st?.aviso ?? undefined}>
                      <span className="flex items-center gap-2 min-w-0">
                        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${COR_ESTADO_NUMERO[st?.estado ?? "desconhecido"]}`} aria-hidden />
                        <span className="truncate">{n.apelido}</span>
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">{n.ativo ? st?.rotulo ?? "lendo..." : "desativado"}</span>
                    </li>
                  );
                })}
              </ul>
            </Cartao>
          </div>
        </>
      )}
    </div>
  );
}
