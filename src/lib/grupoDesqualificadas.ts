/**
 * Para onde vai a lead desqualificada.
 *
 * Ela termina o formulário, lê "infelizmente você não foi selecionada hoje" e
 * recebe um convite pro grupo. Esse botão apontava pra `/nqualf` — uma rota que
 * nunca existiu, nem neste app nem no site antigo. Desde 1º de setembro, toda
 * desqualificada que clicou caiu num 404 em inglês, no momento de maior
 * intenção que ela ia ter. As poucas que entraram no grupo pegaram o link por
 * fora, pelo disparo.
 *
 * O link vive em `app_settings` pra poder ser trocado na tela de configuração
 * sem publicar o site: convite de grupo do WhatsApp expira e é revogado, e um
 * destino que só se troca com deploy volta a apodrecer calado.
 *
 * A validação mora aqui, longe da tela, pelo mesmo motivo de `destinoDasLeads`:
 * um link quebrado não dá erro nenhum na hora — só manda a lead pro nada, e
 * ninguém descobre até sentir falta dela.
 */

export const CHAVE_GRUPO_DESQUALIFICADAS = "whatsapp_grupo_desqualificadas";

/** Usado enquanto a configuração não existir no banco. */
export const GRUPO_PADRAO = "https://chat.whatsapp.com/Gd73lCBmXo0CHZylIODKhl?mode=gi_t";

/**
 * Problema no link, ou null se estiver bom.
 *
 * Só aceita convite de grupo do WhatsApp: é o único formato que faz o botão
 * cumprir o que a tela promete. Um link de conversa (`wa.me`) abriria o
 * WhatsApp numa conversa com alguém, não no grupo.
 */
export function erroDoLinkDoGrupo(valor: string): string | null {
    const limpo = (valor ?? "").trim();
    if (!limpo) return "Cole o link de convite do grupo, ex: https://chat.whatsapp.com/XXXX.";

    let url: URL;
    try {
        url = new URL(limpo);
    } catch {
        return "Isso não é um endereço válido. Cole o link inteiro, começando com https://.";
    }

    if (url.protocol !== "https:") return "O link precisa começar com https://.";
    if (url.hostname !== "chat.whatsapp.com") {
        return "O link precisa ser um convite de grupo (chat.whatsapp.com), não uma conversa.";
    }
    // O código do convite é o caminho; sem ele o link abre o WhatsApp sem grupo.
    if (url.pathname.replace(/\//g, "").length < 10) {
        return "Falta o código do convite no fim do link.";
    }
    return null;
}

/** O link que vale agora: o do banco quando serve, senão o padrão. */
export function linkDoGrupo(doBanco: string | null | undefined): string {
    const limpo = (doBanco ?? "").trim();
    return erroDoLinkDoGrupo(limpo) === null ? limpo : GRUPO_PADRAO;
}
