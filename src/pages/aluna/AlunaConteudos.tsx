import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Loader2, Play } from "lucide-react";
import { AlunaShell } from "@/components/aluna/AlunaShell";
import { useAlunaAuth } from "@/hooks/useAlunaAuth";
import { fetchProdutosComModulos, fetchProgresso } from "@/lib/conteudos/store";
import {
  capaDaAula, duracaoLegivel, emAndamento, percentualAssistido,
} from "@/lib/conteudos/types";
import type { ConteudoAula, ProdutoComModulos } from "@/lib/conteudos/types";
import { cn } from "@/lib/utils";

/**
 * Prateleira horizontal, no formato que a aluna já conhece de streaming: rola
 * com o dedo no celular e com as setas no desktop.
 */
function Prateleira({
  titulo,
  aulas,
  progressoPorAula,
}: {
  titulo: string;
  aulas: ConteudoAula[];
  progressoPorAula: Map<string, number>;
}) {
  const trilho = useRef<HTMLDivElement>(null);

  if (aulas.length === 0) return null;

  const rolar = (direcao: 1 | -1) => {
    const el = trilho.current;
    if (!el) return;
    el.scrollBy({ left: direcao * Math.round(el.clientWidth * 0.85), behavior: "smooth" });
  };

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3 px-5">
        <h2 className="flex items-center gap-2 font-display text-base font-bold tracking-tight">
          <span className="h-4 w-1 rounded-full bg-accent" aria-hidden />
          {titulo}
        </h2>
        <div className="hidden gap-1 md:flex">
          <button
            type="button"
            onClick={() => rolar(-1)}
            aria-label="Voltar"
            className="rounded-lg border border-white/10 p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => rolar(1)}
            aria-label="Avançar"
            className="rounded-lg border border-white/10 p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={trilho}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {aulas.map((aula) => {
          const capa = capaDaAula(aula);
          const pct = percentualAssistido(progressoPorAula.get(aula.id), aula.duracao_segundos);
          const dur = duracaoLegivel(aula.duracao_segundos);
          return (
            <Link
              key={aula.id}
              to={`/aluna/conteudos/${aula.id}`}
              className="group relative w-[150px] shrink-0 snap-start sm:w-[180px]"
            >
              <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-muted">
                {capa ? (
                  <img
                    src={capa}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900 p-3 text-center text-xs text-muted-foreground">
                    {aula.titulo}
                  </div>
                )}
                <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/95">
                    <Play className="ml-0.5 h-5 w-5 fill-black text-black" />
                  </span>
                </span>
                {dur && (
                  <span className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {dur}
                  </span>
                )}
                <span className="absolute inset-x-2 bottom-2">
                  <span className="line-clamp-2 block text-xs font-semibold leading-tight text-white drop-shadow">
                    {aula.titulo}
                  </span>
                </span>
                {pct > 0 && (
                  <span className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                    <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default function AlunaConteudos() {
  const { perfil } = useAlunaAuth();

  const { data: produtos = [], isLoading } = useQuery({
    queryKey: ["conteudo-produtos"],
    queryFn: fetchProdutosComModulos,
  });

  const { data: progresso = [] } = useQuery({
    queryKey: ["conteudo-progresso", perfil?.alunaId],
    queryFn: () => (perfil ? fetchProgresso(perfil.alunaId) : Promise.resolve([])),
    enabled: !!perfil,
  });

  const progressoPorAula = useMemo(
    () => new Map(progresso.map((p) => [p.aula_id, p.segundos])),
    [progresso],
  );

  const todasAulas = useMemo(
    () => produtos.flatMap((p: ProdutoComModulos) => p.modulos.flatMap((m) => m.aulas)),
    [produtos],
  );

  // "Continue assistindo": só aula começada de verdade, na ordem em que ela
  // mexeu por último.
  const continuar = useMemo(() => {
    const porId = new Map(todasAulas.map((a) => [a.id, a]));
    return progresso
      .filter((p) => emAndamento(p, porId.get(p.aula_id)))
      .map((p) => porId.get(p.aula_id))
      .filter((a): a is ConteudoAula => !!a);
  }, [progresso, todasAulas]);

  // Destaque do topo: a aula marcada como destaque, senão a primeira publicada.
  const destaque = useMemo(
    () => todasAulas.find((a) => a.destaque) ?? todasAulas[0],
    [todasAulas],
  );

  if (isLoading) {
    return (
      <AlunaShell titulo="Aulas" largura="cheia">
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AlunaShell>
    );
  }

  if (todasAulas.length === 0) {
    return (
      <AlunaShell titulo="Aulas" largura="cheia">
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] px-6 py-16 text-center">
          <p className="font-display text-lg font-bold">As aulas chegam já</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Teu conteúdo está sendo liberado. Assim que subir, aparece aqui.
          </p>
        </div>
      </AlunaShell>
    );
  }

  const capaDestaque = destaque ? capaDaAula(destaque) : null;

  return (
    <AlunaShell titulo="Aulas" largura="cheia" semPadding>
      {destaque && (
        <section className="relative mb-8 overflow-hidden">
          <div className="relative h-[46vh] min-h-[260px] w-full sm:h-[52vh]">
            {capaDestaque ? (
              <img src={capaDestaque} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-zinc-800 to-black" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 px-5 pb-6">
              <h1 className="max-w-xl font-display text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
                {destaque.titulo}
              </h1>
              {destaque.descricao && (
                <p className="mt-2 line-clamp-2 max-w-xl text-sm text-muted-foreground">
                  {destaque.descricao}
                </p>
              )}
              <Link
                to={`/aluna/conteudos/${destaque.id}`}
                className={cn(
                  "mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5",
                  "text-sm font-bold text-black transition-transform hover:scale-[1.02]",
                )}
              >
                <Play className="h-4 w-4 fill-black" />
                Assistir
              </Link>
            </div>
          </div>
        </section>
      )}

      <Prateleira
        titulo="Continue assistindo"
        aulas={continuar}
        progressoPorAula={progressoPorAula}
      />

      {produtos.map((produto) => {
        const comAula = produto.modulos.filter((m) => m.aulas.length > 0);
        if (comAula.length === 0) return null;
        return (
          <section key={produto.id}>
            {/* O nome do produto só aparece quando há mais de um: com um só,
                repetir o título em cima de cada prateleira é ruído. */}
            {produtos.length > 1 && (
              <h2 className="mb-1 px-5 pt-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {produto.titulo}
              </h2>
            )}
            {comAula.map((modulo) => (
              <Prateleira
                key={modulo.id}
                titulo={modulo.titulo}
                aulas={modulo.aulas}
                progressoPorAula={progressoPorAula}
              />
            ))}
          </section>
        );
      })}
    </AlunaShell>
  );
}
