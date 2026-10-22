// Chamada ao live-control com aviso claro quando a função ainda não foi publicada (nunca quebra a tela).
import { toast } from "sonner";
import { liveControl } from "@/lib/lives/api";
import { AVISO_BACKEND, backendAusente } from "@/lib/lives/painel";

export async function acaoLive<T = any>(acao: string, body: Record<string, unknown>, ok?: string): Promise<T | null> {
  try {
    const r = await liveControl(acao, body);
    if (ok) toast.success(ok);
    return r as T;
  } catch (e) {
    const msg = (e as Error).message;
    if (backendAusente(msg)) toast.warning(AVISO_BACKEND, { id: "lives-backend" });
    else toast.error(msg);
    return null;
  }
}
