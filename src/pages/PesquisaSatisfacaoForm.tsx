import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  PesquisaResponse,
  ProdutoConfig,
  PRODUTOS,
  TEMPO_PROGRAMA,
  PLANOS,
  WPP_FREQUENCIA,
  WPP_OUVIDA,
  COMERCIAL_PRESSAO,
  COMERCIAL_CLAREZA,
  INSTA_FREQUENCIA,
  INSTA_TIPOS,
  NPS_INDICOU,
  NPS_DEPOIMENTO,
  PROGRAMA_INDICACAO_INTERESSE,
  DRAFT_KEY,
} from "@/types/pesquisaSatisfacao";

// Cores fixas (dark mode obrigatório). Não dependo do theme do projeto pra evitar
// que o token de cor do app sobrescreva e quebre o visual da pesquisa.
const C = {
  bg: "#0a0a0a",
  card: "#131313",
  border: "#1f1f1f",
  text: "#e8e8e8",
  textDim: "#888",
  brand: "#ffc000",
  green: "#4ade80",
  yellow: "#fbbf24",
  red: "#f87171",
};

// Ordem: começa pela experiência com o programa (engaja mais que pedir cadastro).
// Identificação fica por último — quando a aluna já investiu tempo respondendo.
const STEPS = [
  "Programa em geral",
  "Acompanhamento no WhatsApp",
  "Comercial / Pré-venda",
  "Conteúdos do Instagram",
  "Indicação",
  "Aberto",
  "Programa de Indicação",
  "Identificação",
] as const;

type StepIdx = number;

interface SliderProps {
  value: number | undefined;
  onChange: (v: number) => void;
  leftLabel: string;
  rightLabel: string;
}

function Slider({ value, onChange, leftLabel, rightLabel }: SliderProps) {
  const display = value ?? 5;
  return (
    <div>
      <input
        type="range"
        min={0}
        max={10}
        step={1}
        value={display}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        style={{
          width: "100%",
          accentColor: C.brand,
          height: "28px",
        }}
        aria-label={`${leftLabel} - ${rightLabel}`}
      />
      <div className="flex items-center justify-between mt-2 text-xs" style={{ color: C.textDim }}>
        <span>{leftLabel}</span>
        <span
          className="px-3 py-1 rounded-md font-semibold tabular-nums"
          style={{
            background: value === undefined ? C.border : C.brand,
            color: value === undefined ? C.textDim : "#000",
            fontSize: "16px",
          }}
        >
          {value === undefined ? "—" : value}
        </span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}

interface RadioProps<T extends string> {
  value: T | undefined;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}

function Radio<T extends string>({ value, onChange, options }: RadioProps<T>) {
  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="w-full text-left px-4 py-3 rounded-lg border transition-colors"
            style={{
              borderColor: selected ? C.brand : C.border,
              background: selected ? "rgba(255,192,0,0.08)" : "transparent",
              color: C.text,
              minHeight: "48px",
              fontSize: "15px",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

interface CheckProps {
  values: string[];
  onChange: (next: string[]) => void;
  options: ReadonlyArray<string>;
}

function Checkboxes({ values, onChange, options }: CheckProps) {
  const toggle = (v: string) => {
    if (values.includes(v)) onChange(values.filter((x) => x !== v));
    else onChange([...values, v]);
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((opt) => {
        const selected = values.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className="text-left px-3 py-3 rounded-lg border transition-colors"
            style={{
              borderColor: selected ? C.brand : C.border,
              background: selected ? "rgba(255,192,0,0.08)" : "transparent",
              color: C.text,
              minHeight: "48px",
              fontSize: "14px",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

interface TextProps {
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  multiline?: boolean;
}

function Textbox({ value, onChange, placeholder, rows = 3, multiline = true }: TextProps) {
  const sharedStyle: React.CSSProperties = {
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: "10px",
    color: C.text,
    padding: "12px 14px",
    width: "100%",
    fontSize: "15px",
    fontFamily: "inherit",
    outline: "none",
  };
  if (multiline) {
    return (
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        style={{ ...sharedStyle, resize: "vertical", minHeight: "80px" }}
        onFocus={(e) => (e.currentTarget.style.borderColor = C.brand)}
        onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
      />
    );
  }
  return (
    <input
      type="text"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ ...sharedStyle, height: "48px" }}
      onFocus={(e) => (e.currentTarget.style.borderColor = C.brand)}
      onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
    />
  );
}

interface QProps {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}

function Q({ label, required, children, hint }: QProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block font-medium" style={{ color: C.text, fontSize: "15px" }}>
          {label}
          {required && <span style={{ color: C.red, marginLeft: "4px" }}>*</span>}
        </label>
        {hint && (
          <p className="text-xs mt-1" style={{ color: C.textDim }}>
            {hint}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

// Header branded — fica fixo no topo. Nome do produto em destaque,
// "Time Breno Xavier" como assinatura embaixo. Mantém coesão visual entre
// produtos enquanto deixa claro qual pesquisa a aluna tá respondendo.
function HeaderBrand({ produto }: { produto: ProdutoConfig }) {
  return (
    <div className="text-center pt-6 pb-4">
      <div
        style={{
          color: C.brand,
          fontSize: "20px",
          fontWeight: 700,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        {produto.nome}
      </div>
      <div
        style={{
          color: C.textDim,
          fontSize: "12px",
          marginTop: "4px",
          letterSpacing: "0.02em",
        }}
      >
        {produto.tagline}
      </div>
      <div
        style={{
          width: "40px",
          height: "2px",
          background: C.brand,
          margin: "10px auto 0",
          borderRadius: "1px",
        }}
      />
      <div
        style={{
          color: C.textDim,
          fontSize: "10px",
          marginTop: "8px",
          letterSpacing: "0.3em",
          textTransform: "uppercase",
        }}
      >
        Time Breno Xavier
      </div>
    </div>
  );
}

interface FormProps {
  produto?: ProdutoConfig;
}

export default function PesquisaSatisfacaoForm({ produto: produtoProp }: FormProps = {}) {
  // Fallback pra MGMD se a rota antiga (sem produto) for usada — não quebra
  // link antigo que esteja em algum WhatsApp.
  const produto = produtoProp ?? PRODUTOS.mgmd;
  // Rascunho separado por produto pra não misturar dados entre MGMD e Elite.
  const draftKey = `${DRAFT_KEY}-${produto.slug}`;

  const [step, setStep] = useState<StepIdx>(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [data, setData] = useState<Partial<PesquisaResponse>>({});
  const [errors, setErrors] = useState<string[]>([]);

  // Restaura rascunho do localStorage (específico do produto).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") setData(parsed);
      }
    } catch {}
  }, [draftKey]);

  // Salva rascunho a cada mudança.
  useEffect(() => {
    if (submitted) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(data));
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [data, submitted, draftKey]);

  const update = <K extends keyof PesquisaResponse>(k: K, v: PesquisaResponse[K]) => {
    setData((prev) => ({ ...prev, [k]: v }));
    setErrors([]);
  };

  const progressPct = useMemo(
    () => Math.min(100, ((step + 1) / STEPS.length) * 100),
    [step]
  );

  // Validação por step. Índices casados com a ordem do array STEPS acima.
  function validateStep(): string[] {
    const errs: string[] = [];
    // 0 = Programa em geral — exige satisfação geral
    if (step === 0) {
      if (data.satisfacao_geral === undefined) errs.push("Marca a satisfação geral.");
    }
    // 4 = Indicação NPS — exige motivo
    if (step === 4) {
      if (!data.nps_motivo || data.nps_motivo.trim().length < 3)
        errs.push("Conta rapidinho por que essa nota de NPS.");
    }
    // 7 = Identificação (último step antes do envio) — exige cadastro mínimo
    if (step === 7) {
      if (!data.nome || data.nome.trim().length < 2) errs.push("Coloca teu nome completo.");
      if (!data.tempo_programa) errs.push("Diz há quanto tempo é aluna.");
      if (!data.plano) errs.push("Marca o plano contratado.");
    }
    return errs;
  }

  function next() {
    const errs = validateStep();
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    setStep((s) => s + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function back() {
    setErrors([]);
    setStep((s) => Math.max(0, s - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    const errs = validateStep();
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setSubmitting(true);
    try {
      const payload: any = {
        ...data,
        nome: data.nome?.trim(),
        produto: produto.slug,
      };
      const { error } = await supabase.from("pesquisa_responses" as any).insert(payload);
      if (error) throw error;
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      setErrors([
        `Não consegui enviar agora (${err.message || "erro desconhecido"}). Tenta de novo em alguns segundos.`,
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div style={{ background: C.bg, color: C.text, minHeight: "100vh" }}>
        <HeaderBrand produto={produto} />
        <div className="max-w-md mx-auto px-5 py-12">
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "10px",
              padding: "32px 24px",
            }}
            className="text-center"
          >
            <div
              style={{
                width: "64px",
                height: "64px",
                background: C.brand,
                color: "#000",
                borderRadius: "999px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "32px",
                fontWeight: 700,
                margin: "0 auto 20px",
              }}
            >
              ✓
            </div>
            <h2 className="font-semibold mb-3" style={{ fontSize: "22px", color: C.text }}>
              Recebido!
            </h2>
            <p style={{ color: C.textDim, lineHeight: 1.5 }}>
              Obrigado pela sinceridade. Vou ler com calma e usar pra ajustar o que precisar — desde
              o atendimento até o conteúdo que entrego.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh" }}>
      {/* Header branded fixo no topo */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: C.bg }}>
        <HeaderBrand produto={produto} />
        <div className="max-w-md mx-auto px-5 pb-3">
          <div className="flex items-center justify-between text-xs mb-2" style={{ color: C.textDim }}>
            <span>
              Etapa {step + 1} de {STEPS.length}
            </span>
            <span>{STEPS[step]}</span>
          </div>
          <div
            style={{
              height: "4px",
              background: C.border,
              borderRadius: "2px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progressPct}%`,
                height: "100%",
                background: C.brand,
                transition: "width 250ms ease",
              }}
            />
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-5 pb-32 pt-3">
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
            {STEPS[step]}
          </h1>

          {/* 0 — Programa em geral (abre o questionário pela experiência) */}
          {step === 0 && (
            <>
              <Q label="No geral, o quanto você está satisfeita com o programa?" required>
                <Slider
                  value={data.satisfacao_geral}
                  onChange={(v) => update("satisfacao_geral", v)}
                  leftLabel="Muito insatisfeita"
                  rightLabel="Extremamente satisfeita"
                />
              </Q>
              <Q label="O resultado tá batendo com a sua expectativa inicial?">
                <Slider
                  value={data.expectativa_resultado}
                  onChange={(v) => update("expectativa_resultado", v)}
                  leftLabel="Muito abaixo"
                  rightLabel="Acima da expectativa"
                />
              </Q>
              <Q label="O que você mais tá gostando do acompanhamento?">
                <Textbox
                  value={data.surpreendeu}
                  onChange={(v) => update("surpreendeu", v)}
                  placeholder="Pode ser sincera"
                />
              </Q>
              <Q label="Tem algo que te decepcionou ou deixou a desejar?">
                <Textbox
                  value={data.decepcionou}
                  onChange={(v) => update("decepcionou", v)}
                  placeholder="Sem filtro"
                />
              </Q>
            </>
          )}

          {/* 1 — WhatsApp */}
          {step === 1 && (
            <>
              <Q label="Satisfação com o atendimento no WhatsApp">
                <Slider
                  value={data.wpp_satisfacao}
                  onChange={(v) => update("wpp_satisfacao", v)}
                  leftLabel="Muito insatisfeita"
                  rightLabel="Extremamente satisfeita"
                />
              </Q>
              <Q label="Tempo de resposta">
                <Slider
                  value={data.wpp_tempo_resposta}
                  onChange={(v) => update("wpp_tempo_resposta", v)}
                  leftLabel="Demorado"
                  rightLabel="Rápido"
                />
              </Q>
              <Q label="Clareza das orientações">
                <Slider
                  value={data.wpp_clareza}
                  onChange={(v) => update("wpp_clareza", v)}
                  leftLabel="Confusas"
                  rightLabel="Claras"
                />
              </Q>
              <Q label="Frequência de contato">
                <Radio
                  value={data.wpp_frequencia as any}
                  onChange={(v) => update("wpp_frequencia", v)}
                  options={WPP_FREQUENCIA as any}
                />
              </Q>
              <Q label="Você se sente ouvida?">
                <Radio
                  value={data.wpp_ouvida as any}
                  onChange={(v) => update("wpp_ouvida", v)}
                  options={WPP_OUVIDA as any}
                />
              </Q>
              <Q label="O que poderíamos melhorar no atendimento?">
                <Textbox
                  value={data.wpp_melhorar}
                  onChange={(v) => update("wpp_melhorar", v)}
                  placeholder="Tempo, tom, clareza..."
                />
              </Q>
            </>
          )}

          {/* 2 — Comercial */}
          {step === 2 && (
            <>
              <Q label="Nota pro atendimento comercial (pré-venda)">
                <Slider
                  value={data.comercial_nota}
                  onChange={(v) => update("comercial_nota", v)}
                  leftLabel="Péssimo"
                  rightLabel="Excelente"
                />
              </Q>
              <Q label="Como você se sentiu no processo de compra?">
                <Radio
                  value={data.comercial_pressao as any}
                  onChange={(v) => update("comercial_pressao", v)}
                  options={COMERCIAL_PRESSAO as any}
                />
              </Q>
              <Q label="As informações foram claras (valor, prazo, o que estava incluso)?">
                <Radio
                  value={data.comercial_clareza as any}
                  onChange={(v) => update("comercial_clareza", v)}
                  options={COMERCIAL_CLAREZA as any}
                />
              </Q>
              <Q label="O que poderíamos melhorar no comercial?">
                <Textbox
                  value={data.comercial_melhorar}
                  onChange={(v) => update("comercial_melhorar", v)}
                />
              </Q>
            </>
          )}

          {/* 3 — Instagram */}
          {step === 3 && (
            <>
              <Q label="Com que frequência você consome conteúdo no Instagram do Breno?">
                <Radio
                  value={data.insta_frequencia as any}
                  onChange={(v) => update("insta_frequencia", v)}
                  options={INSTA_FREQUENCIA as any}
                />
              </Q>
              <Q label="Os conteúdos têm sido úteis pra você?">
                <Slider
                  value={data.insta_utilidade}
                  onChange={(v) => update("insta_utilidade", v)}
                  leftLabel="Nada úteis"
                  rightLabel="Muito úteis"
                />
              </Q>
              <Q label="Quais tipos de conteúdo você mais gosta? (pode marcar vários)">
                <Checkboxes
                  values={data.insta_tipos ?? []}
                  onChange={(v) => update("insta_tipos", v)}
                  options={INSTA_TIPOS}
                />
              </Q>
              <Q label="Que tipo de conteúdo você gostaria de ver mais?">
                <Textbox
                  value={data.insta_ver_mais}
                  onChange={(v) => update("insta_ver_mais", v)}
                />
              </Q>
              <Q label="E o que poderíamos cortar / postar menos?">
                <Textbox value={data.insta_cortar} onChange={(v) => update("insta_cortar", v)} />
              </Q>
            </>
          )}

          {/* 4 — Indicação NPS (separada do programa de indicação remunerada) */}
          {step === 4 && (
            <>
              <Q label="De 0 a 10, o quanto você indicaria o programa pra uma amiga?">
                <Slider
                  value={data.nps_nota}
                  onChange={(v) => update("nps_nota", v)}
                  leftLabel="De jeito nenhum"
                  rightLabel="Com certeza indicaria"
                />
              </Q>
              <Q label="Por que essa nota?" required>
                <Textbox
                  value={data.nps_motivo}
                  onChange={(v) => update("nps_motivo", v)}
                  placeholder="Esse motivo é o que mais importa pra mim"
                />
              </Q>
              <Q label="Você já indicou o programa pra alguém?">
                <Radio
                  value={data.nps_indicou as any}
                  onChange={(v) => update("nps_indicou", v)}
                  options={NPS_INDICOU as any}
                />
              </Q>
              <Q label="Se indicou e a pessoa fechou, qual o nome dela? (opcional)">
                <Textbox
                  value={data.nps_quem_fechou}
                  onChange={(v) => update("nps_quem_fechou", v)}
                  multiline={false}
                  placeholder="Nome de quem fechou"
                />
              </Q>
              <Q label="Posso usar parte da sua resposta como depoimento?">
                <Radio
                  value={data.nps_depoimento as any}
                  onChange={(v) => update("nps_depoimento", v)}
                  options={NPS_DEPOIMENTO as any}
                />
              </Q>
            </>
          )}

          {/* 5 — Aberto */}
          {step === 5 && (
            <>
              <Q label="Se você pudesse mudar UMA coisa no programa, o que mudaria?">
                <Textbox
                  value={data.mudaria_uma_coisa}
                  onChange={(v) => update("mudaria_uma_coisa", v)}
                  rows={4}
                />
              </Q>
              <Q label="O que mais te impede de ter resultado melhor?">
                <Textbox
                  value={data.impede_resultado}
                  onChange={(v) => update("impede_resultado", v)}
                  rows={4}
                />
              </Q>
              <Q label="Espaço livre — qualquer coisa que queira contar">
                <Textbox value={data.livre} onChange={(v) => update("livre", v)} rows={4} />
              </Q>
            </>
          )}

          {/* 6 — Programa de Indicação remunerada */}
          {step === 6 && (
            <>
              <div
                style={{
                  background: "rgba(255,192,0,0.06)",
                  border: `1px solid ${C.brand}`,
                  borderRadius: "10px",
                  padding: "16px 18px",
                  color: C.text,
                  fontSize: "14px",
                  lineHeight: 1.6,
                }}
              >
                <strong style={{ color: C.brand }}>Programa de indicação:</strong> a cada amiga que
                você indica e fecha o programa, você recebe entre <strong>R$ 100 e R$ 300</strong>{" "}
                em dinheiro — ou, se preferir, um benefício aqui dentro (avaliação extra, módulo
                bônus, etc).
              </div>
              <Q label="Tem interesse em participar?">
                <Radio
                  value={data.programa_indicacao_interesse as any}
                  onChange={(v) => update("programa_indicacao_interesse", v)}
                  options={PROGRAMA_INDICACAO_INTERESSE as any}
                />
              </Q>
              {(data.programa_indicacao_interesse === "sim" ||
                data.programa_indicacao_interesse === "talvez") && (
                <>
                  <Q
                    label="Tem alguém em mente? Pode colocar o nome (ou nomes) aqui"
                    hint="Não precisa ter certeza de que vai fechar. A gente conversa com elas."
                  >
                    <Textbox
                      value={data.programa_indicacao_nomes}
                      onChange={(v) => update("programa_indicacao_nomes", v)}
                      placeholder="Nome 1, Nome 2..."
                      rows={3}
                    />
                  </Q>
                  <Q label="Prefere falar comigo no WhatsApp ou que a gente te chame?">
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => update("programa_indicacao_quer_contato", false)}
                        className="w-full text-left px-4 py-3 rounded-lg border transition-colors"
                        style={{
                          borderColor:
                            data.programa_indicacao_quer_contato === false ? C.brand : C.border,
                          background:
                            data.programa_indicacao_quer_contato === false
                              ? "rgba(255,192,0,0.08)"
                              : "transparent",
                          color: C.text,
                          minHeight: "48px",
                          fontSize: "15px",
                        }}
                      >
                        Eu chamo no WhatsApp do Breno
                      </button>
                      <button
                        type="button"
                        onClick={() => update("programa_indicacao_quer_contato", true)}
                        className="w-full text-left px-4 py-3 rounded-lg border transition-colors"
                        style={{
                          borderColor:
                            data.programa_indicacao_quer_contato === true ? C.brand : C.border,
                          background:
                            data.programa_indicacao_quer_contato === true
                              ? "rgba(255,192,0,0.08)"
                              : "transparent",
                          color: C.text,
                          minHeight: "48px",
                          fontSize: "15px",
                        }}
                      >
                        Pode me chamar depois
                      </button>
                    </div>
                  </Q>
                </>
              )}
            </>
          )}

          {/* 7 — Identificação (último step antes do envio) */}
          {step === 7 && (
            <>
              <p style={{ color: C.textDim, fontSize: "14px", lineHeight: 1.5 }}>
                Pra fechar, só preciso saber quem é você. Essas informações ficam comigo, ninguém
                mais vê.
              </p>
              <Q label="Nome completo" required>
                <Textbox
                  value={data.nome}
                  onChange={(v) => update("nome", v)}
                  placeholder="Como você assina por extenso"
                  multiline={false}
                />
              </Q>
              <Q label="Há quanto tempo você é aluna?" required>
                <Radio
                  value={data.tempo_programa as any}
                  onChange={(v) => update("tempo_programa", v)}
                  options={TEMPO_PROGRAMA as any}
                />
              </Q>
              <Q label="Qual plano você contratou?" required>
                <Radio
                  value={data.plano as any}
                  onChange={(v) => update("plano", v)}
                  options={PLANOS as any}
                />
              </Q>
            </>
          )}

          {errors.length > 0 && (
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
              {errors.map((e, i) => (
                <div key={i}>• {e}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Botões fixos no rodapé pra ficarem acessíveis no mobile */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: C.bg,
          borderTop: `1px solid ${C.border}`,
          padding: "12px 16px",
          paddingBottom: "max(12px, env(safe-area-inset-bottom))",
        }}
      >
        <div className="max-w-md mx-auto flex items-center gap-3">
          {step > 0 && (
            <button
              type="button"
              onClick={back}
              disabled={submitting}
              style={{
                background: "transparent",
                border: `1px solid ${C.border}`,
                color: C.text,
                borderRadius: "10px",
                padding: "0 18px",
                height: "48px",
                fontSize: "15px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Voltar
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={next}
              disabled={submitting}
              style={{
                background: C.brand,
                color: "#000",
                border: "none",
                borderRadius: "10px",
                flex: 1,
                height: "48px",
                fontSize: "15px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Próxima
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              style={{
                background: C.brand,
                color: "#000",
                border: "none",
                borderRadius: "10px",
                flex: 1,
                height: "48px",
                fontSize: "15px",
                fontWeight: 700,
                cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "Enviando..." : "Enviar pesquisa"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
