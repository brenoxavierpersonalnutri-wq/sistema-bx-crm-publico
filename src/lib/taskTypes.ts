export type TaskStatus = 'pending' | 'completed';
// 'meta' = objetivo do colaborador (maior fôlego que tarefa avulsa).
// Mesma tabela; visualizado separado no checklist.
// 'conteudo' = camada da agenda do time de conteúdo e criativo (liberada por
// pessoa em "Quem tem acesso"; ver lib/agendaCamadas.ts).
// 'aviso' = criado pelo banco quando a aluna envia anamnese ou feedback
// (ver lib/avisoAluna.ts); camada Reavaliações.
export type TaskType = 'manual' | 'reavaliacao' | 'liberacao' | 'residuo' | 'meta' | 'conteudo' | 'aviso';
export type TaskRecurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
    manual: 'Tarefa',
    meta: 'Meta',
    reavaliacao: 'Reavaliação',
    liberacao: 'Liberação',
    residuo: 'Cobrar Restante',
    conteudo: 'Conteúdo',
    aviso: 'Aviso da aluna',
};

export const TASK_TYPE_COLORS: Record<TaskType, string> = {
    manual: 'bg-purple-500',
    meta: 'bg-amber-500',
    reavaliacao: 'bg-orange-500',
    liberacao: 'bg-blue-500',
    residuo: 'bg-emerald-500',
    conteudo: 'bg-pink-500',
    aviso: 'bg-cyan-600',
};

export const RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
    none: 'Nunca',
    daily: 'Todos os dias',
    weekly: 'Todas as semanas',
    monthly: 'Todos os meses',
    yearly: 'Todos os anos',
};

export interface CollaboratorTask {
    id: string;
    userId: string;
    createdBy: string | null;
    title: string;
    description: string | null;
    dueDate: string;
    status: TaskStatus;
    type: TaskType;
    recurrence: TaskRecurrence;
    metadata: {
        alunaId?: string;
        alunaNome?: string;
        type?: string;
        consultationId?: string;
        /** Aviso: uma por resposta ('anamnese:<id>' / 'feedback:<id>'). */
        avisoChave?: string;
        origem?: 'anamnese' | 'feedback';
        outcome?: 'fez' | 'nao_fez' | 'aguardando_resposta';
        /** Resto da regra de repetição (intervalo, fim, exceções). Ver lib/recorrencia.ts. */
        recorrencia?: import('./recorrencia').RecorrenciaMeta;
        /** Dias (yyyy-MM-dd) concluídos numa tarefa recorrente. */
        concluidas?: string[];
        /** Tarefa de dia inteiro: a hora do due_date não é mostrada. */
        diaInteiro?: boolean;
        /** Cópia avulsa criada ao editar "só este evento" de uma série. */
        serieOrigemId?: string;
        [k: string]: any;
    };
    createdAt: string;
    updatedAt: string;
}

export interface CreateTaskInput {
    userId: string;
    title: string;
    description?: string;
    dueDate: string;
    type?: TaskType;
    recurrence?: TaskRecurrence;
    metadata?: any;
}
