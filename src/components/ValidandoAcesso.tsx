import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { faseDaEspera, MS_ATE_EXPLICAR, MS_ATE_O_GIRO, type FaseDaEspera } from "@/lib/esperaDeAcesso";

/**
 * A espera entre abrir o sistema e a tela aparecer.
 *
 * Era um giro sozinho no meio do branco, por até 15 segundos. Quem abria e
 * esperava não tinha como saber se era pra continuar esperando — e concluía,
 * razoavelmente, que o site não estava abrindo.
 *
 * Agora a espera fala: fica quieta no carregamento rápido, gira, e se passar
 * de alguns segundos diz o que está fazendo e oferece as duas saídas que
 * costumam resolver.
 */
export function ValidandoAcesso() {
    const [fase, setFase] = useState<FaseDaEspera>(() => faseDaEspera(0));

    useEffect(() => {
        const aoGiro = setTimeout(() => setFase(faseDaEspera(MS_ATE_O_GIRO)), MS_ATE_O_GIRO);
        const aExplicar = setTimeout(() => setFase(faseDaEspera(MS_ATE_EXPLICAR)), MS_ATE_EXPLICAR);
        return () => {
            clearTimeout(aoGiro);
            clearTimeout(aExplicar);
        };
    }, []);

    if (fase === "quieto") return <div className="min-h-screen" />;

    return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            {fase === "explicando" && (
                <>
                    <div className="space-y-1 max-w-sm">
                        <p className="font-semibold">Validando seu acesso</p>
                        <p className="text-sm text-muted-foreground">
                            Está demorando mais que o normal. Costuma ser a conexão —
                            em alguns segundos a tela abre ou avisa o que deu errado.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                        <Button variant="outline" onClick={() => window.location.reload()} className="gap-2">
                            <RefreshCw className="h-4 w-4" />
                            Recarregar
                        </Button>
                        <Button variant="ghost" onClick={() => { window.location.href = "/login"; }}>
                            Entrar de novo
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}
