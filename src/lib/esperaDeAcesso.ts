/**
 * As duas regras da espera que antecede qualquer tela logada.
 *
 * Entrar no sistema exige validar a sessão e carregar perfil, papéis e módulos.
 * Isso leva de alguns milissegundos a, no pior caso, os 15 segundos do limite
 * de tempo. O que a pessoa via nesse intervalo era uma página branca com um
 * giro no meio — sem uma palavra escrita e sem nada pra clicar. Não dá pra
 * distinguir "está carregando" de "caiu", então a conclusão é sempre a mesma:
 * o site não abre. Foi exatamente o que a equipe relatou.
 *
 * Aqui ficam as duas decisões que resolviam isso, separadas da tela pra poder
 * testar sem navegador.
 */

/** Antes disso não mostra nada: carregamento rápido não deve piscar. */
export const MS_ATE_O_GIRO = 400;

/** Depois disso a espera deixa de ser silenciosa e passa a se explicar. */
export const MS_ATE_EXPLICAR = 4_000;

export type FaseDaEspera = "quieto" | "girando" | "explicando";

/**
 * Em que fase a espera está, dado quanto tempo já passou.
 *
 * O "explicando" chega bem antes do limite de 15s de propósito: a mensagem
 * precisa aparecer enquanto a pessoa ainda está olhando, não depois de ela
 * desistir.
 */
export function faseDaEspera(decorridoMs: number): FaseDaEspera {
    if (decorridoMs >= MS_ATE_EXPLICAR) return "explicando";
    if (decorridoMs >= MS_ATE_O_GIRO) return "girando";
    return "quieto";
}

/**
 * Se um evento de autenticação deve refazer a carga inteira (e portanto voltar
 * a tela pro estado de espera) ou se basta atualizar a sessão em silêncio.
 *
 * O `idEmAndamento` é o usuário que já está sendo tratado. Enquanto o perfil
 * não voltava, esse registro ficava vazio — só era preenchido no sucesso —, e
 * aí todo evento do MESMO usuário caía no caminho completo e zerava a espera.
 * Com a sessão expirando, os eventos chegam de novo e de novo: a tela voltava
 * pro branco a cada um, e o giro não terminava nunca. Era o "login infinito".
 */
export function deveRecarregarTudo(
    evento: string,
    idDoEvento: string | null | undefined,
    idEmAndamento: string | null,
): boolean {
    // Sem usuário no evento é saída: precisa limpar o estado e ir pro login.
    if (!idDoEvento) return true;

    // Sair e trocar de dados do usuário mudam o que a tela pode mostrar.
    if (evento === "SIGNED_OUT" || evento === "USER_UPDATED") return true;

    // Mesmo usuário que já está sendo tratado: só guarda a sessão nova.
    // A tela segue como está — inclusive a de erro, que tem o botão de tentar
    // de novo e perde a utilidade se for substituída por um giro.
    if (idDoEvento === idEmAndamento) return false;

    return true;
}
