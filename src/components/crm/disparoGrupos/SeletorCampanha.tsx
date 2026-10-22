import type { CampanhaGrupos, NumeroWhatsApp } from "@/lib/grupos";
import { rotuloCampanha } from "@/lib/disparoGrupos";

const seletor = "h-9 rounded-md border border-input bg-background px-2 text-sm max-w-full";

/** Escolha da campanha nas abas que trabalham numa campanha só (criação, configuração, membros). */
export function SeletorCampanha({
  campanhas, numeros, valor, onChange,
}: { campanhas: CampanhaGrupos[]; numeros: NumeroWhatsApp[]; valor: string | null; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Campanha</span>
      <select className={seletor} value={valor ?? ""} onChange={(e) => onChange(e.target.value)} aria-label="Campanha">
        <option value="" disabled>Escolha uma campanha</option>
        {campanhas.map((c) => (
          <option key={c.id} value={c.id}>{rotuloCampanha(c, numeros)}{c.encerrada ? " (encerrada)" : ""}</option>
        ))}
      </select>
    </div>
  );
}
