import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  C,
  Slider,
  Radio,
  Checks,
  Textbox,
  Q,
  HeaderBrand,
} from "@/components/feedback/FeedbackUI";
import {
  FeedbackSemanalResponse,
  FeedbackProdutoConfig,
  FEEDBACK_PRODUTOS,
  produtoDoPrograma,
  TREINO_FREQUENCIA,
  DIETA_REFEICOES_FORA,
  DIETA_BELISCANDO,
  MAIOR_GARGALO,
  PERCEBE_MUDANCA,
  ADESAO_LEMBRETE,
  PAISES,
  PAIS_PADRAO,
  paisPorIso,
  alternarValor,
  listaValores,
  limparNumeroLocal,
  telefoneE164,
  REPS_RESERVA_HINT,
  TREINO_REPS_RESERVA,
  cardioReferencia,
  cardioPercepcao,
  CARDIO_MINUTOS,
  CARDIO_ESCALA,
  montarResumoWhatsApp,
  whatsappLink,
  WHATSAPP_CONSULTORIA,
  FEEDBACK_DRAFT_KEY,
} from "@/types/feedbackSemanal";

// Ordem dos steps: abre pelo treino (a aluna acabou de treinar, lembra melhor),
// fecha na identificação — quando ela já investiu tempo respondendo.
const STEPS = [
  "Treino de força",
  "Cardio",
  "Dieta",
  "Gargalo e saúde",
  "Corpo e consultoria",
  "Identificação",
] as const;

interface FormProps {
  produto?: FeedbackProdutoConfig;
}

export default function FeedbackSemanalForm({ produto: produtoProp }: FormProps = {}) {
  // O produto sai do plano da aluna, não do link. A rota só decide o que ela vê
  // ANTES de entrar com o WhatsApp; assim que o cadastro responde, o formulário
  // vira o do plano dela. Um link errado compartilhado no grupo deixa de ser
  // problema — e o feedback nunca cai no produto errado.
  const produtoDaRota = produtoProp ?? FEEDBACK_PRODUTOS.mgmd;
  const [produtoDoPlano, setProdutoDoPlano] = useState<FeedbackProdutoConfig | null>(null);
  const produto = produtoDoPlano ?? produtoDaRota;
  // O rascunho fica preso à rota, não ao produto resolvido: se acompanhasse a
  // troca, entrar com o WhatsApp recarregaria o rascunho do outro produto por
  // cima do nome que acabou de ser preenchido.
  const draftKey = `${FEEDBACK_DRAFT_KEY}-${produtoDaRota.slug}`;

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [data, setData] = useState<Partial<FeedbackSemanalResponse>>({});
  const [errors, setErrors] = useState<string[]>([]);

  // Identificação pelo WhatsApp: a aluna entra com o número cadastrado na
  // gestão de alunas. Sem isso o feedback não é enviado — é assim que a
  // resposta cai dentro da ficha certa.
  const [aluna, setAluna] = useState<{ id: string; nome: string } | null>(null);
  const [telefoneLogin, setTelefoneLogin] = useState("");
  const [paisIso, setPaisIso] = useState(PAIS_PADRAO.iso);
  const pais = paisPorIso(paisIso);
  const [buscando, setBuscando] = useState(false);
  const [erroLogin, setErroLogin] = useState("");

  async function identificar() {
    const local = limparNumeroLocal(telefoneLogin, pais);
    const minimo = pais.iso === "BR" ? 10 : 8;
    if (local.length < minimo) {
      setErroLogin(
        pais.iso === "BR"
          ? "Coloca DDD + número, só os dígitos. Ex.: 31990000107"
          : `Coloca o número completo, só os dígitos. Ex.: ${pais.exemplo}`
      );
      return;
    }
    const digitos = telefoneE164(local, pais);
    setBuscando(true);
    setErroLogin("");
    try {
      const { data: res, error } = await supabase.rpc(
        "identificar_aluna_por_whatsapp" as any,
        { p_telefone: digitos } as any
      );
      if (error) throw error;
      const encontrada = Array.isArray(res) ? res[0] : res;
      if (!encontrada) {
        setErroLogin(
          "Não achei esse número no cadastro. Confere se digitou certo ou fala com o time da consultoria."
        );
        return;
      }
      // O plano da aluna manda no produto. Programa que não bate com nenhum
      // (ou vazio) deixa valer o da rota, em vez de jogá-la num produto errado.
      const doPlano = produtoDoPrograma(encontrada.programa);
      if (doPlano) setProdutoDoPlano(doPlano);

      setAluna({ id: encontrada.id, nome: encontrada.nome_completo });
      setData((prev) => ({
        ...prev,
        nome: encontrada.nome_completo,
        telefone: digitos,
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "erro desconhecido";
      setErroLogin(`Não consegui verificar agora (${msg}). Tenta de novo.`);
    } finally {
      setBuscando(false);
    }
  }


  // Restaura rascunho (por produto, pra não misturar MGMD com Elite).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") setData(parsed);
      }
    } catch {
      // rascunho corrompido ou storage bloqueado: começa em branco
    }
  }, [draftKey]);

  useEffect(() => {
    if (submitted) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(data));
      } catch {
        // storage cheio ou bloqueado: seguir sem rascunho é aceitável
      }
    }, 300);
    return () => clearTimeout(t);
  }, [data, submitted, draftKey]);

  const update = <K extends keyof FeedbackSemanalResponse>(
    k: K,
    v: FeedbackSemanalResponse[K]
  ) => {
    setData((prev) => ({ ...prev, [k]: v }));
    setErrors([]);
  };

  const progressPct = useMemo(
    () => Math.min(100, ((step + 1) / STEPS.length) * 100),
    [step]
  );

  // Validação por step. Índices casados com a ordem do array STEPS.
  function validateStep(): string[] {
    const errs: string[] = [];
    if (step === 0 && data.treino_execucao === undefined) {
      errs.push("Marca a nota de técnica, amplitude e cadência.");
    }
    if (step === 2 && data.dieta_adesao === undefined) {
      errs.push("Marca a nota de adesão da dieta.");
    }
    if (step === 3 && !data.maior_gargalo) {
      errs.push("Escolhe onde tá teu maior gargalo.");
    }
    if (step === 5) {
      if (!data.nome || data.nome.trim().length < 2) errs.push("Coloca teu nome completo.");
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
      const payload: Record<string, unknown> = {
        ...data,
        nome: data.nome?.trim(),
        telefone: data.telefone?.trim() || null,
        produto: produto.slug,
        aluna_id: aluna?.id ?? null,
      };
      const { error } = await supabase
        .from("feedback_semanal_responses" as any)
        .insert(payload);
      if (error) throw error;
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // storage bloqueado: rascunho expira sozinho, não trava o envio
      }
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "erro desconhecido";
      setErrors([
        `Não consegui enviar agora (${msg}). Tenta de novo em alguns segundos.`,
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  // Tela de sucesso: resposta já está salva no banco. O WhatsApp é o segundo
  // passo, disparado por clique da aluna (abrir sozinho seria bloqueado como
  // popup no mobile).
  if (submitted) {
    const resumo = montarResumoWhatsApp(data, produto);
    const link = whatsappLink(WHATSAPP_CONSULTORIA, resumo);
    return (
      <div style={{ background: C.bg, color: C.text, minHeight: "100vh" }}>
        <HeaderBrand nome={produto.nome} tagline={produto.tagline} />
        <div className="max-w-md mx-auto px-5 py-8">
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
              Feedback recebido!
            </h2>
            <p style={{ color: C.textDim, lineHeight: 1.5, marginBottom: "24px" }}>
              Agora manda esse resumo no WhatsApp da consultoria. É por lá que o ajuste
              da tua próxima semana vai sair.
            </p>

            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                background: C.whatsapp,
                color: "#fff",
                borderRadius: "10px",
                height: "54px",
                fontSize: "16px",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.174.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 0 1 6.988 2.896 9.82 9.82 0 0 1 2.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.82 11.82 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.88 11.88 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.82 11.82 0 0 0-3.48-8.413" />
              </svg>
              Enviar no WhatsApp
            </a>

            <p className="text-xs mt-4" style={{ color: C.textDim, lineHeight: 1.5 }}>
              Se o WhatsApp não abrir, tá tudo bem, tua resposta já foi registrada aqui.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Porta de entrada: só passa quem confirmar o WhatsApp cadastrado.
  if (!aluna) {
    return (
      <div style={{ background: C.bg, color: C.text, minHeight: "100vh" }}>
        <HeaderBrand nome={produto.nome} tagline={produto.tagline} />
        <div className="max-w-md mx-auto px-5 py-8">
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "10px",
              padding: "28px 22px",
            }}
            className="space-y-5"
          >
            <div>
              <h1 className="font-semibold" style={{ fontSize: "20px" }}>
                Entra com teu WhatsApp
              </h1>
              <p style={{ color: C.textDim, fontSize: "14px", lineHeight: 1.5, marginTop: "6px" }}>
                Usa o mesmo número que você passou na consultoria. É assim que teu
                feedback entra na tua ficha.
              </p>
            </div>

            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  background: "rgba(255,255,255,0.04)",
                  border: `1px solid ${C.border}`,
                  borderRadius: "10px",
                  overflow: "hidden",
                }}
              >
                {/* Fechado mostra só bandeira + DDI; o nome do país aparece na
                    lista aberta. O <select> fica por cima, invisível, pra
                    manter o seletor nativo do celular. */}
                <div
                  style={{
                    position: "relative",
                    height: "52px",
                    flexShrink: 0,
                    borderRight: `1px solid ${C.border}`,
                  }}
                >
                  <div
                    aria-hidden
                    style={{
                      height: "52px",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "0 10px 0 14px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ fontSize: "20px", lineHeight: 1 }}>{pais.bandeira}</span>
                    <span style={{ color: C.textDim, fontSize: "16px" }}>+{pais.ddi}</span>
                    <span style={{ color: C.textDim, fontSize: "10px", lineHeight: 1 }}>▼</span>
                  </div>
                  <select
                    value={paisIso}
                    onChange={(e) => {
                      const novo = paisPorIso(e.target.value);
                      setPaisIso(novo.iso);
                      // Reaproveita o que ela já digitou com a trava do país novo.
                      setTelefoneLogin((atual) => limparNumeroLocal(atual, novo));
                    }}
                    aria-label="País do WhatsApp"
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      opacity: 0,
                      cursor: "pointer",
                      appearance: "none",
                      border: "none",
                      background: "transparent",
                      color: C.text,
                      fontSize: "16px",
                    }}
                  >
                    {PAISES.map((op) => (
                      <option
                        key={op.iso}
                        value={op.iso}
                        style={{ background: C.card, color: C.text }}
                      >
                        {op.bandeira} {op.nome} · +{op.ddi}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  value={telefoneLogin}
                  onChange={(e) => setTelefoneLogin(limparNumeroLocal(e.target.value, pais))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") identificar();
                  }}
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={pais.maxLocal + pais.ddi.length}
                  placeholder={pais.exemplo}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: "52px",
                    background: "transparent",
                    border: "none",
                    color: C.text,
                    padding: "0 14px",
                    fontSize: "17px",
                    outline: "none",
                  }}
                />
              </div>
              <p style={{ color: C.textDim, fontSize: "13px", marginTop: "8px", lineHeight: 1.5 }}>
                {pais.iso === "BR"
                  ? `DDD + número, tudo junto. Exemplo: ${pais.exemplo}. Não usa espaço, traço, parênteses nem o 55 na frente.`
                  : `Número completo, tudo junto. Exemplo: ${pais.exemplo}. Não usa espaço, traço, parênteses nem o +${pais.ddi} na frente.`}
                <br />
                Mora fora do Brasil? Troca o país na caixinha ao lado.
              </p>
            </div>

            {erroLogin && (
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
                {erroLogin}
              </div>
            )}

            <button
              type="button"
              onClick={identificar}
              disabled={buscando}
              style={{
                width: "100%",
                background: C.brand,
                color: "#000",
                border: "none",
                borderRadius: "10px",
                height: "50px",
                fontSize: "15px",
                fontWeight: 700,
                cursor: buscando ? "not-allowed" : "pointer",
                opacity: buscando ? 0.7 : 1,
              }}
            >
              {buscando ? "Verificando..." : "Continuar"}
            </button>

            {/* Saída de emergência: aluna que não consegue entrar fala com o
                suporte no WhatsApp em vez de desistir do feedback. */}
            <div style={{ textAlign: "center" }}>
              <div style={{ color: C.textDim, fontSize: "13px", marginBottom: "8px" }}>
                Não conseguiu entrar?
              </div>
              <a
                href={whatsappLink(
                  WHATSAPP_CONSULTORIA,
                  `Oi! Tentei entrar no feedback ${produto.nome} e não consegui.${
                    telefoneLogin ? ` Meu WhatsApp é +${pais.ddi}${telefoneLogin}.` : ""
                  }`
                )}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  width: "100%",
                  height: "46px",
                  background: "transparent",
                  border: `1px solid ${C.whatsapp}`,
                  borderRadius: "10px",
                  color: C.whatsapp,
                  fontSize: "14px",
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                Chamar o suporte no WhatsApp
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: C.bg }}>
        <HeaderBrand nome={produto.nome} tagline={produto.tagline} />
        <div className="max-w-md mx-auto px-5 pb-3">
          <div
            className="flex items-center justify-between text-xs mb-2"
            style={{ color: C.textDim }}
          >
            <span>
              Etapa {step + 1} de {STEPS.length}
            </span>
            <span>{STEPS[step]}</span>
          </div>
          <div
            style={{ height: "4px", background: C.border, borderRadius: "2px", overflow: "hidden" }}
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
        {step === 0 && (
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
              Bem-vinda, {aluna.nome.split(" ")[0]}! 👊
            </div>
            <div style={{ color: C.textDim, fontSize: "13px", marginTop: "2px" }}>
              Teu feedback vai direto pra tua ficha na consultoria.
            </div>
            {produtoDoPlano && (
              <div style={{ color: C.brand, fontSize: "13px", marginTop: "6px", fontWeight: 600 }}>
                Plano: {produtoDoPlano.nome}
              </div>
            )}
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
            {STEPS[step]}
          </h1>

          {/* 0 — Treino: qualidade de execução */}
          {step === 0 && (
            <>
              <Q
                label="Como você percebe sua evolução de técnica, amplitude e cadência?"
                required
              >
                <Slider
                  value={data.treino_execucao}
                  onChange={(v) => update("treino_execucao", v)}
                  leftLabel="Sem evolução"
                  rightLabel="Evoluindo muito"
                />
              </Q>
              <Q
                label="Séries válidas: quantas repetições você ainda conseguiria fazer depois de terminar a série?"
                hint={REPS_RESERVA_HINT}
              >
                <Radio
                  value={data.treino_reps_reserva}
                  onChange={(v) => update("treino_reps_reserva", v)}
                  options={TREINO_REPS_RESERVA}
                />
              </Q>
              <Q label="Como está sua frequência de treino de força?">
                <Radio
                  value={data.treino_frequencia_semanal}
                  onChange={(v) => update("treino_frequencia_semanal", v)}
                  options={TREINO_FREQUENCIA}
                />
              </Q>
            </>
          )}

          {/* 1 — Cardio */}
          {step === 1 && (
            <>
              <Q label="Quantos minutos de cardio você está fazendo por semana?">
                <Radio
                  value={data.cardio_minutos_semanais}
                  onChange={(v) => update("cardio_minutos_semanais", v)}
                  options={CARDIO_MINUTOS}
                />
              </Q>
              <Q label="Qual está a intensidade do seu cardio?">
                <Slider
                  value={data.cardio_intensidade}
                  onChange={(v) => update("cardio_intensidade", v)}
                  leftLabel="Bem leve"
                  rightLabel="Máxima"
                  footnote={
                    cardioPercepcao(data.cardio_intensidade)
                      ? `${cardioPercepcao(data.cardio_intensidade)}${
                          cardioReferencia(data.cardio_intensidade)
                            ? ` · ${cardioReferencia(data.cardio_intensidade)}`
                            : ""
                        }`
                      : cardioReferencia(data.cardio_intensidade)
                  }
                />

                {/* Referência de percepção de esforço: sem ela a nota vira chute. */}
                <div
                  style={{
                    marginTop: "14px",
                    border: `1px solid ${C.border}`,
                    borderRadius: "10px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      padding: "10px 12px",
                      borderBottom: `1px solid ${C.border}`,
                      color: C.textDim,
                      fontSize: "12px",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                    }}
                  >
                    Como saber tua nota
                  </div>
                  {CARDIO_ESCALA.map((linha) => (
                    <div
                      key={linha.nota}
                      style={{
                        display: "flex",
                        gap: "10px",
                        alignItems: "flex-start",
                        padding: "8px 12px",
                        borderTop: `1px solid ${C.border}`,
                        background:
                          data.cardio_intensidade === linha.nota
                            ? "rgba(255,192,0,0.08)"
                            : "transparent",
                      }}
                    >
                      <span
                        style={{
                          color: C.brand,
                          fontWeight: 700,
                          fontSize: "14px",
                          minWidth: "22px",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {linha.nota}
                      </span>
                      <span style={{ fontSize: "13px", lineHeight: 1.45, color: C.text }}>
                        {linha.percepcao}
                        <span style={{ color: C.textDim }}>, {linha.fc}</span>
                      </span>
                    </div>
                  ))}
                  <div
                    style={{
                      padding: "8px 12px",
                      borderTop: `1px solid ${C.border}`,
                      fontSize: "13px",
                      color: C.textDim,
                      lineHeight: 1.45,
                    }}
                  >
                    2 ou menos, caminhada leve, FC abaixo de 110 bpm
                  </div>
                </div>
              </Q>
            </>
          )}

          {/* 2 — Dieta */}
          {step === 2 && (
            <>
              <Q
                label="Como está sua adesão? Está seguindo segunda a segunda?"
                hint={ADESAO_LEMBRETE}
                required
              >
                <Slider
                  value={data.dieta_adesao}
                  onChange={(v) => update("dieta_adesao", v)}
                  leftLabel="Não segui"
                  rightLabel="Segunda a segunda"
                />
              </Q>
              <Q label="Quantas refeições livres você fez na semana?">
                <Radio
                  value={data.dieta_refeicoes_fora}
                  onChange={(v) => update("dieta_refeicoes_fora", v)}
                  options={DIETA_REFEICOES_FORA}
                />
              </Q>
              <Q label="Está beliscando fora das refeições?">
                <Radio
                  value={data.dieta_beliscando}
                  onChange={(v) => update("dieta_beliscando", v)}
                  options={DIETA_BELISCANDO}
                />
              </Q>
            </>
          )}

          {/* 3 — Corpo e gargalo */}
          {step === 3 && (
            <>
              <Q
                label="Onde você percebe que está seu maior gargalo?"
                hint="Pode marcar mais de uma, marca tudo que estiver travando."
                required
              >
                <Checks
                  selecionados={listaValores(data.maior_gargalo)}
                  onToggle={(v) => update("maior_gargalo", alternarValor(data.maior_gargalo, v))}
                  options={MAIOR_GARGALO}
                />
              </Q>
            </>
          )}

          {/* 4 — Corpo e consultoria */}
          {step === 4 && (
            <>
              <Q label="Está percebendo mudança no seu corpo?">
                <Radio
                  value={data.percebe_mudanca}
                  onChange={(v) => update("percebe_mudanca", v)}
                  options={PERCEBE_MUDANCA}
                />
              </Q>
              <Q label="O que você está percebendo de mudança? Conta aqui pra gente.">
                <Textbox
                  value={data.mudanca_descricao}
                  onChange={(v) => update("mudanca_descricao", v)}
                  placeholder="Roupa, medidas, espelho, disposição, força..."
                />
              </Q>
              <Q
                label="O quanto você gosta e indicaria o nosso programa? 🙂"
                hint="Estamos tentando melhorar a cada dia por você!"
              >
                <Slider
                  value={data.programa_indicaria}
                  onChange={(v) => update("programa_indicaria", v)}
                  leftLabel="Não indicaria"
                  rightLabel="Indicaria de olhos fechados"
                />
              </Q>
              <Q
                label="O que você está achando do programa? Fala os pontos positivos e os negativos."
                hint="O que está funcionando, o que não está, o que você sente falta aqui dentro e o que podemos melhorar. Pode ser sincera, é isso que faz a gente ajustar."
              >
                <Textbox
                  value={data.consultoria_feedback}
                  onChange={(v) => update("consultoria_feedback", v)}
                  placeholder="Positivo e negativo, sem filtro"
                  rows={6}
                />
              </Q>
            </>
          )}

          {/* 5 — Identificação (já veio do login por WhatsApp) */}
          {step === 5 && (
            <>
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${C.border}`,
                  borderRadius: "10px",
                  padding: "14px 16px",
                }}
              >
                <div style={{ color: C.textDim, fontSize: "12px" }}>Enviando como</div>
                <div style={{ fontSize: "16px", fontWeight: 600 }}>{data.nome}</div>
                <div style={{ color: C.textDim, fontSize: "13px" }}>{data.telefone}</div>
              </div>
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

      {/* Botões fixos no rodapé — acessíveis com o polegar no mobile */}
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
              {submitting ? "Enviando..." : "Enviar feedback"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
