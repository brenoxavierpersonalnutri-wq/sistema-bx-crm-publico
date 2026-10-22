// Aba "Configuração" da tela Treinar IA: número, modelo (Claude), link, até onde vai, horário, tempo de resposta (delay),
// transferência e políticas de um agente.
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEtapas } from "@/hooks/useEtapas";
import { formatarTelefone, type NumeroCRM } from "@/lib/crm/central";
import {
  LINK_AGENDAMENTO_PADRAO,
  POLITICAS_PADRAO,
  linkAgendamento,
  recomendacaoNumero,
  type AgenteIA,
} from "@/lib/crm/treinarIA";
import { MODELOS_CLAUDE, resolverModelo } from "@/lib/crm/iaClaude";
import { TransferenciaAgente } from "./TransferenciaAgente";
import { RitmoAgente } from "./RitmoAgente";
import { AtivacaoAgente } from "./AtivacaoAgente";
import { modoAtivacao, prontoParaLigar } from "@/lib/crm/treinarIA";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const NENHUM = "__nenhum__";

const corNivel: Record<string, string> = {
  recomendado: "text-green-700 dark:text-green-400",
  evitar: "text-red-600 dark:text-red-400",
  indisponivel: "text-muted-foreground",
  neutro: "text-muted-foreground",
};

function Bloco({ titulo, children, ajuda, testid }: { titulo: string; children: React.ReactNode; ajuda?: string; testid?: string }) {
  return (
    <section className="rounded-xl border bg-card p-4 md:p-5 space-y-4" aria-label={titulo} data-testid={testid}>
      <div>
        <h3 className="text-lg font-bold tracking-tight">{titulo}</h3>
        {ajuda && <p className="mt-0.5 text-sm text-muted-foreground">{ajuda}</p>}
      </div>
      {children}
    </section>
  );
}

/** Campo com rótulo e explicação curta embaixo do rótulo. */
function Campo({ rotulo, ajuda, htmlFor, children }: { rotulo: string; ajuda?: React.ReactNode; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium">{rotulo}</Label>
      {ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>}
      {children}
    </div>
  );
}

interface Props {
  form: AgenteIA;
  numeros: NumeroCRM[];
  set: <K extends keyof AgenteIA>(k: K, v: AgenteIA[K]) => void;
  /** agente de follow-up: número, horário e cadência vêm do fluxo; aqui só modelo, histórico e políticas */
  followup?: boolean;
}

export function ConfigAgente({ form, numeros, set, followup = false }: Props) {
  const { colunas: KANBAN_COLUMNS } = useEtapas(); // etapas de crm_etapas (ativas)
  const numeroSel = numeros.find((n) => n.id === form.numero_id) ?? null;
  const recSel = numeroSel ? recomendacaoNumero(numeroSel) : null;
  const exemploLink = linkAgendamento(form.link_agendamento, form.slug, "abc123xyz");

  const campoModelo = (
    <Campo rotulo="Modelo de IA" ajuda="Claude, da Anthropic, pago com o crédito da conta Anthropic do Breno. Vale para o teste e para o robô do WhatsApp.">
      <Select value={resolverModelo(form.modelo)} onValueChange={(v) => set("modelo", v)}>
        <SelectTrigger className="max-w-md" aria-label="Modelo de IA"><SelectValue /></SelectTrigger>
        <SelectContent>
          {MODELOS_CLAUDE.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
        </SelectContent>
      </Select>
      {form.modelo && resolverModelo(form.modelo) !== form.modelo && (
        <p className="text-xs text-muted-foreground">O modelo antigo ({form.modelo}) não é mais usado: este agente roda no Claude Sonnet 5.5. Salve para gravar.</p>
      )}
    </Campo>
  );

  if (followup) {
    return (
      <div className="space-y-4">
        <Bloco titulo="Onde e quando envia" ajuda="Agente de follow-up não tem número nem horário próprios.">
          <p className="text-xs text-muted-foreground">
            O número, a janela de horário, os limites anti-ban e a cadência são do fluxo que usa este agente (passo Mensagem da IA).
            Se a lead responder ou pedir para parar, nada sai.
          </p>
        </Bloco>
        <Bloco titulo="Modelo de IA">{campoModelo}</Bloco>
        <Bloco titulo="Quanto da conversa a IA lê" ajuda="Últimas mensagens da conversa que vão para o Claude a cada tentativa (4 a 40).">
          <Input type="number" min={4} max={40} className="max-w-[140px]" aria-label="Mensagens do histórico"
            value={form.historico_mensagens ?? 20} onChange={(e) => set("historico_mensagens", Number(e.target.value) || 20)} />
        </Bloco>
        <Bloco titulo="Políticas" ajuda="Entram no prompt acima de tudo. Preço, valor, parcela e desconto já são barrados no follow-up, mesmo que a IA escreva.">
          <Textarea className="min-h-[120px] text-sm" value={form.politicas ?? ""} onChange={(e) => set("politicas", e.target.value)} aria-label="Políticas do follow-up" />
        </Bloco>
      </div>
    );
  }

  const modo = modoAtivacao(form);
  return (
    <div className="space-y-4">
      <AtivacaoAgente form={form} set={set} pronto={prontoParaLigar(form).pronto} />

      <Bloco titulo="Número, modelo e link" ajuda="Onde a IA responde, com qual modelo e o link que ela manda para agendar.">
        <Campo rotulo="Em qual número responde" ajuda="Use o número do comercial. Nunca o pessoal nem o closer.">
          <Select value={form.numero_id ?? NENHUM} onValueChange={(v) => set("numero_id", v === NENHUM ? null : v)}>
            <SelectTrigger className="max-w-md" aria-label="Número do agente"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>Nenhum (não responde)</SelectItem>
              {numeros.map((n) => {
                const r = recomendacaoNumero(n);
                return (
                  <SelectItem key={n.id} value={n.id} disabled={r.nivel === "indisponivel" || Boolean(n.provisorio)}>
                    {n.apelido}{n.telefone ? ` · ${formatarTelefone(n.telefone)}` : ""}{r.nota ? ` · ${r.nota}` : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {recSel && recSel.nota && <p className={`text-xs ${corNivel[recSel.nivel]}`}>{numeroSel?.apelido}: {recSel.nota}</p>}
        </Campo>

        {campoModelo}

        <Campo rotulo="Link de agendamento" ajuda="Entra no lugar de [LINK_AGENDAMENTO], com as UTMs da IA e um código do contato (sem telefone nem nome na URL).">
          <Input
            value={form.link_agendamento ?? ""}
            onChange={(e) => set("link_agendamento", e.target.value)}
            placeholder={LINK_AGENDAMENTO_PADRAO}
            aria-label="Link de agendamento"
          />
          <p className="text-[11px] text-muted-foreground break-all">Exemplo do que a lead recebe: {exemploLink}</p>
        </Campo>
      </Bloco>

      <Bloco titulo="Horário e tempo de resposta" ajuda="Horário de Brasília. Fora dele a IA manda só a mensagem de fora do horário (vazia = fica em silêncio).">
        <div className="space-y-4" aria-label="Horário de atendimento" role="group">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Início</Label>
              <Input type="time" className="w-32" value={(form.horario_inicio ?? "").slice(0, 5)} onChange={(e) => set("horario_inicio", e.target.value || null)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Fim</Label>
              <Input type="time" className="w-32" value={(form.horario_fim ?? "").slice(0, 5)} onChange={(e) => set("horario_fim", e.target.value || null)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Dias da semana</Label>
            <div className="flex flex-wrap gap-2">
              {DIAS.map((d, i) => {
                const marcado = (form.dias_semana ?? []).includes(i);
                return (
                  <label key={d} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm ${marcado ? "border-primary/60 bg-primary/10" : "bg-secondary"}`}>
                    <Checkbox
                      checked={marcado}
                      onCheckedChange={(v) =>
                        set("dias_semana", v ? [...(form.dias_semana ?? []), i].sort((a, b) => a - b) : (form.dias_semana ?? []).filter((x) => x !== i))}
                    />
                    {d}
                  </label>
                );
              })}
            </div>
          </div>
          <Campo rotulo="Mensagem fora do horário">
            <Textarea
              className="min-h-[70px]"
              value={form.mensagem_fora_horario ?? ""}
              onChange={(e) => set("mensagem_fora_horario", e.target.value)}
              placeholder="Escreva aqui o que a IA responde fora do horário. Ex.: Oi! Nosso time atende de segunda a sexta, das 8h às 20h. Amanhã cedo alguém te responde por aqui."
              aria-label="Mensagem fora do horário"
            />
          </Campo>
        </div>
        <RitmoAgente form={form} set={set} embutido />
      </Bloco>

      <Bloco titulo="Gatilhos e limites" ajuda="Em que etapas e para quais origens a IA atua. Fora destes limites ela não responde ou passa para o humano.">
        <Campo rotulo="Etapas do funil em que pode atuar" ajuda="Nenhuma marcada = todas.">
          <div className="flex flex-wrap gap-2">
            {KANBAN_COLUMNS.map((c) => {
              const marcado = (form.etapas ?? []).includes(c.id);
              return (
                <label key={c.id} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm ${marcado ? "border-primary/60 bg-primary/10" : "bg-secondary"}`}>
                  <Checkbox
                    checked={marcado}
                    onCheckedChange={(v) => set("etapas", v ? [...(form.etapas ?? []), c.id] : (form.etapas ?? []).filter((x) => x !== c.id))}
                  />
                  {c.title}
                </label>
              );
            })}
          </div>
        </Campo>
        <Campo rotulo="Origens permitidas" ajuda="Campo origem do contato, separadas por vírgula.">
          <Input className="max-w-xl" value={(form.origens ?? []).join(", ")}
            onChange={(e) => set("origens", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
        </Campo>
        {modo !== "gatilho" && (
          <Campo rotulo="Gatilhos" ajuda="Frase da primeira mensagem que atribui a lead a este agente, uma por linha.">
            <Textarea className="min-h-[70px]" value={(form.gatilhos ?? []).join("\n")}
              onChange={(e) => set("gatilhos", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
          </Campo>
        )}
        <ul className="rounded-lg bg-secondary p-3 text-xs text-muted-foreground list-disc pl-7 space-y-1">
          <li>Nunca responde em grupo (regra fixa).</li>
          <li>Só responde contato que veio de uma origem permitida ou mandou um gatilho; os outros ficam com o humano.</li>
          <li>Humano que responde a conversa (pelo CRM ou pelo celular) pausa a IA daquele contato.</li>
          <li>O modo de ativação (cartão "Quando a IA começa a atender", no topo) decide se a IA assume sozinha ou só as conversas transferidas.</li>
        </ul>
      </Bloco>

      <TransferenciaAgente form={form} set={set} />

      <Bloco titulo="Políticas" ajuda="Entram no prompt de resposta acima de tudo (o que a IA nunca promete, como escreve a frase de passagem).">
        <Textarea className="min-h-[120px] text-sm" value={form.politicas ?? ""} onChange={(e) => set("politicas", e.target.value)} placeholder={POLITICAS_PADRAO} aria-label="Instrução de políticas" />
      </Bloco>
    </div>
  );
}
