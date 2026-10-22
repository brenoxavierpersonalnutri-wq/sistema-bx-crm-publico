/**
 * Para onde vai a lead qualificada, e o que vale como número válido.
 *
 * Ela sai do formulário para o WhatsApp do time, com as respostas dela na
 * mensagem. O número vive em `app_settings`, para poder ser trocado na tela da
 * agenda sem publicar o site.
 *
 * A validação mora aqui, longe da tela, porque errar nela é caro de um jeito
 * silencioso: um número mal formado não dá erro nenhum na hora — só manda a
 * lead para um WhatsApp que não existe, e ninguém descobre até sentir falta
 * dela.
 *
 * A desqualificada tem destino próprio, em `grupoDesqualificadas`: o grupo do
 * WhatsApp. Este comentário dizia que ela ia para /nqualf, "um link do Rotator
 * cujo destino se troca no banco" — não se trocava: /nqualf nunca foi rota e
 * dava 404 desde setembro.
 */

export const CHAVE_WHATSAPP_DO_TIME = "sdr_whatsapp_phone";

/** Usado enquanto a configuração não existir no banco. */
export const WHATSAPP_DO_TIME_PADRAO = "5531990000104";

export function soDigitos(valor: string): string {
    return (valor ?? "").replace(/\D/g, "");
}

/**
 * Problema no número, ou null se estiver bom.
 * Exige DDI 55 + DDD + número: com menos que isso o link do WhatsApp abre numa
 * conversa vazia, sem erro visível.
 */
export function erroDoNumero(valor: string): string | null {
    const digitos = soDigitos(valor);
    if (!digitos) return "Digite o número com DDI e DDD, ex: 5531990000104.";
    if (!digitos.startsWith("55")) return "O número precisa começar com 55 (DDI do Brasil).";
    if (digitos.length < 12) return "Número curto demais. Use DDI + DDD + número, ex: 5531990000104.";
    if (digitos.length > 13) return "Número comprido demais. Confira os dígitos.";
    return null;
}

/** O número que vale agora: o do banco quando serve, senão o padrão. */
export function whatsappDoTime(doBanco: string | null | undefined): string {
    const digitos = soDigitos(doBanco ?? "");
    return erroDoNumero(digitos) === null ? digitos : WHATSAPP_DO_TIME_PADRAO;
}
