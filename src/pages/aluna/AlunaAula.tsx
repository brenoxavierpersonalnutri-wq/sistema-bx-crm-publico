import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Loader2, Play } from "lucide-react";
import { AlunaShell } from "@/components/aluna/AlunaShell";
import { useAlunaAuth } from "@/hooks/useAlunaAuth";
import {
  fetchProdutosComModulos, fetchProgresso, salvarProgresso, urlDoArquivo,
} from "@/lib/conteudos/store";
import { capaDaAula, duracaoLegivel } from "@/lib/conteudos/types";
import type { ConteudoAula } from "@/lib/conteudos/types";
import { youtubeEmbed } from "@/lib/appAluna/types";

/**
 * Player da aula. YouTube entra como embed nocookie, então a aluna assiste
 * aqui dentro em vez de ser jogada pro YouTube. Vídeo próprio vem do bucket
 * privado por URL assinada.
 */
export default function AlunaAula() {
  const { aulaId } = useParams<{ aulaId: string }>();
  const { perfil } = useAlunaAuth();
  const navigate = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const [urlVideo, setUrlVideo] = useState<string | null>(null);
  const [erroVideo, setErroVideo] = useState("");

  const { data: produtos = [], isLoading } = useQuery({
    queryKey: ["conteudo-produtos"],
    queryFn: fetchProdutosComModulos,
  });

  const { data: progresso = [] } = useQuery({
    queryKey: ["conteudo-progresso", perfil?.alunaId],
    queryFn: () => (perfil ? fetchProgresso(perfil.alunaId) : Promise.resolve([])),
    enabled: !!perfil,
  });

  const { aula, modulo, proximas } = useMemo(() => {
    for (const produto of produtos) {
      for (const m of produto.modulos) {
        const encontrada = m.aulas.find((a) => a.id === aulaId);
        if (encontrada) {
          return {
            aula: encontrada,
            modulo: m,
            proximas: m.aulas.filter((a) => a.id !== aulaId),
          };
        }
      }
    }
    return { aula: undefined, modulo: undefined, proximas: [] as ConteudoAula[] };
  }, [produtos, aulaId]);

  const segundosSalvos = useMemo(
    () => progresso.find((p) => p.aula_id === aulaId)?.segundos ?? 0,
    [progresso, aulaId],
  );

  // Vídeo próprio: pega a URL assinada na hora de tocar.
  useEffect(() => {
    let vivo = true;
    setUrlVideo(null);
    setErroVideo("");
    if (aula?.tipo === "upload" && aula.video_path) {
      urlDoArquivo(aula.video_path)
        .then((u) => { if (vivo) setUrlVideo(u); })
        .catch(() => { if (vivo) setErroVideo("Não consegui carregar esse vídeo agora."); });
    }
    return () => { vivo = false; };
  }, [aula?.tipo, aula?.video_path]);

  // Retoma de onde parou, uma vez só, quando o vídeo fica pronto.
  const retomou = useRef(false);
  useEffect(() => { retomou.current = false; }, [aulaId]);

  // Progresso do vídeo próprio: grava a cada 10s de reprodução. Falha aqui não
  // pode parar o vídeo, então o erro é engolido de propósito.
  const ultimoSalvo = useRef(0);
  function aoProgredir() {
    const el = video.current;
    if (!el || !perfil || !aula) return;
    const s = Math.floor(el.currentTime);
    if (s - ultimoSalvo.current < 10) return;
    ultimoSalvo.current = s;
    const concluida = !!el.duration && s >= el.duration - 20;
    void salvarProgresso(perfil.alunaId, aula.id, s, concluida).catch(() => {});
  }

  if (isLoading) {
    return (
      <AlunaShell titulo="Aula" largura="cheia">
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AlunaShell>
    );
  }

  if (!aula) {
    return (
      <AlunaShell titulo="Aula" largura="cheia">
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] px-6 py-16 text-center">
          <p className="font-display text-lg font-bold">Aula não encontrada</p>
          <button
            type="button"
            onClick={() => navigate("/aluna/conteudos")}
            className="mt-4 text-sm font-semibold text-accent"
          >
            Voltar pras aulas
          </button>
        </div>
      </AlunaShell>
    );
  }

  return (
    <AlunaShell titulo={modulo?.titulo ?? "Aula"} largura="cheia" semPadding>
      <div className="px-5 pt-4">
        <Link
          to="/aluna/conteudos"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Todas as aulas
        </Link>

        <div className="overflow-hidden rounded-2xl bg-black">
          {aula.tipo === "youtube" && aula.youtube_id ? (
            <iframe
              src={`${youtubeEmbed(aula.youtube_id)}${
                segundosSalvos > 15 ? `&start=${segundosSalvos}` : ""
              }`}
              title={aula.titulo}
              className="aspect-video w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : urlVideo ? (
            <video
              ref={video}
              src={urlVideo}
              controls
              playsInline
              poster={capaDaAula(aula) ?? undefined}
              className="aspect-video w-full bg-black"
              onLoadedMetadata={() => {
                if (!retomou.current && segundosSalvos > 15 && video.current) {
                  video.current.currentTime = segundosSalvos;
                  retomou.current = true;
                }
              }}
              onTimeUpdate={aoProgredir}
              onEnded={() => {
                if (perfil && video.current) {
                  void salvarProgresso(
                    perfil.alunaId, aula.id, Math.floor(video.current.duration || 0), true,
                  ).catch(() => {});
                }
              }}
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center text-sm text-muted-foreground">
              {erroVideo || "Carregando o vídeo..."}
            </div>
          )}
        </div>

        <h1 className="mt-5 font-display text-xl font-bold tracking-tight sm:text-2xl">
          {aula.titulo}
        </h1>
        {duracaoLegivel(aula.duracao_segundos) && (
          <p className="mt-1 text-xs text-muted-foreground">
            {duracaoLegivel(aula.duracao_segundos)}
          </p>
        )}
        {aula.descricao && (
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {aula.descricao}
          </p>
        )}
      </div>

      {proximas.length > 0 && (
        <section className="mt-8 px-5">
          <h2 className="mb-3 flex items-center gap-2 font-display text-base font-bold tracking-tight">
            <span className="h-4 w-1 rounded-full bg-accent" aria-hidden />
            Mais de {modulo?.titulo}
          </h2>
          <ul className="space-y-2">
            {proximas.map((outra) => {
              const capa = capaDaAula(outra);
              return (
                <li key={outra.id}>
                  <Link
                    to={`/aluna/conteudos/${outra.id}`}
                    className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-2 transition-colors hover:bg-white/[0.05]"
                  >
                    <span className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {capa ? (
                        <img src={capa} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center">
                          <Play className="h-4 w-4 text-muted-foreground" />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 block text-sm font-medium">{outra.titulo}</span>
                      {duracaoLegivel(outra.duracao_segundos) && (
                        <span className="text-xs text-muted-foreground">
                          {duracaoLegivel(outra.duracao_segundos)}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </AlunaShell>
  );
}
