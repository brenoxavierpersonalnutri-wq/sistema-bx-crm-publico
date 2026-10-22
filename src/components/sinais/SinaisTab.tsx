import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { format, parseISO, isBefore, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  HandCoins,
  Phone,
  Instagram,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  CalendarIcon,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarWithShortcuts } from "@/components/ui/calendar-with-shortcuts";
import { supabase } from "@/integrations/supabase/client";
import { numeroParaWhatsapp } from "@/lib/telefoneDaLead";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

type Origem = "consulta" | "aluna";
type StatusSinal = "pago" | "pendente" | "atrasado";

interface SinalRow {
  id: string;
  origem: Origem;
  consultationId?: string;
  alunaId?: string;
  nome: string;
  telefone: string | null;
  instagram: string | null;
  valor: number;
  dataCobranca: string | null;
  status: StatusSinal;
}

function deriveStatus(dataCobranca: string | null, pago: boolean): StatusSinal {
  if (pago) return "pago";
  if (!dataCobranca) return "pendente";
  try {
    const d = startOfDay(parseISO(dataCobranca));
    const hoje = startOfDay(new Date());
    if (isBefore(d, hoje)) return "atrasado";
    return "pendente";
  } catch {
    return "pendente";
  }
}

export function SinaisTab() {
  const [rows, setRows] = useState<SinalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<StatusSinal | "todos">("todos");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // IDs marcados como "Não pagou" nesta sessão. Removemos da tela na hora
  // (otimista) e mascaramos em qualquer load() subsequente — assim a linha
  // some IMEDIATAMENTE e não reaparece por replica lag do Supabase ou por
  // um reload disparado pelos event listeners logo em seguida.
  const dismissedRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: consultas, error: cErr } = await supabase
        .from("consultations")
        .select(
          "id, client_name, client_phone, instagram, signal_value, signal_follow_up_date, signal_residue_paid, refunded, status"
        )
        .eq("gave_signal", true)
        .or("refunded.is.null,refunded.eq.false");
      if (cErr) throw cErr;

      const { data: alunas, error: aErr } = await supabase
        .from("alunas" as any)
        // "*" e não a lista de colunas: assim a tela não quebra antes da coluna
        // is_teste existir no banco (ela só serve pra tirar a aluna de teste daqui).
        .select("*")
        .eq("deu_sinal", true);
      if (aErr) throw aErr;

      const consultaRows: SinalRow[] = (consultas || [])
        // Esconde quem foi marcado como "Não pagou" (status="não convertido")
        .filter((c: any) => c.status !== "não convertido")
        .map((c: any) => ({
          id: `c:${c.id}`,
          origem: "consulta" as const,
          consultationId: c.id,
          nome: c.client_name,
          telefone: c.client_phone,
          instagram: c.instagram,
          valor: Number(c.signal_value) || 0,
          dataCobranca: c.signal_follow_up_date,
          status: deriveStatus(c.signal_follow_up_date, c.signal_residue_paid === true),
        }));

      const alunaRows: SinalRow[] = (alunas || [])
        .filter((a: any) => a.is_teste !== true)
        .filter(
          (a: any) => !a.origem_lead || !String(a.origem_lead).startsWith("consulta:")
        )
        .map((a: any) => ({
          id: `a:${a.id}`,
          origem: "aluna" as const,
          alunaId: a.id,
          nome: a.nome_completo,
          telefone: a.telefone,
          instagram: null,
          valor: Number(a.valor_sinal) || 0,
          dataCobranca: a.data_cobranca_sinal,
          status: deriveStatus(
            a.data_cobranca_sinal,
            a.residuo_pago === true || a.pago === true
          ),
        }));

      const statusOrder: Record<StatusSinal, number> = {
        atrasado: 0,
        pendente: 1,
        pago: 2,
      };
      const all = [...consultaRows, ...alunaRows].sort((x, y) => {
        if (statusOrder[x.status] !== statusOrder[y.status])
          return statusOrder[x.status] - statusOrder[y.status];
        if (!x.dataCobranca && !y.dataCobranca) return 0;
        if (!x.dataCobranca) return 1;
        if (!y.dataCobranca) return -1;
        return x.dataCobranca.localeCompare(y.dataCobranca);
      });
      // Respeita as remoções otimistas da sessão (não pagou).
      setRows(all.filter((r) => !dismissedRef.current.has(r.id)));
    } catch (err: any) {
      toast({
        title: "Erro ao carregar sinais",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener("alunas-updated", handler);
    window.addEventListener("consultations-updated", handler);
    return () => {
      window.removeEventListener("alunas-updated", handler);
      window.removeEventListener("consultations-updated", handler);
    };
  }, [load]);

  const counts = useMemo(() => {
    const c = { todos: rows.length, pago: 0, pendente: 0, atrasado: 0 };
    rows.forEach((r) => {
      c[r.status]++;
    });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    if (filter === "todos") return rows;
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const totalValor = useMemo(
    () => filtered.reduce((s, r) => s + r.valor, 0),
    [filtered]
  );

  // Edição inline da data de cobrança. Sincroniza consulta + aluna vinculada
  // pra manter os dois lados em sync (mesmo padrão dos outros handlers).
  const handleUpdateDate = async (row: SinalRow, newDate: Date | undefined) => {
    const isoDate = newDate ? format(newDate, "yyyy-MM-dd") : null;
    try {
      if (row.origem === "consulta" && row.consultationId) {
        const { error } = await supabase
          .from("consultations")
          .update({
            signal_follow_up_date: isoDate,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.consultationId);
        if (error) throw error;
        // Espelha pra aluna vinculada (se existir).
        await supabase
          .from("alunas" as any)
          .update({ data_cobranca_sinal: isoDate })
          .eq("origem_lead", `consulta:${row.consultationId}`);
      } else if (row.origem === "aluna" && row.alunaId) {
        const { error } = await supabase
          .from("alunas" as any)
          .update({ data_cobranca_sinal: isoDate })
          .eq("id", row.alunaId);
        if (error) throw error;
      }
      toast({
        title: "Data atualizada",
        description: isoDate
          ? `${row.nome} agora vai ser cobrada em ${format(newDate!, "dd/MM/yyyy", { locale: ptBR })}.`
          : `Data de cobrança de ${row.nome} foi limpada.`,
      });
      queryClient.invalidateQueries({ queryKey: ["consultations"] });
      queryClient.invalidateQueries({ queryKey: ["alunas"] });
      window.dispatchEvent(new Event("alunas-updated"));
      window.dispatchEvent(new Event("consultations-updated"));
      load();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const handleMarkPaid = async (row: SinalRow) => {
    try {
      if (row.origem === "consulta" && row.consultationId) {
        const { error } = await supabase
          .from("consultations")
          .update({
            signal_residue_paid: true,
            converted: true,
            attended: true,
            status: "convertido",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.consultationId);
        if (error) throw error;
        await supabase
          .from("alunas" as any)
          .update({ residuo_pago: true, pago: true })
          .eq("origem_lead", `consulta:${row.consultationId}`);
      } else if (row.origem === "aluna" && row.alunaId) {
        const { error } = await supabase
          .from("alunas" as any)
          .update({ residuo_pago: true, pago: true })
          .eq("id", row.alunaId);
        if (error) throw error;
      }
      toast({ title: "Pago!", description: `${row.nome} marcada como paga.` });
      queryClient.invalidateQueries({ queryKey: ["consultations"] });
      queryClient.invalidateQueries({ queryKey: ["alunas"] });
      window.dispatchEvent(new Event("alunas-updated"));
      window.dispatchEvent(new Event("consultations-updated"));
      load();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const handleMarkUnpaid = async (row: SinalRow) => {
    if (
      !confirm(
        `Marcar ${row.nome} como NÃO PAGOU o restante? A venda vai ser marcada como não convertida.`
      )
    )
      return;
    try {
      if (row.origem === "consulta" && row.consultationId) {
        const { error } = await supabase
          .from("consultations")
          .update({
            signal_residue_paid: false,
            converted: false,
            status: "não convertido",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.consultationId);
        if (error) throw error;
        await supabase
          .from("alunas" as any)
          .update({ residuo_pago: false, pago: false })
          .eq("origem_lead", `consulta:${row.consultationId}`);
      } else if (row.origem === "aluna" && row.alunaId) {
        // deu_sinal=false tira da lista (não tem coluna explícita de "marcado como não pagou")
        const { error } = await supabase
          .from("alunas" as any)
          .update({ residuo_pago: false, pago: false, deu_sinal: false })
          .eq("id", row.alunaId);
        if (error) throw error;
      }
      // Remoção otimista: some da tela AGORA e fica mascarado nos próximos
      // loads desta sessão. É o que garante "sair da tela" na hora.
      dismissedRef.current.add(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast({
        title: "Registrado",
        description: `${row.nome} marcada como não pagou o restante.`,
      });
      queryClient.invalidateQueries({ queryKey: ["consultations"] });
      queryClient.invalidateQueries({ queryKey: ["alunas"] });
      window.dispatchEvent(new Event("alunas-updated"));
      window.dispatchEvent(new Event("consultations-updated"));
      load();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  // Mesma regra do lembrete de sinal: o DDI entra só se faltar.
  const cleanPhone = (p: string | null) => numeroParaWhatsapp(p) ?? "";
  const cleanInsta = (i: string | null) => (i || "").replace(/^@/, "").trim();

  const StatusBadge = ({ status }: { status: StatusSinal }) => {
    if (status === "pago")
      return (
        <Badge className="bg-success/15 text-success hover:bg-success/20 border-success/30">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Pago
        </Badge>
      );
    if (status === "atrasado")
      return (
        <Badge variant="destructive">
          <AlertCircle className="h-3 w-3 mr-1" />
          Atrasado
        </Badge>
      );
    return (
      <Badge variant="outline">
        <Clock className="h-3 w-3 mr-1" />
        Pendente
      </Badge>
    );
  };

  const KpiCard = ({
    label,
    value,
    color,
    onClick,
    active,
  }: {
    label: string;
    value: number;
    color: string;
    onClick: () => void;
    active: boolean;
  }) => (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${
        active ? "ring-2 ring-primary" : ""
      }`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">
          {label}
        </div>
        <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <HandCoins className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Sinais</h2>
          <span className="text-sm text-muted-foreground">
            · {filtered.length} {filtered.length === 1 ? "registro" : "registros"} · R${" "}
            {totalValor.toFixed(2).replace(".", ",")}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          disabled={loading}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Todos"
          value={counts.todos}
          color="text-foreground"
          onClick={() => setFilter("todos")}
          active={filter === "todos"}
        />
        <KpiCard
          label="Pendentes"
          value={counts.pendente}
          color="text-foreground"
          onClick={() => setFilter("pendente")}
          active={filter === "pendente"}
        />
        <KpiCard
          label="Atrasados"
          value={counts.atrasado}
          color="text-destructive"
          onClick={() => setFilter("atrasado")}
          active={filter === "atrasado"}
        />
        <KpiCard
          label="Pagos"
          value={counts.pago}
          color="text-success"
          onClick={() => setFilter("pago")}
          active={filter === "pago"}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading && rows.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" />
              Carregando...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {filter === "todos"
                ? "Nenhum sinal registrado ainda."
                : `Nenhum sinal no status "${filter}".`}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead className="text-right">Sinal</TableHead>
                  <TableHead>Cobrar em</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const phone = cleanPhone(r.telefone);
                  const insta = cleanInsta(r.instagram);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.nome}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {r.origem === "consulta" ? "Consulta" : "Aluna"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 flex-wrap">
                          {phone && (
                            <a
                              href={`https://wa.me/${phone}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-success hover:underline"
                            >
                              <Phone className="h-3 w-3" />
                              WhatsApp
                            </a>
                          )}
                          {insta && (
                            <a
                              href={`https://instagram.com/${insta}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-pink-600 hover:underline"
                            >
                              <Instagram className="h-3 w-3" />@{insta}
                            </a>
                          )}
                          {!phone && !insta && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        R$ {r.valor.toFixed(2).replace(".", ",")}
                      </TableCell>
                      <TableCell>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2.5 gap-1.5 font-normal border-dashed hover:border-primary hover:bg-primary/5 hover:text-primary group"
                              title="Clique pra editar a data de cobrança"
                            >
                              <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
                              {r.dataCobranca
                                ? format(parseISO(r.dataCobranca), "dd/MM/yyyy", { locale: ptBR })
                                : "definir data"}
                              <Pencil className="h-3 w-3 ml-0.5 text-muted-foreground/60 group-hover:text-primary" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <CalendarWithShortcuts
                              selected={r.dataCobranca ? parseISO(r.dataCobranca) : undefined}
                              onSelect={(d) => handleUpdateDate(r, d)}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {r.status !== "pago" && (
                          <div className="flex items-center justify-end gap-2 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-success text-success hover:bg-success hover:text-white"
                              onClick={() => handleMarkPaid(r)}
                            >
                              Marcar pago
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-destructive text-destructive hover:bg-destructive hover:text-white"
                              onClick={() => handleMarkUnpaid(r)}
                            >
                              Não pagou
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
