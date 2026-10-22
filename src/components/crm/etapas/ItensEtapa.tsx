// Itens de <Select> com as etapas do CRM (crm_etapas via useEtapas). Só as ativas; `incluir` mantém na lista o
// valor já salvo mesmo que a etapa tenha sido arquivada (senão o seletor aparece vazio e confunde).
import { SelectItem } from "@/components/ui/select";
import { useEtapas } from "@/hooks/useEtapas";

export function ItensEtapa({ incluir }: { incluir?: string | null }) {
  const { ativas, nomeEtapa } = useEtapas();
  const lista = ativas.map((e) => ({ slug: e.slug, nome: e.nome }));
  if (incluir && !lista.some((e) => e.slug === incluir)) lista.push({ slug: incluir, nome: `${nomeEtapa(incluir)} (arquivada)` });
  return (
    <>
      {lista.map((e) => (
        <SelectItem key={e.slug} value={e.slug}>{e.nome}</SelectItem>
      ))}
    </>
  );
}
