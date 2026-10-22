import { useSearchParams } from "react-router-dom";
import WebinarRoom from "./WebinarRoom";

export default function WebinarVenda() {
  const [params] = useSearchParams();
  const force = params.get("force") as "countdown" | "live" | "over" | null;
  return <WebinarRoom variant="venda" forceScreen={force ?? undefined} />;
}
