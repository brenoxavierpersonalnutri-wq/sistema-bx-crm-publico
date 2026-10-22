// Cartão de UM número de WhatsApp na Central de Automação: status, tipo, uso do dia e o que está ligado.
import { BadgeCheck, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatarTelefone, type NumeroCRM, type StatusNumero } from "@/lib/crm/central";

const COR_ESTADO: Record<StatusNumero["estado"], string> = {
  conectado: "bg-emerald-500",
  qr: "bg-amber-500",
  desconectado: "bg-red-500",
  sem_ponte: "bg-zinc-400",
  oficial: "bg-sky-500",
  desconhecido: "bg-zinc-400",
};

export function CartaoNumero({
  numero,
  status,
  envios,
  fluxos,
  automacoes,
  selecionado,
  onClick,
}: {
  numero: NumeroCRM;
  status: StatusNumero | undefined;
  envios: number;
  fluxos: number;
  automacoes: number;
  selecionado: boolean;
  onClick: () => void;
}) {
  const telefone = formatarTelefone(numero.telefone ?? status?.telefone);
  const pct = Math.min(100, Math.round((envios / Math.max(1, numero.max_dia)) * 100));
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selecionado}
      className={`text-left rounded-xl border p-4 transition hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        selecionado ? "border-primary ring-1 ring-primary bg-primary/5" : "bg-card"
      } ${numero.ativo ? "" : "opacity-60"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold truncate flex items-center gap-1.5">
            {numero.tipo === "oficial" ? <BadgeCheck className="h-4 w-4 text-sky-500 shrink-0" /> : <Smartphone className="h-4 w-4 text-muted-foreground shrink-0" />}
            {numero.apelido}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {telefone || "número não informado"}
            {numero.sessao_openwa ? ` · sessão ${numero.sessao_openwa}` : ""}
          </div>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {numero.tipo === "oficial" ? "oficial" : "não oficial"}
        </Badge>
      </div>

      <div className="mt-3 flex items-center gap-2 text-sm" title={status?.aviso ?? undefined}>
        <span className={`h-2.5 w-2.5 rounded-full ${COR_ESTADO[status?.estado ?? "desconhecido"]}`} aria-hidden />
        <span>{numero.ativo ? status?.rotulo ?? "lendo..." : "desativado"}</span>
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Envios hoje</span>
          <span className="tabular-nums">{envios} / {numero.max_dia}</span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mt-3 flex gap-3 text-xs text-muted-foreground">
        <span><b className="text-foreground tabular-nums">{fluxos}</b> fluxo(s) ligado(s)</span>
        <span><b className="text-foreground tabular-nums">{automacoes}</b> automação(ões) ligada(s)</span>
      </div>
    </button>
  );
}
