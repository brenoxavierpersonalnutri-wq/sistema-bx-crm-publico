// Marca do Breno no lugar do logo do estúdio: o quadrado "BX" do favicon e o nome.
import { cn } from "@/lib/utils";

export function Marca({ compacta, className }: { compacta?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <img src="/favicon.svg" alt="" className="h-8 w-8 shrink-0 rounded-lg" />
      {!compacta && <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight">Breno Xavier <span className="font-normal text-muted-foreground">Lives</span></span>}
    </span>
  );
}
