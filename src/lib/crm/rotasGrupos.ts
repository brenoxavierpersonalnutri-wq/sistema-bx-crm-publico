// Rotas da seção "Disparo em grupo" (sem rede, sem React): usado no App (redirect) e nos testes.
export const ROTA_DISPARO_GRUPOS = "/crm/disparo-grupos";

/** /crm/grupos?numero=X (link antigo e da Central) -> /crm/disparo-grupos?aba=campanhas&numero=X */
export function destinoGruposAntigo(search: string): string {
  const p = new URLSearchParams(search);
  if (!p.get("aba")) p.set("aba", "campanhas");
  return `${ROTA_DISPARO_GRUPOS}?${p.toString()}`;
}
