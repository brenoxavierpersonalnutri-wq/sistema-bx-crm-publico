import { DOMINIO_PUBLICO } from "@/lib/linkPublico";

/**
 * Os links rastreados que a parceira recebe pra divulgar.
 *
 * Isto morava solto dentro da tela de parcerias, com o domínio escrito à mão —
 * e escrito errado: "novav.com.br", um "a" a menos que o novaav e sem o
 * brenoxavier. Esse endereço não aponta pra servidor nenhum, então cada link
 * entregue a uma influencer desde julho levava a seguidora pra uma página de
 * erro. A lead não chegava torta no relatório: ela não chegava.
 *
 * Mora aqui agora porque um endereço que ninguém testa é um endereço que
 * apodrece calado. O domínio vem de `linkPublico`, que é o mesmo do resto do
 * app, e os testes prendem o formato.
 */

/** O apelido da parceira que vai no utm_source: só letras, números e traço. */
export function apelidoDaParceira(instagram: string): string {
    return (instagram || "")
        .toLowerCase()
        .replace(/^@/, "")
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

export interface LinksDaParceria {
    avaliacao: string;
    individual: string;
}

/**
 * Os dois links da parceira, já com as UTMs que identificam de quem veio a lead.
 *
 * A avaliação leva o caminho `/avaliacao`: no site antigo o formulário ficava na
 * raiz, e por isso o link vinha sem caminho nenhum — mas na raiz deste app mora
 * a tela logada, então um link sem caminho jogaria a seguidora no login.
 */
export function linksDaParceria(instagram: string): LinksDaParceria {
    const apelido = apelidoDaParceira(instagram) || "parceira";
    const utms = `utm_source=${apelido}&utm_medium=parceria&utm_campaign=influencer`;
    return {
        avaliacao: `${DOMINIO_PUBLICO}/avaliacao?${utms}`,
        individual: `${DOMINIO_PUBLICO}/individual?${utms}`,
    };
}
