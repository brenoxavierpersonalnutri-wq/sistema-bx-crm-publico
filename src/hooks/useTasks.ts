import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    fetchTasks,
    upsertTask,
    updateTaskStatus,
    updateTaskOutcome,
    deleteTask,
    setOccurrenceDone,
    deleteOccurrence,
    saveOccurrence,
    type TaskOutcome,
} from "@/lib/taskStore";
import type { Escopo } from "@/lib/recorrencia";
import { CollaboratorTask } from "@/lib/taskTypes";
import { useToast } from "@/hooks/use-toast";

export function useTasks(userId?: string) {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const query = useQuery({
        queryKey: ["tasks", userId],
        queryFn: () => fetchTasks(userId),
    });

    const updateMutation = useMutation({
        mutationFn: (task: Partial<CollaboratorTask>) => upsertTask(task),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
            toast({ title: "Agenda atualizada", description: "Tarefa salva com sucesso." });
        },
        onError: (err: any) => {
            toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
        },
    });

    const statusMutation = useMutation({
        mutationFn: ({ id, status }: { id: string, status: 'pending' | 'completed' }) => updateTaskStatus(id, status),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
        },
        onError: (err: any) => {
            toast({ title: "Erro ao atualizar status", description: err.message, variant: "destructive" });
        },
    });

    const outcomeMutation = useMutation({
        mutationFn: ({ id, outcome }: { id: string; outcome: TaskOutcome }) =>
            updateTaskOutcome(id, outcome),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
        },
        onError: (err: any) => {
            toast({ title: "Erro ao atualizar", description: err.message, variant: "destructive" });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteTask(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
            toast({ title: "Tarefa removida", description: "A tarefa foi excluída da agenda." });
        },
        onError: (err: any) => {
            toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
        },
    });

    // Conclusão de UMA ocorrência de tarefa recorrente.
    const occurrenceDoneMutation = useMutation({
        mutationFn: ({ task, dia, concluida }: { task: CollaboratorTask; dia: Date; concluida: boolean }) =>
            setOccurrenceDone(task, dia, concluida),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
        },
        onError: (err: any) => {
            toast({ title: "Erro ao atualizar status", description: err.message, variant: "destructive" });
        },
    });

    const deleteOccurrenceMutation = useMutation({
        mutationFn: ({ task, dia, escopo }: { task: CollaboratorTask; dia: Date; escopo: Escopo }) =>
            deleteOccurrence(task, dia, escopo),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
            toast({ title: "Tarefa removida", description: "A agenda foi atualizada." });
        },
        onError: (err: any) => {
            toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
        },
    });

    const saveOccurrenceMutation = useMutation({
        mutationFn: (args: {
            task: CollaboratorTask;
            dia: Date;
            escopo: Escopo;
            novo: Partial<CollaboratorTask>;
            regraAlterada: boolean;
        }) => saveOccurrence(args.task, args.dia, args.escopo, args.novo, args.regraAlterada),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
            toast({ title: "Agenda atualizada", description: "Tarefa salva com sucesso." });
        },
        onError: (err: any) => {
            toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
        },
    });

    return {
        ...query,
        upsertTaskAsync: updateMutation.mutateAsync,
        setOccurrenceDone: occurrenceDoneMutation.mutate,
        deleteOccurrenceAsync: deleteOccurrenceMutation.mutateAsync,
        saveOccurrenceAsync: saveOccurrenceMutation.mutateAsync,
        upsertTask: updateMutation.mutate,
        updateStatus: statusMutation.mutate,
        updateOutcome: outcomeMutation.mutate,
        deleteTask: deleteMutation.mutate,
    };
}
