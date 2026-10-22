// Escolhe a mensagem: um roteiro inteiro (até o primeiro passo que espera resposta) ou um passo dele.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEtapas } from "@/hooks/useEtapas";
import type { PassoOpcao, RoteiroOpcao } from "./useCatalogo";

const INTEIRO = "__inteiro__";

export function SeletorMensagem({
  roteiros,
  passos,
  roteiroId,
  passoId,
  onChange,
}: {
  roteiros: RoteiroOpcao[];
  passos: PassoOpcao[];
  roteiroId: string | null;
  passoId: string | null;
  onChange: (v: { roteiro_id: string | null; passo_id: string | null }) => void;
}) {
  const { nomeEtapa } = useEtapas();
  const doRoteiro = passos.filter((p) => p.roteiro_id === roteiroId);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Select value={roteiroId ?? ""} onValueChange={(v) => onChange({ roteiro_id: v, passo_id: null })}>
        <SelectTrigger><SelectValue placeholder="Roteiro" /></SelectTrigger>
        <SelectContent>
          {roteiros.map((r) => (
            <SelectItem key={r.id} value={r.id}>{nomeEtapa(r.stage)} · {r.nome}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={passoId ?? INTEIRO}
        onValueChange={(v) => onChange({ roteiro_id: roteiroId, passo_id: v === INTEIRO ? null : v })}
        disabled={!roteiroId}
      >
        <SelectTrigger><SelectValue placeholder="Passo" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={INTEIRO}>Roteiro inteiro (até esperar resposta)</SelectItem>
          {doRoteiro.map((p) => (
            <SelectItem key={p.id} value={p.id}>Passo {p.ordem} · {p.rotulo || p.tipo}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
