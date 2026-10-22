import { Badge } from "@/components/ui/badge";
import { ROTULO_PERMISSAO, type PermissaoGrupo } from "@/lib/grupos";

const DICA: Record<PermissaoGrupo, string> = {
  admin: "O número é admin: dispara e muda foto, descrição, nome, ajustes e admins.",
  so_envio: "O número não é admin, mas o grupo deixa membros enviarem: só disparo.",
  sem_permissao: "Só admins enviam e o número não é admin: nem disparo nem configuração.",
  desconhecida: "Ainda não li (ou o proxy da VPS é antigo). Use \"Ler permissões\".",
};
const COR: Record<PermissaoGrupo, string> = {
  admin: "border-green-600/50 text-green-500",
  so_envio: "border-sky-600/50 text-sky-400",
  sem_permissao: "border-red-600/50 text-red-400",
  desconhecida: "text-muted-foreground",
};

/** O que o número pode fazer no grupo: "admin" / "só envio" / "só admins enviam — sem permissão". */
export function PermissaoBadge({ permissao }: { permissao: PermissaoGrupo }) {
  return <Badge variant="outline" className={COR[permissao]} title={DICA[permissao]}>{ROTULO_PERMISSAO[permissao]}</Badge>;
}
