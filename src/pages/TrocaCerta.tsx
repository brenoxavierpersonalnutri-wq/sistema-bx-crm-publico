import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { C, HeaderBrand } from "@/components/feedback/FeedbackUI";
import {
  PAISES,
  PAIS_PADRAO,
  paisPorIso,
  limparNumeroLocal,
  telefoneE164,
} from "@/types/feedbackSemanal";
import {
  ALIMENTOS,
  FONTE,
  buscar,
  medidasDe,
  trocar,
  NOME_MACRO,
  type Alimento,
  type MedidaCaseira,
} from "@/lib/trocaCerta";

/**
 * Troca Certa — a aluna troca um alimento da dieta por outro equivalente.
 *
 * Entra pelo mesmo portão do feedback semanal: o WhatsApp que ela deu na
 * consultoria, via RPC identificar_aluna_por_whatsapp. Reusa o portão em vez de
 * criar um segundo jeito de entrar — a aluna já conhece esse.
 *
 * O cálculo mora em @/lib/trocaCerta. Aqui é só tela.
 */
export default function TrocaCerta() {
  const [pais, setPais] = useState(PAIS_PADRAO);
  const [telefone, setTelefone] = useState("");
  const [aluna, setAluna] = useState<{ id: string; nome: string } | null>(null);
  const [erroLogin, setErroLogin] = useState("");
  const [buscandoAluna, setBuscandoAluna] = useState(false);

  async function identificar() {
    const local = limparNumeroLocal(telefone, pais);
    const minimo = pais.iso === "BR" ? 10 : 8;
    if (local.length < minimo) {
      setErroLogin(
        pais.iso === "BR"
          ? "Coloca DDD + número, só os dígitos. Ex.: 31990000107"
          : `Coloca o número completo, só os dígitos. Ex.: ${pais.exemplo}`
      );
      return;
    }
    setBuscandoAluna(true);
    setErroLogin("");
    try {
      // A RPC já vem tipada em integrations/supabase/types.ts — não precisa de `as any`.
      const { data, error } = await supabase.rpc("identificar_aluna_por_whatsapp", {
        p_telefone: telefoneE164(local, pais),
      });
      if (error) throw error;
      const achou = data?.[0];
      if (!achou) {
        setErroLogin(
          "Não achei esse número no cadastro. Confere se digitou certo ou fala com o time da consultoria."
        );
        return;
      }
      setAluna({ id: achou.id, nome: achou.nome_completo });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "erro desconhecido";
      setErroLogin(`Não consegui verificar agora (${msg}). Tenta de novo.`);
    } finally {
      setBuscandoAluna(false);
    }
  }

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh", padding: "24px 16px" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <HeaderBrand nome="TROCA CERTA" tagline="Time Breno Xavier" sub="Substituição de alimentos" />
        {aluna ? (
          <Calculadora primeiroNome={aluna.nome.split(" ")[0]} />
        ) : (
          <Portao
            pais={pais}
            setPais={setPais}
            telefone={telefone}
            setTelefone={setTelefone}
            erro={erroLogin}
            buscando={buscandoAluna}
            onEntrar={identificar}
          />
        )}
      </div>
    </div>
  );
}

// --- portão de entrada ------------------------------------------------------

function Portao({
  pais, setPais, telefone, setTelefone, erro, buscando, onEntrar,
}: {
  pais: typeof PAIS_PADRAO;
  setPais: (p: typeof PAIS_PADRAO) => void;
  telefone: string;
  setTelefone: (v: string) => void;
  erro: string;
  buscando: boolean;
  onEntrar: () => void;
}) {
  return (
    <div style={cardStyle}>
      <h2 style={{ margin: "0 0 6px", fontSize: 20 }}>Entra com teu WhatsApp</h2>
      <p style={{ color: C.textDim, fontSize: 14, margin: "0 0 16px" }}>
        O mesmo número que você passou na consultoria.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <select
          value={pais.iso}
          onChange={(e) => setPais(paisPorIso(e.target.value))}
          aria-label="País"
          style={{ ...inputStyle, width: 96 }}
        >
          {PAISES.map((p) => (
            <option key={p.iso} value={p.iso}>+{p.ddi}</option>
          ))}
        </select>
        <input
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onEntrar()}
          inputMode="numeric"
          placeholder="31990000107"
          aria-label="Número de WhatsApp"
          style={{ ...inputStyle, flex: 1 }}
        />
      </div>
      {erro && <p style={{ color: C.red, fontSize: 13, marginTop: 10 }}>{erro}</p>}
      <button onClick={onEntrar} disabled={buscando} style={botaoStyle}>
        {buscando ? "Verificando…" : "Continuar"}
      </button>
    </div>
  );
}

// --- calculadora ------------------------------------------------------------

function Calculadora({ primeiroNome }: { primeiroNome: string }) {
  const [termo, setTermo] = useState("");
  const [alimento, setAlimento] = useState<Alimento | null>(null);
  const [quantidade, setQuantidade] = useState("100");
  const [medida, setMedida] = useState<MedidaCaseira | null>(null);

  const achados = useMemo(() => (alimento ? [] : buscar(termo)), [termo, alimento]);
  const medidas = alimento ? medidasDe(alimento) : [];

  // Medida caseira vira grama aqui: o cálculo só trabalha em grama.
  const gramas = medida
    ? (Number(quantidade.replace(",", ".")) || 0) * medida.gramas
    : Number(quantidade.replace(",", ".")) || 0;

  const resultado = alimento && gramas > 0 ? trocar(alimento, gramas) : null;

  function escolher(a: Alimento) {
    setAlimento(a);
    setTermo("");
    setMedida(null);
    setQuantidade("100");
  }

  function limpar() {
    setAlimento(null);
    setMedida(null);
    setTermo("");
  }

  return (
    <>
      <p style={{ color: C.textDim, fontSize: 14, margin: "0 0 16px" }}>
        Oi, {primeiroNome}. Escolhe o alimento da tua dieta e eu te digo quanto comer do substituto.
      </p>

      <div style={cardStyle}>
        {!alimento ? (
          <>
            <label style={labelStyle}>Qual alimento você quer trocar?</label>
            <input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="arroz, frango, banana…"
              aria-label="Buscar alimento"
              style={{ ...inputStyle, width: "100%" }}
              autoFocus
            />
            {achados.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", maxHeight: 280, overflowY: "auto" }}>
                {achados.map((a) => (
                  <li key={a.id}>
                    <button onClick={() => escolher(a)} style={itemStyle}>
                      <span>{a.nome}</span>
                      {a.preparo && <Etiqueta texto={a.preparo} />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {termo.trim().length >= 2 && achados.length === 0 && (
              <p style={{ color: C.textDim, fontSize: 13, marginTop: 12 }}>
                Não achei esse alimento na tabela. Tenta outro nome — ex.: "arroz" em vez de "arroz branco".
              </p>
            )}
          </>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{alimento.nome}</div>
                <div style={{ color: C.textDim, fontSize: 13, marginTop: 4 }}>{alimento.categoria}</div>
              </div>
              <button onClick={limpar} style={linkStyle}>trocar</button>
            </div>

            {alimento.preparo && (
              <div style={{ marginTop: 12 }}>
                <Etiqueta texto={alimento.preparo} />
                <span style={{ color: C.textDim, fontSize: 12, marginLeft: 8 }}>
                  confere se é assim que você come — cru e cozido pesam diferente
                </span>
              </div>
            )}

            <label style={{ ...labelStyle, marginTop: 20 }}>Quanto você ia comer?</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                inputMode="decimal"
                aria-label="Quantidade"
                style={{ ...inputStyle, flex: 1 }}
              />
              <select
                value={medida ? medida.nome : "g"}
                onChange={(e) =>
                  setMedida(e.target.value === "g" ? null : medidas.find((m) => m.nome === e.target.value) ?? null)
                }
                aria-label="Unidade"
                style={{ ...inputStyle, flex: 1 }}
              >
                <option value="g">gramas</option>
                {medidas.map((m) => (
                  <option key={m.nome} value={m.nome}>{m.nome}</option>
                ))}
              </select>
            </div>

            {medida ? (
              <p style={{ color: C.yellow, fontSize: 12, marginTop: 8 }}>
                Dá mais ou menos {Math.round(gramas)} g. Medida caseira varia de casa pra casa —
                se puder pesar, pesa.
              </p>
            ) : (
              medidas.length > 0 && (
                <p style={{ color: C.textDim, fontSize: 12, marginTop: 8 }}>
                  Peso é o mais exato. Se não tiver balança, troca pra medida caseira acima.
                </p>
              )
            )}
          </>
        )}
      </div>

      {resultado && (
        <div style={{ marginTop: 16 }}>
          {resultado.ok ? (
            <>
              <p style={{ color: C.textDim, fontSize: 13, margin: "0 0 10px" }}>
                No lugar de <strong style={{ color: C.text }}>{Math.round(gramas)} g</strong> de{" "}
                {alimento!.nome.split(",")[0].toLowerCase()}, você pode comer:
              </p>
              {resultado.opcoes.map((o) => (
                <div key={o.alimento.id} style={{ ...cardStyle, marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <span style={{ fontSize: 15 }}>{o.alimento.nome}</span>
                    <strong style={{ color: C.brand, fontSize: 20, whiteSpace: "nowrap" }}>{o.gramas} g</strong>
                  </div>
                  <div style={{ color: C.textDim, fontSize: 12, marginTop: 6 }}>
                    mesma quantidade de {NOME_MACRO[resultado.macro]}
                    {o.deltaKcal !== 0 && ` · ${o.deltaKcal > 0 ? "+" : ""}${o.deltaKcal} kcal no dia`}
                  </div>
                </div>
              ))}
              <p style={{ color: C.textDim, fontSize: 11, marginTop: 14, lineHeight: 1.5 }}>
                Troca equivalente em {NOME_MACRO[resultado.macro]}, dentro do mesmo grupo de alimento.
                Fonte: {FONTE}.
              </p>
            </>
          ) : (
            <p style={{ color: C.textDim, fontSize: 14 }}>{resultado.motivo}</p>
          )}
        </div>
      )}
    </>
  );
}

function Etiqueta({ texto }: { texto: string }) {
  return (
    <span
      style={{
        background: "#1f1f1f", color: C.brand, fontSize: 11, textTransform: "uppercase",
        letterSpacing: 0.5, padding: "3px 8px", borderRadius: 4, whiteSpace: "nowrap",
      }}
    >
      {texto}
    </span>
  );
}

// --- estilos ----------------------------------------------------------------

const cardStyle: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 20,
};

const inputStyle: React.CSSProperties = {
  background: "#0f0f0f",
  border: `1px solid ${C.border}`,
  color: C.text,
  borderRadius: 8,
  padding: "12px 14px",
  fontSize: 15,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 14,
  marginBottom: 8,
  color: C.text,
};

const botaoStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 16,
  background: C.brand,
  color: "#000",
  border: "none",
  borderRadius: 8,
  padding: "14px",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
};

const itemStyle: React.CSSProperties = {
  width: "100%",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  background: "transparent",
  border: "none",
  borderBottom: `1px solid ${C.border}`,
  color: C.text,
  textAlign: "left",
  padding: "12px 2px",
  fontSize: 14,
  cursor: "pointer",
};

const linkStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: C.brand,
  fontSize: 13,
  cursor: "pointer",
  padding: 0,
  textDecoration: "underline",
  whiteSpace: "nowrap",
};
