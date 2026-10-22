import { useParams } from "react-router-dom";
import { AbrindoGrupo } from "@/components/grupos/AbrindoGrupo";

// /g/:slug — link único da campanha de grupos (substitui o link do SendFlow).
// Manda para o grupo com vaga; lotado espera o grupo novo que o CRM cria sozinho (AbrindoGrupo).
export default function GrupoLink() {
  const { slug } = useParams<{ slug: string }>();
  if (!slug) return null;
  return <AbrindoGrupo slug={slug} />;
}
