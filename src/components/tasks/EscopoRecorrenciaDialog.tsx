import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Escopo } from "@/lib/recorrencia";

// A pergunta do Calendário do Mac ao mexer num evento que se repete:
// vale só para este ou para este e todos os futuros?
export function EscopoRecorrenciaDialog({
    acao,
    onEscolher,
    onCancelar,
}: {
    /** null = fechado. */
    acao: "salvar" | "excluir" | null;
    onEscolher: (escopo: Escopo) => void;
    onCancelar: () => void;
}) {
    const excluir = acao === "excluir";
    return (
        <AlertDialog open={acao !== null} onOpenChange={(o) => { if (!o) onCancelar(); }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Este é um evento recorrente</AlertDialogTitle>
                    <AlertDialogDescription>
                        {excluir
                            ? "Você quer excluir só este evento ou este e todos os eventos futuros da série?"
                            : "Você quer salvar as alterações só neste evento ou neste e em todos os eventos futuros da série?"}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="gap-2 sm:gap-0">
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <Button
                        variant="outline"
                        className={excluir ? "border-destructive/40 text-destructive hover:bg-destructive/10" : undefined}
                        onClick={() => onEscolher("futuros")}
                    >
                        {excluir ? "Excluir este e os futuros" : "Este e os futuros"}
                    </Button>
                    <Button
                        variant={excluir ? "destructive" : "default"}
                        onClick={() => onEscolher("este")}
                    >
                        {excluir ? "Excluir só este evento" : "Só este evento"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
