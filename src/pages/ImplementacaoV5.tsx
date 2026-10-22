import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Check, X, Calendar, Clock, Target, Users, TrendingUp, Zap } from "lucide-react";
import { useEffect } from "react";
import { captureUtmsFromUrl } from "@/lib/utmCapture";
import brenoPhoto from "@/assets/breno-xavier.jpg";
import dashboardPrint from "@/assets/dashboard-print.png";
import dashboardTotals from "@/assets/dashboard-totals.png";

// Paleta inspirada na referência: preto sólido + laranja vibrante como accent
const ORANGE = "#FF9419";
const ORANGE_LIGHT = "#FFB155";
const ORANGE_DARK = "#D67200";
const BG = "#0A0A0A";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

function PillBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[10px] md:text-[11px] font-bold uppercase"
      style={{
        color: ORANGE,
        borderColor: `${ORANGE}55`,
        background: `${ORANGE}10`,
        letterSpacing: "0.18em",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {children}
    </span>
  );
}

function CTAButton({
  children,
  onClick,
  pulse = false,
  fullWidth = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  pulse?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`relative inline-flex items-center justify-center gap-2 rounded-full text-base md:text-lg font-extrabold ${
        fullWidth ? "w-full" : ""
      }`}
      style={{
        background: `linear-gradient(135deg, ${ORANGE_LIGHT} 0%, ${ORANGE} 50%, ${ORANGE_DARK} 100%)`,
        color: "#fff",
        padding: "20px 36px",
        minHeight: 58,
        boxShadow: `0 8px 32px ${ORANGE}55, 0 0 60px ${ORANGE}33`,
        fontFamily: "Manrope, sans-serif",
        letterSpacing: "0.01em",
      }}
    >
      {pulse && (
        <span
          className="absolute inset-0 rounded-full animate-pulse"
          style={{ boxShadow: `0 0 80px ${ORANGE}88`, pointerEvents: "none" }}
        />
      )}
      <span className="relative">{children}</span>
    </motion.button>
  );
}

function Microcopy() {
  return (
    <div
      className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs"
      style={{ color: "#888", fontFamily: "Inter, sans-serif" }}
    >
      <span className="inline-flex items-center gap-1.5">
        <Clock size={11} style={{ color: ORANGE }} />
        2 minutos
      </span>
      <span style={{ color: "#444" }}>·</span>
      <span className="inline-flex items-center gap-1.5">
        <Check size={11} style={{ color: ORANGE }} />
        100% gratuito
      </span>
      <span style={{ color: "#444" }}>·</span>
      <span>Sem compromisso</span>
    </div>
  );
}

export default function ImplementacaoV5({ onStart }: { onStart?: () => void } = {}) {
  const navigate = useNavigate();
  const goQuiz = () => {
    try { (window as any).fbq?.("track", "ViewContent", { content_name: "hero_cta" }); } catch {}
    return onStart ? onStart() : navigate("/agendar");
  };

  useEffect(() => {
    captureUtmsFromUrl();
  }, []);

  useEffect(() => {
    document.title = "Diagnóstico do seu negócio digital — Breno Xavier";
    const meta = document.querySelector('meta[name="description"]');
    if (meta)
      meta.setAttribute(
        "content",
        "Diagnóstico em 2 minutos pra profissional da saúde que já vende no digital. Descubra qual dos 4 buracos tá custando mais dinheiro no seu negócio.",
      );
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800;900&family=Inter:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  const heroFont = { fontFamily: "Manrope, sans-serif" };
  const bodyFont = { fontFamily: "Inter, sans-serif" };

  return (
    <div
      className="min-h-screen w-full text-white overflow-x-hidden"
      style={{ backgroundColor: BG, ...bodyFont, scrollBehavior: "smooth" as const }}
    >
      {/* ════════════════════════════════════════════════════════════
          SEÇÃO 1 — HERO SPLIT (texto esquerda + foto direita)
          ════════════════════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex items-center px-5 md:px-12 lg:px-20 py-20 overflow-hidden">
        {/* Gradientes radiais nas extremidades */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              radial-gradient(ellipse 60% 50% at 0% 50%, ${ORANGE}1a 0%, transparent 60%),
              radial-gradient(ellipse 50% 40% at 100% 30%, ${ORANGE}22 0%, transparent 55%)
            `,
          }}
        />

        <div className="relative z-10 mx-auto max-w-7xl w-full grid lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-16 items-center">
          {/* Coluna esquerda — texto */}
          <div className="text-left">
            <motion.div initial="hidden" animate="show" variants={fadeUp} custom={0}>
              <PillBadge>Diagnóstico Liberado</PillBadge>
            </motion.div>

            <motion.h1
              initial="hidden"
              animate="show"
              variants={fadeUp}
              custom={1}
              className="mt-7 font-black"
              style={{
                ...heroFont,
                fontSize: "clamp(34px, 5vw, 62px)",
                lineHeight: 1.05,
                letterSpacing: "-0.025em",
              }}
            >
              Não é <span style={{ color: ORANGE }}>palestra motivacional</span> de mentor. É implementação.
            </motion.h1>

            <motion.p
              initial="hidden"
              animate="show"
              variants={fadeUp}
              custom={2}
              className="mt-7 text-base md:text-lg"
              style={{ color: "#B8B8B8", lineHeight: 1.65, maxWidth: 580 }}
            >
              Eu <strong style={{ color: "#fff" }}>replico no seu projeto</strong> os mesmos
              múltiplos funis + processo comercial de autoconversão que eu rodo no fitness —
              o mesmo motor que me faz fechar 2 a 4 programas por dia. Se quer entrar na
              seleção pra implementar isso, segue o fluxo até o botão.
            </motion.p>

            {/* Bloco 3 pilares */}
            <motion.div
              initial="hidden"
              animate="show"
              variants={fadeUp}
              custom={3}
              className="mt-8 rounded-2xl border p-5 md:p-6"
              style={{ borderColor: `${ORANGE}33`, background: `${ORANGE}08`, maxWidth: 580 }}
            >
              <p
                className="text-[10px] md:text-[11px] font-bold uppercase mb-4"
                style={{ color: ORANGE, letterSpacing: "0.18em" }}
              >
                Os 4 pilares que eu instalo
              </p>
              <ul className="space-y-3">
                {[
                  { t: "Múltiplos funis rodando ao mesmo tempo" },
                  { t: "Processo comercial de autoconversão" },
                  { t: "Sistema que qualifica e afasta o curioso" },
                  { t: "NDA — Narrativa de Diferenciação e Autoridade", s: "você não pode parecer mais um profissional qualquer" },
                ].map((p) => (
                  <li key={p.t} className="flex items-start gap-3">
                    <div
                      className="shrink-0 mt-1 inline-flex items-center justify-center rounded-full"
                      style={{ width: 18, height: 18, background: ORANGE, boxShadow: `0 0 10px ${ORANGE}88` }}
                    >
                      <Check size={11} color="#000" strokeWidth={3.5} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm md:text-base" style={{ color: "#E8E8E8", lineHeight: 1.45 }}>
                        {p.t}
                      </p>
                      {p.s && (
                        <p className="mt-1 text-xs md:text-sm italic" style={{ color: "#999", lineHeight: 1.4 }}>
                          {p.s}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs md:text-sm" style={{ color: "#888", lineHeight: 1.5 }}>
                Batendo nessas 4 teclas, o mês vira previsível. Sem elas, você opera no achismo.
              </p>
            </motion.div>

            {/* Promessa numérica */}
            <motion.div
              initial="hidden"
              animate="show"
              variants={fadeUp}
              custom={4}
              className="mt-6"
              style={{ maxWidth: 580 }}
            >
              <p
                className="text-[10px] md:text-[11px] font-bold uppercase mb-2"
                style={{ color: "#888", letterSpacing: "0.18em" }}
              >
                O que eu faço hoje operando esses 3
              </p>
              <p className="text-lg md:text-xl font-black" style={{ ...heroFont, color: "#fff", lineHeight: 1.35 }}>
                <span style={{ color: ORANGE }}>2 a 4 programas vendidos por dia</span>
                <span style={{ color: "#666", fontWeight: 400 }}> · </span>
                ticket médio <span style={{ color: ORANGE }}>R$ 1.500 a R$ 3.000</span>
              </p>
            </motion.div>

            <motion.div
              initial="hidden"
              animate="show"
              variants={fadeUp}
              custom={5}
              className="mt-10 flex flex-col items-start"
            >
              <CTAButton onClick={goQuiz} pulse>
                QUERO QUE IMPLEMENTE ESSES FUNIS E ESSE PROCESSO NO MEU PERFIL AGORA →
              </CTAButton>
            </motion.div>
          </div>

          {/* Coluna direita — foto do Breno em destaque */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            <div
              className="relative rounded-3xl overflow-hidden"
              style={{
                boxShadow: `0 30px 80px ${ORANGE}33, 0 0 0 1px ${ORANGE}22`,
                aspectRatio: "4/5",
              }}
            >
              <img
                src={brenoPhoto}
                alt="Breno Xavier"
                className="w-full h-full object-cover"
              />
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(180deg, transparent 60%, ${BG}cc 100%)`,
                }}
              />
              {/* Nameplate sobreposta */}
              <div className="absolute bottom-0 left-0 right-0 p-6 md:p-7">
                <p
                  className="text-xl md:text-2xl font-black"
                  style={{ ...heroFont, letterSpacing: "-0.01em" }}
                >
                  Breno Xavier
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          SEÇÃO 2 — PAINEL AO VIVO
          ════════════════════════════════════════════════════════════ */}
      <section className="relative px-5 md:px-12 lg:px-20 py-24 md:py-32">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-14">
            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeUp}
              custom={0}
            >
              <PillBadge>Prova Real</PillBadge>
            </motion.div>

            <motion.h2
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeUp}
              custom={1}
              className="mt-6 font-black"
              style={{ ...heroFont, fontSize: "clamp(28px, 4vw, 48px)", lineHeight: 1.1, letterSpacing: "-0.025em" }}
            >
              Isso não é screenshot de aluno.<br />
              <span style={{ color: ORANGE }}>É o meu painel agora.</span>
            </motion.h2>
          </div>

          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            variants={fadeUp}
            custom={0}
            className="rounded-2xl overflow-hidden border"
            style={{ borderColor: `${ORANGE}33`, boxShadow: `0 30px 100px ${ORANGE}22` }}
          >
            <img src={dashboardPrint} alt="Painel real Sistema BX" className="w-full h-auto block" />
          </motion.div>

          {/* 4 cards de números */}
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            variants={fadeUp}
            custom={1}
            className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4"
          >
            {[
              { num: "644", label: "conversas geradas" },
              { num: "35", label: "vendas fechadas" },
              { num: "R$ 20.443", label: "faturado" },
              { num: "7", label: "funis ativos" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl p-5 md:p-6 text-center border"
                style={{ borderColor: `${ORANGE}22`, background: "#0F0F0F" }}
              >
                <div
                  className="font-black"
                  style={{ ...heroFont, color: ORANGE, fontSize: "clamp(24px, 3vw, 38px)", letterSpacing: "-0.02em" }}
                >
                  {stat.num}
                </div>
                <div className="mt-2 text-[10px] md:text-xs uppercase tracking-wider" style={{ color: "#888" }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </motion.div>

          <motion.p
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            variants={fadeUp}
            custom={2}
            className="mt-8 text-center text-sm md:text-base italic max-w-xl mx-auto"
            style={{ color: "#888", lineHeight: 1.6 }}
          >
            Dados reais do meu próprio negócio rodando essa semana. Sem projeção, sem case antigo.
            É o painel que eu olho de manhã antes do café.
          </motion.p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          SEÇÃO 3 — OS 4 BURACOS
          ════════════════════════════════════════════════════════════ */}
      <section className="relative px-5 md:px-12 lg:px-20 py-24 md:py-32 border-t border-white/5">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeUp}
              custom={0}
            >
              <PillBadge>Diagnóstico</PillBadge>
            </motion.div>

            <motion.h2
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeUp}
              custom={1}
              className="mt-6 font-black max-w-4xl mx-auto"
              style={{ ...heroFont, fontSize: "clamp(28px, 4vw, 48px)", lineHeight: 1.1, letterSpacing: "-0.025em" }}
            >
              Quem fatura <span style={{ color: ORANGE }}>R$ 100 mil limpo</span> tem 4 coisas rodando.
              Você provavelmente tem problema em pelo menos duas.
            </motion.h2>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            {[
              {
                icon: Target,
                num: "01",
                title: "PROCESSO COMERCIAL",
                quote: "Você perde venda sem saber onde.",
                body: "Alguém chega animado, conversa, some. Você muda o preço, muda o formato, muda no sentimento. Quem fatura 100k mede cada etapa e identifica onde a venda morre.",
              },
              {
                icon: Users,
                num: "02",
                title: "CAPTAÇÃO",
                quote: "Todo mês começa do zero.",
                body: "Você acorda dia 1 sem saber quanto vai entrar até o dia 30. Quem tem estabilidade não reza pra viralizar — tem uma máquina que liga quando precisa de cliente.",
              },
              {
                icon: TrendingUp,
                num: "03",
                title: "NARRATIVA",
                quote: "Você compete por preço porque soa igual aos 80 do feed.",
                body: "Quando o cliente compara, a única diferença visível é o valor. Aí você abaixa. Quem fatura 100k não compete por preço porque o cliente não consegue comparar.",
              },
              {
                icon: Zap,
                num: "04",
                title: "AUTORIDADE",
                quote: "Você ainda precisa provar quem é toda semana.",
                body: "Você posta print de aluno, tira depoimento, mostra transformação. Funciona até o aluno sumir. Quem opera de verdade tem autoridade de sistema — mostra como funciona, não só que funcionou.",
              },
            ].map((b, i) => (
              <motion.div
                key={b.num}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.2 }}
                variants={fadeUp}
                custom={i}
                className="rounded-2xl p-7 md:p-8 border"
                style={{ borderColor: `${ORANGE}22`, background: "#0F0F0F" }}
              >
                <div className="flex items-start gap-4 mb-4">
                  <div
                    className="shrink-0 inline-flex items-center justify-center rounded-full"
                    style={{
                      width: 52,
                      height: 52,
                      background: `linear-gradient(135deg, ${ORANGE_LIGHT}, ${ORANGE_DARK})`,
                      boxShadow: `0 4px 16px ${ORANGE}44`,
                    }}
                  >
                    <b.icon size={22} color="#fff" strokeWidth={2.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-xs font-bold"
                      style={{ color: ORANGE, letterSpacing: "0.15em" }}
                    >
                      {b.num}
                    </p>
                    <h3
                      className="font-black mt-1"
                      style={{ ...heroFont, fontSize: "clamp(18px, 2vw, 22px)", letterSpacing: "0.01em" }}
                    >
                      {b.title}
                    </h3>
                  </div>
                </div>
                <p
                  className="italic mb-4 text-base md:text-lg"
                  style={{ color: ORANGE_LIGHT, fontFamily: "Manrope, sans-serif" }}
                >
                  "{b.quote}"
                </p>
                <p className="text-sm md:text-base" style={{ color: "#B0B0B0", lineHeight: 1.7 }}>
                  {b.body}
                </p>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={fadeUp}
            custom={0}
            className="mt-14 flex flex-col items-center"
          >
            <CTAButton onClick={goQuiz}>QUERO IMPLEMENTAR ISSO NO MEU PERFIL →</CTAButton>
            <Microcopy />
          </motion.div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          SEÇÃO 4 — COM vs SEM (comparação visual estilo "USANDO X NÃO USANDO")
          ════════════════════════════════════════════════════════════ */}
      <section className="relative px-5 md:px-12 lg:px-20 py-24 md:py-32 border-t border-white/5">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-14">
            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeUp}
              custom={0}
            >
              <PillBadge>Antes & Depois</PillBadge>
            </motion.div>

            <motion.h2
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeUp}
              custom={1}
              className="mt-6 font-black max-w-3xl mx-auto"
              style={{ ...heroFont, fontSize: "clamp(28px, 4vw, 46px)", lineHeight: 1.1, letterSpacing: "-0.025em" }}
            >
              O que mudou na minha operação{" "}
              <span style={{ color: ORANGE }}>em 30 dias</span>
            </motion.h2>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            {/* Card 1: SEM o sistema */}
            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.2 }}
              variants={fadeUp}
              custom={0}
              className="rounded-2xl p-7 md:p-8 border"
              style={{ borderColor: "#222", background: "#0A0A0A" }}
            >
              <div className="text-center py-3 mb-6 rounded-xl" style={{ background: "#1A1A1A" }}>
                <p
                  className="font-black"
                  style={{ ...heroFont, color: "#888", fontSize: "clamp(15px, 1.8vw, 19px)", letterSpacing: "0.1em" }}
                >
                  ANTES DO SISTEMA
                </p>
              </div>
              <ul className="space-y-4">
                {[
                  "Pago caro pra trazer gente que nem responde.",
                  "Não sei se quem chega qualificado vai fechar.",
                  "Conversa com gente indecisa toda semana.",
                  "Preciso postar sem parar pra não morrer.",
                  "Faturamento oscilando entre 8k e 32k.",
                  "Muito marca-e-some. Tempo perdido.",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div
                      className="shrink-0 mt-0.5 inline-flex items-center justify-center rounded-full"
                      style={{ width: 22, height: 22, background: "#2A1F1F", border: "1px solid #5A2929" }}
                    >
                      <X size={12} color="#FF6B6B" strokeWidth={3} />
                    </div>
                    <span className="text-sm md:text-base" style={{ color: "#999", lineHeight: 1.55 }}>
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* Card 2: COM o sistema */}
            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.2 }}
              variants={fadeUp}
              custom={1}
              className="rounded-2xl p-7 md:p-8 border-2 relative"
              style={{
                borderColor: ORANGE,
                background: `linear-gradient(180deg, ${ORANGE}08 0%, transparent 100%), #0F0F0F`,
                boxShadow: `0 0 60px ${ORANGE}22`,
              }}
            >
              <div
                className="text-center py-3 mb-6 rounded-xl"
                style={{ background: `linear-gradient(90deg, ${ORANGE_DARK}, ${ORANGE})` }}
              >
                <p
                  className="font-black"
                  style={{ ...heroFont, color: "#000", fontSize: "clamp(15px, 1.8vw, 19px)", letterSpacing: "0.1em" }}
                >
                  COM O SISTEMA BX
                </p>
              </div>
              <ul className="space-y-4">
                {[
                  "Quem chega vem com preço validado, sem objeção rasa.",
                  "Tenho previsibilidade — sei quantas conversas viram venda.",
                  "Só falo com quem tem perfil de compra.",
                  "Rodo conteúdo uma vez e ele trabalha por meses.",
                  "Faturamento estável + crescente medido em painel próprio.",
                  "Marca-e-some despencou. Time foca no que converte.",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div
                      className="shrink-0 mt-0.5 inline-flex items-center justify-center rounded-full"
                      style={{
                        width: 22,
                        height: 22,
                        background: ORANGE,
                        boxShadow: `0 0 12px ${ORANGE}88`,
                      }}
                    >
                      <Check size={12} color="#000" strokeWidth={3} />
                    </div>
                    <span className="text-sm md:text-base" style={{ color: "#E8E8E8", lineHeight: 1.55 }}>
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>

          {/* 3 cards de métricas ANTES → DEPOIS */}
          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { metric: "Marca e some", before: "31%", after: "8%" },
              { metric: "Conversas que fecham", before: "1/12", after: "1/5" },
              { metric: "Faturamento", before: "Oscilante", after: "Previsível" },
            ].map((card, i) => (
              <motion.div
                key={card.metric}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.2 }}
                variants={fadeUp}
                custom={i}
                className="rounded-xl p-5 border text-center"
                style={{ borderColor: `${ORANGE}33`, background: "#0F0F0F" }}
              >
                <p
                  className="text-[10px] uppercase tracking-widest font-bold mb-3"
                  style={{ color: ORANGE, letterSpacing: "0.15em" }}
                >
                  {card.metric}
                </p>
                <div className="flex items-center justify-center gap-3">
                  <span className="text-base md:text-lg line-through" style={{ color: "#666" }}>
                    {card.before}
                  </span>
                  <ArrowRight size={16} style={{ color: ORANGE }} />
                  <span
                    className="font-black"
                    style={{ ...heroFont, color: "#fff", fontSize: "clamp(18px, 2.2vw, 24px)" }}
                  >
                    {card.after}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          SEÇÃO 4.5 — MEUS ALUNOS VENDENDO AGORA
          ════════════════════════════════════════════════════════════ */}
      <section className="relative px-5 md:px-12 lg:px-20 py-24 md:py-32 border-t border-white/5 overflow-hidden">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-14">
            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeUp}
              custom={0}
            >
              <PillBadge>Prova de que instala</PillBadge>
            </motion.div>

            <motion.h2
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeUp}
              custom={1}
              className="mt-6 font-black max-w-4xl mx-auto"
              style={{ ...heroFont, fontSize: "clamp(28px, 4vw, 48px)", lineHeight: 1.1, letterSpacing: "-0.025em" }}
            >
              Mentor mostra o próprio faturamento.<br />
              <span style={{ color: ORANGE }}>Eu mostro o de quem já tá implementado.</span>
            </motion.h2>

            <motion.p
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeUp}
              custom={2}
              className="mt-6 text-base md:text-lg mx-auto"
              style={{ color: "#B8B8B8", lineHeight: 1.65, maxWidth: 640 }}
            >
              Prints do grupo do BG IMPLEMENTAÇÃO essa semana. Vendas fechadas, conta cheia,
              agenda começando a lotar. Não é depoimento em vídeo com pose — é aluno mandando
              venda no zap na cara do gerente.
            </motion.p>
          </div>

          {/* CARD DESTAQUE — print do dep-14 com métricas na legenda */}
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            variants={fadeUp}
            custom={0}
            className="max-w-4xl mx-auto mb-12 rounded-2xl overflow-hidden border-2"
            style={{
              borderColor: ORANGE,
              background: `linear-gradient(180deg, ${ORANGE}0a 0%, transparent 100%), #0F0F0F`,
              boxShadow: `0 30px 80px ${ORANGE}33`,
            }}
          >
            <div className="grid md:grid-cols-[1fr_1.1fr] gap-0">
              {/* Foto do print */}
              <div className="relative bg-black">
                <img
                  src="/depoimentos/dep-14.jpg"
                  alt="Painel de vendas de aluno mostrando R$9.074 faturados em 1 mês"
                  className="w-full h-full object-cover object-top"
                  style={{ maxHeight: 560 }}
                />
              </div>

              {/* Métricas + copy */}
              <div className="p-7 md:p-9 flex flex-col justify-center">
                <p
                  className="text-[10px] md:text-[11px] font-bold uppercase mb-4"
                  style={{ color: ORANGE, letterSpacing: "0.2em" }}
                >
                  Aluno · Junho/Julho 2026
                </p>
                <h3
                  className="font-black mb-6"
                  style={{ ...heroFont, fontSize: "clamp(20px, 2.4vw, 30px)", lineHeight: 1.15, letterSpacing: "-0.02em" }}
                >
                  1 mês rodando os funis.<br />
                  <span style={{ color: ORANGE }}>R$ 9.074 faturado.</span>
                </h3>

                <div className="space-y-3">
                  {[
                    { l: "Faturamento no mês", v: "R$ 9.074,00" },
                    { l: "Gasto em tráfego", v: "R$ 900,00" },
                    { l: "Retorno sobre o tráfego", v: "10x" },
                    { l: "Vendas fechadas", v: "10 faturas" },
                  ].map((m) => (
                    <div
                      key={m.l}
                      className="flex items-center justify-between border-b pb-2"
                      style={{ borderColor: "#222" }}
                    >
                      <span className="text-xs md:text-sm" style={{ color: "#999" }}>
                        {m.l}
                      </span>
                      <span
                        className="font-black text-sm md:text-base"
                        style={{ ...heroFont, color: "#fff" }}
                      >
                        {m.v}
                      </span>
                    </div>
                  ))}
                </div>

                <p
                  className="mt-6 text-xs md:text-sm italic"
                  style={{ color: "#888", lineHeight: 1.5 }}
                >
                  Print do grupo BG IMPLEMENTAÇÃO. Aluno rodando os mesmos 4 pilares que
                  eu instalo — múltiplos funis + processo comercial + sistema que
                  qualifica + narrativa de diferenciação e autoridade.
                </p>
              </div>
            </div>
          </motion.div>

          {/* Quote destacada — resposta de comprador real */}
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={fadeUp}
            custom={0}
            className="max-w-3xl mx-auto mb-12 rounded-2xl p-7 md:p-9 border"
            style={{
              borderColor: `${ORANGE}44`,
              background: `linear-gradient(180deg, ${ORANGE}0a 0%, transparent 100%), #0F0F0F`,
            }}
          >
            <p
              className="text-lg md:text-2xl font-black leading-snug"
              style={{ ...heroFont, color: "#F5F5F5", letterSpacing: "-0.01em" }}
            >
              "Passei por vários processos de mentoria e não virava a chave.
              Remava e não chegava no objetivo. Aqui é algo{" "}
              <span style={{ color: ORANGE }}>verdadeiro</span> — método que funciona."
            </p>
            <p
              className="mt-5 text-xs md:text-sm font-bold uppercase"
              style={{ color: "#888", letterSpacing: "0.15em" }}
            >
              — Comprador da implementação · pesquisa de compra
            </p>
          </motion.div>

          {/* Grid de prints — desktop = 3 col, mobile = scroll horizontal */}
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.1 }}
            variants={fadeUp}
            custom={0}
            className="md:hidden -mx-5 px-5 overflow-x-auto"
            style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
          >
            <div className="flex gap-4 pb-4" style={{ width: "max-content" }}>
              {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => {
                const num = String(n).padStart(2, "0");
                return (
                  <div
                    key={num}
                    className="shrink-0 rounded-2xl overflow-hidden border"
                    style={{
                      width: 260,
                      scrollSnapAlign: "start",
                      borderColor: `${ORANGE}22`,
                      background: "#0F0F0F",
                      boxShadow: `0 20px 40px ${ORANGE}11`,
                    }}
                  >
                    <img
                      src={`/depoimentos/dep-${num}.jpg`}
                      alt={`Print aluno vendendo ${num}`}
                      loading="lazy"
                      className="w-full h-auto block"
                    />
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* Desktop: grid de 3-4 colunas */}
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.1 }}
            variants={fadeUp}
            custom={0}
            className="hidden md:grid grid-cols-3 lg:grid-cols-4 gap-5"
          >
            {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => {
              const num = String(n).padStart(2, "0");
              return (
                <div
                  key={num}
                  className="rounded-2xl overflow-hidden border"
                  style={{
                    borderColor: `${ORANGE}22`,
                    background: "#0F0F0F",
                    boxShadow: `0 20px 40px ${ORANGE}11`,
                  }}
                >
                  <img
                    src={`/depoimentos/dep-${num}.jpg`}
                    alt={`Print aluno vendendo ${num}`}
                    loading="lazy"
                    className="w-full h-auto block"
                  />
                </div>
              );
            })}
          </motion.div>

          <motion.p
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={fadeUp}
            custom={1}
            className="mt-10 text-center font-black"
            style={{ ...heroFont, color: ORANGE, fontSize: "clamp(20px, 2.4vw, 28px)", letterSpacing: "-0.02em" }}
          >
            Isso não é aula. É sistema instalado.
          </motion.p>

          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            variants={fadeUp}
            custom={2}
            className="mt-10 flex flex-col items-center"
          >
            <CTAButton onClick={goQuiz}>QUERO QUE IMPLEMENTE ESSES FUNIS NO MEU PERFIL AGORA →</CTAButton>
            <Microcopy />
          </motion.div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          SEÇÃO 5 — EU JÁ FUI VOCÊ
          ════════════════════════════════════════════════════════════ */}
      <section className="relative px-5 md:px-12 lg:px-20 py-24 md:py-32 border-t border-white/5">
        <div className="mx-auto max-w-3xl">
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={fadeUp}
            custom={0}
            className="text-center mb-12"
          >
            <PillBadge>Quem fala</PillBadge>
          </motion.div>

          <motion.h2
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={fadeUp}
            custom={1}
            className="text-center font-black mb-12"
            style={{ ...heroFont, fontSize: "clamp(32px, 5vw, 56px)", letterSpacing: "-0.03em" }}
          >
            Eu já fui <span style={{ color: ORANGE }}>você.</span>
          </motion.h2>

          <div className="space-y-5">
            {[
              "Postava todo dia. Respondia direct até de madrugada. Gravava reel achando que ia mudar o jogo.",
              "Eu faturava. Mas eu oscilava. E quando parava de postar, o faturamento parava junto.",
              'A virada veio quando parei de perguntar "o que postar?" e comecei a perguntar "onde o dinheiro está vazando?".',
              "Hoje o negócio funciona quando eu tiro férias. E é isso que eu instalo no seu.",
            ].map((line, i) => (
              <motion.p
                key={i}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.3 }}
                variants={fadeUp}
                custom={i}
                className="text-base md:text-lg text-center"
                style={{
                  color: i === 3 ? "#fff" : "#B8B8B8",
                  fontWeight: i === 3 ? 700 : 400,
                  lineHeight: 1.65,
                }}
              >
                {line}
              </motion.p>
            ))}
          </div>

          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            variants={fadeUp}
            custom={0}
            className="mt-12 mx-auto max-w-2xl rounded-2xl overflow-hidden border"
            style={{ borderColor: `${ORANGE}22`, opacity: 0.85 }}
          >
            <img src={dashboardTotals} alt="Totais do painel" className="w-full h-auto" />
          </motion.div>

          <motion.p
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={fadeUp}
            custom={0}
            className="mt-8 text-center font-black"
            style={{ ...heroFont, color: ORANGE, fontSize: "clamp(22px, 2.6vw, 32px)", letterSpacing: "-0.02em" }}
          >
            Não ensino. Implemento.
          </motion.p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          SEÇÃO 6 — PRA QUEM É
          ════════════════════════════════════════════════════════════ */}
      <section className="relative px-5 md:px-12 lg:px-20 py-24 md:py-32 border-t border-white/5">
        <div className="mx-auto max-w-3xl">
          <div className="text-center mb-12">
            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeUp}
              custom={0}
            >
              <PillBadge>Pra quem é</PillBadge>
            </motion.div>

            <motion.h2
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeUp}
              custom={1}
              className="mt-6 font-black"
              style={{ ...heroFont, fontSize: "clamp(28px, 4vw, 44px)", lineHeight: 1.1, letterSpacing: "-0.025em" }}
            >
              O diagnóstico funciona pra{" "}
              <span style={{ color: ORANGE }}>quem já tá no jogo</span>
            </motion.h2>
          </div>

          <div className="space-y-3">
            {[
              "Você já vende no digital — fatura entre R$10k e R$100k/mês",
              "Tem produto ou serviço que alguém já pagou",
              "Consegue separar dinheiro pra investir em crescimento",
              "Prefere instalar do que aprender — quer sistema funcionando, não mais aula",
            ].map((b, i) => (
              <motion.div
                key={i}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.2 }}
                variants={fadeUp}
                custom={i}
                className="flex items-start gap-4 rounded-xl border p-5"
                style={{ borderColor: `${ORANGE}22`, background: "#0F0F0F" }}
              >
                <div
                  className="shrink-0 inline-flex items-center justify-center rounded-full"
                  style={{
                    width: 32,
                    height: 32,
                    background: `linear-gradient(135deg, ${ORANGE_LIGHT}, ${ORANGE_DARK})`,
                  }}
                >
                  <Check size={16} color="#000" strokeWidth={3} />
                </div>
                <p className="text-base md:text-lg" style={{ color: "#E0E0E0", lineHeight: 1.55 }}>
                  {b}
                </p>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            variants={fadeUp}
            custom={0}
            className="mt-10 rounded-xl p-5 border"
            style={{ borderColor: "#333", background: "#0A0A0A" }}
          >
            <p className="text-sm md:text-base" style={{ color: "#999", lineHeight: 1.6 }}>
              <strong style={{ color: "#fff" }}>Se você ainda não vende:</strong> o diagnóstico
              pressupõe negócio rodando. Se você tá começando, o VSL gratuito aqui no site cobre
              o que vem antes.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          SEÇÃO 7 — FECHAMENTO
          ════════════════════════════════════════════════════════════ */}
      <section className="relative px-5 md:px-12 lg:px-20 py-24 md:py-32 border-t border-white/5 overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 60% 60% at 50% 50%, ${ORANGE}15 0%, transparent 70%)`,
          }}
        />

        <div className="relative z-10 mx-auto max-w-3xl text-center">
          <motion.h2
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={fadeUp}
            custom={0}
            className="font-black"
            style={{ ...heroFont, fontSize: "clamp(34px, 5.4vw, 58px)", lineHeight: 1.05, letterSpacing: "-0.03em" }}
          >
            Você não precisa de mais conteúdo.<br />
            <span style={{ color: ORANGE }}>Precisa de operação.</span>
          </motion.h2>

          <motion.p
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={fadeUp}
            custom={1}
            className="mt-8 text-base md:text-lg"
            style={{ color: "#B8B8B8", lineHeight: 1.7 }}
          >
            Em 2 minutos você responde 6 perguntas e descobre:
          </motion.p>

          <div className="mt-8 space-y-3 text-left max-w-xl mx-auto">
            {[
              "Qual dos 4 buracos tá custando mais dinheiro agora",
              "Se o volume de conversas que você gera hoje bate a meta que você tem",
              "Se faz sentido o time entrar em contato pra uma conversa de 30 min comigo",
            ].map((line, i) => (
              <motion.div
                key={i}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.2 }}
                variants={fadeUp}
                custom={i}
                className="flex items-start gap-3"
              >
                <ArrowRight className="h-5 w-5 shrink-0 mt-1" style={{ color: ORANGE }} strokeWidth={2.5} />
                <p className="text-base md:text-lg" style={{ color: "#E0E0E0", lineHeight: 1.55 }}>
                  {line}
                </p>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={fadeUp}
            custom={0}
            className="mt-12 flex flex-col items-center"
          >
            <CTAButton onClick={goQuiz} pulse>
              QUERO IMPLEMENTAR ESSES FUNIS E PROCESSO NO MEU PERFIL →
            </CTAButton>
            <Microcopy />
          </motion.div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          FOOTER
          ════════════════════════════════════════════════════════════ */}
      <footer className="border-t border-white/5 py-10 px-5 text-center">
        <p className="text-xs" style={{ color: "#555" }}>
          © 2026 BG Fitness Ltda · CNPJ 63.702.235/0001-45
        </p>
      </footer>
    </div>
  );
}
