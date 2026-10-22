// /lives/youtube-retorno?youtube=ok|erro&motivo= — onde o youtube-oauth devolve o popup depois do login do
// Google. Avisa o estúdio (BroadcastChannel + postMessage pro opener) e tenta fechar a janela; se não
// fechar (popup bloqueado e o login correu na mesma aba), mostra o resultado e um botão pra voltar.
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CANAL_RETORNO, TIPO_MENSAGEM, type MensagemOauth } from "@/lib/lives/youtube";

export default function YoutubeRetorno() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ok = params.get("youtube") === "ok";
  const motivo = (params.get("motivo") ?? "").slice(0, 160);
  const [aberta, setAberta] = useState(false);

  useEffect(() => {
    const msg: MensagemOauth = { tipo: TIPO_MENSAGEM, status: ok ? "ok" : "erro", motivo };
    try {
      if (typeof BroadcastChannel !== "undefined") {
        const bc = new BroadcastChannel(CANAL_RETORNO);
        bc.postMessage(msg);
        bc.close();
      }
    } catch {
      /* segue pro opener */
    }
    try {
      window.opener?.postMessage(msg, window.location.origin);
    } catch {
      /* opener cortado pela página do Google: o BroadcastChannel já avisou */
    }
    const t = setTimeout(() => {
      window.close();
      setTimeout(() => setAberta(true), 400);
    }, 300);
    return () => clearTimeout(t);
  }, [ok, motivo]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-lg font-semibold">{ok ? "YouTube conectado" : "Não foi possível conectar o YouTube"}</h1>
        {motivo && <p className="text-sm text-muted-foreground">{ok ? `Canal: ${motivo}` : motivo}</p>}
        {aberta && (
          <>
            <p className="text-sm text-muted-foreground">Pode fechar esta janela.</p>
            <Button variant="outline" onClick={() => navigate("/lives")}>Voltar para Lives</Button>
          </>
        )}
      </div>
    </main>
  );
}
