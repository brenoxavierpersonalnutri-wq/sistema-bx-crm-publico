import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Tela de espera das rotas preguiçosas.
 *
 * Era um <div> vazio. Quando o pedaço do app não vinha — o que acontece com
 * quem está com a aba aberta na hora de uma publicação — a pessoa ficava
 * olhando pro branco, sem saber se o sistema caiu, se a internet caiu ou se
 * era pra esperar mais. Sem nada pra clicar.
 *
 * Agora: nada nos primeiros instantes (pra não piscar em carregamento rápido),
 * depois o giro, e se demorar demais o motivo mais provável e o botão que
 * resolve.
 */
const MS_ATE_O_GIRO = 400;
const MS_ATE_A_AJUDA = 8_000;

export function CarregandoRota() {
    const [fase, setFase] = useState<"quieto" | "girando" | "ajuda">("quieto");

    useEffect(() => {
        const aoGiro = setTimeout(() => setFase("girando"), MS_ATE_O_GIRO);
        const aAjuda = setTimeout(() => setFase("ajuda"), MS_ATE_A_AJUDA);
        return () => {
            clearTimeout(aoGiro);
            clearTimeout(aAjuda);
        };
    }, []);

    if (fase === "quieto") return <div className="min-h-screen" />;

    return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            {fase === "ajuda" && (
                <>
                    <div className="space-y-1 max-w-sm">
                        <p className="font-semibold">Esta tela está demorando demais</p>
                        <p className="text-sm text-muted-foreground">
                            Costuma acontecer logo depois de uma atualização do sistema:
                            seu navegador ainda está com a versão anterior. Recarregar resolve.
                        </p>
                    </div>
                    <Button onClick={() => window.location.reload()}>Recarregar</Button>
                </>
            )}
        </div>
    );
}
