// Código de pareamento do WhatsApp (entrar com número de telefone, alternativa ao QR).
// Lógica pura (sem Deno, sem rede): usada pela whatsapp-qr ({acao:"codigo"}) e testada no vitest.

/**
 * Validade que a tela mostra. O WhatsApp não devolve a validade junto com o código. No whatsapp-web.js
 * (motor das sessões da instância principal do OpenWA) o código é pedido com a página ainda em modo QR:
 * a página continua trocando o QR (Client.js chama refreshQR em UNPAIRED_IDLE quando o cliente não nasceu
 * com pairWithPhoneNumber) e o OpenWA mediu recargas da página a cada ~20 s enquanto não pareado
 * (wwebjs-lifecycle.ts:1171, engine-capability-matrix.ts:317-319). O estado do código vive nessa página, então
 * ele pode morrer bem antes dos 3 min do WhatsApp. 60 s é o teto honesto: a tela pede para digitar já e
 * oferece "gerar outro" (20/10/2026, caso Sabrina: "Não foi possível conectar o dispositivo").
 */
export const VALIDADE_CODIGO_SEGUNDOS = 60;

/** Prazo da chamada ao proxy: o OpenWA tenta até 4x15 s + 3x3 s enquanto a página do QR recarrega. */
export const PRAZO_CODIGO_MS = 85_000;

/**
 * Telefone para o pareamento: só dígitos, com DDI. Brasil (55) exige DDD + 8 ou 9 dígitos (12-13 no total);
 * outro país, 10-15 dígitos. Devolve os dígitos ou null.
 */
export function telefonePareamento(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = String(v).replace(/\D/g, "");
  if (!/^\d{10,15}$/.test(d)) return null;
  if (d.startsWith("55")) return d.length === 12 || d.length === 13 ? d : null;
  return d;
}

/**
 * Telefone no formato em que o WhatsApp registra a conta (o código é amarrado a esse número exato).
 * Celular do Brasil: DDD 11 a 28 tem o 9 no id da conta (13 dígitos); DDD 31 em diante NÃO tem
 * (12 dígitos: 55 + DDD + 8). Prova na casa: closer e comercial-fit-2 (DDD 31) estão no OpenWA como
 * 5531 + 8 dígitos. Fixo (8 dígitos começando com 2-5) e outros países passam como vieram.
 */
export function telefoneWhatsapp(t: string): string {
  const d = String(t ?? "").replace(/\D/g, "");
  if (!d.startsWith("55")) return d;
  const ddd = Number(d.slice(2, 4));
  const local = d.slice(4);
  if (ddd >= 31 && local.length === 9 && local[0] === "9" && /^[6-9]/.test(local.slice(1))) return `55${d.slice(2, 4)}${local.slice(1)}`;
  if (ddd >= 11 && ddd <= 28 && local.length === 8 && /^[6-9]/.test(local)) return `55${d.slice(2, 4)}9${local}`;
  return d;
}

/**
 * Sessão do pedido de código: OBRIGATÓRIA e nunca a padrão. Sem isso o corpo ao proxy sai sem `sessao` e o
 * proxy cai na sessão padrão (closer, o número pessoal do Breno): o código nasce na sessão errada e o celular
 * responde "Não foi possível conectar" (20/10/2026). A padrão continua conectando pelo QR.
 */
export function sessaoDoPedidoDeCodigo(
  sessao: unknown,
  padrao: string,
): { sessao: string } | { status: number; error: string } {
  const s = typeof sessao === "string" ? sessao.trim().toLowerCase() : "";
  if (!s) return { status: 400, error: "Pedido sem a sessão do número. Feche e abra de novo o Conectar do número certo." };
  if (s === padrao.trim().toLowerCase()) {
    return { status: 409, error: `O número da sessão padrão ("${s}") conecta só pelo QR code.` };
  }
  return { sessao: s };
}

/** Código devolvido pelo proxy: 8 letras/números, maiúsculo, sem hífen. Senão null. */
export function codigoPareamentoValido(v: unknown): string | null {
  const c = typeof v === "string" ? v.replace(/[\s-]/g, "").toUpperCase() : "";
  return /^[A-Z0-9]{8}$/.test(c) ? c : null;
}

/** Erro do proxy/OpenWA no pedido do código -> mensagem em português para a tela. */
export function mensagemErroCodigo(status: number, detalhe: unknown): string {
  const d = (detalhe && typeof detalhe === "object" ? detalhe : {}) as Record<string, unknown>;
  const statusOpenwa = typeof d.status === "number" ? d.status : null;
  if (status === 404 && d.error === "não existe") {
    return "A ponte da VPS ainda não tem o pedido de código (falta aplicar a atualização do proxy). Use o QR code por enquanto.";
  }
  if (status === 429) {
    const espera = segundosDeEspera(d.retryAfter);
    // 429 do throttler do OpenWA (error "openwa") não é limite de códigos: é a VPS segurando consultas
    if (d.error === "openwa") return `O WhatsApp da VPS está segurando pedidos agora. Tente de novo em ${textoEspera(espera ?? 60)}.`;
    return `Muitos códigos pedidos em pouco tempo. Tente de novo em ${textoEspera(espera ?? 60)}.`;
  }
  if (status === 409) return "A sessão não está esperando pareamento agora. Aguarde o QR code aparecer na outra aba e tente de novo.";
  if (status === 400) {
    if (d.error === "phone") return "Número inválido: confira o DDI e o DDD.";
    return "O WhatsApp recusou o pedido: a sessão pode já estar conectada ou não foi iniciada.";
  }
  if (status === 503 && d.error === "sessão sem chave no proxy") return "Esta sessão ainda não está liberada na ponte da VPS.";
  if (statusOpenwa === 503) return "O WhatsApp Web estava recarregando. Tente de novo em alguns segundos.";
  return "Não consegui gerar o código agora. Tente de novo ou use o QR code.";
}

/** retryAfter (segundos) do corpo do proxy: inteiro positivo ou null. */
export function segundosDeEspera(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/** "45 s", "2 min", "40 min". */
export function textoEspera(segundos: number): string {
  const s = Math.max(1, Math.ceil(segundos));
  return s < 90 ? `${s} s` : `${Math.ceil(s / 60)} min`;
}

/** Espera antes de reler o status que voltou 429 (uma vez só; mais que isso o pedido segue sem o status). */
export const ESPERA_RELER_STATUS_MS = 1_500;
/** retryAfter acima disto não compensa esperar: o pedido do código segue sem o status. */
export const TETO_ESPERA_STATUS_S = 2;

/**
 * Leitura de status antes do pedido de código. O status é só uma conferência (já conectado? esperando QR?):
 * o próprio OpenWA recusa o código quando a sessão não está esperando pareamento (400/409, com mensagem).
 * Então um 429 no status (limite de consultas) NÃO pode barrar o código (20/10/2026, caso Sabrina: o throttler
 * do OpenWA bloqueou o GET de status por 1 h e a tela dizia "Não consegui falar com a ponte da VPS").
 * Relê uma vez depois de ESPERA_RELER_STATUS_MS; se ainda vier 429, devolve state "desconhecido" e segue.
 * Outras falhas (proxy fora, 5xx) continuam barrando, com mensagem.
 */
export async function lerStatusParaCodigo(
  ler: () => Promise<unknown>,
  esperar: (ms: number) => Promise<void>,
): Promise<{ state: string; limitado: boolean } | { erro: { status: number; detalhe: unknown } }> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const st = (await ler()) as Record<string, unknown> | null;
      return { state: typeof st?.status === "string" ? st.status : "desconhecido", limitado: false };
    } catch (e) {
      const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : 502;
      const detalhe = (e as { detalhe?: unknown })?.detalhe ?? null;
      if (status !== 429) return { erro: { status, detalhe } };
      const d = (detalhe && typeof detalhe === "object" ? detalhe : {}) as Record<string, unknown>;
      const espera = segundosDeEspera(d.retryAfter);
      if (tentativa === 0 && (espera === null || espera <= TETO_ESPERA_STATUS_S)) {
        await esperar(ESPERA_RELER_STATUS_MS);
        continue;
      }
      return { state: "desconhecido", limitado: true };
    }
  }
  return { state: "desconhecido", limitado: true };
}

/** Falha (não 429) ao ler o status antes do código -> mensagem real para a tela. */
export function mensagemErroStatusCodigo(status: number, detalhe: unknown): string {
  const d = (detalhe && typeof detalhe === "object" ? detalhe : {}) as Record<string, unknown>;
  if (status === 401) return "A ponte da VPS recusou a assinatura do CRM (segredo do proxy diferente). Avise o suporte.";
  if (status === 503 && d.error === "sessão sem chave no proxy") return "Esta sessão ainda não está liberada na ponte da VPS.";
  if (status === 404) return "A sessão deste número não existe no OpenWA da VPS.";
  if (status === 504 || status === 502) return "A ponte da VPS não respondeu a tempo. Tente de novo em alguns segundos.";
  return `Não consegui falar com a ponte da VPS agora (erro ${status}). Tente de novo em alguns segundos.`;
}

/** Sessão (de outro cartão) em que este telefone já está gravado como conectado, ou null. */
export function sessaoQueJaTemOTelefone(
  telefone: string,
  sessao: string,
  numeros: { telefone: string | null; sessao_openwa: string | null }[],
): string | null {
  // compara no formato do WhatsApp: "5531 9xxxx-xxxx" digitado e "5531 xxxx-xxxx" gravado são o mesmo número
  const alvo = telefoneWhatsapp(telefone);
  for (const n of numeros) {
    const t = String(n.telefone ?? "").replace(/\D/g, "");
    if (t && telefoneWhatsapp(t) === alvo && n.sessao_openwa && n.sessao_openwa !== sessao) return n.sessao_openwa;
  }
  return null;
}
