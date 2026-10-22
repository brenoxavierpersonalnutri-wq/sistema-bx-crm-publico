import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { C, Slider, Radio, Checks, Textbox, Q, HeaderBrand } from "@/components/feedback/FeedbackUI";
import {
  ANAMNESE_SECOES, ANSIEDADE, AVISO_CARGAS, BEBIDA_ALCOOLICA, DEFINE_ALIMENTACAO,
  DESCONTA_ESTRESSE, DIAS_DISPONIVEIS, ESFORCO_DIARIO, FUMA, HORAS_SONO,
  HORAS_TRABALHO, INGESTAO_DOCES, INTESTINO_ANAMNESE, QUALIDADE_SONO,
  REFEICOES_DIA, ROTINA_ALIMENTAR_EXEMPLO, SIM_NAO, TEMPO_SESSAO, TERMO_FINAL,
  TREINA_MUSCULACAO, TREINA_ONDE,
} from "@/types/anamnese";
import type { AnamneseResposta } from "@/types/anamnese";
import { alternarValor, listaValores } from "@/types/feedbackSemanal";

/**
 * Anamnese inicial da aluna, em três etapas (Você / Treino / Alimentação).
 *
 * A aluna chega por um link com token, sem login. O token não dá acesso à
 * tabela: quem lê e grava são as funções anamnese_abrir e anamnese_enviar.
 */
export default function AnamneseForm() {
  const { token } = useParams<{ token: string }>();

  const [carregando, setCarregando] = useState(true);
  const [nomeAluna, setNomeAluna] = useState("");
  const [invalida, setInvalida] = useState(false);
  const [jaRespondida, setJaRespondida] = useState(false);

  const [etapa, setEtapa] = useState(0);
  const [data, setData] = useState<Partial<AnamneseResposta>>({});
  const [erros, setErros] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [enviada, setEnviada] = useState(false);

  const rascunhoKey = `anamnese-${token ?? "sem-token"}`;

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { data: res, error } = await supabase.rpc("anamnese_abrir" as never, {
          p_token: token,
        } as never);
        if (error) throw error;
        // A RPC devolve uma linha só; o cliente tipa como unknown/null.
        const linhas = (res ?? []) as Array<{ nome_aluna?: string; ja_respondida?: boolean }>;
        const linha = Array.isArray(linhas) ? linhas[0] : (linhas as { nome_aluna?: string; ja_respondida?: boolean });
        if (!vivo) return;
        if (!linha) {
          setInvalida(true);
        } else {
          setNomeAluna(linha.nome_aluna ?? "");
          setJaRespondida(!!linha.ja_respondida);
          setData((prev) => ({ nome_completo: linha.nome_aluna ?? "", ...prev }));
        }
      } catch {
        if (vivo) setInvalida(true);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, [token]);

  // Rascunho local: a anamnese é longa, ninguém responde de uma vez.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(rascunhoKey);
      if (raw) setData((prev) => ({ ...JSON.parse(raw), ...prev }));
    } catch {
      // storage bloqueado: segue sem rascunho
    }
  }, [rascunhoKey]);

  useEffect(() => {
    if (enviada) return;
    try {
      localStorage.setItem(rascunhoKey, JSON.stringify(data));
    } catch {
      // storage bloqueado: o rascunho é conveniência, não trava nada
    }
  }, [data, enviada, rascunhoKey]);

  const set = <K extends keyof AnamneseResposta>(campo: K, valor: AnamneseResposta[K]) => {
    setData((prev) => ({ ...prev, [campo]: valor }));
    setErros([]);
  };

  function validar(): string[] {
    const e: string[] = [];
    if (etapa === 0) {
      if (!data.nome_completo?.trim()) e.push("Coloca teu nome completo.");
      if (!data.peso_altura?.trim()) e.push("Coloca teu peso e altura.");
      if (!data.treina_onde) e.push("Marca se vai treinar em casa ou na academia.");
    }
    if (etapa === 1) {
      if (!listaValores(data.dias_disponiveis).length) {
        e.push("Marca quantos dias por semana você tem pra treinar.");
      }
      if (!data.tempo_sessao) e.push("Marca quanto tempo você tem por treino.");
    }
    if (etapa === 2) {
      if (!data.rotina_alimentar?.trim()) e.push("Escreve tua rotina alimentar.");
      if (!data.aceite) e.push("Confirma a declaração do final pra enviar.");
    }
    return e;
  }

  function proxima() {
    const e = validar();
    if (e.length) { setErros(e); return; }
    setErros([]);
    setEtapa((s) => s + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function enviar() {
    const e = validar();
    if (e.length) { setErros(e); return; }
    setEnviando(true);
    try {
      const payload: Record<string, unknown> = { ...data };
      // O jsonb do banco lê tudo como texto; número e booleano viram string.
      Object.keys(payload).forEach((k) => {
        const v = payload[k];
        if (typeof v === "number" || typeof v === "boolean") payload[k] = String(v);
      });
      const { data: ok, error } = await supabase.rpc("anamnese_enviar" as never, {
        p_token: token,
        p_dados: payload,
      } as never);
      if (error) throw error;
      if (!ok) {
        setErros(["Essa anamnese já foi respondida. Fala com o time se precisar mudar algo."]);
        return;
      }
      try { localStorage.removeItem(rascunhoKey); } catch { /* storage bloqueado */ }
      setEnviada(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "erro desconhecido";
      setErros([`Não consegui enviar agora (${msg}). Tenta de novo em alguns segundos.`]);
    } finally {
      setEnviando(false);
    }
  }

  const progresso = useMemo(
    () => Math.round(((etapa + 1) / ANAMNESE_SECOES.length) * 100),
    [etapa],
  );

  const moldura = (conteudo: React.ReactNode) => (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh" }}>
      <HeaderBrand nome="Anamnese inicial" tagline="Time Breno Xavier" />
      <div className="max-w-md mx-auto px-5 py-8">{conteudo}</div>
    </div>
  );

  const aviso = (titulo: string, texto: string) =>
    moldura(
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: "10px",
          padding: "28px 22px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "18px", fontWeight: 700 }}>{titulo}</div>
        <div style={{ color: C.textDim, fontSize: "14px", marginTop: "8px", lineHeight: 1.5 }}>
          {texto}
        </div>
      </div>,
    );

  if (carregando) return aviso("Abrindo tua anamnese", "Um segundo.");
  if (invalida) {
    return aviso(
      "Link inválido",
      "Esse link não existe ou foi trocado. Fala com o time da consultoria que a gente manda outro.",
    );
  }
  if (jaRespondida && !enviada) {
    return aviso(
      "Anamnese já respondida",
      `Tua anamnese já está com a gente, ${nomeAluna.split(" ")[0]}. Se precisar mudar alguma coisa, fala com o time.`,
    );
  }
  if (enviada) {
    return aviso(
      "Recebemos tua anamnese",
      "É daqui que sai teu treino e tua dieta. Qualquer coisa que faltar, a gente te chama.",
    );
  }

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh" }}>
      <HeaderBrand nome="Anamnese inicial" tagline="Time Breno Xavier" />

      <div className="max-w-md mx-auto px-5 pt-2">
        <div className="flex items-center justify-between mb-2">
          <span style={{ color: C.textDim, fontSize: "12px" }}>
            Etapa {etapa + 1} de {ANAMNESE_SECOES.length}
          </span>
          <span style={{ color: C.textDim, fontSize: "12px" }}>{ANAMNESE_SECOES[etapa]}</span>
        </div>
        <div style={{ height: "4px", background: C.border, borderRadius: "2px", overflow: "hidden" }}>
          <div
            style={{
              width: `${progresso}%`,
              height: "100%",
              background: C.brand,
              transition: "width 250ms ease",
            }}
          />
        </div>
      </div>

      <div className="max-w-md mx-auto px-5 pb-32 pt-3">
        {etapa === 0 && (
          <div
            style={{
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${C.border}`,
              borderRadius: "10px",
              padding: "14px 16px",
              marginBottom: "12px",
            }}
          >
            <div style={{ fontSize: "16px", fontWeight: 600 }}>
              Oi, {nomeAluna.split(" ")[0] || "tudo bem"}!
            </div>
            <div style={{ color: C.textDim, fontSize: "13px", marginTop: "4px", lineHeight: 1.5 }}>
              É daqui que sai teu treino e tua dieta. Preenche com calma e com sinceridade, teu
              resultado depende disso.
            </div>
          </div>
        )}

        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: "10px",
            padding: "24px 20px",
          }}
          className="space-y-7"
        >
          <h1 className="font-semibold" style={{ fontSize: "20px", color: C.text }}>
            {ANAMNESE_SECOES[etapa]}
          </h1>

          {/* ---------------- 0: Você ---------------- */}
          {etapa === 0 && (
            <>
              <Q label="Teu nome completo" required>
                <Textbox
                  value={data.nome_completo}
                  onChange={(v) => set("nome_completo", v)}
                  placeholder="Nome e sobrenome"
                  multiline={false}
                />
              </Q>
              <Q label="Teu Instagram">
                <Textbox
                  value={data.instagram}
                  onChange={(v) => set("instagram", v)}
                  placeholder="@seuperfil"
                  multiline={false}
                />
              </Q>
              <Q label="Vai treinar em casa ou na academia? (treino de força)" required>
                <Radio
                  value={data.treina_onde}
                  onChange={(v) => set("treina_onde", v)}
                  options={TREINA_ONDE}
                />
              </Q>
              <Q label="Data de nascimento">
                <input
                  type="date"
                  value={data.data_nascimento ?? ""}
                  onChange={(e) => set("data_nascimento", e.target.value)}
                  style={{
                    width: "100%",
                    height: "48px",
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${C.border}`,
                    borderRadius: "10px",
                    color: C.text,
                    padding: "0 14px",
                    fontSize: "15px",
                    outline: "none",
                  }}
                />
              </Q>
              <Q label="Profissão">
                <Textbox
                  value={data.profissao}
                  onChange={(v) => set("profissao", v)}
                  multiline={false}
                />
              </Q>
              <Q label="Peso e altura" required>
                <Textbox
                  value={data.peso_altura}
                  onChange={(v) => set("peso_altura", v)}
                  placeholder="Ex.: 62kg e 1,65m"
                  multiline={false}
                />
              </Q>
              <Q label="Tem alguma restrição médica para a prática de exercícios? Se sim, qual?">
                <Textbox value={data.restricao_medica} onChange={(v) => set("restricao_medica", v)} />
              </Q>
              <Q label="Qual o teu nível de ansiedade?">
                <Radio value={data.ansiedade} onChange={(v) => set("ansiedade", v)} options={ANSIEDADE} />
              </Q>
              <Q label="Quantas horas por dia você trabalha?">
                <Radio
                  value={data.horas_trabalho}
                  onChange={(v) => set("horas_trabalho", v)}
                  options={HORAS_TRABALHO}
                />
              </Q>
              <Q
                label="Qual o nível do teu esforço diário?"
                hint="Não conta o treino, e sim as atividades do dia: trabalho, andar, tarefas de casa."
              >
                <Radio
                  value={data.esforco_diario}
                  onChange={(v) => set("esforco_diario", v)}
                  options={ESFORCO_DIARIO}
                />
              </Q>
              <Q label="Dorme aproximadamente quantas horas por noite?">
                <Radio value={data.horas_sono} onChange={(v) => set("horas_sono", v)} options={HORAS_SONO} />
              </Q>
              <Q label="Como você considera a qualidade do teu sono?">
                <Radio
                  value={data.qualidade_sono}
                  onChange={(v) => set("qualidade_sono", v)}
                  options={QUALIDADE_SONO}
                />
              </Q>
              <Q label="Quantas vezes você vai ao banheiro fazer o número 2 por dia?">
                <Radio
                  value={data.intestino}
                  onChange={(v) => set("intestino", v)}
                  options={INTESTINO_ANAMNESE}
                />
              </Q>
              <Q label="Você já conseguiu atingir teu objetivo? Se não, o que faltou?">
                <Textbox
                  value={data.objetivo_atingido}
                  onChange={(v) => set("objetivo_atingido", v)}
                  rows={4}
                />
              </Q>
              <Q label="Pensando no que mais te incomoda no teu corpo, se pudesse escolher só 3, quais seriam?">
                <Textbox value={data.tres_incomodos} onChange={(v) => set("tres_incomodos", v)} rows={4} />
              </Q>
              <Q
                label="Qual é o modelo de corpo que te agrada?"
                hint="Descreve as características, ou os músculos que você tem interesse em desenvolver mais."
              >
                <Textbox value={data.modelo_corpo} onChange={(v) => set("modelo_corpo", v)} rows={4} />
              </Q>
              <Q
                label="Conta o histórico de evoluções e regressões no teu corpo, e onde você está hoje."
                hint="Ex.: ganhei mais de 10kg nos últimos anos e estou no meu maior peso; ou já venho de bons resultados e agora quero lapidar."
              >
                <Textbox value={data.historico_corpo} onChange={(v) => set("historico_corpo", v)} rows={5} />
              </Q>
            </>
          )}

          {/* ---------------- 1: Treino ---------------- */}
          {etapa === 1 && (
            <>
              <Q label="Você sente dores com frequência? Se sim, cita.">
                <Textbox value={data.dores} onChange={(v) => set("dores", v)} rows={3} />
              </Q>
              <Q label="Você treina musculação? Se sim, há quanto tempo?">
                <Radio
                  value={data.treina_musculacao}
                  onChange={(v) => set("treina_musculacao", v)}
                  options={TREINA_MUSCULACAO}
                />
                {data.treina_musculacao === "outro" && (
                  <div style={{ marginTop: "10px" }}>
                    <Textbox
                      value={data.treina_musculacao_outro}
                      onChange={(v) => set("treina_musculacao_outro", v)}
                      placeholder="Conta como é"
                      multiline={false}
                    />
                  </div>
                )}
              </Q>
              <Q
                label="Quantos dias por semana você tem disponível pra treinar?"
                hint="Pode marcar mais de uma."
                required
              >
                <Checks
                  selecionados={listaValores(data.dias_disponiveis)}
                  onToggle={(v) => set("dias_disponiveis", alternarValor(data.dias_disponiveis, v))}
                  options={DIAS_DISPONIVEIS}
                />
              </Q>
              <Q label="Quanto tempo você tem por sessão de treino?" required>
                <Radio
                  value={data.tempo_sessao}
                  onChange={(v) => set("tempo_sessao", v)}
                  options={TEMPO_SESSAO}
                />
              </Q>
              <Q label="Pratica algum exercício com constância que não seja musculação? Se sim, qual?">
                <Textbox value={data.outro_exercicio} onChange={(v) => set("outro_exercicio", v)} rows={3} />
              </Q>
              <Q label="Quer falar mais alguma coisa que ajude no planejamento do teu treino?">
                <Textbox
                  value={data.comentario_treino}
                  onChange={(v) => set("comentario_treino", v)}
                  rows={3}
                />
              </Q>
              <div
                style={{
                  border: `1px dashed ${C.border}`,
                  borderRadius: "10px",
                  padding: "12px 14px",
                  color: C.textDim,
                  fontSize: "13px",
                  lineHeight: 1.5,
                }}
              >
                {AVISO_CARGAS}
              </div>
            </>
          )}

          {/* ---------------- 2: Alimentação ---------------- */}
          {etapa === 2 && (
            <>
              <Q label="Já fez algum acompanhamento nutricional? Se sim, teve uma boa experiência?">
                <Textbox
                  value={data.acompanhamento_nutricional}
                  onChange={(v) => set("acompanhamento_nutricional", v)}
                  rows={3}
                />
              </Q>
              <Q
                label="Tem alguma restrição, intolerância ou alergia alimentar? Se sim, qual?"
                hint="Isso entra direto no teu cardápio."
              >
                <Textbox
                  value={data.restricao_alimentar}
                  onChange={(v) => set("restricao_alimentar", v)}
                  rows={3}
                />
              </Q>
              <Q label="Como você define tua alimentação?">
                <Radio
                  value={data.define_alimentacao}
                  onChange={(v) => set("define_alimentacao", v)}
                  options={DEFINE_ALIMENTACAO}
                />
              </Q>
              <Q label="Ingere bebida alcoólica?">
                <Radio
                  value={data.bebida_alcoolica}
                  onChange={(v) => set("bebida_alcoolica", v)}
                  options={BEBIDA_ALCOOLICA}
                />
              </Q>
              <Q label="Fuma?">
                <Radio value={data.fuma} onChange={(v) => set("fuma", v)} options={FUMA} />
              </Q>
              <Q label="Como é a tua ingestão de doces?">
                <Radio
                  value={data.ingestao_doces}
                  onChange={(v) => set("ingestao_doces", v)}
                  options={INGESTAO_DOCES}
                />
              </Q>
              <Q label="Na alimentação, o que você acha que tem te atrapalhado a atingir teus objetivos?">
                <Textbox
                  value={data.dificuldade_alimentacao}
                  onChange={(v) => set("dificuldade_alimentacao", v)}
                  rows={4}
                />
              </Q>
              <Q label="Tem o hábito de levar as refeições para o trabalho?">
                <Radio
                  value={data.leva_refeicoes}
                  onChange={(v) => set("leva_refeicoes", v)}
                  options={SIM_NAO}
                />
              </Q>
              <Q label="Tua família tem histórico de doenças cardiovasculares? (pressão alta, parada cardíaca)">
                <Radio
                  value={data.historico_cardiovascular}
                  onChange={(v) => set("historico_cardiovascular", v)}
                  options={SIM_NAO}
                />
              </Q>
              <Q label="Quantas refeições ficam confortáveis pra você fazer por dia?">
                <Radio
                  value={data.refeicoes_dia ? String(data.refeicoes_dia) : undefined}
                  onChange={(v) => set("refeicoes_dia", Number(v))}
                  options={REFEICOES_DIA.map((n) => ({
                    value: String(n),
                    label: n === 1 ? "1 refeição por dia" : `${n} refeições por dia`,
                  }))}
                />
              </Q>
              <Q label="Está usando algum suplemento alimentar? Se sim, qual?">
                <Textbox value={data.suplemento} onChange={(v) => set("suplemento", v)} multiline={false} />
              </Q>
              <Q label="Está usando alguma medicação, prescrita ou por conta própria?">
                <Textbox value={data.medicacao} onChange={(v) => set("medicacao", v)} multiline={false} />
              </Q>
              <Q
                label="Você costuma descontar o estresse e a ansiedade na alimentação?"
                hint="Beliscando ao longo do dia, pedindo comida, doce."
              >
                <Radio
                  value={data.desconta_estresse}
                  onChange={(v) => set("desconta_estresse", v)}
                  options={DESCONTA_ESTRESSE}
                />
              </Q>
              <Q label="De 0 a 10, o quanto você está PRONTA pra mudar teus hábitos e comportamentos?">
                <Slider
                  value={data.pronta_mudanca}
                  onChange={(v) => set("pronta_mudanca", v)}
                  leftLabel="Nada pronta"
                  rightLabel="Totalmente pronta"
                />
              </Q>
              <Q label="De 0 a 10, o quanto você se acha CAPAZ de mudar teus hábitos e comportamentos?">
                <Slider
                  value={data.capaz_mudanca}
                  onChange={(v) => set("capaz_mudanca", v)}
                  leftLabel="Nada capaz"
                  rightLabel="Totalmente capaz"
                />
              </Q>
              <Q label="O quanto as pessoas e o ambiente ao teu redor te dão suporte pra essa mudança?">
                <Slider
                  value={data.suporte_ambiente}
                  onChange={(v) => set("suporte_ambiente", v)}
                  leftLabel="Nenhum suporte"
                  rightLabel="Suporte total"
                />
              </Q>
              <Q
                label="Escreve de forma prática e detalhada a tua rotina alimentar."
                hint={ROTINA_ALIMENTAR_EXEMPLO}
                required
              >
                <Textbox
                  value={data.rotina_alimentar}
                  onChange={(v) => set("rotina_alimentar", v)}
                  rows={8}
                  placeholder="Do café da manhã até a última coisa que você come no dia"
                />
              </Q>
              <label
                style={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "flex-start",
                  border: `1px solid ${data.aceite ? C.brand : C.border}`,
                  borderRadius: "10px",
                  padding: "14px",
                  cursor: "pointer",
                  background: data.aceite ? "rgba(255,192,0,0.06)" : "transparent",
                }}
              >
                <input
                  type="checkbox"
                  checked={!!data.aceite}
                  onChange={(e) => set("aceite", e.target.checked)}
                  style={{ marginTop: "3px", width: "18px", height: "18px", accentColor: C.brand }}
                />
                <span style={{ fontSize: "13px", lineHeight: 1.5, color: C.text }}>{TERMO_FINAL}</span>
              </label>
            </>
          )}

          {erros.length > 0 && (
            <div
              style={{
                background: "rgba(248,113,113,0.08)",
                border: `1px solid ${C.red}`,
                borderRadius: "8px",
                padding: "12px 14px",
                color: C.red,
                fontSize: "14px",
              }}
            >
              {erros.map((e) => (
                <div key={e}>• {e}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          position: "fixed",
          insetInline: 0,
          bottom: 0,
          background: C.bg,
          borderTop: `1px solid ${C.border}`,
          padding: "12px 20px calc(12px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div className="max-w-md mx-auto flex gap-3">
          {etapa > 0 && (
            <button
              type="button"
              onClick={() => { setEtapa((s) => s - 1); setErros([]); }}
              style={{
                background: "transparent",
                border: `1px solid ${C.border}`,
                borderRadius: "10px",
                color: C.text,
                padding: "0 20px",
                height: "48px",
                fontSize: "15px",
                cursor: "pointer",
              }}
            >
              Voltar
            </button>
          )}
          <button
            type="button"
            onClick={etapa < ANAMNESE_SECOES.length - 1 ? proxima : enviar}
            disabled={enviando}
            style={{
              flex: 1,
              background: C.brand,
              color: "#000",
              border: "none",
              borderRadius: "10px",
              height: "48px",
              fontSize: "15px",
              fontWeight: 700,
              cursor: enviando ? "not-allowed" : "pointer",
              opacity: enviando ? 0.7 : 1,
            }}
          >
            {etapa < ANAMNESE_SECOES.length - 1
              ? "Próxima"
              : enviando
                ? "Enviando..."
                : "Enviar anamnese"}
          </button>
        </div>
      </div>
    </div>
  );
}
