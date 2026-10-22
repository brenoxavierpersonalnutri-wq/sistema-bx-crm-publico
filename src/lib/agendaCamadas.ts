// Camadas compartilhadas da agenda.
//
// Cada pessoa vê as próprias tarefas. Além disso, o admin libera "camadas"
// compartilhadas por pessoa na lista "Quem tem acesso" (Área do Usuário):
//
//  - Reavaliações (módulo `agenda-alunas`): reavaliações, liberações,
//    cobranças de restante e avisos (anamnese/feedback enviados) de TODAS
//    as alunas, não só as da pessoa.
//  - Conteúdo (módulo `agenda-conteudo`): a agenda do time de conteúdo e
//    criativo. Tarefas do tipo `conteudo`, de quem quer que seja.
//
// As duas liberações moram no mesmo lugar: uma linha em `user_modules`
// (user_id, module). No banco, as policies de `collaborator_tasks` usam
// `has_module(auth.uid(), '<módulo>')` pra abrir a leitura/escrita da camada.
//
// Diferença proposital entre as duas: a camada de Conteúdo é FECHADA — quem
// não tem a liberação (e não é admin) não vê nem cria tarefa de conteúdo,
// mesmo que alguém tenha atribuído uma a ela. Reavaliações continua como era:
// a pessoa sempre vê as que são dela.

export const AGENDA_ALUNAS_MODULE = "agenda-alunas";
export const AGENDA_CONTEUDO_MODULE = "agenda-conteudo";

export const TIPOS_CAMADA_ALUNAS: ReadonlyArray<string> = ["reavaliacao", "liberacao", "residuo", "aviso"];
export const TIPOS_CAMADA_CONTEUDO: ReadonlyArray<string> = ["conteudo"];

export interface AcessoAgenda {
    isAdmin: boolean;
    modulos: ReadonlyArray<string>;
}

export function temCamadaAlunas(a: AcessoAgenda): boolean {
    return a.modulos.includes(AGENDA_ALUNAS_MODULE);
}

/** Vê e cria na camada de Conteúdo: quem foi liberado ou é admin. */
export function temCamadaConteudo(a: AcessoAgenda): boolean {
    return a.isAdmin || a.modulos.includes(AGENDA_CONTEUDO_MODULE);
}

/** Tipos que a pessoa vê de TODO o time (além das próprias tarefas). */
export function tiposCompartilhados(a: AcessoAgenda): string[] {
    return [
        ...(temCamadaAlunas(a) ? TIPOS_CAMADA_ALUNAS : []),
        ...(temCamadaConteudo(a) ? TIPOS_CAMADA_CONTEUDO : []),
    ];
}

/** A tarefa aparece na agenda de `donoAgenda`, que tem o acesso `a`? */
export function podeVerTarefa(
    tarefa: { userId: string; type: string },
    donoAgenda: string,
    a: AcessoAgenda,
): boolean {
    if (TIPOS_CAMADA_CONTEUDO.includes(tarefa.type)) return temCamadaConteudo(a);
    if (tarefa.userId === donoAgenda) return true;
    return tiposCompartilhados(a).includes(tarefa.type);
}

/** Pode criar/editar tarefa daquele tipo pelo formulário? */
export function podeCriarTipo(tipo: string, a: AcessoAgenda): boolean {
    if (TIPOS_CAMADA_CONTEUDO.includes(tipo)) return temCamadaConteudo(a);
    return true;
}

/** Filtro `or` do PostgREST pra buscar a agenda de `userId`. */
export function filtroDaAgenda(userId: string, a: AcessoAgenda): string {
    const tipos = tiposCompartilhados(a);
    return tipos.length
        ? `user_id.eq.${userId},type.in.(${tipos.join(",")})`
        : `user_id.eq.${userId}`;
}
