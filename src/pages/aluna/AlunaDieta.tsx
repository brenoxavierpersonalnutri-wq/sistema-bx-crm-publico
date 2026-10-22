import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, Loader2, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AlunaShell } from "@/components/aluna/AlunaShell";
import { useAlunaAuth } from "@/hooks/useAlunaAuth";
import { fetchMinhaDieta, urlAssinadaDieta } from "@/lib/appAluna/store";

export default function AlunaDieta() {
  const { perfil } = useAlunaAuth();
  const [urlPdf, setUrlPdf] = useState<string | null>(null);

  const { data: dieta, isLoading } = useQuery({
    queryKey: ["minha-dieta", perfil?.alunaId],
    queryFn: () => (perfil ? fetchMinhaDieta(perfil.alunaId) : Promise.resolve(null)),
    enabled: !!perfil,
  });

  // O bucket é privado; a URL assinada é gerada sob demanda e expira.
  useEffect(() => {
    let cancelado = false;
    if (dieta?.tipo === "pdf" && dieta.arquivoPath) {
      urlAssinadaDieta(dieta.arquivoPath)
        .then((u) => !cancelado && setUrlPdf(u))
        .catch(() => !cancelado && toast.error("Não consegui abrir o arquivo da dieta."));
    } else {
      setUrlPdf(null);
    }
    return () => { cancelado = true; };
  }, [dieta]);

  if (isLoading) {
    return (
      <AlunaShell titulo="Sua dieta">
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AlunaShell>
    );
  }

  if (!dieta) {
    return (
      <AlunaShell titulo="Sua dieta">
        <div className="rounded-2xl border border-white/5 bg-card/60 p-8 text-center">
          <UtensilsCrossed className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h2 className="font-display text-lg font-semibold">Dieta a caminho</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Seu plano alimentar ainda não foi liberado. Assim que sair, aparece aqui.
          </p>
        </div>
      </AlunaShell>
    );
  }

  return (
    <AlunaShell titulo="Sua dieta">
      <div className="space-y-5">
        <header className="rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/12 via-card to-card p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-accent">
            Plano alimentar
          </p>
          <h2 className="mt-1 font-display text-xl font-bold leading-tight">{dieta.titulo}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Válido desde{" "}
            {new Date(`${dieta.vigenciaInicio}T12:00:00`).toLocaleDateString("pt-BR", {
              day: "2-digit", month: "long",
            })}
          </p>
        </header>

        {dieta.observacao && (
          <div className="rounded-xl border-l-2 border-accent/40 bg-white/[0.03] px-4 py-3">
            <p className="text-sm">{dieta.observacao}</p>
          </div>
        )}

        {dieta.tipo === "pdf" ? (
          <div className="space-y-3">
            {urlPdf ? (
              <>
                <div className="overflow-hidden rounded-2xl border border-white/5 bg-white">
                  <iframe
                    src={urlPdf}
                    title={dieta.titulo}
                    className="h-[65vh] w-full"
                  />
                </div>
                <Button asChild className="w-full gap-2">
                  <a href={urlPdf} target="_blank" rel="noopener noreferrer">
                    <Download className="h-4 w-4" /> Baixar PDF
                  </a>
                </Button>
              </>
            ) : (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/5 bg-card/60 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Abrindo arquivo…
              </div>
            )}
          </div>
        ) : (
          <article className="rounded-2xl border border-white/5 bg-card/60 p-5">
            <div className="mb-3 flex items-center gap-2 text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span className="text-xs uppercase tracking-wider">Seu plano</span>
            </div>
            <div className="whitespace-pre-wrap text-[15px] leading-relaxed">
              {dieta.conteudo}
            </div>
          </article>
        )}
      </div>
    </AlunaShell>
  );
}
