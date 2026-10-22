import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Settings2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type Periodo = "hoje" | "semana" | "mes" | "tudo";
type Filtro = "todas" | "compareceu" | "noshow" | "pitch" | "converteu";


type Consulta = {
  id: string;
  nome: string;
  data: string;
  attended: boolean | null;
  passouPitch: boolean;
  converteu: boolean;
};

type Linha = {
  id: string;
  nome: string;
  confirmadas: number;
  compareceram: number;
  noShow: number;
  passouPitch: number;
  converteram: number;
  consultas: Consulta[];
};

const STORAGE_KEY = "sdr-comissao-valores";

function lerValores() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { pitch: Number(p.pitch) || 10, conversao: Number(p.conversao) || 20 };
    }
  } catch { /* ignora */ }
  return { pitch: 10, conversao: 20 };
}

function inicioDe(p: Periodo): string | null {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === "hoje") return d.toISOString().slice(0, 10);
  if (p === "semana") { d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10); }
  if (p === "mes") { d.setDate(1); return d.toISOString().slice(0, 10); }
  return null;
}

const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 100) : 0);
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (d: string) => (d ? d.split("-").reverse().join("/") : "—");

export function SdrPerformance() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [detalhe, setDetalhe] = useState<Linha | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todas");

  const [configAberta, setConfigAberta] = useState(false);
  const [valores, setValores] = useState(lerValores);
  const { isAdmin } = useAuth();

  // Comissão: converteu vale o valor cheio e substitui os R$10 do pitch (não soma)
  const comissaoDe = (l: Linha) =>
    Math.max(l.passouPitch - l.converteram, 0) * valores.pitch + l.converteram * valores.conversao;

  const salvarValores = (pitch: number, conversao: number) => {
    const novo = { pitch, conversao };
    setValores(novo);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(novo));
    setConfigAberta(false);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["desempenho-sdr", periodo],
    queryFn: async () => {
      let q = supabase
        .from("consultations")
        .select("id, client_name, confirmed_by_user_id, attended, passed_pitch_01, converted, date")
        .eq("call_confirmed", true)
        .not("confirmed_by_user_id", "is", null);

      const ini = inicioDe(periodo);
      if (ini) q = q.gte("date", ini);

      const { data: consultas, error } = await q;
      if (error) throw error;

      const { data: perfis } = await supabase.from("profiles").select("id, full_name");
      const nomes = new Map((perfis ?? []).map((p) => [p.id, p.full_name || "Sem nome"]));

      const mapa = new Map<string, Linha>();
      for (const c of consultas ?? []) {
        const id = c.confirmed_by_user_id as string;
        if (!mapa.has(id)) {
          mapa.set(id, { id, nome: nomes.get(id) || "Sem nome", confirmadas: 0, compareceram: 0, noShow: 0, passouPitch: 0, converteram: 0, consultas: [] });
        }
        const l = mapa.get(id)!;
        const passou = c.attended === true && c.passed_pitch_01 === true;
        l.confirmadas += 1;
        if (c.attended === true) l.compareceram += 1;
        if (c.attended === false) l.noShow += 1;
        // Só conta o pitch de quem apareceu — é isso que separa lead qualificada de curiosa
        if (passou) l.passouPitch += 1;
        if (c.converted === true) l.converteram += 1;
        l.consultas.push({
          id: c.id,
          nome: c.client_name || "Sem nome",
          data: (c.date as string) ?? "",
          attended: c.attended,
          passouPitch: passou,
          converteu: c.converted === true,
        });
      }
      const linhas = [...mapa.values()].sort((a, b) => b.confirmadas - a.confirmadas);
      linhas.forEach((l) => l.consultas.sort((a, b) => (a.data < b.data ? 1 : -1)));
      return linhas;
    },
  });

  const total = useMemo(() => {
    const z = { confirmadas: 0, compareceram: 0, noShow: 0, passouPitch: 0, converteram: 0 };
    (data ?? []).forEach((l) => {
      z.confirmadas += l.confirmadas; z.compareceram += l.compareceram;
      z.noShow += l.noShow; z.passouPitch += l.passouPitch; z.converteram += l.converteram;
    });
    return z;
  }, [data]);

  const totalComissao = useMemo(
    () => (data ?? []).reduce((s, l) => s + comissaoDe(l), 0),
    [data, valores],
  );

  const periodos: { v: Periodo; r: string }[] = [
    { v: "hoje", r: "Hoje" }, { v: "semana", r: "Semana" },
    { v: "mes", r: "Mês" }, { v: "tudo", r: "Tudo" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-xl">
          Baseado em quem confirmou cada consulta. Passou do Pitch 01 só conta para quem compareceu.
          Clique no nome do colaborador para ver os leads.
        </p>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button size="sm" variant="outline" className="gap-2" onClick={() => setConfigAberta(true)}>
              <Settings2 className="h-4 w-4" /> Valores
            </Button>
          )}
          <div className="flex gap-1 rounded-lg border p-1">
            {periodos.map((p) => (
              <Button key={p.v} size="sm" variant={periodo === p.v ? "default" : "ghost"}
                onClick={() => setPeriodo(p.v)}>{p.r}</Button>
            ))}
          </div>
        </div>
      </div>
    {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : !data || data.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          Nenhuma confirmação com autor registrado neste período. A partir de agora, toda vez que
          alguém marcar uma consulta como confirmada, o sistema pergunta quem confirmou — e os
          números aparecem aqui.
        </CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            {[
              { r: "Confirmadas", v: total.confirmadas },
              { r: "Compareceram", v: `${pct(total.compareceram, total.confirmadas)}%` },
              { r: "No-show", v: `${pct(total.noShow, total.confirmadas)}%` },
              { r: "Passou Pitch 01", v: `${pct(total.passouPitch, total.confirmadas)}%` },
              { r: "Converteram", v: `${pct(total.converteram, total.confirmadas)}%` },
              { r: "Comissão total", v: brl(totalComissao) },
            ].map((k) => (
              <Card key={k.r}>
                <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground">{k.r}</CardTitle></CardHeader>
                <CardContent className="pt-0 text-2xl font-semibold tabular-nums">{k.v}</CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Por colaborador</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-right [&>th:first-child]:text-left">
                    <th>Colaborador</th><th>Confirmadas</th><th>Compareceu</th>
                    <th>No-show</th><th>Passou Pitch 01</th><th>Converteu</th><th>Comissão</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((l) => (
                    <tr key={l.id} className="border-b last:border-0 [&>td]:px-4 [&>td]:py-3 [&>td]:text-right [&>td:first-child]:text-left tabular-nums">
                      <td>
                        <button className="font-medium text-primary underline-offset-4 hover:underline"
                          onClick={() => { setFiltro("todas"); setDetalhe(l); }}>{l.nome}</button>
                      </td>
                      <td>{l.confirmadas}</td>
                      <td>{l.compareceram} <span className="text-muted-foreground">({pct(l.compareceram, l.confirmadas)}%)</span></td>
                      <td>{l.noShow} <span className="text-muted-foreground">({pct(l.noShow, l.confirmadas)}%)</span></td>
                      <td className="font-medium">{l.passouPitch} <span className="text-muted-foreground">({pct(l.passouPitch, l.confirmadas)}%)</span></td>
                      <td>{l.converteram} <span className="text-muted-foreground">({pct(l.converteram, l.confirmadas)}%)</span></td>
                      <td className="font-semibold">{brl(comissaoDe(l))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            A coluna que define pagamento por performance é <strong>Passou Pitch 01</strong> somada a{" "}
            <strong>Converteu</strong>. Comissão: {brl(valores.pitch)} por lead que passou do Pitch 01 e{" "}
            {brl(valores.conversao)} por conversão — quem converteu conta só o valor da conversão, sem somar o pitch.
          </p>
        </>
      )}

      {/* Detalhe do colaborador */}
      <Dialog open={!!detalhe} onOpenChange={(o) => !o && setDetalhe(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{detalhe?.nome}</DialogTitle></DialogHeader>
          {detalhe && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
                {([
                  ["todas", "Confirmadas", detalhe.confirmadas],
                  ["compareceu", "Compareceu", detalhe.compareceram],
                  ["noshow", "No-show", detalhe.noShow],
                  ["pitch", "Passou Pitch", detalhe.passouPitch],
                  ["converteu", "Converteu", detalhe.converteram],
                ] as [Filtro, string, number][]).map(([f, r, v]) => (
                  <button
                    key={r}
                    onClick={() => setFiltro(f)}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      filtro === f ? "border-primary bg-primary/10" : "hover:bg-muted/50"
                    }`}
                  >
                    <p className="text-xs text-muted-foreground">{r}</p>
                    <p className="text-lg font-semibold tabular-nums">{v}</p>
                  </button>
                ))}
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                Comissão do período: <strong>{brl(comissaoDe(detalhe))}</strong>{" "}
                <span className="text-muted-foreground">
                  ({Math.max(detalhe.passouPitch - detalhe.converteram, 0)} × {brl(valores.pitch)} +{" "}
                  {detalhe.converteram} × {brl(valores.conversao)})
                </span>
              </div>
              <div className="max-h-[45vh] overflow-y-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b bg-background text-xs text-muted-foreground">
                    <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                      <th>Lead</th><th>Data</th><th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalhe.consultas.filter((c) =>
                      filtro === "compareceu" ? c.attended === true
                      : filtro === "noshow" ? c.attended === false
                      : filtro === "pitch" ? c.passouPitch
                      : filtro === "converteu" ? c.converteu
                      : true
                    ).map((c) => (
                      <tr key={c.id} className="border-b last:border-0 [&>td]:px-3 [&>td]:py-2">
                        <td className="font-medium">{c.nome}</td>
                        <td className="tabular-nums text-muted-foreground">{dataBr(c.data)}</td>
                        <td className="space-x-1">
                          {c.attended === true && <Badge variant="secondary">Compareceu</Badge>}
                          {c.attended === false && <Badge variant="destructive">No-show</Badge>}
                          {c.attended === null && <Badge variant="outline">Sem retorno</Badge>}
                          {c.passouPitch && <Badge variant="secondary">Pitch 01</Badge>}
                          {c.converteu && <Badge>Converteu</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Configuração de valores (admin) */}
      <Dialog open={configAberta} onOpenChange={setConfigAberta}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Valores de comissão</DialogTitle></DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget as HTMLFormElement);
              salvarValores(Number(f.get("pitch")) || 0, Number(f.get("conversao")) || 0);
            }}
          >
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="pitch">Passou do Pitch 01 (R$)</label>
              <Input id="pitch" name="pitch" type="number" min={0} step="0.01" defaultValue={valores.pitch} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="conversao">Converteu (R$)</label>
              <Input id="conversao" name="conversao" type="number" min={0} step="0.01" defaultValue={valores.conversao} />
              <p className="text-xs text-muted-foreground">Substitui o valor do pitch, não soma.</p>
            </div>
            <Button type="submit" className="w-full">Salvar</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
