/**
 * Qual nome vale: o que esta na consulta ou o que ela preencheu no formulario.
 *
 * A aluna digita o nome completo na pergunta "Qual seu nome completo?", mas a
 * consulta nem sempre nasce com ele: quando o link de agendamento chega sem o
 * nome, a consulta vira "Futura Aluna", e quando a reuniao vem do Calendly o
 * nome e o que ela digitou la, que costuma ser so o primeiro. Esse nome curto
 * atravessa o sistema inteiro: ele e o que aparece no monitoramento de consulta
 * e e o que vira `nome_completo` quando ela e convertida em aluna.
 *
 * A regra e conservadora de proposito: na duvida, NAO troca. Trocar a mais
 * renomeia a pessoa errada na ficha de outra — e isso o time nao tem como
 * perceber olhando a tela.
 */

/** Nomes que o sistema inventa quando nao sabe quem e. */
const PROVISORIOS = ["futura aluna", "sem nome", "lead", "cliente"];

function normalizar(nome: string): string {
    return nome
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function palavras(nome: string): string[] {
    const limpo = normalizar(nome);
    return limpo ? limpo.split(" ") : [];
}

export function ehProvisorio(nome: string | null | undefined): boolean {
    if (!nome || !nome.trim()) return true;
    return PROVISORIOS.includes(normalizar(nome));
}

/**
 * Devolve o nome que deve ficar gravado.
 *
 * Troca em dois casos, e so neles:
 *  - o atual e vazio ou provisorio ("Futura Aluna", "Sem nome");
 *  - o do formulario tem mais palavras E comeca pelo mesmo primeiro nome,
 *    que e o caso de "anna" virar "Anna Beatriz Souza".
 *
 * Nos demais — primeiro nome diferente, ou o atual ja mais completo — mantem o
 * que esta la.
 */
export function melhorNome(
    atual: string | null | undefined,
    doFormulario: string | null | undefined,
): string {
    const formulario = (doFormulario ?? "").trim();
    const existente = (atual ?? "").trim();

    if (!formulario || ehProvisorio(formulario)) return existente;
    if (ehProvisorio(existente)) return formulario;

    const pAtual = palavras(existente);
    const pForm = palavras(formulario);

    if (pForm.length <= pAtual.length) return existente;
    if (pForm[0] !== pAtual[0]) return existente;

    return formulario;
}
