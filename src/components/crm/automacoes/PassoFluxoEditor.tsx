// Campos de um passo do fluxo (esperar, condição, template oficial, mensagem, tag, etapa, parar).
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEtapas } from "@/hooks/useEtapas";
import { VALORES_VARIAVEL, variaveisDoTemplate, type Desvio, type PassoFluxo, type TemplateOficial } from "@/lib/crmFluxos";
import { SeletorMensagem } from "./SeletorMensagem";
import type { PassoOpcao, RoteiroOpcao } from "./useCatalogo";

/** Tipos que este editor em lista sabe editar; os do construtor visual (/crm/automacao) ficam de fora. */
export type TipoPassoClassico = "esperar" | "condicao" | "template_oficial" | "mensagem" | "tag" | "etapa" | "parar";
export const TIPOS_CLASSICOS: TipoPassoClassico[] = ["esperar", "condicao", "template_oficial", "mensagem", "tag", "etapa", "parar"];

export const NOVO_PASSO: Record<TipoPassoClassico, PassoFluxo> = {
  esperar: { tipo: "esperar", quantidade: 1, unidade: "dias" },
  condicao: { tipo: "condicao", condicao: { tipo: "respondeu" }, se_sim: "parar", se_nao: "continuar" },
  template_oficial: { tipo: "template_oficial", template: "", variaveis: {} },
  mensagem: { tipo: "mensagem", roteiro_id: null, passo_id: null },
  tag: { tipo: "tag", acao: "por", tag: "" },
  etapa: { tipo: "etapa", etapa: "contato" },
  parar: { tipo: "parar" },
};

export const rotuloTipoPasso = (t: PassoFluxo["tipo"]): string => ROTULO_TIPO_PASSO[t as TipoPassoClassico] ?? "Passo do construtor";

export const ROTULO_TIPO_PASSO: Record<TipoPassoClassico, string> = {
  esperar: "Esperar",
  condicao: "Condição (se/senão)",
  template_oficial: "Template oficial (Full Funnel)",
  mensagem: "Mensagem não oficial (roteiro)",
  tag: "Pôr / tirar tag",
  etapa: "Mudar etapa",
  parar: "Parar",
};

function SeletorDesvio({ valor, idx, total, onChange }: { valor: Desvio; idx: number; total: number; onChange: (d: Desvio) => void }) {
  const opcoes = Array.from({ length: total }, (_, i) => i + 1).filter((n) => n > idx + 1);
  return (
    <Select value={String(valor)} onValueChange={(v) => onChange(v === "continuar" || v === "parar" ? v : Number(v))}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="continuar">Segue para o próximo</SelectItem>
        <SelectItem value="parar">Para o fluxo</SelectItem>
        {opcoes.map((n) => <SelectItem key={n} value={String(n)}>Vai ao passo {n}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function PassoFluxoEditor({
  passo, idx, total, templates, roteiros, passos, onChange,
}: {
  passo: PassoFluxo;
  idx: number;
  total: number;
  templates: TemplateOficial[];
  roteiros: RoteiroOpcao[];
  passos: PassoOpcao[];
  onChange: (p: PassoFluxo) => void;
}) {
  const { colunas: KANBAN_COLUMNS } = useEtapas(); // etapas de crm_etapas (ativas)
  switch (passo.tipo) {
    case "esperar":
      return (
        <div className="grid gap-2 sm:grid-cols-3 items-end">
          <div className="space-y-1">
            <Label>Quanto</Label>
            <Input type="number" min={1} value={passo.quantidade} onChange={(e) => onChange({ ...passo, quantidade: Number(e.target.value) })} />
          </div>
          <Select value={passo.unidade} onValueChange={(v) => onChange({ ...passo, unidade: v as typeof passo.unidade })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="minutos">minutos</SelectItem>
              <SelectItem value="horas">horas</SelectItem>
              <SelectItem value="dias">dias</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={Boolean(passo.ate_responder)} onCheckedChange={(v) => onChange({ ...passo, ate_responder: v })} />
            ou até a lead responder
          </label>
        </div>
      );
    case "condicao": {
      const c = passo.condicao;
      return (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              value={c.tipo}
              onValueChange={(v) => onChange({ ...passo, condicao: v === "respondeu" ? { tipo: "respondeu" } : v === "tem_tag" ? { tipo: "tem_tag", valor: "" } : { tipo: "etapa", valor: "agendado" } })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="respondeu">A lead respondeu (desde o último envio)?</SelectItem>
                <SelectItem value="tem_tag">Tem a tag?</SelectItem>
                <SelectItem value="etapa">Está na etapa?</SelectItem>
              </SelectContent>
            </Select>
            {c.tipo === "tem_tag" && <Input value={c.valor} placeholder="tag" onChange={(e) => onChange({ ...passo, condicao: { tipo: "tem_tag", valor: e.target.value } })} />}
            {c.tipo === "etapa" && (
              <Select value={c.valor} onValueChange={(v) => onChange({ ...passo, condicao: { tipo: "etapa", valor: v } })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{KANBAN_COLUMNS.map((k) => <SelectItem key={k.id} value={k.id}>{k.title}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1"><Label>Se sim</Label><SeletorDesvio valor={passo.se_sim} idx={idx} total={total} onChange={(d) => onChange({ ...passo, se_sim: d })} /></div>
            <div className="space-y-1"><Label>Se não</Label><SeletorDesvio valor={passo.se_nao} idx={idx} total={total} onChange={(d) => onChange({ ...passo, se_nao: d })} /></div>
          </div>
        </div>
      );
    }
    case "template_oficial": {
      const t = templates.find((x) => x.nome === passo.template);
      const vars = t ? variaveisDoTemplate(t.corpo) : [];
      return (
        <div className="space-y-2">
          <Select value={passo.template || undefined} onValueChange={(v) => onChange({ ...passo, template: v, variaveis: {} })}>
            <SelectTrigger><SelectValue placeholder="Escolha o template aprovado" /></SelectTrigger>
            <SelectContent>
              {templates.map((x) => (
                <SelectItem key={x.nome} value={x.nome}>{x.nome} · {x.categoria === "MARKETING" ? "marketing" : "utilidade"}{x.status !== "APPROVED" ? ` · ${x.status}` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {t && <p className="whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">{t.corpo}</p>}
          {vars.map((n) => (
            <div key={n} className="grid gap-2 sm:grid-cols-[120px_1fr] items-center">
              <Label className="text-xs">{`{{${n}}}`} {t?.rotulos_variaveis?.[String(n)] ?? ""}</Label>
              <Input
                list="valores-variavel-fluxo"
                value={passo.variaveis?.[String(n)] ?? ""}
                placeholder="{primeiro_nome}"
                onChange={(e) => onChange({ ...passo, variaveis: { ...(passo.variaveis ?? {}), [String(n)]: e.target.value } })}
              />
            </div>
          ))}
          <datalist id="valores-variavel-fluxo">{VALORES_VARIAVEL.map((v) => <option key={v} value={v} />)}</datalist>
          {vars.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {"{primeiro_nome}"}, {"{nome}"}, {"{telefone}"} vêm do contato; {"{dados.email}"} e outros {"{dados.campo}"} vêm do evento que iniciou o fluxo. Variável vazia faz a Meta recusar o envio.
            </p>
          )}
        </div>
      );
    }
    case "mensagem":
      return (
        <SeletorMensagem
          roteiros={roteiros}
          passos={passos}
          roteiroId={passo.roteiro_id ?? passos.find((p) => p.id === passo.passo_id)?.roteiro_id ?? null}
          passoId={passo.passo_id ?? null}
          onChange={(v) => onChange({ ...passo, ...v })}
        />
      );
    case "tag":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={passo.acao} onValueChange={(v) => onChange({ ...passo, acao: v as "por" | "tirar" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="por">Pôr a tag</SelectItem><SelectItem value="tirar">Tirar a tag</SelectItem></SelectContent>
          </Select>
          <Input value={passo.tag} placeholder="tag" onChange={(e) => onChange({ ...passo, tag: e.target.value })} />
        </div>
      );
    case "etapa":
      return (
        <Select value={passo.etapa} onValueChange={(v) => onChange({ ...passo, etapa: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{KANBAN_COLUMNS.map((k) => <SelectItem key={k.id} value={k.id}>{k.title}</SelectItem>)}</SelectContent>
        </Select>
      );
    case "parar":
      return <p className="text-xs text-muted-foreground">Encerra o fluxo para este contato.</p>;
  }
}
