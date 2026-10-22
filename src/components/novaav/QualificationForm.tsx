// Formulário de qualificação da captação — portado do novaav (cloudflare-magic-replicator).
// Diferenças do original: grava direto no lead_form_responses via edge function
// submit-form-response (mesmo Supabase deste app) e redireciona pro /agendar interno.
import { useState, useMemo, useEffect, useRef } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { trackLeadQualificado } from "@/lib/novaavPixel";
import { CHAVE_WHATSAPP_DO_TIME, WHATSAPP_DO_TIME_PADRAO, whatsappDoTime } from "@/lib/destinoDasLeads";
import { supabase } from "@/integrations/supabase/client";
import { buscarComLimite } from "@/lib/fetchComLimite";
import { CHAVE_GRUPO_DESQUALIFICADAS, GRUPO_PADRAO, linkDoGrupo } from "@/lib/grupoDesqualificadas";
import { apenasDigitos, telefoneCompleto, telefoneParecePlausivel } from "@/lib/telefoneDaLead";
import { captureUtmsFromUrl, getAllUtms } from "@/lib/utmCapture";
import { paramsDoRotadorParaAgendar } from "@/lib/rotatorEventos";

// Ordem em que as UTMs vão pra URL do /agendar e pra mensagem do WhatsApp.
const UTM_KEYS = ["utm_source", "utm_campaign", "utm_medium", "utm_content", "utm_term"] as const;

// UTMs como CONJUNTO (regra em lib/utmCapture): se a URL trouxer qualquer utm_*,
// vale só a URL; senão, o conjunto guardado da visita anterior. Nunca mistura
// campo da URL com campo de cookie antigo.
const getUtmsForRedirect = (): Record<string, string> => {
  const all = getAllUtms();
  const utms: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const val = all[key];
    if (val) utms[key] = val;
  }
  return utms;
};

// Mesma lógica de funil usada no admin do novaav (mantém em sincronia)
const resolveFunil = (utms: Record<string, string>): string => {
  const s = (utms.utm_source || "").toLowerCase();
  const c = (utms.utm_campaign || "").toLowerCase();
  if (c === "social_selling" || s === "social_selling") return "social_selling";
  if (c === "low_ticket" || s === "low_ticket") return "low_ticket";
  if (c === "organico" || s === "organico") return "organico";
  if (c === "eu_quero") return "comentou_eu_quero";
  if (c === "indicacao" || s === "indicacao") return "indicacao";
  if (c === "bio_link" || s === "acomp_individual" || c === "acomp_individual") return "acomp_individual";
  if (c === "avaliacao_low" || s === "avaliacao_low") return "avaliacao_low_ticket";
  // Fallback: anúncios pagos do Meta (FB/IG/TH) ou sem UTM = Tráfego Direto
  if (["ig", "fb", "th"].includes(s) || (!utms.utm_source && !utms.utm_campaign)) return "trafego_direto";
  return "trafego_direto";
};

interface QuestionField {
  id: number;
  label: string;
  type: "text" | "number" | "tel";
  placeholder?: string;
  suffix?: string;
  dbField?: string;
}

interface Question {
  id: number;
  question: string;
  type: "text" | "select" | "number" | "multiple";
  options?: { label: string; points: number }[];
  placeholder?: string;
  suffix?: string;
  dbField?: string;
  fields?: QuestionField[];
  subtitle?: string;
}

const questions: Question[] = [
  {
    id: 5,
    question: "Qual seu objetivo estético?",
    type: "select",
    options: [
      { label: "Apenas emagrecer", points: -20 },
      { label: "Perder gordura e definir o corpo", points: 5 },
      { label: "Ter um corpo definido e slim", points: 5 },
      { label: "Ganhar volume muscular e ter um corpo definido", points: 5 },
    ],
    dbField: "objetivo_estetico",
  },
  {
    id: 12,
    question: "Tem alguma situação específica da sua vida que você se sente mal com o seu corpo? Se sim, entre em detalhes",
    type: "text",
    placeholder: "Ex: Não gosto de olhar o meu corpo no espelho...",
    dbField: "situacao_corpo",
  },
  {
    id: 7,
    question: "Qual seu trabalho atual?",
    type: "text",
    placeholder: "escreva com o que você está trabalhando atualmente",
    dbField: "profissao",
  },
  {
    id: 100,
    question: "Me informe alguns dados sobre você:",
    type: "multiple",
    fields: [
      { id: 3, label: "Qual sua altura? (cm)", type: "number", placeholder: "Ex: 165", suffix: "cm", dbField: "altura" },
      { id: 4, label: "Qual seu peso? (kg)", type: "number", placeholder: "Ex: 70", suffix: "kg", dbField: "peso" },
      { id: 6, label: "Qual sua idade?", type: "number", placeholder: "Ex: 35" },
    ]
  },
  {
    id: 10,
    question: "Com as estratégias que você está seguindo, você acredita que vai ter o corpo que deseja?",
    type: "select",
    options: [
      { label: "Infelizmente não, as estratégias não entregam resultado justo", points: 5 },
      { label: "Acho que posso ter, mas vou demorar muito tempo", points: 0 },
      { label: "Do jeito que estou indo consigo ter o resultado que desejo", points: -10 },
    ],
    dbField: "estrategias_atuais",
  },
  {
    id: 17,
    question: "Você faz ou já fez uso de caneta emagrecedora?",
    type: "select",
    options: [
      { label: "Sim, faço uso atualmente", points: 10 },
      { label: "Já usei, mas parei", points: 5 },
      { label: "Nunca usei", points: 0 },
    ],
    dbField: "suplementos",
  },
  {
    id: 9,
    question: "Você já teve algum acompanhamento individual?",
    type: "select",
    options: [
      { label: "Sim - acompanhamento nutricional (pelo convênio)", points: 0 },
      { label: "Sim - acompanhamento nutricional", points: 10 },
      { label: "Sim - consultoria de treino", points: 10 },
      { label: "Sim - os dois (consultoria de treino e nutricionista particular)", points: 20 },
      { label: "Nunca tive", points: 0 },
    ],
    dbField: "acompanhamento_individual",
  },
  {
    id: 16,
    question: "Quanto você investiu mensalmente nos acompanhamentos individual que você teve?",
    subtitle: "(não considerar academia, suplementos, gasto com dieta ou equipamentos)",
    type: "select",
    options: [
      { label: "Abaixo de R$100/mês", points: -20 },
      { label: "R$100 a R$250/mês", points: 5 },
      { label: "R$250 a R$400/mês", points: 10 },
      { label: "R$400 a R$600/mês", points: 15 },
      { label: "R$600 a R$1.000/mês", points: 20 },
      { label: "Mais de R$1.000/mês", points: 25 },
    ],
    dbField: "investimento_fisico",
  },
  {
    id: 18,
    question: "Qual sua situação atual com acompanhamento e resultados?",
    type: "select",
    options: [
      { label: "Estou sem acompanhamento, e preciso começar a ver resultado de verdade", points: 0 },
      { label: "Estou sem acompanhamento, mas estou com resultados excelentes", points: -5 },
      { label: "Estou com acompanhamento, mas estou insatisfeito com os resultados", points: 0 },
      { label: "Estou com acompanhamento, e estou satisfeito com os resultados", points: -5 },
    ],
    dbField: "situacao_acompanhamento",
  },
  {
    id: 14,
    question: "Se conseguirmos encontrar um plano de ação com métodos avançados de treino e dieta, para você construir um físico Slim e Definido, como você reagiria?",
    type: "select",
    options: [
      { label: "Iniciaria de imediato — é minha principal prioridade", points: 15 },
      { label: "Pretendo iniciar futuramente — não é minha prioridade principal", points: -5 },
      { label: "Precisaria pensar um pouco mais — não é prioridade hoje", points: -10 },
    ],
    dbField: "vontade_mudar",
  },
  {
    id: 19,
    question: "Qual sua renda mensal atual?",
    subtitle: "(Considerar a sua renda, ou a renda principal da casa)",
    type: "select",
    options: [
      { label: "Até R$2.000", points: 0 },
      { label: "De R$2.000 a R$4.000", points: 5 },
      { label: "De R$5.000 a R$8.000", points: 10 },
      { label: "De R$9.000 a R$15.000", points: 15 },
      { label: "Acima de R$15.000", points: 20 },
    ],
    dbField: "renda_mensal",
  },
  {
    id: 101,
    question: "Como podemos entrar em contato com você?",
    type: "multiple",
    fields: [
      { id: 15, label: "Qual seu nome completo?", type: "text", placeholder: "Digite seu nome completo", dbField: "nome_completo" },
      { id: 13, label: "Qual seu WhatsApp?", type: "tel", placeholder: "Ex: 31 99999-9999", dbField: "whatsapp" },
      { id: 2, label: "Qual seu Instagram?", type: "text", placeholder: "Ex: @seunome", dbField: "instagram" },
    ]
  },
];

interface QualificationFormProps {
  onDisqualified: () => void;
  isConsultoria?: boolean;
  /** Versão de teste da página (ex.: "avaliacao-v3"). Vai no `origem` da
   *  resposta e no parâmetro `versao` do Lead / Lead_qualificado. */
  versao?: string;
}

const FORM_PENDENTE = "bx_form_resposta_pendente";

// Seletor de país do campo WhatsApp — Brasil vem como padrão
const COUNTRIES: { ddi: string; nome: string; flag: string }[] = [
  { ddi: "55", nome: "Brasil", flag: "🇧🇷" },
  { ddi: "351", nome: "Portugal", flag: "🇵🇹" },
  { ddi: "1", nome: "EUA / Canadá", flag: "🇺🇸" },
  { ddi: "54", nome: "Argentina", flag: "🇦🇷" },
  { ddi: "598", nome: "Uruguai", flag: "🇺🇾" },
  { ddi: "595", nome: "Paraguai", flag: "🇵🇾" },
  { ddi: "591", nome: "Bolívia", flag: "🇧🇴" },
  { ddi: "56", nome: "Chile", flag: "🇨🇱" },
  { ddi: "51", nome: "Peru", flag: "🇵🇪" },
  { ddi: "57", nome: "Colômbia", flag: "🇨🇴" },
  { ddi: "58", nome: "Venezuela", flag: "🇻🇪" },
  { ddi: "52", nome: "México", flag: "🇲🇽" },
  { ddi: "34", nome: "Espanha", flag: "🇪🇸" },
  { ddi: "39", nome: "Itália", flag: "🇮🇹" },
  { ddi: "33", nome: "França", flag: "🇫🇷" },
  { ddi: "49", nome: "Alemanha", flag: "🇩🇪" },
  { ddi: "44", nome: "Reino Unido", flag: "🇬🇧" },
  { ddi: "353", nome: "Irlanda", flag: "🇮🇪" },
  { ddi: "41", nome: "Suíça", flag: "🇨🇭" },
  { ddi: "31", nome: "Holanda", flag: "🇳🇱" },
  { ddi: "32", nome: "Bélgica", flag: "🇧🇪" },
  { ddi: "61", nome: "Austrália", flag: "🇦🇺" },
  { ddi: "81", nome: "Japão", flag: "🇯🇵" },
  { ddi: "244", nome: "Angola", flag: "🇦🇴" },
  { ddi: "258", nome: "Moçambique", flag: "🇲🇿" },
  { ddi: "238", nome: "Cabo Verde", flag: "🇨🇻" },
  { ddi: "245", nome: "Guiné-Bissau", flag: "🇬🇼" },
  { ddi: "239", nome: "São Tomé e Príncipe", flag: "🇸🇹" },
  { ddi: "670", nome: "Timor-Leste", flag: "🇹🇱" },
];

// Destino da lead desqualificada: em vez de sair sem nada, ela entra no grupo.

// Rede de celular cai, função de servidor demora a acordar. Uma tentativa só
// significa perder a lead por causa de dois segundos ruins.
// Cada tentativa tem limite próprio, mais curto que o geral: a lead está
// olhando pra um botão de enviar, não pra uma tela de relatório. Três
// tentativas de 15s somam 45s no pior caso; depois disso a resposta vai pro
// localStorage (FORM_PENDENTE) e é reenviada quando ela voltar.
const LIMITE_DO_ENVIO_MS = 15_000;

const enviarComTentativas = async (payload: unknown, tentativas = 3): Promise<string | null> => {
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await buscarComLimite(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-form-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, LIMITE_DO_ENVIO_MS);
      const json = await res.json().catch(() => null);
      if (json?.id) return json.id as string;
      console.warn(`submit-form-response tentativa ${i + 1} sem ID`, json);
    } catch (e) {
      console.warn(`submit-form-response tentativa ${i + 1} falhou`, e);
    }
    if (i < tentativas - 1) await new Promise((r) => setTimeout(r, 900 * (i + 1)));
  }
  return null;
};

const QualificationForm = ({ onDisqualified, isConsultoria = false, versao }: QualificationFormProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [scores, setScores] = useState<Record<number, number>>({});
  const [result, setResult] = useState<"qualified" | "disqualified" | "underage" | null>(null);
  const [finalScore, setFinalScore] = useState(0);
  // Trava contra duplo envio: clique/toque duplo gravava a mesma lead 2x.
  // useRef porque state não atualiza a tempo entre dois cliques rápidos.
  const enviando = useRef(false);

  // Visita nova com UTM substitui a atribuição guardada inteira (campos que
  // não vieram são apagados). Sem UTM na URL, não mexe em nada.
  useEffect(() => {
    captureUtmsFromUrl();
  }, []);

  // Se a gravação falhou numa visita anterior, tenta de novo assim que a
  // página abre. É a segunda chance da lead que se perderia por queda de rede.
  useEffect(() => {
    let bruto: string | null = null;
    try { bruto = localStorage.getItem(FORM_PENDENTE); } catch { return; }
    if (!bruto) return;
    (async () => {
      let pend: unknown;
      try { pend = JSON.parse(bruto as string); }
      catch { try { localStorage.removeItem(FORM_PENDENTE); } catch { /* ignora */ } return; }
      const id = await enviarComTentativas(pend, 2);
      // Só limpa se gravou. Se falhar de novo, tenta na próxima visita.
      if (id) { try { localStorage.removeItem(FORM_PENDENTE); } catch { /* ignora */ } }
    })();
  }, []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // ID do registro criado em lead_form_responses — vai no redirect como form_response_id
  const [responseId, setResponseId] = useState<string | null>(null);
  // DDI do WhatsApp — padrão Brasil (55), trocável no seletor de país
  const [ddi, setDdi] = useState("55");
  // WhatsApp do time — configurável em app_settings.sdr_whatsapp_phone
  const [closerWpp, setCloserWpp] = useState<string>(WHATSAPP_DO_TIME_PADRAO);

  // Grupo das desqualificadas — configurável em app_settings.
  const [grupoWpp, setGrupoWpp] = useState<string>(GRUPO_PADRAO);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", CHAVE_WHATSAPP_DO_TIME)
      .maybeSingle()
      .then(({ data }) => setCloserWpp(whatsappDoTime(data?.value)));
  }, []);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", CHAVE_GRUPO_DESQUALIFICADAS)
      .maybeSingle()
      .then(({ data }) => setGrupoWpp(linkDoGrupo(data?.value)));
  }, []);

  const utmParams = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get("utm_source") || null,
      utm_campaign: params.get("utm_campaign") || null,
      utm_content: params.get("utm_content") || null,
      utm_term: params.get("utm_term") || null,
    };
  }, []);

  const calculateWeightPenalty = (currentAnswers: Record<number, string>) => {
    const weight = parseFloat(currentAnswers[4] || "0");
    return weight > 86 ? -10 : 0;
  };

  // Telefone final com o DDI escolhido no seletor (ex.: "+5531999999999")
  const getTelefoneCompleto = (ans: Record<number, string>): string | null =>
    telefoneCompleto(ddi, ans[13]);

  const current = questions[currentStep];
  const progress = ((currentStep + 1) / questions.length) * 100;

  const canProceed = () => {
    if (current.type === "multiple" && current.fields) {
      return current.fields.every((f) => {
        const ans = answers[f.id];
        if (!ans || ans.trim() === "") return false;
        // WhatsApp: exige número com tamanho plausível (≥8 dígitos sem o DDI)
        if (f.type === "tel" && !telefoneParecePlausivel(ans)) return false;
        return true;
      });
    }
    const answer = answers[current.id];
    if (!answer || answer.trim() === "") return false;
    return true;
  };

  // Grava no lead_form_responses via edge function (score/nível recalculados server-side)
  const saveToDatabase = async (finalAnswers: Record<number, string>): Promise<string | null> => {
    try {
      const mapP1: Record<string, string> = {
        "Apenas emagrecer": "emagrecer",
        "Perder gordura e definir o corpo": "perder_gordura_definir",
        "Ter um corpo definido e slim": "definido_slim",
        "Ganhar volume muscular e ter um corpo definido": "volume_muscular",
      };
      const mapP5: Record<string, string> = {
        "Infelizmente não, as estratégias não entregam resultado justo": "nao_entregam",
        "Acho que posso ter, mas vou demorar muito tempo": "demoro_muito",
        "Do jeito que estou indo consigo ter o resultado que desejo": "consigo_resultado",
      };
      const mapP6: Record<string, string> = {
        "Sim, faço uso atualmente": "uso_atual",
        "Já usei, mas parei": "ja_usei",
        "Nunca usei": "nunca_usei",
      };
      const mapP7: Record<string, string> = {
        "Sim - acompanhamento nutricional (pelo convênio)": "nutricional_convenio",
        "Sim - acompanhamento nutricional": "nutricional",
        "Sim - consultoria de treino": "treino",
        "Sim - os dois (consultoria de treino e nutricionista particular)": "ambos",
        "Nunca tive": "nunca",
      };
      const mapP8: Record<string, string> = {
        "Abaixo de R$100/mês": "abaixo_100",
        "R$100 a R$250/mês": "100_250",
        "R$250 a R$400/mês": "250_400",
        "R$400 a R$600/mês": "400_600",
        "R$600 a R$1.000/mês": "600_1000",
        "Mais de R$1.000/mês": "acima_1000",
      };
      const mapP9: Record<string, string> = {
        "Iniciaria de imediato — é minha principal prioridade": "imediato",
        "Pretendo iniciar futuramente — não é minha prioridade principal": "futuramente",
        "Precisaria pensar um pouco mais — não é prioridade hoje": "pensar",
      };
      const mapP10: Record<string, string> = {
        "Até R$2.000": "ate_2k",
        "De R$2.000 a R$4.000": "2k_4k",
        "De R$5.000 a R$8.000": "5k_8k",
        "De R$9.000 a R$15.000": "9k_15k",
        "Acima de R$15.000": "acima_15k",
      };

      const utmsExt = getUtmsForRedirect();
      const payload = {
        origem: isConsultoria ? "individual" : (versao || "avaliacao"),
        nome: finalAnswers[15] || null,
        telefone: getTelefoneCompleto(finalAnswers),
        instagram: finalAnswers[2] || null,
        email: null,
        p1_objetivo: mapP1[finalAnswers[5]] || null,
        p2_situacao: finalAnswers[12] || null,
        p3_profissao: finalAnswers[7] || null,
        p4_altura: finalAnswers[3] ? Number(finalAnswers[3]) / 100 : null,
        p4_peso: finalAnswers[4] ? Number(finalAnswers[4]) : null,
        p4_idade: finalAnswers[6] ? Number(finalAnswers[6]) : null,
        p5_estrategias: mapP5[finalAnswers[10]] || null,
        p6_caneta: mapP6[finalAnswers[17]] || null,
        p7_acompanhamento: mapP7[finalAnswers[9]] || null,
        p8_investimento: mapP8[finalAnswers[16]] || null,
        p9_prioridade: mapP9[finalAnswers[14]] || null,
        p10_renda: mapP10[finalAnswers[19]] || null,
        utm_source: utmsExt.utm_source ?? utmParams.utm_source ?? null,
        utm_medium: utmsExt.utm_medium ?? null,
        utm_campaign: utmsExt.utm_campaign ?? utmParams.utm_campaign ?? null,
        utm_content: utmsExt.utm_content ?? utmParams.utm_content ?? null,
        utm_term: utmsExt.utm_term ?? utmParams.utm_term ?? null,
      };

      const id = await enviarComTentativas(payload);
      if (!id) {
        // Guarda a resposta no navegador da lead. Sem isso, uma queda de rede
        // de dois segundos apaga a lead para sempre: ela vê a tela de
        // qualificada, vai pro WhatsApp, e o time nunca fica sabendo.
        try { localStorage.setItem(FORM_PENDENTE, JSON.stringify(payload)); } catch { /* sem storage */ }
        return null;
      }

      // Rotator (BXMetrics): conta preenchimento do formulário como checkout
      try {
        (window as unknown as { cmTrack?: (t: string, v?: number) => void }).cmTrack?.("checkout", 0);
      } catch { /* pixel opcional — não bloqueia UX */ }
      return id;
    } catch (e) {
      console.warn("submit-form-response erro", e);
      return null;
    }
  };

  // Clique no grupo conta como conversão da desqualificada — sem isso não dá
  // para saber se essa tela recupera alguém ou se a lead simplesmente some.
  const marcarEntradaGrupo = () => {
    try {
      (window as unknown as { cmTrack?: (t: string, v?: number) => void }).cmTrack?.("purchase", 0);
    } catch { /* pixel opcional */ }
    try {
      (window as unknown as { fbq?: (...a: unknown[]) => void }).fbq?.("trackCustom", "Grupo_desqualificada", { content_name: "grupo_desqualificada" });
    } catch { /* pixel opcional */ }
  };

  // O clique da desqualificada tem handler proprio porque ela tem evento
  // proprio no Meta (Grupo_desqualificada). marcarEntradaGrupo foi escrita pra
  // isso e nao estava sendo chamada em lugar nenhum: o botao usava o handler da
  // qualificada, entao o evento do Meta nunca disparava. O purchase do rotator
  // continua, que e o que mede se esta tela recupera alguem.
  const handleGrupoClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    marcarEntradaGrupo();
    window.location.href = href;
  };

  const handleAgendarClick = async (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    // Rotator (BXMetrics): lead qualificado que clicou em agendar = conversão final
    try {
      (window as unknown as { cmTrack?: (t: string, v?: number) => void }).cmTrack?.("purchase", 0);
    } catch { /* pixel opcional */ }
    window.location.href = href;
  };

  const handleWhatsappClick = async (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    try {
      (window as unknown as { cmTrack?: (t: string, v?: number) => void }).cmTrack?.("purchase", 0);
    } catch { /* pixel opcional */ }
    window.open(href, "_blank", "noopener,noreferrer");
  };

  const finishForm = async (finalAnswers: Record<number, string>, finalScores: Record<number, number>) => {
    if (enviando.current) return; // já está gravando este formulário
    enviando.current = true;
    setIsSubmitting(true);
    const baseScore = Object.values(finalScores).reduce((sum, s) => sum + s, 0);
    const totalScore = baseScore + calculateWeightPenalty(finalAnswers);

    let nivel = "";
    if (totalScore >= 65) nivel = "Nível A";
    else if (totalScore >= 50) nivel = "Nível B";
    else if (totalScore >= 41) nivel = "Nível C";
    else if (totalScore >= 35) nivel = "Nível D";
    else nivel = "Desqualificada";

    // Pontuação por renda já entra no score (2-4k +5, 5-8k +10, 9-15k +15, >15k +20).

    const isQualified = nivel !== "Desqualificada";
    setFinalScore(totalScore);
    // Aguarda a persistência para que o CTA de agendamento sempre carregue o
    // ID da resposta. Sem isso, uma lead rápida chegava ao /agendar sem o
    // form_response_id e o painel precisava adivinhar o vínculo por telefone.
    const savedResponseId = await saveToDatabase(finalAnswers);
    if (savedResponseId) setResponseId(savedResponseId);
    setResult(isQualified ? "qualified" : "disqualified");

    if (isQualified) {
      trackLeadQualificado(versao);
    }
    setIsSubmitting(false);
  };

  const handleSelect = (label: string, points: number) => {
    const newAnswers = { ...answers, [current.id]: label };
    const newScores = { ...scores, [current.id]: points };
    setAnswers(newAnswers);
    setScores(newScores);
    setTimeout(() => {
      moveToNext(currentStep, newAnswers, newScores);
    }, 300);
  };

  const handleTextChange = (value: string) => {
    setAnswers((prev) => ({ ...prev, [current.id]: value }));
  };

  const moveToNext = (step: number, currentAnswers: Record<number, string>, currentScores: Record<number, number>) => {
    let nextStep = step + 1;

    // Pula a pergunta "Investimento" (id 16) para quem nunca pagou acompanhamento particular
    if (nextStep < questions.length && questions[nextStep].id === 16) {
      const resp9 = currentAnswers[9];
      if (resp9 === "Nunca tive" || resp9 === "Sim - acompanhamento nutricional (pelo convênio)") {
        nextStep++;
      }
    }

    if (nextStep < questions.length) {
      setCurrentStep(nextStep);
    } else {
      void finishForm(currentAnswers, currentScores);
    }
  };

  const disqualifyUnderage = () => {
    // Menor de idade não entra na base do time — só mostra a tela.
    setFinalScore(0);
    setResult("underage");
  };

  const handleNext = () => {
    // Validação: idade < 18 desqualifica imediatamente (pergunta múltipla id=100, campo id=6)
    if (current.id === 100) {
      const idadeRaw = answers[6];
      const idade = idadeRaw ? parseInt(idadeRaw, 10) : NaN;
      if (!isNaN(idade) && idade < 18) {
        disqualifyUnderage();
        return;
      }
    }
    moveToNext(currentStep, answers, scores);
  };

  const handleBack = () => {
    if (currentStep > 0) {
      let prevStep = currentStep - 1;
      // Reverter o pulo da pergunta 16
      if (questions[prevStep].id === 16) {
        const resp9 = answers[9];
        if (resp9 === "Nunca tive" || resp9 === "Sim - acompanhamento nutricional (pelo convênio)") {
          prevStep--;
        }
      }
      setCurrentStep(prevStep);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canProceed() && (current.type === "text" || current.type === "number" || current.type === "multiple")) {
      handleNext();
    }
  };

  if (result === "underage") {
    return (
      <section className="relative flex flex-col items-center justify-center px-4 py-16 md:py-24 min-h-[80vh]">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-[400px] blur-glow rounded-full pointer-events-none" />
        <div className="max-w-2xl w-full relative z-10 text-center space-y-6">
          <div className="text-5xl">💛</div>
          <h2 className="text-2xl md:text-4xl font-black tracking-tight uppercase">
            Obrigada pelo seu interesse!
          </h2>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
            No momento, a consultoria do Breno Xavier é voltada exclusivamente
            para mulheres <span className="text-foreground font-bold">maiores de 18 anos</span>.
          </p>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
            Quando você atingir essa idade, será um prazer te receber aqui novamente.
          </p>
          <p className="text-sm md:text-base text-muted-foreground leading-relaxed pt-2">
            Enquanto isso, siga o Breno no Instagram para acompanhar conteúdos
            sobre saúde, treino e nutrição:
          </p>
          <a
            href="https://instagram.com/brenoxavieer_"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center justify-center w-full max-w-md bg-primary hover:bg-primary/85 text-primary-foreground font-black text-lg md:text-xl py-5 md:py-6 rounded-3xl transition-all transform hover:scale-[1.02] uppercase cursor-pointer"
          >
            Seguir @brenoxavieer_
          </a>
          <button
            type="button"
            onClick={() => {
              setAnswers((prev) => ({ ...prev, 6: "" }));
              setResult(null);
              const idx = questions.findIndex((q) => q.id === 100);
              if (idx >= 0) setCurrentStep(idx);
            }}
            className="inline-flex items-center justify-center w-full max-w-md text-sm md:text-base text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors mt-2"
          >
            ← Voltar ao formulário — tenho +18 anos
          </button>
        </div>
      </section>
    );
  }

  if (result === "qualified") {
    if (isConsultoria) {
      // Monta mensagem WhatsApp para o comercial (fluxo /individual)
      let mensagem = `Oi Breno, tudo bem? Tenho interesse de saber mais sobre a consultoria de elite, as minhas respostas estão aqui abaixo, qual seria o próximo passo?\n\n---\n\n📋 RESPOSTAS DO FORMULÁRIO:\n\n`;
      questions.forEach((q) => {
        if (q.type === "multiple" && q.fields) {
        q.fields.forEach((f) => {
          const v = f.id === 13 ? getTelefoneCompleto(answers) : answers[f.id];
          if (v) mensagem += `${f.label.replace(/\?$/, "")}: ${v}${f.suffix ? ` ${f.suffix}` : ""}\n`;
        });
        } else {
          const v = answers[q.id];
          if (v) mensagem += `${q.question.replace(/\?$/, "")}: ${v}${q.suffix ? ` ${q.suffix}` : ""}\n`;
        }
      });
      const utms = getUtmsForRedirect();
      const utmsStr = Object.entries(utms).map(([k, v]) => `${k}=${v}`).join(" | ");
      if (utmsStr) mensagem += `\n---\n🔗 Origem: ${utmsStr}\n`;
      const whatsappUrl = `https://wa.me/${closerWpp}?text=${encodeURIComponent(mensagem)}`;

      return (
        <section className="relative flex flex-col items-center justify-center px-4 py-16 md:py-24 min-h-[80vh]">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-[400px] blur-glow rounded-full pointer-events-none" />
          <div className="max-w-2xl w-full relative z-10 text-center space-y-8">
            <div className="w-20 h-20 bg-[hsl(45,80%,50%)]/20 rounded-full flex items-center justify-center mx-auto">
              <ChevronRight size={40} className="text-[hsl(45,80%,50%)]" />
            </div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase">
              Parabéns, você foi <span className="text-[hsl(45,80%,50%)]">selecionada!</span>
            </h2>
            <p className="text-lg text-muted-foreground">
              Clique no botão abaixo e fale agora com o nosso time no WhatsApp.
            </p>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => handleWhatsappClick(e, whatsappUrl)}
              className="group inline-flex items-center justify-center w-full max-w-xl bg-[hsl(45,80%,50%)] hover:bg-[hsl(45,80%,45%)] text-background font-black text-xl md:text-2xl py-7 md:py-8 rounded-3xl transition-all transform hover:scale-[1.02] active:scale-[0.98] uppercase cursor-pointer"
            >
              <span className="flex items-center gap-3">
                Falar no WhatsApp agora
                <ChevronRight className="group-hover:translate-x-1 transition-transform" />
              </span>
            </a>
          </div>
        </section>
      );
    }

    const nome = answers[15] || "";
    const whatsapp = getTelefoneCompleto(answers) || "";
    const agendarParams = new URLSearchParams({
      origem: "avaliacao",
      nome,
      whatsapp,
    });
    questions.forEach((q) => {
      if (q.type === "multiple" && q.fields) {
        q.fields.forEach((f) => {
          if (f.dbField && answers[f.id]) {
            agendarParams.set(f.dbField, answers[f.id] + (f.suffix ? ` ${f.suffix}` : ""));
          }
        });
      } else if (q.dbField && answers[q.id]) {
        agendarParams.set(q.dbField, answers[q.id] + (q.suffix ? ` ${q.suffix}` : ""));
      }
    });
    // O laço acima copia toda resposta que tem `dbField` — e o campo do WhatsApp
    // tem. Ele passava por cima do número já normalizado com o texto cru: com
    // espaços e sem o DDI. Era isso que chegava em `consultations.client_phone`,
    // porque a função do banco grava o que recebe. Reponho depois do laço.
    if (whatsapp) agendarParams.set("whatsapp", whatsapp);
    agendarParams.set("score", finalScore.toString());
    const utms = getUtmsForRedirect();
    Object.entries(utms).forEach(([k, v]) => agendarParams.set(k, v));
    agendarParams.set("funil", resolveFunil(utms));
    if (responseId) agendarParams.set("form_response_id", responseId);
    // Versões do teste (/avaliacao/vN): o clique do rotador vai junto, senão a
    // conversão "URL contém agendar" não tem a quem ser atribuída. A /avaliacao
    // base (sem versão) segue sem esses parâmetros, como antes.
    if (versao) {
      paramsDoRotadorParaAgendar(window.location.search).forEach(([k, v]) => agendarParams.set(k, v));
    }
    // Agendamento agora é interno — mesma aplicação (equipe.brenoxavier.com.br)
    const agendarUrl = `/agendar?${agendarParams.toString()}`;

    return (
      <section className="relative flex flex-col items-center justify-center px-4 py-16 md:py-24 min-h-[80vh]">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-[400px] blur-glow rounded-full pointer-events-none" />
        <div className="max-w-2xl w-full relative z-10 text-center space-y-8">
          <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mx-auto">
            <ChevronRight size={40} className="text-primary" />
          </div>
          <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase">
            Parabéns, você foi <span className="text-gold">selecionada!</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            Clique no botão abaixo para agendar sua consulta e receber sua avaliação.
          </p>
          <a
            href={agendarUrl}
            rel="noopener noreferrer"
            onClick={(e) => handleAgendarClick(e, agendarUrl)}
            className="group inline-flex items-center justify-center w-full max-w-xl bg-primary hover:bg-primary/85 text-primary-foreground font-black text-xl md:text-2xl py-7 md:py-8 rounded-3xl transition-all transform hover:scale-[1.02] glow-green uppercase cursor-pointer"
          >
            <span className="flex items-center gap-3">
              Marcar minha consulta e receber minha avaliação para definir meu corpo
              <ChevronRight className="group-hover:translate-x-1 transition-transform" />
            </span>
          </a>
        </div>
      </section>
    );
  }

  if (result === "disqualified") {
    return (
      <section className="relative flex flex-col items-center justify-center px-4 py-16 md:py-24 min-h-[80vh]">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-[400px] blur-glow rounded-full pointer-events-none" />
        <div className="max-w-2xl w-full relative z-10 text-center space-y-8">
          <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase">
            Infelizmente você não foi selecionada hoje!
          </h2>
          <p className="text-lg leading-relaxed">
            No grupo você recebe o método para um corpo <strong>Slim e Definido</strong> sem
            abrir mão da sua vida real — com presentes e uma condição única.
          </p>
          <a
            href={grupoWpp}
            rel="noopener noreferrer"
            onClick={(e) => handleGrupoClick(e, grupoWpp)}
            className="group inline-flex items-center justify-center w-full max-w-xl bg-accent hover:bg-accent/85 text-accent-foreground font-black text-xl md:text-2xl py-7 md:py-8 rounded-3xl transition-all transform hover:scale-[1.02] uppercase"
          >
            <span className="flex items-center gap-3">
              Entrar no grupo
              <ChevronRight className="group-hover:translate-x-1 transition-transform" />
            </span>
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="relative flex flex-col items-center justify-center px-4 py-16 md:py-24 min-h-[80vh]">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-[400px] blur-glow rounded-full pointer-events-none" />
      <div className="max-w-2xl w-full relative z-10 space-y-8">
        <div className="space-y-3">
          <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <span>Pergunta {currentStep + 1} de {questions.length}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300" key={current.id}>
          <h2 className="text-2xl md:text-4xl font-black tracking-tight">
            {current.question}
          </h2>
          {current.subtitle && (
            <p className="text-sm md:text-base font-medium text-muted-foreground -mt-4">
              {current.subtitle}
            </p>
          )}
          {(current.type === "text" || current.type === "number") && (
            <div className="relative">
              <input
                type={current.type}
                value={answers[current.id] || ""}
                onChange={(e) => handleTextChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={current.placeholder}
                className="w-full bg-secondary/50 border border-border rounded-2xl px-6 py-5 text-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              />
              {current.suffix && (
                <span className="absolute right-6 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">
                  {current.suffix}
                </span>
              )}
            </div>
          )}
          {current.type === "select" && current.options && (
            <div className="space-y-3">
              {current.options.map((option) => (
                <button
                  key={option.label}
                  onClick={() => handleSelect(option.label, option.points)}
                  className={`w-full text-left px-6 py-5 rounded-2xl border transition-all text-base md:text-lg font-medium ${answers[current.id] === option.label
                      ? "bg-primary/20 border-primary text-foreground"
                      : "bg-secondary/50 border-border text-foreground hover:bg-secondary hover:border-muted-foreground/30"
                    }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          {current.type === "multiple" && current.fields && (
            <div className="space-y-6">
              {current.fields.map((field) => (
                <div key={field.id} className="space-y-2">
                  <label className="text-sm font-bold text-muted-foreground">
                    {field.label}
                    {field.type === "tel" && (
                      <span className="ml-2 font-normal normal-case">(sem espaço, apenas números)</span>
                    )}
                  </label>
                  {field.type === "tel" ? (
                    <div className="flex gap-2">
                      <select
                        value={ddi}
                        onChange={(e) => setDdi(e.target.value)}
                        aria-label="Código do país"
                        className="bg-secondary/50 border border-border rounded-2xl px-3 py-5 text-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-all cursor-pointer"
                      >
                        {COUNTRIES.map((c) => (
                          <option key={`${c.ddi}-${c.nome}`} value={c.ddi}>
                            {c.flag} +{c.ddi}
                          </option>
                        ))}
                      </select>
                      <input
                        type="tel"
                        inputMode="numeric"
                        value={answers[field.id] || ""}
                        onChange={(e) => {
                          // Filtra aqui, e não só na hora de enviar: o campo
                          // aceitava "3414 34 424" e a pessoa não tinha como
                          // saber que aquilo ia dar problema depois.
                          const soNumeros = apenasDigitos(e.target.value);
                          setAnswers((prev) => ({ ...prev, [field.id]: soNumeros }));
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder={field.placeholder}
                        className="flex-1 min-w-0 bg-secondary/50 border border-border rounded-2xl px-6 py-5 text-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                      />
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        type={field.type}
                        value={answers[field.id] || ""}
                        onChange={(e) => {
                          setAnswers((prev) => ({ ...prev, [field.id]: e.target.value }));
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder={field.placeholder}
                        className="w-full bg-secondary/50 border border-border rounded-2xl px-6 py-5 text-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                      />
                      {field.suffix && (
                        <span className="absolute right-6 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">
                          {field.suffix}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between pt-4">
          <button
            onClick={handleBack}
            disabled={currentStep === 0}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-bold uppercase text-sm tracking-wider"
          >
            <ChevronLeft size={18} />
            Voltar
          </button>
          {(current.type === "text" || current.type === "number" || current.type === "multiple") && (
            <button
              onClick={handleNext}
              disabled={!canProceed() || isSubmitting}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-2xl font-black uppercase tracking-wider text-sm hover:bg-primary/85 disabled:opacity-30 disabled:cursor-not-allowed transition-all glow-green"
            >
              {isSubmitting ? "Enviando..." : currentStep === questions.length - 1 ? "Enviar" : "Próxima"}
              <ChevronRight size={18} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

export default QualificationForm;
