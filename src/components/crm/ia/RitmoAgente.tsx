// Seção "Tempo de resposta (delay)" do agente (Treinar IA > Configuração, 19/10/2026): quanto a IA espera a lead
// terminar de escrever, o atraso antes de responder, o "digitando…" e a pausa entre bolhas. A conta (e a prévia) é a
// mesma que o robô usa: supabase/functions/_shared/ritmoResposta.ts.
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { temColunasRitmo, type AgenteIA } from "@/lib/crm/treinarIA";
import {
  LIMITES_RITMO,
  RESPOSTA_TIPICA,
  RITMO_PADRAO,
  TEMPO_IA_TIPICO_S,
  camposDoRitmo,
  formatarSegundos,
  normalizarRitmo,
  previaTempo,
} from "../../../../supabase/functions/_shared/ritmoResposta";

type CampoNum =
  | "debounce_segundos" | "debounce_max_segundos" | "atraso_min_segundos" | "atraso_max_segundos"
  | "digitando_cps" | "intervalo_min_segundos" | "intervalo_max_segundos";

const NOME_CAMPO: Record<CampoNum, string> = {
  debounce_segundos: "espera",
  debounce_max_segundos: "máximo de mensagens picadas",
  atraso_min_segundos: "atraso mínimo",
  atraso_max_segundos: "atraso máximo",
  digitando_cps: "velocidade do digitando",
  intervalo_min_segundos: "intervalo mínimo",
  intervalo_max_segundos: "intervalo máximo",
};

interface Props {
  form: AgenteIA;
  set: <K extends keyof AgenteIA>(k: K, v: AgenteIA[K]) => void;
  /** dentro do cartão "Horário e tempo de resposta": vira subseção (sem moldura própria) */
  embutido?: boolean;
}

/** Input numérico que deixa apagar e redigitar (vazio = padrão ao salvar). */
function Numero({ id, valor, padrao, min, max, disabled, onMudar, rotulo }: {
  id: string; valor: number | null | undefined; padrao: number; min: number; max: number; disabled?: boolean;
  onMudar: (v: number | null) => void; rotulo: string;
}) {
  const [texto, setTexto] = useState(valor === null || valor === undefined ? "" : String(valor));
  useEffect(() => {
    setTexto((t) => (Number(t) === valor && t !== "" ? t : valor === null || valor === undefined ? "" : String(valor)));
  }, [valor]);
  return (
    <Input
      id={id} type="number" inputMode="numeric" min={min} max={max} placeholder={String(padrao)} disabled={disabled}
      className="w-24 tabular-nums" aria-label={rotulo} value={texto}
      onChange={(e) => {
        setTexto(e.target.value);
        const n = e.target.value === "" ? null : Number(e.target.value);
        onMudar(n === null || Number.isFinite(n) ? n : null);
      }}
    />
  );
}

function Linha({ titulo, ajuda, children }: { titulo: string; ajuda: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-sm font-medium">{titulo}</Label>
      <div className="flex flex-wrap items-center gap-2 text-sm">{children}</div>
      <p className="text-[11px] text-muted-foreground">{ajuda}</p>
    </div>
  );
}

export function RitmoAgente({ form, set, embutido = false }: Props) {
  const migrado = temColunasRitmo(form);
  const ritmo = normalizarRitmo(form);
  const previa = previaTempo(ritmo);
  const L = LIMITES_RITMO;
  const campo = (k: CampoNum) => (form as unknown as Record<string, number | null | undefined>)[k];
  const mudar = (k: CampoNum) => (v: number | null) => set(k, v as AgenteIA[typeof k]);

  // o que vai ser ajustado ao salvar (fora da faixa ou incoerente)
  const ajustes: string[] = [];
  const salvo = camposDoRitmo(ritmo);
  for (const k of Object.keys(NOME_CAMPO) as CampoNum[]) {
    const v = campo(k);
    if (migrado && v !== null && v !== undefined && Number(v) !== salvo[k]) ajustes.push(`${NOME_CAMPO[k]} ${v} vira ${salvo[k]}`);
  }

  const usarRecomendado = () => {
    const c = camposDoRitmo(RITMO_PADRAO);
    for (const [k, v] of Object.entries(c)) set(k as keyof AgenteIA, v as never);
  };

  return (
    <section className={embutido ? "border-t pt-4 space-y-4" : "rounded-xl border bg-card p-4 md:p-5 space-y-4"} aria-label="Tempo de resposta (delay)">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className={embutido ? "text-base font-bold tracking-tight" : "text-lg font-bold tracking-tight"}>Tempo de resposta (delay)</h4>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Quanto a IA espera antes de responder, para não parecer robô. Vale só para este agente.
          </p>
        </div>
        {migrado && (
          <Button type="button" variant="outline" size="sm" onClick={usarRecomendado}>Usar o recomendado</Button>
        )}
      </div>

      {!migrado && (
        <p className="text-xs text-amber-700 dark:text-amber-400" role="status">
          O banco ainda não tem os campos novos (migration 20261105100000). Por enquanto só a primeira espera é salva (10 a 120 s);
          o resto fica no padrão: atraso 20 a 60 s, digitando a 8 caracteres/s, 3 a 8 s entre bolhas.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Linha titulo="Esperar a lead terminar de escrever"
          ajuda={`Cada mensagem nova da lead reinicia a conta; a IA só responde depois de X segundos de silêncio (${L.debounce.min} a ${L.debounce.max}).`}>
          <Numero id="ritmo-debounce" rotulo="Esperar a lead terminar de escrever (segundos)" valor={campo("debounce_segundos")}
            padrao={L.debounce.padrao} min={migrado ? L.debounce.min : 10} max={migrado ? L.debounce.max : 120} onMudar={mudar("debounce_segundos")} />
          <span className="text-muted-foreground">segundos</span>
        </Linha>

        <Linha titulo="Tempo máximo esperando mensagens picadas"
          ajuda={`Lead que não para de mandar mensagem: responde no máximo Y segundos depois da primeira (${L.debounceMax.min} a ${L.debounceMax.max}, nunca menor que a espera acima).`}>
          <Numero id="ritmo-debounce-max" rotulo="Tempo máximo esperando mensagens picadas (segundos)" valor={campo("debounce_max_segundos")}
            padrao={L.debounceMax.padrao} min={L.debounceMax.min} max={L.debounceMax.max} disabled={!migrado} onMudar={mudar("debounce_max_segundos")} />
          <span className="text-muted-foreground">segundos</span>
        </Linha>

        <Linha titulo="Atraso antes de responder"
          ajuda={`Depois da espera, sorteia um tempo entre o mínimo e o máximo, para cada resposta sair num ritmo diferente (0 a ${L.atraso.max} s).`}>
          <span className="text-muted-foreground">entre</span>
          <Numero id="ritmo-atraso-min" rotulo="Atraso mínimo antes de responder (segundos)" valor={campo("atraso_min_segundos")}
            padrao={L.atraso.padraoMin} min={L.atraso.min} max={L.atraso.max} disabled={!migrado} onMudar={mudar("atraso_min_segundos")} />
          <span className="text-muted-foreground">e</span>
          <Numero id="ritmo-atraso-max" rotulo="Atraso máximo antes de responder (segundos)" valor={campo("atraso_max_segundos")}
            padrao={L.atraso.padraoMax} min={L.atraso.min} max={L.atraso.max} disabled={!migrado} onMudar={mudar("atraso_max_segundos")} />
          <span className="text-muted-foreground">segundos</span>
        </Linha>

        <Linha titulo={`Simular "digitando…"`}
          ajuda={`Antes de cada bolha a IA fica "digitando…" pelo tempo que uma pessoa levaria, pelo tamanho do texto (${L.cps.min} a ${L.cps.max} caracteres por segundo; cada bolha de 1 a 25 s).`}>
          <Switch checked={ritmo.digitando} disabled={!migrado} onCheckedChange={(v) => set("digitando_ligado", v)} aria-label='Simular "digitando…"' />
          <span className="text-muted-foreground">{ritmo.digitando ? "ligado, a" : "desligado"}</span>
          {ritmo.digitando && (
            <>
              <Numero id="ritmo-cps" rotulo="Velocidade do digitando (caracteres por segundo)" valor={campo("digitando_cps")}
                padrao={L.cps.padrao} min={L.cps.min} max={L.cps.max} disabled={!migrado} onMudar={mudar("digitando_cps")} />
              <span className="text-muted-foreground">caracteres por segundo</span>
            </>
          )}
        </Linha>

        <Linha titulo="Intervalo entre mensagens"
          ajuda={`Quando a IA responde em várias bolhas, pausa um tempo sorteado entre uma e outra (0 a ${L.intervalo.max} s).`}>
          <span className="text-muted-foreground">entre</span>
          <Numero id="ritmo-intervalo-min" rotulo="Intervalo mínimo entre mensagens (segundos)" valor={campo("intervalo_min_segundos")}
            padrao={L.intervalo.padraoMin} min={L.intervalo.min} max={L.intervalo.max} disabled={!migrado} onMudar={mudar("intervalo_min_segundos")} />
          <span className="text-muted-foreground">e</span>
          <Numero id="ritmo-intervalo-max" rotulo="Intervalo máximo entre mensagens (segundos)" valor={campo("intervalo_max_segundos")}
            padrao={L.intervalo.padraoMax} min={L.intervalo.min} max={L.intervalo.max} disabled={!migrado} onMudar={mudar("intervalo_max_segundos")} />
          <span className="text-muted-foreground">segundos</span>
        </Linha>
      </div>

      <div className="rounded-lg bg-secondary p-3 text-xs space-y-1" aria-label="Prévia do tempo de resposta" data-testid="previa-ritmo">
        <p>
          <b>Prévia</b>, resposta típica ({RESPOSTA_TIPICA.bolhas} bolhas de ~{RESPOSTA_TIPICA.caracteres} caracteres): a primeira bolha sai
          entre <b>{formatarSegundos(previa.primeiraMin)}</b> e <b>{formatarSegundos(previa.primeiraMax)}</b> depois da última mensagem
          da lead, e a resposta inteira termina entre <b>{formatarSegundos(previa.totalMin)}</b> e <b>{formatarSegundos(previa.totalMax)}</b>.
        </p>
        <p className="text-muted-foreground">
          {ritmo.debounce} s de espera + {ritmo.atrasoMin} a {ritmo.atrasoMax} s de atraso + ~{TEMPO_IA_TIPICO_S} s da IA escrevendo
          {ritmo.digitando ? ` + ${previa.digitandoPorBolha} s de "digitando…" por bolha` : ""}
          {` + ${ritmo.intervaloMin} a ${ritmo.intervaloMax} s entre as bolhas`}. O tempo da IA varia.
        </p>
      </div>

      {ajustes.length > 0 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400" role="status">Ao salvar: {ajustes.join("; ")}.</p>
      )}
    </section>
  );
}
