import { supabase } from "@/integrations/supabase/client";
import { CollaboratorTask } from "./taskTypes";
import { chaveDeduplicacao } from "./avisoAluna";
import {
    AGENDA_ALUNAS_MODULE,
    AGENDA_CONTEUDO_MODULE,
    TIPOS_CAMADA_ALUNAS,
    filtroDaAgenda,
    podeVerTarefa,
    type AcessoAgenda,
} from "./agendaCamadas";
import {
    alternarConclusao,
    cortarSerie,
    ehRecorrente,
    excluirSoEste,
    metaDaRegra,
    ocorrenciaConcluida,
    semDadosDeSerie,
    type Escopo,
} from "./recorrencia";

function fromDbRow(row: any): CollaboratorTask {
    return {
        id: row.id,
        userId: row.user_id,
        createdBy: row.created_by,
        title: row.title,
        description: row.description,
        dueDate: row.due_date,
        status: row.status as any,
        type: row.type as any,
        recurrence: (row.recurrence as any) ?? 'none',
        metadata: row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export { AGENDA_ALUNAS_MODULE, AGENDA_CONTEUDO_MODULE } from "./agendaCamadas";
const ALUNA_TASK_TYPES = TIPOS_CAMADA_ALUNAS;

/**
 * Camadas liberadas para o dono da agenda (linhas em user_modules + papel de
 * admin). Falha de leitura vira "sem camada extra" em vez de derrubar a agenda.
 */
export async function fetchAcessoAgenda(userId: string): Promise<AcessoAgenda> {
    const [mods, roles] = await Promise.all([
        supabase
            .from("user_modules")
            .select("module")
            .eq("user_id", userId)
            .in("module", [AGENDA_ALUNAS_MODULE, AGENDA_CONTEUDO_MODULE]),
        supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin"),
    ]);
    return {
        isAdmin: !roles.error && (roles.data ?? []).length > 0,
        modulos: mods.error ? [] : (mods.data ?? []).map((m: any) => m.module),
    };
}

export async function fetchTasks(userId?: string): Promise<CollaboratorTask[]> {
    let query = supabase.from("collaborator_tasks" as any).select("*");

    // Quem foi liberado pelo admin vê também as camadas compartilhadas:
    // reavaliações/liberações das alunas e/ou a agenda de Conteúdo.
    const acesso = userId ? await fetchAcessoAgenda(userId) : null;
    if (userId && acesso) {
        query = query.or(filtroDaAgenda(userId, acesso));
    }

    const { data, error } = await query.order("due_date", { ascending: true });
    if (error) throw error;

    // Esconde tasks de alunas inativas/canceladas: quando a aluna sai do plano,
    // nenhuma reavaliação/liberação/cobrança dela deve poluir a agenda do time.
    const { data: deadAlunas } = await supabase
        .from("alunas" as any)
        .select("id")
        .in("status", ["inativa", "cancelada"]);
    const deadIds = new Set((deadAlunas || []).map((a: any) => a.id));

    const seen = new Set<string>();
    return (data || [])
        .map(fromDbRow)
        .filter((t) => {
            // Camada de Conteúdo é fechada: sem a liberação, não aparece.
            if (userId && acesso && !podeVerTarefa(t, userId, acesso)) return false;
            const alunaId = t.metadata?.alunaId;
            if (alunaId && deadIds.has(alunaId)) return false;
            // Evita duplicar a mesma tarefa da aluna vinda de agendas diferentes
            if (alunaId && ALUNA_TASK_TYPES.includes(t.type)) {
                const k = chaveDeduplicacao(t);
                if (seen.has(k)) return false;
                seen.add(k);
            }
            return true;
        });
}

// Salva o "outcome" do contato do time com a aluna SEM tocar nos outros campos.
// Mantém histórico no metadata; status vai pra 'completed' (qualquer outcome
// significa "tratado") ou volta pra 'pending' (outcome=null = desmarcar).
export type TaskOutcome = "fez" | "nao_fez" | "aguardando_resposta" | null;

export async function updateTaskOutcome(id: string, outcome: TaskOutcome): Promise<void> {
    const { data: current, error: fetchErr } = await supabase
        .from("collaborator_tasks" as any)
        .select("metadata")
        .eq("id", id)
        .maybeSingle();
    if (fetchErr) throw fetchErr;

    const meta = (current as any)?.metadata ?? {};
    const newMeta = outcome === null
        ? Object.fromEntries(Object.entries(meta).filter(([k]) => k !== "outcome"))
        : { ...meta, outcome };

    const { error } = await supabase
        .from("collaborator_tasks" as any)
        .update({
            metadata: newMeta,
            status: outcome === "fez" || outcome === "nao_fez" ? "completed" : "pending",
        })
        .eq("id", id);
    if (error) throw error;
}

const DEDUPE_TYPES: ReadonlyArray<string> = ["reavaliacao", "liberacao", "residuo"];

export async function upsertTask(task: Partial<CollaboratorTask>): Promise<void> {
    // Dedupe: tasks automáticas (reavaliação/liberação/cobrança de resíduo) só podem
    // existir uma vez por (user, tipo, aluna|consulta). Antes de criar uma nova,
    // apaga as anteriores do mesmo alvo pra não acumular pontos duplicados na agenda.
    if (
        task.userId &&
        task.type &&
        DEDUPE_TYPES.includes(task.type) &&
        (task.metadata?.alunaId || task.metadata?.consultationId)
    ) {
        let del = supabase
            .from("collaborator_tasks" as any)
            .delete()
            .eq("user_id", task.userId)
            .eq("type", task.type);
        if (task.metadata.alunaId) {
            del = del.eq("metadata->>alunaId", task.metadata.alunaId);
        }
        if (task.metadata.consultationId) {
            del = del.eq("metadata->>consultationId", task.metadata.consultationId);
        }
        if (task.id) {
            del = del.neq("id", task.id);
        }
        await del;
    }

    const { error } = await supabase
        .from("collaborator_tasks" as any)
        .upsert({
            id: task.id,
            user_id: task.userId,
            title: task.title,
            description: task.description,
            due_date: task.dueDate,
            status: task.status,
            type: task.type,
            recurrence: task.recurrence ?? 'none',
            metadata: task.metadata,
        });
    if (error) throw error;
}

export async function updateTaskStatus(id: string, status: 'pending' | 'completed'): Promise<void> {
    const { error } = await supabase
        .from("collaborator_tasks" as any)
        .update({ status })
        .eq("id", id);
    if (error) throw error;
}

export async function deleteTask(id: string): Promise<void> {
    const { error } = await supabase
        .from("collaborator_tasks" as any)
        .delete()
        .eq("id", id);
    if (error) throw error;
}

async function updateTaskMetadata(id: string, metadata: Record<string, any>): Promise<void> {
    const { error } = await supabase
        .from("collaborator_tasks" as any)
        .update({ metadata })
        .eq("id", id);
    if (error) throw error;
}

/** Marca/desmarca UMA ocorrência de tarefa recorrente (as outras não mudam). */
export async function setOccurrenceDone(task: CollaboratorTask, dia: Date, concluida: boolean): Promise<void> {
    await updateTaskMetadata(task.id, alternarConclusao(task, dia, concluida));
}

/**
 * Excluir pelo jeito do Calendário do Mac. Tarefa simples: apaga a linha.
 * "este": a série ganha uma exceção naquele dia. "futuros": a série termina na
 * véspera (se o dia era o primeiro, a série inteira vai embora).
 */
export async function deleteOccurrence(task: CollaboratorTask, dia: Date, escopo: Escopo): Promise<void> {
    if (!ehRecorrente(task)) return deleteTask(task.id);
    if (escopo === "este") return updateTaskMetadata(task.id, excluirSoEste(task, dia));
    const corte = cortarSerie(task, dia);
    if (!corte.antes) return deleteTask(task.id);
    return updateTaskMetadata(task.id, corte.antes.metadata);
}

/**
 * Salvar edição de uma ocorrência de série.
 *  - "este": cria uma tarefa avulsa com os dados novos e tira o dia da série.
 *  - "futuros": a série antiga termina na véspera e nasce uma nova a partir do
 *    dia com os dados novos. Se a regra de repetição não foi mexida, a nova
 *    herda o que sobrou (ex.: 10 vezes, 4 já passaram -> 6 vezes).
 * `novo` vem do formulário, já com recurrence/metadata da regra escolhida.
 */
export async function saveOccurrence(
    task: CollaboratorTask,
    dia: Date,
    escopo: Escopo,
    novo: Partial<CollaboratorTask>,
    regraAlterada: boolean,
): Promise<void> {
    if (escopo === "este") {
        await upsertTask({
            ...novo,
            id: undefined,
            recurrence: "none",
            status: ocorrenciaConcluida(task, dia) ? "completed" : "pending",
            metadata: { ...semDadosDeSerie(novo.metadata), serieOrigemId: task.id },
        });
        await updateTaskMetadata(task.id, excluirSoEste(task, dia));
        return;
    }

    const corte = cortarSerie(task, dia);
    let metadata = { ...(novo.metadata ?? {}) };
    if (!regraAlterada) {
        metadata.recorrencia = metaDaRegra(corte.depois.regra, corte.depois.excecoes);
        if (corte.depois.concluidas.length) metadata.concluidas = corte.depois.concluidas;
        else delete metadata.concluidas;
    } else {
        metadata = semDadosDeSerie(metadata);
        if (novo.metadata?.recorrencia) metadata.recorrencia = novo.metadata.recorrencia;
    }

    if (!corte.antes) {
        await upsertTask({ ...novo, id: task.id, status: "pending", metadata });
        return;
    }
    await upsertTask({ ...novo, id: undefined, status: "pending", metadata });
    await updateTaskMetadata(task.id, corte.antes.metadata);
}
