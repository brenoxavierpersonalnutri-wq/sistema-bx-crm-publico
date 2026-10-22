import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { mergeRedirectUrl, spaPathFor } from "@/lib/redirectParams";
import { resolverLinkGrupo, type ResultadoLink } from "@/lib/grupoLink";
import { AbrindoGrupo } from "@/components/grupos/AbrindoGrupo";

// O rotator devolve só a URL da variação + ?cm_click. Aqui entram os
// parâmetros do anúncio (utm_*, fbclid...) e a marca da variação
// (cm_variant, utm_content=vN). Regras e testes em lib/redirectParams.
export default function RedirectPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [grupo, setGrupo] = useState<ResultadoLink | null>(null);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        // /r/grupo-<x>: campanha de grupos do CRM (módulo Grupos), se existir com esse slug.
        // Não existindo, segue para o rotator normal.
        if (slug.startsWith("grupo-")) {
          const g = await resolverLinkGrupo(slug, window.location.search);
          // grupo, lotado (espera o grupo novo) ou pausado: a mesma página do /g/ cuida
          if (g.tipo === "grupo" || g.tipo === "aguardando" || g.tipo === "pausado") {
            setGrupo(g);
            return;
          }
        }
        const { data, error: fnError } = await supabase.functions.invoke("rotator-redirect", {
          body: { slug },
        });
        if (fnError) throw new Error(fnError.message);
        if (data?.redirect_url) {
          const origin = window.location.origin;
          const finalUrl = mergeRedirectUrl(
            data.redirect_url,
            window.location.search,
            window.location.hash,
            origin,
          );
          const spaPath = spaPathFor(finalUrl, origin);
          if (spaPath) navigate(spaPath, { replace: true });
          else window.location.replace(finalUrl);
        } else if (data?.error) {
          setError(data.error);
        }
      } catch (err: unknown) {
        setError((err as { message?: string })?.message || "Erro ao redirecionar");
      }
    })();
  }, [slug, navigate]);

  if (grupo && slug) return <AbrindoGrupo slug={slug} inicial={grupo} />;

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return null;
}
