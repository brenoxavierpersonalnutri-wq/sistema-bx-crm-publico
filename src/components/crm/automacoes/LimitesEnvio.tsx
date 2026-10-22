// Chave geral do envio não oficial, limites anti-ban por número e amostra do template oficial.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Play, Save, Send } from "lucide-react";
import { CONFIG_PADRAO, chamarAutomacoes, db, type ConfigEnvio } from "@/lib/crmAutomacoes";

const CAMPOS: { k: keyof ConfigEnvio; rotulo: string; min: number; max: number }[] = [
  { k: "max_hora", rotulo: "Máx. mensagens por hora", min: 1, max: 60 },
  { k: "max_dia", rotulo: "Máx. mensagens por dia", min: 1, max: 500 },
  { k: "hora_inicio", rotulo: "Começa às (h)", min: 6, max: 22 },
  { k: "hora_fim", rotulo: "Para às (h)", min: 7, max: 23 },
  { k: "intervalo_min", rotulo: "Intervalo mínimo (s)", min: 20, max: 3600 },
  { k: "intervalo_max", rotulo: "Intervalo máximo (s)", min: 20, max: 3600 },
];

export function LimitesEnvio() {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<ConfigEnvio>(CONFIG_PADRAO);
  const [existe, setExiste] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [uso, setUso] = useState({ hora: 0, dia: 0 });
  const [template, setTemplate] = useState("");
  const [amostra, setAmostra] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await db.from("crm_envio_config").select("*").eq("numero", "principal").maybeSingle();
    setExiste(Boolean(data));
    if (data) setCfg(data as ConfigEnvio);
    const base = () => db.from("crm_automacao_log").select("id", { count: "exact", head: true }).eq("canal", "whatsapp").eq("status", "ok");
    const { count: hora } = await base().gte("created_at", new Date(Date.now() - 3600_000).toISOString());
    const hoje = new Date(`${new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)}T00:00:00-03:00`);
    const { count: dia } = await base().gte("created_at", hoje.toISOString());
    setUso({ hora: hora ?? 0, dia: dia ?? 0 });
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const gravar = async (p: Partial<ConfigEnvio>) => {
    setSalvando(true);
    const { error } = await db.from("crm_envio_config").update({ ...p, atualizado_em: new Date().toISOString() }).eq("numero", "principal");
    setSalvando(false);
    if (error) return toast({ title: "Não salvou", description: error.message, variant: "destructive" });
    toast({ title: "Salvo" });
    carregar();
  };

  const salvarLimites = () => {
    for (const c of CAMPOS) {
      const v = Number(cfg[c.k]);
      if (!Number.isInteger(v) || v < c.min || v > c.max) return toast({ title: `${c.rotulo}: use de ${c.min} a ${c.max}`, variant: "destructive" });
    }
    if (cfg.hora_inicio >= cfg.hora_fim) return toast({ title: "O horário de início precisa ser antes do fim", variant: "destructive" });
    if (cfg.intervalo_min > cfg.intervalo_max) return toast({ title: "Intervalo mínimo maior que o máximo", variant: "destructive" });
    gravar(Object.fromEntries(CAMPOS.map((c) => [c.k, Number(cfg[c.k])])));
  };

  const alternarEnvio = (v: boolean) => {
    if (v && !window.confirm(
      "Ligar o envio não oficial? A fila de automações e campanhas começa a sair neste número, no ritmo configurado. " +
      "Automatizar WhatsApp comum pode levar a restrição ou banimento do número.",
    )) return;
    gravar({ ligado: v });
  };

  const enviarAmostra = async () => {
    setAmostra(null);
    try {
      const r = await chamarAutomacoes<{ ok: boolean; http: number }>({ modo: "amostra_template", template: template || "nome_do_template" });
      setAmostra(r.ok ? `Amostra enviada (HTTP ${r.http}). No Full Funnel, clique em "Fetch sample request" no gatilho.` : `Full Funnel respondeu HTTP ${r.http}.`);
    } catch (e) { setAmostra((e as Error).message); }
  };

  if (!existe) return <p className="pt-4 text-sm text-red-600">Configuração não encontrada: rode a migration 20261018100000.</p>;

  return (
    <div className="space-y-5 pt-2">
      <div className="rounded-lg border p-4 space-y-2">
        <label className="flex items-center gap-3">
          <Switch checked={cfg.ligado} onCheckedChange={alternarEnvio} disabled={salvando} />
          <span className="font-medium">Envio não oficial {cfg.ligado ? "LIGADO" : "desligado"}</span>
        </label>
        <p className="text-xs text-muted-foreground">
          Uso: {uso.hora}/{cfg.max_hora} na última hora · {uso.dia}/{cfg.max_dia} hoje. Mudar etapa, pôr tag e template oficial não usam este número.
        </p>
        {cfg.pausado && (
          <div className="rounded bg-red-50 p-2 text-sm text-red-700 flex items-center gap-2 dark:bg-red-950/40">
            <span className="flex-1">Pausado automaticamente: {cfg.pausado_motivo}. Confira o número antes de retomar.</span>
            <Button size="sm" variant="outline" onClick={() => gravar({ pausado: false, pausado_motivo: null, falhas_seguidas: 0 })}>
              <Play className="mr-1 h-4 w-4" /> Retomar
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <p className="font-medium text-sm">Limites por número</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {CAMPOS.map((c) => (
            <div key={c.k} className="space-y-1">
              <Label>{c.rotulo}</Label>
              <Input type="number" min={c.min} max={c.max} value={String(cfg[c.k] ?? "")}
                onChange={(e) => setCfg({ ...cfg, [c.k]: Number(e.target.value) })} />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Pausa sozinho com 3 falhas seguidas ou sinal de restrição (bloqueio, desconexão, limite do provedor).</p>
        <Button size="sm" onClick={salvarLimites} disabled={salvando}>
          {salvando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Salvar limites
        </Button>
      </div>

      <div className="rounded-lg border p-4 space-y-2">
        <p className="font-medium text-sm">Template oficial (Full Funnel)</p>
        <p className="text-xs text-muted-foreground">
          A URL do Inbound Webhook fica em integracao_config.fullfunnel_webhook_crm_url (SQL). A amostra manda dados falsos
          (telefone +5500900000000) para o Full Funnel aprender o formato.
        </p>
        <div className="flex gap-2 max-w-md">
          <Input value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="nome do template" />
          <Button size="sm" variant="outline" onClick={enviarAmostra}><Send className="mr-1 h-4 w-4" /> Enviar amostra</Button>
        </div>
        {amostra && <p className="text-xs">{amostra}</p>}
      </div>
    </div>
  );
}
