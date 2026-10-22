import { useEffect, useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { rotatorApi, type RotatorLink } from "@/lib/rotatorApi";
import { PARAMETROS_PADRAO } from "@/lib/rotatorOtimizacao";

// Interruptor e parâmetros da otimização automática do teste. Quem calcula e
// grava os pesos é o banco (public.rotator_otimizar, gatilho + pg_cron).

const FASES: Record<string, string> = {
  validando: "Validando: tráfego igual até bater o volume mínimo",
  otimizando: "Otimizando: mais tráfego para quem converte mais",
  campea: "Campeã com 95% ou mais de confiança",
  sem_variacoes: "Sem variações",
};

const num = (v: unknown, padrao: number) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : padrao;
};

export function OtimizacaoPainel({
  link,
  onAtualizado,
  onErro,
}: {
  link: RotatorLink;
  onAtualizado: (link: RotatorLink) => void;
  onErro: (mensagem: string) => void;
}) {
  const disponivel = link.otim_ativa !== undefined;
  const [minVisitas, setMinVisitas] = useState(String(link.otim_min_visitas ?? PARAMETROS_PADRAO.minVisitas));
  const [minCompras, setMinCompras] = useState(String(link.otim_min_compras ?? PARAMETROS_PADRAO.minCompras));
  const [piso, setPiso] = useState(String(Math.round(num(link.otim_piso, PARAMETROS_PADRAO.piso) * 100)));
  const [teto, setTeto] = useState(String(Math.round(num(link.otim_teto, PARAMETROS_PADRAO.teto) * 100)));
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setMinVisitas(String(link.otim_min_visitas ?? PARAMETROS_PADRAO.minVisitas));
    setMinCompras(String(link.otim_min_compras ?? PARAMETROS_PADRAO.minCompras));
    setPiso(String(Math.round(num(link.otim_piso, PARAMETROS_PADRAO.piso) * 100)));
    setTeto(String(Math.round(num(link.otim_teto, PARAMETROS_PADRAO.teto) * 100)));
  }, [link.id, link.otim_min_visitas, link.otim_min_compras, link.otim_piso, link.otim_teto]);

  if (!disponivel) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
        Otimização automática indisponível: falta rodar a migration 20261016180000_rotator_otimizacao.sql no banco.
      </div>
    );
  }

  const salvar = async (ativa: boolean) => {
    const params = {
      otim_ativa: ativa,
      otim_min_visitas: Math.max(0, Math.round(num(minVisitas, PARAMETROS_PADRAO.minVisitas))),
      otim_min_compras: Math.max(0, Math.round(num(minCompras, PARAMETROS_PADRAO.minCompras))),
      otim_piso: Math.min(50, Math.max(0, num(piso, 5))) / 100,
      otim_teto: Math.min(100, Math.max(20, num(teto, 80))) / 100,
    };
    setSalvando(true);
    try {
      await rotatorApi.updateOtimizacao(link.id, params);
      const atualizado = await rotatorApi.getOne(link.id);
      if (atualizado) onAtualizado(atualizado);
    } catch (e) {
      onErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  };

  const recalcular = async () => {
    setSalvando(true);
    try {
      await rotatorApi.recalcularOtimizacao(link.id);
      const atualizado = await rotatorApi.getOne(link.id);
      if (atualizado) onAtualizado(atualizado);
    } catch (e) {
      onErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  };

  const campo = (rotulo: string, valor: string, set: (v: string) => void, sufixo?: string, titulo?: string) => (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground" title={titulo}>
      {rotulo}
      <div className="relative">
        <input
          type="number"
          min={0}
          value={valor}
          onChange={(e) => set(e.target.value)}
          className="h-8 w-24 rounded-md border border-border bg-secondary px-2 pr-6 text-sm text-foreground text-right focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        {sufixo && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs">{sufixo}</span>}
      </div>
    </label>
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="otimizacao-painel">
      <div className="flex flex-wrap items-center gap-3">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Otimização automática</span>
        <Switch
          checked={!!link.otim_ativa}
          disabled={salvando}
          onCheckedChange={(v) => salvar(v)}
          aria-label="Otimização automática"
        />
        <span className="text-xs text-muted-foreground">
          {link.otim_ativa ? FASES[link.otim_fase ?? ""] ?? "Ligada" : "Desligada: o sorteio usa os pesos manuais"}
        </span>
        {link.otim_ativa && (
          <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 text-xs" disabled={salvando} onClick={recalcular}>
            <RefreshCw className="h-3 w-3" /> Recalcular agora
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {campo("Mín. visitas por variação", minVisitas, setMinVisitas)}
        {campo("Mín. compras no teste", minCompras, setMinCompras)}
        {campo("Piso por variação", piso, setPiso, "%", "Tráfego mínimo que toda variação continua recebendo")}
        {campo("Teto da líder", teto, setTeto, "%", "Máximo da líder enquanto ela não tiver 95% de confiança")}
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={salvando} onClick={() => salvar(!!link.otim_ativa)}>
          Salvar parâmetros
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Thompson Sampling: o peso de cada variação é a probabilidade de ela ser a melhor (compras ÷ visitas), recalculada no
        máximo a cada hora ou a cada 300 visitas novas.
        {link.otim_ativa && link.otim_recalculado_em
          ? ` Último cálculo: ${new Date(link.otim_recalculado_em).toLocaleString("pt-BR")}.`
          : ""}
      </p>
    </div>
  );
}
