// Seção "Transferência para humano" do agente (Treinar IA, 18/10/2026), no molde do SellFlux: prompt de
// transferência (o Claude classifica cada mensagem com ele antes de responder), palavras-chave como atalho,
// máximo de respostas, despedida (ou nada), para quem transferir e o que aplicar ao transferir (tag/etapa/fluxo).
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SeletorTags } from "@/components/crm/SeletorTags";
import { ItensEtapa } from "@/components/crm/etapas/ItensEtapa";
import { FRASE_TRANSFERENCIA_PADRAO, PROMPT_TRANSFERENCIA_PADRAO, db, type AgenteIA } from "@/lib/crm/treinarIA";

const FILA = "__fila__";
const NADA = "__nada__";

interface Props {
  form: AgenteIA;
  set: <K extends keyof AgenteIA>(k: K, v: AgenteIA[K]) => void;
}

export function TransferenciaAgente({ form, set }: Props) {
  const [atendentes, setAtendentes] = useState<string[]>([]);
  const [fluxos, setFluxos] = useState<{ id: string; nome: string }[]>([]);
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [p, f] = await Promise.all([
          db.from("profiles").select("full_name").eq("approved", true).order("full_name"),
          db.from("crm_fluxos").select("id, nome").is("excluido_em", null).order("nome"),
        ]) as [{ data: { full_name: string }[] | null }, { data: { id: string; nome: string }[] | null }];
        if (!vivo) return;
        setAtendentes((p.data ?? []).map((x) => x.full_name).filter(Boolean));
        setFluxos(f.data ?? []);
      } catch {
        /* sem lista: o seletor mostra só a fila geral */
      }
    })();
    return () => { vivo = false; };
  }, []);

  // banco sem a migration 20261103100000: a linha não tem os campos novos
  const semMigracao = !("prompt_transferencia" in form);

  return (
    <section className="rounded-xl border bg-card p-4 md:p-5 space-y-4" aria-label="Transferência para humano" data-testid="transferencia-agente">
      <div>
        <h3 className="text-lg font-bold tracking-tight">Transferência para humano</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          A cada mensagem da lead, antes de responder, o Claude lê o prompt abaixo e decide se passa a conversa para o humano.
          Palavras-chave e o máximo de respostas são atalhos: transferem sem perguntar à IA.
        </p>
      </div>
      {semMigracao && (
        <p className="text-xs rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 p-2">
          Falta rodar a migration 20261103100000_crm_robo_atendimento_ia.sql: os campos abaixo só são salvos depois dela.
        </p>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm font-medium">Prompt de transferência (quando a IA deve passar para o humano)</Label>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => set("prompt_transferencia", PROMPT_TRANSFERENCIA_PADRAO)}>
            Usar modelo pronto
          </Button>
        </div>
        <Textarea
          className="min-h-[180px] text-xs font-mono"
          value={form.prompt_transferencia ?? ""}
          onChange={(e) => set("prompt_transferencia", e.target.value)}
          placeholder={PROMPT_TRANSFERENCIA_PADRAO}
          aria-label="Prompt de transferência"
        />
        <p className="text-[11px] text-muted-foreground">Vazio = usa o modelo pronto (lógica dos agentes do SellFlux: preço, fechar, reembolso, reagendar, dúvida clínica, terceira pergunta fora do roteiro, fim do roteiro).</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-sm font-medium">Palavras que transferem na hora (separadas por vírgula)</Label>
          <Input value={(form.palavras_transferencia ?? []).join(", ")}
            onChange={(e) => set("palavras_transferencia", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
        </div>
        <div>
          <Label className="text-sm font-medium">Máximo de respostas da IA por conversa</Label>
          <Input type="number" min={1} max={200} value={form.limite_interacoes ?? 15}
            onChange={(e) => set("limite_interacoes", Math.max(1, Number(e.target.value) || 1))} />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-sm font-medium">Mensagem de despedida da IA (o que ela fala ao transferir)</Label>
        <Input value={form.frase_transferencia ?? ""} disabled={Boolean(form.transferir_sem_mensagem)}
          onChange={(e) => set("frase_transferencia", e.target.value)} placeholder={FRASE_TRANSFERENCIA_PADRAO} />
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={Boolean(form.transferir_sem_mensagem)} onCheckedChange={(v) => set("transferir_sem_mensagem", v)} aria-label="Não mandar nada ao transferir" />
          Não mandar nada (transfere em silêncio, como o SellFlux)
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-sm font-medium">Para quem transferir</Label>
          <Select value={form.transferir_para || FILA} onValueChange={(v) => set("transferir_para", v === FILA ? null : v)}>
            <SelectTrigger aria-label="Para quem transferir"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={FILA}>Fila geral (qualquer atendente)</SelectItem>
              {[...new Set([...(form.transferir_para ? [form.transferir_para] : []), ...atendentes])].map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-sm font-medium">Ao transferir: mover para a etapa</Label>
          <Select value={form.transferir_etapa || NADA} onValueChange={(v) => set("transferir_etapa", v === NADA ? null : v)}>
            <SelectTrigger aria-label="Etapa ao transferir"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={NADA}>Não mover</SelectItem><ItensEtapa incluir={form.transferir_etapa ?? undefined} /></SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-sm font-medium">Ao transferir: aplicar a tag</Label>
          <SeletorTags valor={form.transferir_tag ? [form.transferir_tag] : []} onMudar={(t) => set("transferir_tag", t[0] ?? null)} rotulo="Ao transferir: aplicar a tag" />
        </div>
        <div className="space-y-1">
          <Label className="text-sm font-medium">Ao transferir: iniciar o fluxo</Label>
          <Select value={form.transferir_fluxo_id || NADA} onValueChange={(v) => set("transferir_fluxo_id", v === NADA ? null : v)}>
            <SelectTrigger aria-label="Fluxo ao transferir"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NADA}>Nenhum</SelectItem>
              {fluxos.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {/* a espera para juntar mensagens picadas mudou para a seção "Tempo de resposta (delay)" (RitmoAgente) */}
        <div>
          <Label className="text-sm font-medium">Falhas seguidas da IA antes de passar para humano (1 a 10)</Label>
          <Input type="number" min={1} max={10} value={form.max_falhas ?? 3}
            onChange={(e) => set("max_falhas", Number(e.target.value) || 3)} />
        </div>
      </div>
    </section>
  );
}
