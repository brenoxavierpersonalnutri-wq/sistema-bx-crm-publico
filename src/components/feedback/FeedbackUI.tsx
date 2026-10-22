// Primitivas visuais do Feedback Semanal / Quinzenal.
//
// Mesma linguagem visual da Pesquisa de Satisfação (dark + dourado, mobile
// first, alvos de toque de 48px). Cores fixas de propósito: o formulário é
// público e não pode depender do theme do app, senão um token de cor do
// dashboard sobrescreve e quebra o visual pra aluna.

export const C = {
  bg: "#0a0a0a",
  card: "#131313",
  border: "#1f1f1f",
  text: "#e8e8e8",
  textDim: "#888",
  brand: "#ffc000",
  green: "#4ade80",
  yellow: "#fbbf24",
  red: "#f87171",
  whatsapp: "#25D366",
};

interface SliderProps {
  value: number | undefined;
  onChange: (v: number) => void;
  leftLabel: string;
  rightLabel: string;
  /** Legenda extra que muda conforme a nota (ex.: referência de FC do cardio). */
  footnote?: string | null;
}

export function Slider({ value, onChange, leftLabel, rightLabel, footnote }: SliderProps) {
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
        style={{ width: "100%", accentColor: C.brand, height: "28px" }}
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
      {footnote && (
        <div
          className="text-xs mt-2 text-center"
          style={{ color: C.brand, opacity: 0.85 }}
        >
          {footnote}
        </div>
      )}
    </div>
  );
}

// Sem genérico de propósito: todos os campos de escolha viram `string` na
// tabela, então amarrar T nas literais dos `as const` só obrigaria cast na
// chamada sem ganhar segurança nenhuma.
interface RadioProps {
  value: string | undefined;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}

export function Radio({ value, onChange, options }: RadioProps) {
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

interface ChecksProps {
  /** Valores marcados. */
  selecionados: string[];
  onToggle: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}

/**
 * Múltipla escolha. Mesma caixa do Radio, com um quadradinho marcável na
 * frente — é o que diz pra aluna, sem ler texto nenhum, que dá pra marcar
 * mais de uma.
 */
export function Checks({ selecionados, onToggle, options }: ChecksProps) {
  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const selected = selecionados.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            role="checkbox"
            aria-checked={selected}
            onClick={() => onToggle(opt.value)}
            className="w-full text-left px-4 py-3 rounded-lg border transition-colors flex items-center gap-3"
            style={{
              borderColor: selected ? C.brand : C.border,
              background: selected ? "rgba(255,192,0,0.08)" : "transparent",
              color: C.text,
              minHeight: "48px",
              fontSize: "15px",
            }}
          >
            <span
              aria-hidden
              style={{
                width: "20px",
                height: "20px",
                flexShrink: 0,
                borderRadius: "5px",
                border: `1.5px solid ${selected ? C.brand : C.border}`,
                background: selected ? C.brand : "transparent",
                color: "#000",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "13px",
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              {selected ? "✓" : ""}
            </span>
            {opt.label}
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
  inputMode?: "text" | "tel";
}

export function Textbox({
  value,
  onChange,
  placeholder,
  rows = 3,
  multiline = true,
  inputMode,
}: TextProps) {
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
      inputMode={inputMode}
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

export function Q({ label, required, children, hint }: QProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block font-medium" style={{ color: C.text, fontSize: "15px" }}>
          {label}
          {required && <span style={{ color: C.red, marginLeft: "4px" }}>*</span>}
        </label>
        {hint && (
          <p className="text-xs mt-1" style={{ color: C.textDim, lineHeight: 1.5 }}>
            {hint}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

export function HeaderBrand({
  nome,
  tagline,
  sub = "Feedback de acompanhamento",
}: {
  nome: string;
  tagline: string;
  sub?: string;
}) {
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
        {nome}
      </div>
      <div style={{ color: C.textDim, fontSize: "12px", marginTop: "4px" }}>{tagline}</div>
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
        {sub}
      </div>
    </div>
  );
}
