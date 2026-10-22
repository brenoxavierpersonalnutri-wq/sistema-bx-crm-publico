import { useSearchParams } from "react-router-dom";
import WebinarRoom from "./WebinarRoom";

export default function WebinarAvaliacao() {
  const [params] = useSearchParams();
  const force = params.get("force") as "countdown" | "live" | "over" | null;
  return <WebinarRoom variant="avaliacao" forceScreen={force ?? undefined} />;
}
