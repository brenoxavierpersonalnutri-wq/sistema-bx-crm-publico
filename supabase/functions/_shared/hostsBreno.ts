// Sites do Breno que chamam submit-form-response. Lista ÚNICA: decide quem vai ao SellFlux e é gravada na linha
// (lead_form_responses.host_breno), que o banco usa para barrar lead de site de cliente no Full Funnel, na base de
// leads e nos eventos de fluxo (public.base_leads_form_de_cliente, migration 20261122130000).
// Hosts EXATOS, minúsculos, sem porta. Nada de sufixo/curinga: qualquer outro subdomínio de brenoxavier.com.br
// (ex.: bgimplementacao.brenoxavier.com.br, que é da BG Implementação) fica de fora.
// Para liberar/remover um site, edite só esta lista e publique a edge function.
export const HOSTS_BRENO: ReadonlySet<string> = new Set<string>([
  "novaav.brenoxavier.com.br",
  "equipe.brenoxavier.com.br",
  "brenoxavier.com.br",
  "www.brenoxavier.com.br",
]);

/** Host de quem chamou (Origin, depois Referer). O navegador preenche os dois sozinho em POST cross-origin. */
export function hostDaRequisicao(headers: { get(nome: string): string | null }): string | null {
  for (const h of ["origin", "referer"]) {
    const v = headers.get(h);
    if (!v) continue;
    try {
      const host = new URL(v).hostname.toLowerCase();
      if (host) return host;
    } catch {
      // cabeçalho malformado: tenta o próximo
    }
  }
  return null;
}

/** O lead veio de um site do Breno? Sem host (chamada sem navegador) = não. */
export function hostEhDoBreno(host: string | null | undefined): boolean {
  return !!host && HOSTS_BRENO.has(host.toLowerCase());
}

/** Insert sem as colunas novas quando a migration 20261122130000 ainda não rodou (PostgREST: coluna desconhecida). */
export function erroColunaAusente(erro: { code?: string; message?: string } | null | undefined): boolean {
  if (!erro) return false;
  return erro.code === "PGRST204" || erro.code === "42703" ||
    /could not find the '(origem_host|host_breno)' column|column "?(origem_host|host_breno)"? .*does not exist/i.test(erro.message ?? "");
}
