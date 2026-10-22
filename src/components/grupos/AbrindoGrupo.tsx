import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { abrirComEspera, resolverLinkGrupo, type EstadoEspera, type ResultadoLink } from "@/lib/grupoLink";

export const TEXTO_PREPARANDO = "Preparando seu grupo, só um instante…";
export const TEXTO_TENTE_DE_NOVO = "Tente de novo em instantes";

const recarregarPagina = () => window.location.reload();
const irPara = (url: string) => window.location.replace(url);

/**
 * Página pública do link de grupos (/g/<slug> e /r/grupo-<x>). Com vaga, redireciona. Lotado: mostra
 * "Preparando seu grupo…" e consulta a cada 3 s até o grupo novo ter convite (o disparador cria sozinho);
 * passou de 60 s, "Tente de novo em instantes" com botão de recarregar. Pausado vai para a URL de pausa, se houver.
 */
export function AbrindoGrupo({
  slug, inicial, resolver = resolverLinkGrupo, redirecionar = irPara, recarregar = recarregarPagina,
}: {
  slug: string;
  /** resultado já obtido (o /r/ resolve antes de saber que é grupo) */
  inicial?: ResultadoLink;
  resolver?: typeof resolverLinkGrupo;
  redirecionar?: (url: string) => void;
  recarregar?: () => void;
}) {
  const [estado, setEstado] = useState<EstadoEspera>({ fase: "abrindo" });

  useEffect(() => {
    let vivo = true;
    abrirComEspera({
      slug, search: window.location.search, inicial, resolver, vivo: () => vivo,
      onEstado: (e) => {
        if (e.fase === "fim" && e.resultado.tipo === "grupo") redirecionar(e.resultado.url);
        else if (e.fase === "fim" && e.resultado.tipo === "pausado" && e.resultado.url) redirecionar(e.resultado.url);
        setEstado(e);
      },
    });
    return () => { vivo = false; };
    // inicial/resolver só valem na montagem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  let texto = "Abrindo o grupo do WhatsApp...";
  let carregando = true;
  let botao = false;
  if (estado.fase === "preparando") texto = TEXTO_PREPARANDO;
  else if (estado.fase === "tempo_esgotado") { texto = TEXTO_TENTE_DE_NOVO; carregando = false; botao = true; }
  else if (estado.fase === "fim") {
    const r = estado.resultado;
    if (r.tipo === "grupo" || (r.tipo === "pausado" && r.url)) texto = "Abrindo o grupo do WhatsApp...";
    else {
      carregando = false;
      if (r.tipo === "pausado") texto = "As entradas nos grupos estão fechadas no momento.";
      else if (r.tipo === "nao_encontrada") texto = "Link não encontrado.";
      else { texto = "Não foi possível abrir o grupo agora. Tente de novo."; botao = true; }
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3 text-center max-w-sm" role="status" aria-live="polite">
        {carregando && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />}
        <p className="text-sm text-muted-foreground">{texto}</p>
        {botao && <Button variant="outline" size="sm" onClick={recarregar}>Tentar de novo</Button>}
      </div>
    </div>
  );
}
