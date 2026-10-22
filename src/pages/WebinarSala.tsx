import { useSearchParams } from "react-router-dom";
import WebinarRoom from "./WebinarRoom";

export default function WebinarSala() {
  const [params] = useSearchParams();
  const tipoRaw = params.get("tipo");
  const tipo: "venda" | "avaliacao" = tipoRaw === "avaliacao" ? "avaliacao" : "venda";
  const force = params.get("force") as "countdown" | "live" | "over" | null;
  return <WebinarRoom variant={tipo} forceScreen={force ?? undefined} />;
}
