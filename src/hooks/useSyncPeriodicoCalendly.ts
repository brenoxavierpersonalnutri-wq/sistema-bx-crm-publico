import { useEffect } from "react";
import {
    CHAVE_ULTIMA_SINCRONIZACAO,
    deveSincronizar,
    INTERVALO_DE_CONFERENCIA_MS,
    lerUltimaSincronizacao,
} from "@/lib/sincronizacaoPeriodica";

/**
 * Sincronizacao periodica do Calendly, compartilhada pelas telas que a usam.
 *
 * Estava duplicada no Index e no MonthlyDashboard, cada uma com seu proprio
 * setInterval de 60s — duas telas abertas dobravam a carga sem que ninguem
 * visse. A regra de quando disparar esta em lib/sincronizacaoPeriodica.
 */
export function useSyncPeriodicoCalendly(sincronizar: (opts: { silent: boolean }) => void) {
    useEffect(() => {
        const tentar = () => {
            let ultima: number | null = null;
            try { ultima = lerUltimaSincronizacao(localStorage.getItem(CHAVE_ULTIMA_SINCRONIZACAO)); }
            catch { /* sem storage: cai no ritmo da propria aba */ }

            const visivel = typeof document === "undefined" || !document.hidden;
            if (!deveSincronizar(Date.now(), ultima, visivel)) return;

            // Marca antes de disparar: se duas abas acordarem no mesmo instante,
            // a segunda ja encontra a marca nova e desiste.
            try { localStorage.setItem(CHAVE_ULTIMA_SINCRONIZACAO, String(Date.now())); }
            catch { /* sem storage, segue */ }

            sincronizar({ silent: true });
        };

        const id = window.setInterval(tentar, INTERVALO_DE_CONFERENCIA_MS);
        // Voltou pra aba: confere na hora, sem esperar o proximo ciclo.
        document.addEventListener("visibilitychange", tentar);
        return () => {
            window.clearInterval(id);
            document.removeEventListener("visibilitychange", tentar);
        };
    }, [sincronizar]);
}
