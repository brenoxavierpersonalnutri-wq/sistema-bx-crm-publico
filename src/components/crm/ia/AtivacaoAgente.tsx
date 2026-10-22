// Aba Configuração da tela Agente IA: "Quando a IA começa a atender" (modo de ativação do agente).
// Regras e portões em supabase/functions/_shared/iaGatilho.ts; quem aplica é o openwa-webhook (robô do número ligado).
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SeletorTags } from "@/components/crm/SeletorTags";
import {
  ATALHOS_AVALIACAO,
  LIMITES_ATIVACAO,
  MODOS_ATIVACAO,
  QUANDO_ATIVAR_AVALIACAO,
  camposDoModo,
  horasHumano,
  maxMensagensGatilho,
  MAX_TAGS_AO_INICIAR,
  modoAtivacao,
  normalizarTagsAoIniciar,
  temColunaTagsInicio,
  temColunasAtivacao,
  type AgenteIA,
  type ModoAtivacao,
} from "@/lib/crm/treinarIA";

interface Props {
  form: AgenteIA;
  set: <K extends keyof AgenteIA>(k: K, v: AgenteIA[K]) => void;
  /** número + link + horário preenchidos (sem isso não liga em modo nenhum além de "só transferidas") */
  pronto: boolean;
}

export function AtivacaoAgente({ form, set, pronto }: Props) {
  const temColunas = temColunasAtivacao(form);
  const modo = modoAtivacao(form);
  const escolher = (m: ModoAtivacao) => {
    const c = camposDoModo(m);
    set("ativo", c.ativo);
    if (temColunas) set("ativacao_modo", c.ativacao_modo);
  };
  const usarModeloAvaliacao = () => {
    set("ativacao_quando", QUANDO_ATIVAR_AVALIACAO);
    const atuais = form.gatilhos ?? [];
    set("gatilhos", [...atuais, ...ATALHOS_AVALIACAO.filter((a) => !atuais.some((x) => x.toLowerCase() === a.toLowerCase()))]);
  };

  return (
    <section className="rounded-xl border bg-card p-4 md:p-5 space-y-4" aria-label="Quando a IA começa a atender">
      <div>
        <h3 className="text-lg font-bold tracking-tight">Quando a IA começa a atender</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">Vale só com o "Robô de IA ligado" no número. Nunca em grupo; humano que responde a conversa pausa a IA.</p>
      </div>
      <fieldset className="space-y-2" aria-label="Modo de ativação">
        {MODOS_ATIVACAO.map((m) => {
          const bloqueado = (m.id === "gatilho" && !temColunas) || (m.id !== "transferidas" && !pronto && modo !== m.id);
          return (
            <label key={m.id} className={`flex gap-3 rounded-xl border p-3 text-sm transition-colors ${modo === m.id ? "border-primary bg-primary/10" : "bg-secondary hover:border-primary/40"} ${bloqueado ? "opacity-60" : "cursor-pointer"}`}>
              <input type="radio" name={`modo-ativacao-${form.id}`} value={m.id} checked={modo === m.id} disabled={bloqueado} onChange={() => escolher(m.id)} className="mt-1 accent-[hsl(var(--primary))]" />
              <span>
                <span className="font-semibold">{m.rotulo}</span>
                <span className="block text-xs text-muted-foreground">{m.ajuda}</span>
                {m.id === "gatilho" && !temColunas && <span className="block text-xs text-amber-400">Falta rodar a migration 20261108100000_crm_ai_ativacao_gatilho.sql.</span>}
                {m.id !== "transferidas" && !pronto && <span className="block text-xs text-amber-400">Preencha número, link e horário para usar este modo.</span>}
              </span>
            </label>
          );
        })}
      </fieldset>

      {modo === "gatilho" && (
        <div className="space-y-4 rounded-lg border bg-secondary p-3 md:p-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor={`atalhos-${form.id}`} className="text-sm font-medium">Atalhos: trechos que ativam na hora, sem IA (um por linha)</Label>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={usarModeloAvaliacao}>Usar o modelo da avaliação</Button>
            </div>
            <Textarea id={`atalhos-${form.id}`} className="min-h-[70px] text-xs" value={(form.gatilhos ?? []).join("\n")}
              onChange={(e) => set("gatilhos", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
              placeholder="Fui qualificada no formulário de avaliação" />
            <p className="text-[11px] text-muted-foreground">O trecho precisa aparecer na mensagem da lead (ignora acento, maiúscula, pontuação e emoji).</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`quando-${form.id}`} className="text-sm font-medium">Quando ativar (regra em texto, vai para o Claude Haiku quando nenhum atalho bate)</Label>
            <Textarea id={`quando-${form.id}`} className="min-h-[110px] text-xs" value={form.ativacao_quando ?? ""}
              onChange={(e) => set("ativacao_quando", e.target.value)} placeholder={QUANDO_ATIVAR_AVALIACAO} />
            <p className="text-[11px] text-muted-foreground">Vazio = só os atalhos ativam. O classificador responde só sim ou não e não escreve nada para a lead.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor={`maxmsg-${form.id}`} className="text-sm font-medium">Mensagens que o gatilho avalia por conversa (por dia)</Label>
              <Input id={`maxmsg-${form.id}`} type="number" min={LIMITES_ATIVACAO.maxMensagens.min} max={LIMITES_ATIVACAO.maxMensagens.max} className="max-w-[120px]"
                value={form.ativacao_max_mensagens ?? maxMensagensGatilho(form)} onChange={(e) => set("ativacao_max_mensagens", Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`horas-${form.id}`} className="text-sm font-medium">Não ativa se a equipe escreveu na conversa nas últimas (horas)</Label>
              <Input id={`horas-${form.id}`} type="number" min={LIMITES_ATIVACAO.humanoHoras.min} max={LIMITES_ATIVACAO.humanoHoras.max} className="max-w-[120px]"
                value={form.ativacao_humano_horas ?? horasHumano(form)} onChange={(e) => set("ativacao_humano_horas", Number(e.target.value))} />
            </div>
          </div>
          <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5">
            <li>Só conversa sem dono: sem atendente atribuído, sem "Precisa de humano" e sem a IA já atendendo.</li>
            <li>Só mensagem nova que chega pelo WhatsApp agora; conversa importada ou mensagem antiga nunca ativa.</li>
            <li>Ao ativar, o histórico da conversa mostra "IA ativada por gatilho: motivo". Para tirar a IA, use "Assumir" no chat.</li>
            <li>Horário de atendimento e tempo de resposta deste agente continuam valendo.</li>
          </ul>
        </div>
      )}
      <div className="space-y-1.5 rounded-lg border bg-secondary p-3 md:p-4" data-testid="tags-ao-comecar">
        <Label className="text-sm font-medium">Tags ao começar</Label>
        <p className="text-xs text-muted-foreground">
          Quando este agente assume a conversa (por gatilho, modo "todas", "Transferir para IA" ou passo de fluxo), estas tags
          entram no contato. Só adiciona: nunca tira tag nem repete. Dispara as automações de "recebeu a tag" como se a equipe tivesse posto.
        </p>
        {temColunaTagsInicio(form) ? (
          <SeletorTags multiplo rotulo="Tags ao começar" placeholder="Escolher ou criar tag" valor={form.tags_ao_iniciar ?? []}
            onMudar={(lista) => set("tags_ao_iniciar", normalizarTagsAoIniciar(lista))} />
        ) : (
          <p className="text-xs text-amber-400">Falta rodar a migration 20261113100000_crm_ai_tags_ao_iniciar.sql.</p>
        )}
        {(form.tags_ao_iniciar?.length ?? 0) >= MAX_TAGS_AO_INICIAR && <p className="text-[11px] text-muted-foreground">Até {MAX_TAGS_AO_INICIAR} tags.</p>}
      </div>
    </section>
  );
}
