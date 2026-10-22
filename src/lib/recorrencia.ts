// Recorrência de tarefas da agenda, no molde do Calendário do Mac.
//
// Uma tarefa recorrente é UMA linha no banco. A coluna `recurrence` guarda só a
// frequência base (none/daily/weekly/monthly/yearly — é o que a CHECK do banco
// aceita) e o resto da regra mora em `metadata.recorrencia`:
//
//   intervalo  -> a cada N dias/semanas/meses/anos (quinzenal = weekly + 2)
//   fim        -> nunca | até uma data (inclusive) | após N ocorrências
//   excecoes   -> dias (yyyy-MM-dd) apagados com "só este evento"
//
// e `metadata.concluidas` guarda os dias já marcados como feitos, porque numa
// série cada ocorrência é concluída sozinha.
//
// Semântica igual à da RFC 5545 (iCalendar), que é o que o Calendário segue:
//  - mensal no dia 31 pula os meses sem dia 31 (não cai no dia 30);
//  - anual em 29/02 só acontece em ano bissexto;
//  - "após N ocorrências" conta as ocorrências GERADAS; apagar uma com
//    "só este evento" não empurra a série pra frente (EXDATE vem depois do COUNT).
//
// Tarefa antiga (sem metadata.recorrencia) continua funcionando: vira
// intervalo 1, sem fim, sem exceções.

import { addDays, format } from "date-fns";

export type Frequencia = "daily" | "weekly" | "monthly" | "yearly";

export type FimRecorrencia =
    | { tipo: "nunca" }
    | { tipo: "data"; data: string } // yyyy-MM-dd, inclusive
    | { tipo: "ocorrencias"; total: number };

export interface RegraRecorrencia {
    freq: Frequencia;
    intervalo: number;
    fim: FimRecorrencia;
}

/** O que fica em metadata.recorrencia. */
export interface RecorrenciaMeta {
    intervalo?: number;
    fim?: FimRecorrencia;
    excecoes?: string[];
}

/** Recorte mínimo de uma tarefa que este módulo precisa. */
export interface TarefaRecorrente {
    dueDate: string;
    recurrence?: string | null;
    metadata?: Record<string, any> | null;
}

const FREQUENCIAS: ReadonlyArray<string> = ["daily", "weekly", "monthly", "yearly"];

// Teto de segurança pra nenhum laço girar sem fim (regra corrompida no banco,
// intervalo 0, etc). 20 mil passos cobrem 54 anos de "todo dia".
const MAX_PASSOS = 20000;

export function chaveDia(d: Date): string {
    return format(d, "yyyy-MM-dd");
}

/** Converte yyyy-MM-dd em Date local (meia-noite), sem o deslocamento de fuso do `new Date("yyyy-MM-dd")`. */
export function diaDaChave(chave: string): Date {
    const [y, m, d] = chave.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

function inicioDoDia(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function diasNoMes(ano: number, mes: number): number {
    return new Date(ano, mes + 1, 0).getDate();
}

function normalizarIntervalo(n: unknown): number {
    const v = Math.floor(Number(n));
    return Number.isFinite(v) && v >= 1 ? Math.min(v, 999) : 1;
}

function normalizarFim(fim: unknown): FimRecorrencia {
    const f = fim as FimRecorrencia | undefined;
    if (f?.tipo === "data" && typeof f.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.data)) {
        return { tipo: "data", data: f.data };
    }
    if (f?.tipo === "ocorrencias") {
        const total = Math.floor(Number(f.total));
        if (Number.isFinite(total) && total >= 1) return { tipo: "ocorrencias", total: Math.min(total, 5000) };
    }
    return { tipo: "nunca" };
}

/** Lê a regra da tarefa. null = não repete. */
export function regraDaTarefa(t: TarefaRecorrente): RegraRecorrencia | null {
    const freq = t.recurrence ?? "none";
    if (!FREQUENCIAS.includes(freq)) return null;
    const meta = (t.metadata?.recorrencia ?? {}) as RecorrenciaMeta;
    return {
        freq: freq as Frequencia,
        intervalo: normalizarIntervalo(meta.intervalo),
        fim: normalizarFim(meta.fim),
    };
}

export function excecoesDaTarefa(t: TarefaRecorrente): string[] {
    const ex = t.metadata?.recorrencia?.excecoes;
    return Array.isArray(ex) ? ex.filter((x: unknown) => typeof x === "string") : [];
}

export function ehRecorrente(t: TarefaRecorrente): boolean {
    return regraDaTarefa(t) !== null;
}

/**
 * k-ésima data candidata da série (k = 0 é a data original), já com o horário
 * da original. null quando a data não existe naquele período (31 num mês de
 * 30 dias, 29/02 em ano comum) — a ocorrência é pulada e NÃO conta pro total.
 */
function candidata(inicio: Date, regra: RegraRecorrencia, k: number): Date | null {
    const passo = k * regra.intervalo;
    switch (regra.freq) {
        case "daily":
            return addDays(inicio, passo);
        case "weekly":
            return addDays(inicio, passo * 7);
        case "monthly": {
            const mesAbs = inicio.getMonth() + passo;
            const ano = inicio.getFullYear() + Math.floor(mesAbs / 12);
            const mes = ((mesAbs % 12) + 12) % 12;
            if (inicio.getDate() > diasNoMes(ano, mes)) return null;
            return new Date(ano, mes, inicio.getDate(), inicio.getHours(), inicio.getMinutes(), inicio.getSeconds());
        }
        case "yearly": {
            const ano = inicio.getFullYear() + passo;
            if (inicio.getDate() > diasNoMes(ano, inicio.getMonth())) return null;
            return new Date(ano, inicio.getMonth(), inicio.getDate(), inicio.getHours(), inicio.getMinutes(), inicio.getSeconds());
        }
    }
}

/**
 * Percorre a série em ordem e chama `visitar` com cada ocorrência gerada
 * (antes de aplicar exceções). Para quando `visitar` devolve false, quando
 * passa do fim da regra ou do dia `ate`.
 */
function percorrer(
    inicio: Date,
    regra: RegraRecorrencia,
    ate: Date,
    visitar: (d: Date) => boolean,
    desde?: Date,
) {
    const limiteDia = inicioDoDia(ate).getTime();
    const fimData = regra.fim.tipo === "data" ? diaDaChave(regra.fim.data).getTime() : Infinity;
    const total = regra.fim.tipo === "ocorrencias" ? regra.fim.total : Infinity;

    // Sem contagem, dá pra pular direto pra perto de `desde` em diário/semanal
    // (passo fixo em dias), em vez de andar desde a data original.
    let k = 0;
    if (desde && total === Infinity && (regra.freq === "daily" || regra.freq === "weekly")) {
        const passoDias = regra.intervalo * (regra.freq === "weekly" ? 7 : 1);
        const diff = Math.round((inicioDoDia(desde).getTime() - inicioDoDia(inicio).getTime()) / 86400000);
        if (diff > passoDias) k = Math.floor(diff / passoDias) - 1;
    }

    let geradas = 0;
    for (let passos = 0; passos < MAX_PASSOS && geradas < total; passos++, k++) {
        const d = candidata(inicio, regra, k);
        if (!d) continue;
        const dia = inicioDoDia(d).getTime();
        if (dia > limiteDia || dia > fimData) return;
        geradas++;
        if (!visitar(d)) return;
    }
}

/**
 * Ocorrências da tarefa entre `de` e `ate` (dias inclusivos), já sem as
 * exceções. Tarefa que não repete devolve só a própria data, se cair no intervalo.
 */
export function ocorrenciasEntre(t: TarefaRecorrente, de: Date, ate: Date): Date[] {
    const inicio = new Date(t.dueDate);
    if (Number.isNaN(inicio.getTime())) return [];
    const deDia = inicioDoDia(de).getTime();
    const ateDia = inicioDoDia(ate).getTime();
    const regra = regraDaTarefa(t);
    if (!regra) {
        const dia = inicioDoDia(inicio).getTime();
        return dia >= deDia && dia <= ateDia ? [inicio] : [];
    }
    const excecoes = new Set(excecoesDaTarefa(t));
    const out: Date[] = [];
    percorrer(inicio, regra, ate, (d) => {
        if (inicioDoDia(d).getTime() >= deDia && !excecoes.has(chaveDia(d))) out.push(d);
        return true;
    }, de);
    return out;
}

export function ocorreEm(t: TarefaRecorrente, dia: Date): boolean {
    return ocorrenciasEntre(t, dia, dia).length > 0;
}

/** Quantas ocorrências a série GEROU antes do dia (exceções contam, como no COUNT do iCalendar). */
export function ocorrenciasAntesDe(t: TarefaRecorrente, dia: Date): number {
    const regra = regraDaTarefa(t);
    const inicio = new Date(t.dueDate);
    if (!regra) return inicioDoDia(inicio) < inicioDoDia(dia) ? 1 : 0;
    const alvo = inicioDoDia(dia).getTime();
    let n = 0;
    percorrer(inicio, regra, addDays(dia, -1), (d) => {
        if (inicioDoDia(d).getTime() < alvo) n++;
        return true;
    });
    return n;
}

/** metadata.recorrencia a gravar para uma regra (sem exceções). */
export function metaDaRegra(regra: RegraRecorrencia, excecoes: string[] = []): RecorrenciaMeta {
    const meta: RecorrenciaMeta = { intervalo: regra.intervalo, fim: regra.fim };
    if (excecoes.length) meta.excecoes = [...new Set(excecoes)].sort();
    return meta;
}

/** Remove da metadata tudo que é da série (pra uma cópia avulsa). */
export function semDadosDeSerie(metadata: Record<string, any> | null | undefined): Record<string, any> {
    const { recorrencia: _r, concluidas: _c, ...resto } = metadata ?? {};
    return resto;
}

// ---------------------------------------------------------------------------
// Conclusão por ocorrência

export function concluidasDaTarefa(t: TarefaRecorrente): string[] {
    const c = t.metadata?.concluidas;
    return Array.isArray(c) ? c.filter((x: unknown) => typeof x === "string") : [];
}

/** A ocorrência daquele dia está concluída? Tarefa simples usa o status da linha. */
export function ocorrenciaConcluida(t: TarefaRecorrente & { status?: string }, dia: Date): boolean {
    if (!ehRecorrente(t)) return t.status === "completed";
    return concluidasDaTarefa(t).includes(chaveDia(dia));
}

/** Metadata nova com a ocorrência do dia marcada/desmarcada. */
export function alternarConclusao(t: TarefaRecorrente, dia: Date, concluida: boolean): Record<string, any> {
    const k = chaveDia(dia);
    const atual = new Set(concluidasDaTarefa(t));
    if (concluida) atual.add(k);
    else atual.delete(k);
    return { ...(t.metadata ?? {}), concluidas: [...atual].sort() };
}

// ---------------------------------------------------------------------------
// "Só este evento" / "Este e os futuros"

export type Escopo = "este" | "futuros";

/** Metadata da série com aquele dia apagado ("só este evento"). */
export function excluirSoEste(t: TarefaRecorrente, dia: Date): Record<string, any> {
    const k = chaveDia(dia);
    const meta = { ...(t.metadata ?? {}) };
    const rec: RecorrenciaMeta = { ...(meta.recorrencia ?? {}) };
    rec.excecoes = [...new Set([...(rec.excecoes ?? []), k])].sort();
    meta.recorrencia = rec;
    const conc = concluidasDaTarefa(t).filter((c) => c !== k);
    if (conc.length) meta.concluidas = conc;
    else delete meta.concluidas;
    return meta;
}

export interface CorteDeSerie {
    /** null = a ocorrência é a primeira; a série inteira vai junto. */
    antes: { metadata: Record<string, any> } | null;
    /** Regra e dados que a parte "daqui pra frente" herda. */
    depois: { regra: RegraRecorrencia; excecoes: string[]; concluidas: string[] };
}

/**
 * Corta a série no dia: a parte de antes termina na véspera e a parte de
 * depois começa no dia. Com "após N ocorrências", o total se divide entre as
 * duas, pra soma continuar N.
 */
export function cortarSerie(t: TarefaRecorrente, dia: Date): CorteDeSerie {
    const regra = regraDaTarefa(t) ?? { freq: "daily" as Frequencia, intervalo: 1, fim: { tipo: "nunca" } as FimRecorrencia };
    const k = chaveDia(dia);
    const excecoes = excecoesDaTarefa(t);
    const concluidas = concluidasDaTarefa(t);
    const antesN = ocorrenciasAntesDe(t, dia);

    let fimDepois: FimRecorrencia = regra.fim;
    if (regra.fim.tipo === "ocorrencias") {
        fimDepois = { tipo: "ocorrencias", total: Math.max(1, regra.fim.total - antesN) };
    }
    const depois = {
        regra: { ...regra, fim: fimDepois },
        excecoes: excecoes.filter((e) => e >= k),
        concluidas: concluidas.filter((c) => c >= k),
    };

    if (antesN === 0) return { antes: null, depois };

    const fimAntes: FimRecorrencia = regra.fim.tipo === "ocorrencias"
        ? { tipo: "ocorrencias", total: antesN }
        : { tipo: "data", data: chaveDia(addDays(dia, -1)) };
    const meta = { ...(t.metadata ?? {}) };
    meta.recorrencia = metaDaRegra({ ...regra, fim: fimAntes }, excecoes.filter((e) => e < k));
    const concAntes = concluidas.filter((c) => c < k);
    if (concAntes.length) meta.concluidas = concAntes;
    else delete meta.concluidas;
    return { antes: { metadata: meta }, depois };
}

// ---------------------------------------------------------------------------
// Rótulos (formulário e resumo)

export type OpcaoRepetir = "none" | "daily" | "weekly" | "biweekly" | "monthly" | "yearly" | "custom";

export const OPCOES_REPETIR: { valor: OpcaoRepetir; rotulo: string }[] = [
    { valor: "none", rotulo: "Nunca" },
    { valor: "daily", rotulo: "Todo dia" },
    { valor: "weekly", rotulo: "Toda semana" },
    { valor: "biweekly", rotulo: "A cada 2 semanas" },
    { valor: "monthly", rotulo: "Todo mês" },
    { valor: "yearly", rotulo: "Todo ano" },
    { valor: "custom", rotulo: "Personalizado..." },
];

/** Opção do seletor que representa a regra (o inverso de regraDaOpcao). */
export function opcaoDaRegra(regra: RegraRecorrencia | null): OpcaoRepetir {
    if (!regra) return "none";
    if (regra.intervalo === 1) return regra.freq;
    if (regra.freq === "weekly" && regra.intervalo === 2) return "biweekly";
    return "custom";
}

export function regraDaOpcao(
    opcao: OpcaoRepetir,
    fim: FimRecorrencia,
    personalizado?: { freq: Frequencia; intervalo: number },
): RegraRecorrencia | null {
    switch (opcao) {
        case "none":
            return null;
        case "biweekly":
            return { freq: "weekly", intervalo: 2, fim };
        case "custom":
            return {
                freq: personalizado?.freq ?? "daily",
                intervalo: normalizarIntervalo(personalizado?.intervalo),
                fim,
            };
        default:
            return { freq: opcao, intervalo: 1, fim };
    }
}

export function regrasIguais(a: RegraRecorrencia | null, b: RegraRecorrencia | null): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

const UNIDADE: Record<Frequencia, [string, string]> = {
    daily: ["dia", "dias"],
    weekly: ["semana", "semanas"],
    monthly: ["mês", "meses"],
    yearly: ["ano", "anos"],
};

export function rotuloUnidade(freq: Frequencia, n: number): string {
    return UNIDADE[freq][n === 1 ? 0 : 1];
}

/** Ex.: "A cada 2 semanas, 6 vezes" / "Todo mês, até 31/12/2026". */
export function resumoDaRegra(regra: RegraRecorrencia | null): string {
    if (!regra) return "Não repete";
    const op = opcaoDaRegra(regra);
    const base = op === "custom"
        ? `A cada ${regra.intervalo} ${rotuloUnidade(regra.freq, regra.intervalo)}`
        : OPCOES_REPETIR.find((o) => o.valor === op)!.rotulo;
    if (regra.fim.tipo === "data") return `${base}, até ${format(diaDaChave(regra.fim.data), "dd/MM/yyyy")}`;
    if (regra.fim.tipo === "ocorrencias") return `${base}, ${regra.fim.total} ${regra.fim.total === 1 ? "vez" : "vezes"}`;
    return base;
}
