import { useCallback, useEffect, useState } from "react";
import { buscarComLimite } from "@/lib/fetchComLimite";
import { supabase } from "@/integrations/supabase/client";

/** Desde 17/10/2026 o OpenWA (VPS) é o único provedor de WhatsApp do CRM; a UazAPI foi aposentada. */
export type ProvedorWhatsApp = "openwa";

export interface StatusWhatsApp {
  provider: ProvedorWhatsApp;
  connected: boolean;
  state: string | null;
  phone: string | null;
  /** data URL da imagem do QR, só quando pedido com action=qr e a sessão espera pareamento */
  qr: string | null;
  aviso: string | null;
}

/** Normaliza a resposta da edge function whatsapp-qr. Resposta inválida = desconectado. */
export function interpretarStatusWhatsApp(data: unknown): StatusWhatsApp {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const qr = typeof d.qr === "string" && d.qr.startsWith("data:image/") ? d.qr : null;
  return {
    provider: "openwa",
    connected: d.connected === true,
    state: typeof d.state === "string" ? d.state : null,
    phone: typeof d.phone === "string" ? d.phone : null,
    qr,
    aviso: typeof d.aviso === "string" ? d.aviso : typeof d.error === "string" ? d.error : null,
  };
}

export async function buscarStatusWhatsApp(action: "status" | "qr" = "status"): Promise<StatusWhatsApp> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão expirada");
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const res = await buscarComLimite(
    `https://${projectId}.supabase.co/functions/v1/whatsapp-qr?action=${action}`,
    { headers: { Authorization: `Bearer ${session.access_token}` } },
  );
  return interpretarStatusWhatsApp(await res.json().catch(() => ({})));
}

export function useProvedorWhatsApp() {
  const [status, setStatus] = useState<StatusWhatsApp | null>(null);

  const recarregar = useCallback(async () => {
    try {
      setStatus(await buscarStatusWhatsApp());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  return { provedor: "openwa" as const, status, recarregar };
}
