// Tipos e opções do Feedback Semanal / Quinzenal das alunas da consultoria.
//
// Base principal de acompanhamento: cada resposta vira uma linha em
// public.feedback_semanal_responses. É daqui que sai o monitoramento
// (dashboard em /alunas/feedback) — por isso quase tudo é fechado (0-10 ou
// múltipla escolha), pra virar série temporal comparável semana a semana.
// Campo aberto só onde a aluna precisa mesmo escrever.

export interface FeedbackSemanalResponse {
  id?: string;
  created_at?: string;
  produto?: string; // slug: "mgmd" | "elite"
  periodicidade?: string; // legado: saiu do formulário

  // Identificação
  nome: string;
  telefone?: string;

  // Treino — qualidade de execução
  treino_execucao?: number; // técnica, amplitude e cadência
  // Legado: as duas notas 0-10 abaixo saíram do formulário quando a pergunta de
  // repetições em reserva passou a medir série válida. Ficam aqui só pra ler
  // respostas antigas — nada novo é gravado nelas.
  treino_progressao_carga?: number;
  treino_series_validas?: number;
  treino_reps_reserva?: string; // repetições que ainda dava no fim da série (RIR)

  // Treino — volume
  treino_frequencia_semanal?: string;
  treino_minutos_semanais?: string;
  cardio_minutos_semanais?: string;
  cardio_intensidade?: number;

  // Dieta
  dieta_nota?: number; // legado: saiu do formulário, ficou a adesão
  dieta_adesao?: number;
  dieta_refeicoes_fora?: string;
  dieta_beliscando?: string;

  // Leitura geral
  maior_gargalo?: string; // múltipla escolha: valores separados por vírgula
  percebe_mudanca?: string;
  mudanca_descricao?: string;
  /** 0 a 10: o quanto ela gosta e indicaria o programa. */
  programa_indicaria?: number;
  consultoria_feedback?: string; // o que ela está achando do programa
  consultoria_sente_falta?: string; // o que falta aqui dentro / o que melhorar

  // Resumo escrito pela edge function feedback-semanal-resumo.
  resumo_ia?: string;
  resumo_ia_at?: string;
}

// ---------------------------------------------------------------------------
// Produto (mesma convenção da pesquisa de satisfação: cada produto tem URL,
// header e filtro próprios, mantendo o visual dark + dourado da marca).
// ---------------------------------------------------------------------------

export interface FeedbackProdutoConfig {
  slug: string;
  nome: string;
  tagline: string;
  rotulo: string;
}

export const FEEDBACK_PRODUTOS: Record<"mgmd" | "elite" | "plataforma", FeedbackProdutoConfig> = {
  mgmd: {
    slug: "mgmd",
    nome: "MGMD",
    tagline: "Menos Gordura, Mais Definição",
    rotulo: "MGMD",
  },
  elite: {
    slug: "elite",
    nome: "Elite",
    tagline: "Time Breno Xavier",
    rotulo: "Elite",
  },
  plataforma: {
    slug: "plataforma",
    nome: "Plataforma",
    tagline: "Magra e Definida",
    rotulo: "Plataforma",
  },
};

export const FEEDBACK_PRODUTOS_LISTA: FeedbackProdutoConfig[] = [
  FEEDBACK_PRODUTOS.mgmd,
  FEEDBACK_PRODUTOS.elite,
  FEEDBACK_PRODUTOS.plataforma,
];

/**
 * Descobre o produto pelo programa que está no cadastro da aluna.
 *
 * `alunas.programa` é texto livre, escrito à mão ao longo dos anos: aparece
 * como "MGMD", "mgmd 12 meses", "Consultoria de Elite", "ELITE", "Plataforma
 * Magra e Definida". Por isso a comparação é por pedaço do texto, sem acento e
 * sem caixa, e não por igualdade.
 *
 * Devolve null quando não reconhece — aí quem chama decide o que fazer, em vez
 * de a aluna cair num produto errado sem ninguém perceber.
 */
export function produtoDoPrograma(programa?: string | null): FeedbackProdutoConfig | null {
  const limpo = (programa ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!limpo) return null;

  // Elite primeiro: "consultoria de elite" também casaria com regra genérica.
  if (limpo.includes("elite")) return FEEDBACK_PRODUTOS.elite;
  if (limpo.includes("plataforma")) return FEEDBACK_PRODUTOS.plataforma;
  if (limpo.includes("mgmd") || limpo.includes("magra") || limpo.includes("definic")) {
    return limpo.includes("magra") && limpo.includes("definida")
      ? FEEDBACK_PRODUTOS.plataforma
      : FEEDBACK_PRODUTOS.mgmd;
  }
  if (limpo.includes("gordura")) return FEEDBACK_PRODUTOS.mgmd;
  return null;
}

// ---------------------------------------------------------------------------
// Opções fechadas
// ---------------------------------------------------------------------------

// Repetições em reserva (RIR): quantas ainda dava no fim da série principal.
// Quanto MENOS sobra, mais perto da falha ela está treinando.
export const TREINO_REPS_RESERVA = [
  { value: "1-3", label: "1 a 3 repetições" },
  { value: "4-6", label: "4 a 6 repetições" },
  { value: "7-10", label: "7 a 10 repetições" },
  { value: "10+", label: "Mais de 10 repetições" },
] as const;

// ---------------------------------------------------------------------------
// País / DDI do WhatsApp da aluna
// ---------------------------------------------------------------------------
// Brasil é o default, mas tem aluna morando fora. maxLocal é o tamanho do
// número SEM o DDI — serve de trava na digitação. exemplo vira o placeholder.
export interface PaisDDI {
  iso: string;
  nome: string;
  ddi: string;
  exemplo: string;
  maxLocal: number;
  bandeira: string;
}

export const PAISES: PaisDDI[] = [
  { iso: "BR", nome: "Brasil", ddi: "55", exemplo: "31990000107", maxLocal: 11, bandeira: "🇧🇷" },
  { iso: "PT", nome: "Portugal", ddi: "351", exemplo: "912345678", maxLocal: 9, bandeira: "🇵🇹" },
  { iso: "US", nome: "Estados Unidos", ddi: "1", exemplo: "4155551234", maxLocal: 10, bandeira: "🇺🇸" },
  { iso: "CA", nome: "Canadá", ddi: "1", exemplo: "4165551234", maxLocal: 10, bandeira: "🇨🇦" },
  { iso: "ES", nome: "Espanha", ddi: "34", exemplo: "612345678", maxLocal: 9, bandeira: "🇪🇸" },
  { iso: "GB", nome: "Reino Unido", ddi: "44", exemplo: "7700900123", maxLocal: 10, bandeira: "🇬🇧" },
  { iso: "IE", nome: "Irlanda", ddi: "353", exemplo: "851234567", maxLocal: 9, bandeira: "🇮🇪" },
  { iso: "IT", nome: "Itália", ddi: "39", exemplo: "3123456789", maxLocal: 10, bandeira: "🇮🇹" },
  { iso: "FR", nome: "França", ddi: "33", exemplo: "612345678", maxLocal: 9, bandeira: "🇫🇷" },
  { iso: "DE", nome: "Alemanha", ddi: "49", exemplo: "15123456789", maxLocal: 11, bandeira: "🇩🇪" },
  { iso: "CH", nome: "Suíça", ddi: "41", exemplo: "781234567", maxLocal: 9, bandeira: "🇨🇭" },
  { iso: "NL", nome: "Países Baixos", ddi: "31", exemplo: "612345678", maxLocal: 9, bandeira: "🇳🇱" },
  { iso: "BE", nome: "Bélgica", ddi: "32", exemplo: "470123456", maxLocal: 9, bandeira: "🇧🇪" },
  { iso: "AO", nome: "Angola", ddi: "244", exemplo: "923123456", maxLocal: 9, bandeira: "🇦🇴" },
  { iso: "MZ", nome: "Moçambique", ddi: "258", exemplo: "821234567", maxLocal: 9, bandeira: "🇲🇿" },
  { iso: "AR", nome: "Argentina", ddi: "54", exemplo: "91123456789", maxLocal: 11, bandeira: "🇦🇷" },
  { iso: "CL", nome: "Chile", ddi: "56", exemplo: "912345678", maxLocal: 9, bandeira: "🇨🇱" },
  { iso: "UY", nome: "Uruguai", ddi: "598", exemplo: "91234567", maxLocal: 8, bandeira: "🇺🇾" },
  { iso: "PY", nome: "Paraguai", ddi: "595", exemplo: "961234567", maxLocal: 9, bandeira: "🇵🇾" },
  { iso: "MX", nome: "México", ddi: "52", exemplo: "5512345678", maxLocal: 10, bandeira: "🇲🇽" },
  { iso: "AU", nome: "Austrália", ddi: "61", exemplo: "412345678", maxLocal: 9, bandeira: "🇦🇺" },
  { iso: "JP", nome: "Japão", ddi: "81", exemplo: "9012345678", maxLocal: 10, bandeira: "🇯🇵" },
  { iso: "AE", nome: "Emirados Árabes", ddi: "971", exemplo: "501234567", maxLocal: 9, bandeira: "🇦🇪" },
];

export const PAIS_PADRAO = PAISES[0];

export function paisPorIso(iso: string): PaisDDI {
  return PAISES.find((p) => p.iso === iso) ?? PAIS_PADRAO;
}

/**
 * Limpa o que a aluna digitou: fica só dígito (fora espaço, traço, parênteses)
 * e um DDI colado na frente é descartado. Só descartamos o DDI quando o número
 * passa do tamanho local — assim o DDD 55 brasileiro (11 dígitos) sobrevive.
 */
export function limparNumeroLocal(valor: string, pais: PaisDDI): string {
  let d = valor.replace(/\D/g, "");
  if (d.length > pais.maxLocal && d.startsWith(pais.ddi)) d = d.slice(pais.ddi.length);
  return d.slice(0, pais.maxLocal);
}

/** Número pronto pro banco e pro WhatsApp: E.164 com "+". */
export function telefoneE164(numeroLocal: string, pais: PaisDDI): string {
  return `+${pais.ddi}${numeroLocal.replace(/\D/g, "")}`;
}

// Leitura do RIR: até 3 repetições sobrando é série válida de verdade; 7 ou
// mais sobrando quer dizer que ela parou longe demais da falha.
export const REPS_RESERVA_IDEAL = "1-3";
export const REPS_RESERVA_LONGE = ["7-10", "10+"];

export function repsReservaLonge(valor: string | undefined | null): boolean {
  return !!valor && REPS_RESERVA_LONGE.includes(valor);
}

export const TREINO_FREQUENCIA = [
  { value: "1x", label: "1x na semana" },
  { value: "2x", label: "2x na semana" },
  { value: "3x", label: "3x na semana" },
  { value: "4x", label: "4x na semana" },
  { value: "5x", label: "5x na semana" },
  { value: "6x+", label: "6x ou mais" },
  { value: "nao_treinei", label: "Não treinei essa semana" },
] as const;

// Minutos de musculação (carga) na semana. Buckets exatos pedidos pelo Breno.
export const TREINO_MINUTOS = [
  { value: "<100", label: "Abaixo de 100 min" },
  { value: "100-150", label: "De 100 a 150 min" },
  { value: "150-200", label: "De 150 a 200 min" },
  { value: "200-250", label: "De 200 a 250 min" },
  { value: "250+", label: "Mais de 250 min" },
] as const;

// Minutos de cardio na semana — separado dos minutos de carga (musculação).
export const CARDIO_MINUTOS = [
  { value: "0", label: "Não fiz cardio" },
  { value: "<60", label: "Abaixo de 60 min" },
  { value: "60-120", label: "De 60 a 120 min" },
  { value: "120-180", label: "De 120 a 180 min" },
  { value: "180-240", label: "De 180 a 240 min" },
  { value: "240+", label: "Mais de 240 min" },
] as const;

// Refeições livres na semana. O rótulo já devolve a leitura do Breno — a aluna
// entende sozinha onde está pisando. Nenhuma não é elogio automático: pode ser
// controle, pode ser restrição que vai estourar depois.
export const DIETA_REFEICOES_FORA = [
  { value: "0", label: "Nenhuma, cuidado, pode ser bom ou pode ser ruim" },
  { value: "1", label: "1 refeição livre, estou voando" },
  { value: "2", label: "2 refeições livres, estou atenta" },
  { value: "3", label: "3 refeições livres, estou super atenta" },
  { value: "4+", label: "4 refeições livres ou mais, tenho que ajustar tudo" },
] as const;

export const DIETA_BELISCANDO = [
  { value: "nao", label: "Não estou beliscando" },
  { value: "raramente", label: "Raramente" },
  { value: "algumas_vezes", label: "Algumas vezes na semana" },
  { value: "quase_todo_dia", label: "Quase todo dia" },
  { value: "todo_dia", label: "Todo dia" },
] as const;

export const MAIOR_GARGALO = [
  { value: "treino", label: "Treino" },
  { value: "dieta", label: "Dieta" },
  { value: "cardio", label: "Cardio" },
  { value: "sono", label: "Sono e recuperação" },
  { value: "rotina", label: "Rotina e falta de tempo" },
  { value: "fim_de_semana", label: "Fim de semana" },
  { value: "intestino_preso", label: "Intestino preso" },
  { value: "urina_escura", label: "Urina escura, provavelmente retida" },
  { value: "constancia", label: "Cabeça e constância" },
  { value: "nenhum", label: "Nenhum, tá fluindo" },
] as const;

export const PERCEBE_MUDANCA = [
  { value: "sim_muito", label: "Sim, bastante" },
  { value: "sim_pouco", label: "Sim, pouca coisa" },
  { value: "nao_ainda", label: "Ainda não, mas é começo" },
  { value: "nao", label: "Não estou percebendo nada" },
] as const;

// Referência de intensidade de cardio por frequência cardíaca — o Breno usa
// essa escala com as alunas, então ela aparece na tela junto do slider.
export const CARDIO_FC_REFERENCIA: Record<number, string> = {
  10: "FC acima de 180 bpm",
  9: "FC por volta de 170 bpm",
  8: "FC por volta de 160 bpm",
  7: "FC por volta de 150 bpm",
  6: "FC por volta de 140 bpm",
  5: "FC por volta de 130 bpm",
  4: "FC por volta de 120 bpm",
  3: "FC por volta de 110 bpm",
};

// Percepção de esforço na linguagem que a aluna entende — sem isso ela chuta a
// nota. O 10 é a frase literal do Breno.
export const CARDIO_PERCEPCAO: Record<number, string> = {
  10: "Não consigo correr mais nem pra salvar alguém que eu amo",
  9: "Só aguento mais alguns segundos nesse ritmo",
  8: "Falo uma palavra por vez",
  7: "Frases curtas, respiração pesada",
  6: "Uma frase inteira, com esforço",
  5: "Converso puxando o ar",
  4: "Converso quase normal",
  3: "Converso tranquila",
  2: "Caminhada leve",
  1: "Quase parada",
  0: "Não fiz cardio",
};

export function cardioReferencia(nota: number | undefined | null): string | null {
  if (nota === undefined || nota === null) return null;
  if (CARDIO_FC_REFERENCIA[nota]) return CARDIO_FC_REFERENCIA[nota];
  if (nota < 3) return "FC abaixo de 110 bpm";
  return null;
}

export function cardioPercepcao(nota: number | undefined | null): string | null {
  if (nota === undefined || nota === null) return null;
  return CARDIO_PERCEPCAO[nota] ?? null;
}

/** Linhas da tabela de referência que aparece embaixo do slider de cardio. */
export const CARDIO_ESCALA = [10, 9, 8, 7, 6, 5, 4, 3].map((n) => ({
  nota: n,
  fc: CARDIO_FC_REFERENCIA[n],
  percepcao: CARDIO_PERCEPCAO[n],
}));

// Texto que aparece embaixo da pergunta de adesão. Pedido literal do Breno —
// evita que a aluna leia "segui a dieta" como "cortei doce da vida".
export const ADESAO_LEMBRETE =
  "Lembre-se: seguir a dieta segunda a segunda não quer dizer parar de comer doce. Tudo tem como encaixar, lembra muito disso.";

// Âncora que o Breno usa pra aluna calibrar o esforço de verdade: sem ela a
// resposta vira chute otimista.
export const REPS_RESERVA_HINT =
  "É isso que define série válida: técnica próxima da perfeição, carga desafiadora e perda de velocidade do movimento no fim da série. Lembra do teu último treino, a pessoa que você mais ama está embaixo do peso. Quantas repetições a mais você ainda conseguiria fazer?";

// Definição de série válida, usada como hint da pergunta.
export const SERIE_VALIDA_HINT =
  "Série válida é aquela com técnica próxima da perfeição, carga desafiadora e perda de velocidade do movimento no fim da série.";

// ---------------------------------------------------------------------------
// WhatsApp da consultoria
// ---------------------------------------------------------------------------

// Número que recebe o resumo do feedback. Formato E.164 sem "+" (DDI 55).
// Trocar aqui muda em todos os lugares (formulário e dashboard).
export const WHATSAPP_CONSULTORIA = "5531970000105";

export function whatsappLink(numero: string, texto: string): string {
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

// ---------------------------------------------------------------------------
// Resumo pro WhatsApp
// ---------------------------------------------------------------------------

/**
 * Campos de múltipla escolha guardam os valores separados por vírgula na mesma
 * coluna text — nada de migração pra isso. Estas três funções são o contrato.
 */
export const GARGALO_EXCLUSIVO = "nenhum";

export function listaValores(valor: string | undefined | null): string[] {
  return (valor ?? "").split(",").map((v) => v.trim()).filter(Boolean);
}

export function alternarValor(atual: string | undefined, valor: string): string {
  const lista = listaValores(atual);
  // "Nenhum, tá fluindo" não combina com gargalo nenhum: marca sozinho.
  if (valor === GARGALO_EXCLUSIVO) {
    return lista.includes(GARGALO_EXCLUSIVO) ? "" : GARGALO_EXCLUSIVO;
  }
  const semExclusivo = lista.filter((v) => v !== GARGALO_EXCLUSIVO);
  return semExclusivo.includes(valor)
    ? semExclusivo.filter((v) => v !== valor).join(",")
    : [...semExclusivo, valor].join(",");
}

export function rotulosMultiplos(
  opcoes: ReadonlyArray<{ value: string; label: string }>,
  valor: string | undefined
): string | null {
  const lista = listaValores(valor);
  if (lista.length === 0) return null;
  return lista.map((v) => opcoes.find((o) => o.value === v)?.label ?? v).join(", ");
}

function rotulo(
  opcoes: ReadonlyArray<{ value: string; label: string }>,
  value: string | undefined
): string | null {
  if (!value) return null;
  return opcoes.find((o) => o.value === value)?.label ?? value;
}

function linhaNota(titulo: string, valor: number | undefined): string | null {
  if (valor === undefined || valor === null) return null;
  return `${titulo}: ${valor}/10`;
}

function linhaTexto(titulo: string, valor: string | null | undefined): string | null {
  if (!valor || !valor.trim()) return null;
  return `${titulo}: ${valor.trim()}`;
}

/**
 * Monta a mensagem que a aluna manda no WhatsApp da consultoria depois de
 * enviar o formulário. Só entra o que ela respondeu — pergunta pulada não
 * vira linha vazia.
 */
export function montarResumoWhatsApp(
  data: Partial<FeedbackSemanalResponse>,
  produto: FeedbackProdutoConfig
): string {
  const nome = data.nome?.trim() || "Aluna";

  const treino = [
    linhaNota("Técnica, amplitude e cadência", data.treino_execucao),
    linhaTexto(
      "Séries válidas (repetições que ainda dava)",
      rotulo(TREINO_REPS_RESERVA, data.treino_reps_reserva)
    ),
    linhaTexto("Frequência", rotulo(TREINO_FREQUENCIA, data.treino_frequencia_semanal)),
    linhaTexto("Minutos de cardio na semana", rotulo(CARDIO_MINUTOS, data.cardio_minutos_semanais)),
    data.cardio_intensidade !== undefined
      ? `Intensidade do cardio: ${data.cardio_intensidade}/10${
          cardioReferencia(data.cardio_intensidade)
            ? ` (${cardioReferencia(data.cardio_intensidade)})`
            : ""
        }`
      : null,
  ].filter(Boolean) as string[];

  const dieta = [
    linhaNota("Adesão (segunda a segunda)", data.dieta_adesao),
    linhaTexto("Refeições livres na semana", rotulo(DIETA_REFEICOES_FORA, data.dieta_refeicoes_fora)),
    linhaTexto("Beliscando", rotulo(DIETA_BELISCANDO, data.dieta_beliscando)),
  ].filter(Boolean) as string[];

  const geral = [
    linhaTexto("Maior gargalo", rotulosMultiplos(MAIOR_GARGALO, data.maior_gargalo)),
    linhaTexto("Percebe mudança no corpo", rotulo(PERCEBE_MUDANCA, data.percebe_mudanca)),
    linhaTexto("O que está percebendo", data.mudanca_descricao),
    linhaNota("Indicaria o programa", data.programa_indicaria),
    linhaTexto("Sobre o programa", data.consultoria_feedback),
    linhaTexto("O que sente falta, o que pode melhorar", data.consultoria_sente_falta),
  ].filter(Boolean) as string[];

  const partes: string[] = [
    `*Feedback ${produto.nome}*`,
    `Aluna: ${nome}`,
  ];

  if (treino.length > 0) partes.push("", "*TREINO*", ...treino);
  if (dieta.length > 0) partes.push("", "*DIETA*", ...dieta);
  if (geral.length > 0) partes.push("", "*GERAL*", ...geral);

  return partes.join("\n");
}

// Chave do rascunho no localStorage (caso a aluna feche o navegador no meio).
export const FEEDBACK_DRAFT_KEY = "feedback-semanal-draft-v1";

// ---------------------------------------------------------------------------
// Leitura completa de uma resposta (dashboard)
// ---------------------------------------------------------------------------

export interface BlocoResposta {
  etapa: string;
  itens: { label: string; valor: string }[];
}

/**
 * Todas as respostas de uma aluna agrupadas por etapa do formulário, já com os
 * rótulos legíveis. Pergunta não respondida não entra. É o que o dashboard
 * mostra quando o Breno abre "ver todas as respostas".
 */
export function respostasPorEtapa(r: FeedbackSemanalResponse): BlocoResposta[] {
  const nota = (v: number | undefined) => (typeof v === "number" ? `${v}/10` : null);
  const blocos: BlocoResposta[] = [
    {
      etapa: "Treino de força",
      itens: [
        ["Técnica, amplitude e cadência", nota(r.treino_execucao)],
        ["Séries válidas (reps que ainda davam)", rotulo(TREINO_REPS_RESERVA, r.treino_reps_reserva)],
        ["Frequência de treino de força", rotulo(TREINO_FREQUENCIA, r.treino_frequencia_semanal)],
        // Legado: só aparece em respostas antigas.
        ["Progressão de carga (antigo)", nota(r.treino_progressao_carga)],
        ["Séries válidas 0-10 (antigo)", nota(r.treino_series_validas)],
      ],
    },
    {
      etapa: "Cardio",
      itens: [
        ["Minutos de cardio na semana", rotulo(CARDIO_MINUTOS, r.cardio_minutos_semanais)],
        [
          "Intensidade do cardio",
          typeof r.cardio_intensidade === "number"
            ? `${r.cardio_intensidade}/10${
                cardioPercepcao(r.cardio_intensidade) ? `, ${cardioPercepcao(r.cardio_intensidade)}` : ""
              }${cardioReferencia(r.cardio_intensidade) ? ` (${cardioReferencia(r.cardio_intensidade)})` : ""}`
            : null,
        ],
      ],
    },
    {
      etapa: "Dieta",
      itens: [
        ["Adesão (segunda a segunda)", nota(r.dieta_adesao)],
        ["Refeições livres na semana", rotulo(DIETA_REFEICOES_FORA, r.dieta_refeicoes_fora)],
        ["Beliscando", rotulo(DIETA_BELISCANDO, r.dieta_beliscando)],
        ["Dieta no geral (antigo)", nota(r.dieta_nota)],
      ],
    },
    {
      etapa: "Gargalo",
      itens: [
        ["Maior gargalo", rotulosMultiplos(MAIOR_GARGALO, r.maior_gargalo)],
      ],
    },
    {
      etapa: "Corpo e consultoria",
      itens: [
        ["Percebe mudança no corpo", rotulo(PERCEBE_MUDANCA, r.percebe_mudanca)],
        ["O que está percebendo", r.mudanca_descricao?.trim() || null],
        ["Indicaria o programa", nota(r.programa_indicaria)],
        ["O que acha do programa", r.consultoria_feedback?.trim() || null],
        ["O que sente falta, o que pode melhorar", r.consultoria_sente_falta?.trim() || null],
      ],
    },
  ].map((b) => ({
    etapa: b.etapa,
    itens: (b.itens as [string, string | null][])
      .filter(([, v]) => !!v)
      .map(([label, valor]) => ({ label, valor: valor as string })),
  }));

  return blocos.filter((b) => b.itens.length > 0);
}
