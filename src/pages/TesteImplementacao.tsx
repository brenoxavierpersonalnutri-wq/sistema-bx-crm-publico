import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Activity, CalendarCheck, Copy, ExternalLink, LogOut,
  MousePointerClick, RefreshCw, TrendingUp, UserCheck, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  buscarTesteImplementacao,
  comTaxas,
  FuncaoAusenteError,
  IMPLEMENTACAO_LINK,
  IMPLEMENTACAO_PAINEL,
  melhorVersao,
  periodoDoPreset,
  pctBR,
  PRESETS,
  totaisDe,
  type Periodo,
  type PresetPeriodo,
  type VersaoImplementacao,
} from "@/lib/implementacaoTeste";

const inputData =
  "h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50";

/**
 * Teste /r/implementacao (projeto da implementação) visto de dentro do Link
 * Master. Só leitura: editar variações continua no painel da implementação.
 */
export default function TesteImplementacao() {
  const { signOut } = useAuth();
  const { toast } = useToast();
  const [preset, setPreset] = useState<PresetPeriodo | "custom">("tudo");
  const [desde, setDesde] = useState("");
  const [ate, setAte] = useState("");
  const [versoes, setVersoes] = useState<VersaoImplementacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [faltaSql, setFaltaSql] = useState(false);
  const [carregando, setCarregando] = useState(false);

  const periodo: Periodo = useMemo(
    () => (preset === "custom" ? { desde: desde || undefined, ate: ate || undefined } : periodoDoPreset(preset)),
    [preset, desde, ate],
  );

  const carregar = (p: Periodo) => {
    setCarregando(true);
    setErro(null);
    setFaltaSql(false);
    buscarTesteImplementacao(p)
      .then((v) => setVersoes(v))
      .catch((e) => {
        setVersoes(null);
        if (e instanceof FuncaoAusenteError) setFaltaSql(true);
        else setErro(e?.message || "erro ao ler o banco da implementação");
      })
      .finally(() => setCarregando(false));
  };

  useEffect(() => { carregar(periodo); }, [periodo.desde, periodo.ate]); // eslint-disable-line react-hooks/exhaustive-deps

  const linhas = useMemo(() => (versoes ?? []).map(comTaxas), [versoes]);
  const totais = useMemo(() => totaisDe(versoes ?? []), [versoes]);
  const melhor = useMemo(() => melhorVersao(linhas), [linhas]);

  const kpis = [
    { icon: MousePointerClick, label: "Visitas", value: totais.visitas.toLocaleString("pt-BR"), sub: undefined, color: "text-primary" },
    { icon: Users, label: "Leads (quiz)", value: `${totais.leads}`, sub: pctBR(totais.taxa_lead), color: "text-amber-400" },
    { icon: UserCheck, label: "Qualificados", value: `${totais.qualificados}`, sub: pctBR(totais.taxa_qualificado), color: "text-sky-400" },
    { icon: CalendarCheck, label: "Agendamentos", value: `${totais.agendamentos}`, sub: pctBR(totais.taxa_agendamento), color: "text-emerald-400" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/teste">
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Voltar">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight">Implementação (BG)</h1>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-secondary text-muted-foreground px-2 py-0.5 rounded">Só leitura</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
                <p className="text-xs text-muted-foreground truncate max-w-md">{IMPLEMENTACAO_LINK}</p>
                <button
                  onClick={() => { navigator.clipboard.writeText(IMPLEMENTACAO_LINK); toast({ title: "Copiado!" }); }}
                  className="text-primary hover:text-primary/80"
                  aria-label="Copiar link do teste"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="gap-2" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sair
          </Button>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Período */}
        <div className="flex flex-wrap items-center gap-2" data-bloco="periodo">
          {PRESETS.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={preset === p.id ? "default" : "secondary"}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </Button>
          ))}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={preset === "custom" ? desde : periodo.desde ?? ""}
              onChange={(e) => { setPreset("custom"); setDesde(e.target.value); if (preset !== "custom") setAte(periodo.ate ?? ""); }}
              className={inputData}
              aria-label="De"
            />
            <span className="text-xs text-muted-foreground">até</span>
            <input
              type="date"
              value={preset === "custom" ? ate : periodo.ate ?? ""}
              onChange={(e) => { setPreset("custom"); setAte(e.target.value); if (preset !== "custom") setDesde(periodo.desde ?? ""); }}
              className={inputData}
              aria-label="Até"
            />
          </div>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => carregar(periodo)} disabled={carregando}>
            <RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground -mt-3">
          O período conta pela data da visita (dia de Brasília): lead e agendamento entram no dia em que a pessoa clicou no link.
        </p>

        {faltaSql ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-6 text-sm" data-estado="falta-sql">
            <p className="font-semibold text-foreground">O banco da implementação ainda não liberou a leitura deste teste.</p>
            <p className="mt-1 text-muted-foreground">
              Falta rodar o SQL <code>implementacao_teste_publico</code> no projeto da implementação. Enquanto isso, o teste continua visível no{" "}
              <a href={IMPLEMENTACAO_PAINEL} target="_blank" rel="noreferrer" className="text-primary underline">painel da implementação</a>.
            </p>
          </div>
        ) : erro ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive" data-estado="erro">
            Não consegui ler o banco da implementação: {erro}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {kpis.map((k) => (
                <div key={k.label} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <k.icon className={`h-4 w-4 ${k.color}`} />
                    <span className="text-xs">{k.label}</span>
                  </div>
                  <p className="mt-2 text-xl font-bold text-foreground" data-kpi={k.label}>
                    {versoes ? k.value : "…"}
                    {versoes && k.sub && <span className="text-sm font-normal text-muted-foreground ml-1">({k.sub})</span>}
                  </p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50">
                    <TableHead className="text-xs font-semibold uppercase tracking-wider">Versão</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-right" title="Cliques no /r/implementacao que caíram nesta versão">Visitas</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-right" title="Quiz enviado ÷ visitas">Leads</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-right" title="Nível A/B/C e não desqualificado ÷ visitas">Qualificados</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-right" title="Agendou no /agendar ÷ visitas">Agendamentos</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-right" title="Agendamentos ÷ leads">Agend./lead</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!versoes ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground text-sm">Carregando…</TableCell>
                    </TableRow>
                  ) : linhas.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground text-sm">
                        Nenhuma versão configurada no /r/implementacao.
                      </TableCell>
                    </TableRow>
                  ) : (
                    linhas.map((v) => {
                      const eMelhor = v.versao === melhor;
                      return (
                        <TableRow
                          key={`${v.ordem}-${v.versao}`}
                          data-versao={v.versao}
                          data-melhor={eMelhor ? "sim" : undefined}
                          className={`border-border/30 ${eMelhor ? "bg-primary/10 hover:bg-primary/15" : ""}`}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">{v.versao}</span>
                              {eMelhor && (
                                <span className="inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                                  <TrendingUp className="h-3 w-3" /> Melhor
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate max-w-xs mt-0.5">
                              {v.pagina} · peso {v.peso}
                            </p>
                          </TableCell>
                          <TableCell className="text-right font-medium">{v.visitas.toLocaleString("pt-BR")}</TableCell>
                          <Celula n={v.leads} taxa={v.taxa_lead} />
                          <Celula n={v.qualificados} taxa={v.taxa_qualificado} />
                          <Celula n={v.agendamentos} taxa={v.taxa_agendamento} destaque={eMelhor} />
                          <TableCell className="text-right text-muted-foreground">{v.leads > 0 ? pctBR(v.agendamento_por_lead) : "—"}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Melhor versão = maior agendamento ÷ visita (empate decide por qualificado e depois lead). Leads de teste não contam.
              Para mudar as versões ou os pesos, use o{" "}
              <a href={IMPLEMENTACAO_PAINEL} target="_blank" rel="noreferrer" className="text-primary underline">painel da implementação</a>.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function Celula({ n, taxa, destaque }: { n: number; taxa: number; destaque?: boolean }) {
  return (
    <TableCell className="text-right">
      <div className={`font-medium ${destaque ? "text-primary font-bold" : ""}`}>{n}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{pctBR(taxa)}</div>
    </TableCell>
  );
}
