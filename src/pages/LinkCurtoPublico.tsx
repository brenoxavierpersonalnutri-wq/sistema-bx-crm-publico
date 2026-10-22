import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { abrirLinkCurto, type TipoLinkCurto } from "@/lib/crmGrupoLinks";

// /grupo/:slug e /ir/:slug — rota PÚBLICA (sem login). Busca o destino na RPC crm_grupo_link_abrir e
// redireciona com window.location.replace. Enquanto carrega: tela escura com botão manual de reserva.
// Usada pelo botão do template oficial do WhatsApp (a Meta não aceita chat.whatsapp.com direto no botão).

type Estado =
  | { fase: "carregando" }
  | { fase: "redirecionando"; url: string }
  | { fase: "indisponivel" }
  | { fase: "erro" };

const TEXTOS: Record<TipoLinkCurto, { abrindo: string; botao: string }> = {
  grupo: { abrindo: "Abrindo o grupo…", botao: "Entrar no grupo" },
  link: { abrindo: "Abrindo…", botao: "Abrir agora" },
};

export default function LinkCurtoPublico({ tipo }: { tipo: TipoLinkCurto }) {
  const { slug = "" } = useParams<{ slug: string }>();
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [tentativa, setTentativa] = useState(0);

  const tentarDeNovo = useCallback(() => {
    setEstado({ fase: "carregando" });
    setTentativa((n) => n + 1);
  }, []);

  useEffect(() => {
    let vivo = true;
    abrirLinkCurto(slug, tipo).then((r) => {
      if (!vivo) return;
      if (r.tipo === "ok") {
        setEstado({ fase: "redirecionando", url: r.url });
        window.location.replace(r.url);
      } else if (r.tipo === "indisponivel") {
        setEstado({ fase: "indisponivel" });
      } else {
        setEstado({ fase: "erro" });
      }
    });
    return () => { vivo = false; };
  }, [slug, tipo, tentativa]);

  const textos = TEXTOS[tipo];

  return (
    <main
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "#0b0d10", color: "#e8eaed" }}
    >
      <div className="w-full max-w-sm text-center space-y-5">
        {(estado.fase === "carregando" || estado.fase === "redirecionando") && (
          <>
            <div
              aria-hidden
              className="mx-auto h-8 w-8 rounded-full border-2 animate-spin"
              style={{ borderColor: "#2a2f36", borderTopColor: "#25d366" }}
            />
            <p className="text-lg" role="status">{textos.abrindo}</p>
            {estado.fase === "redirecionando" ? (
              <a
                href={estado.url}
                className="inline-block rounded-md px-5 py-3 text-sm font-semibold"
                style={{ background: "#25d366", color: "#0b0d10" }}
              >
                {textos.botao}
              </a>
            ) : (
              <p className="text-xs" style={{ color: "#9aa0a6" }}>Se não abrir sozinho, o botão aparece aqui.</p>
            )}
          </>
        )}
        {estado.fase === "indisponivel" && (
          <p className="text-lg" role="alert">Link indisponível, fale com a consultoria.</p>
        )}
        {estado.fase === "erro" && (
          <>
            <p className="text-lg" role="alert">Não foi possível abrir agora.</p>
            <button
              type="button"
              onClick={tentarDeNovo}
              className="rounded-md px-5 py-3 text-sm font-semibold"
              style={{ background: "#25d366", color: "#0b0d10" }}
            >
              Tentar de novo
            </button>
          </>
        )}
      </div>
    </main>
  );
}
