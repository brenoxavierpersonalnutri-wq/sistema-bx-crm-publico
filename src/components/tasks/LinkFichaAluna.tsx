import { Link } from "react-router-dom";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { linkDaFicha } from "@/lib/avisoAluna";
import type { CollaboratorTask } from "@/lib/taskTypes";

/**
 * "Abrir ficha" num aviso da aluna (anamnese/feedback). Não renderiza nada em
 * tarefa que não é aviso ou que não tem aluna ligada. O clique não propaga,
 * pra não abrir junto o diálogo de edição da tarefa.
 */
export function LinkFichaAluna({
    task,
    className,
}: {
    task: Pick<CollaboratorTask, "type" | "metadata">;
    className?: string;
}) {
    const href = linkDaFicha(task);
    if (!href) return null;
    return (
        <Link
            to={href}
            onClick={(e) => e.stopPropagation()}
            className={cn(
                "inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline",
                className,
            )}
        >
            <UserRound className="h-3 w-3" />
            Abrir ficha
        </Link>
    );
}
