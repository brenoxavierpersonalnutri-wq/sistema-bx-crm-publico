import { useState, useEffect } from "react";
import { ChevronRight, TrendingUp } from "lucide-react";
import { variations, type VariationKey } from "@/config/novaavVariations";

const INTERVAL = 5 * 60; // 5 min in seconds
const MAX_VAGAS = 4;
const MIN_VAGAS = 2;

/** Troca só título e foto (versões /avaliacao/vN). photo null = sem foto. */
export interface HeroOverride {
  headlineBefore: string;
  headlineHighlight: string;
  headlineAfter?: string;
  photo: string | null;
}

interface HeroSectionProps {
  variation?: VariationKey;
  override?: HeroOverride;
}

const HeroSection = ({ variation = "v1", override }: HeroSectionProps) => {
  const base = variations[variation];
  const v = override
    ? {
        ...base,
        headlineBefore: override.headlineBefore,
        headlineHighlight: override.headlineHighlight,
        headlineAfter: override.headlineAfter ?? "",
      }
    : base;
  const photo = override ? override.photo : base.photo;
  const [vagas, setVagas] = useState(MAX_VAGAS);
  const [timeLeft, setTimeLeft] = useState(INTERVAL);

  useEffect(() => {
    const KEY = "vsf_start_v2";
    let start = parseInt(localStorage.getItem(KEY) ?? "0");
    if (!start) {
      start = Math.floor(Date.now() / 1000);
      localStorage.setItem(KEY, String(start));
    }

    const tick = () => {
      const elapsed = Math.floor(Date.now() / 1000) - start;
      const intervals = Math.floor(elapsed / INTERVAL);
      setVagas(Math.max(MIN_VAGAS, MAX_VAGAS - intervals));
      setTimeLeft(INTERVAL - (elapsed % INTERVAL));
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const mm = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const ss = String(timeLeft % 60).padStart(2, "0");

  return (
    <section className="relative flex flex-col items-center justify-center px-4 pt-6 pb-12 md:py-16 overflow-hidden border-b border-border">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[70%] h-[350px] bg-[hsl(45,80%,50%)]/8 blur-[100px] rounded-full pointer-events-none" />

      <div className="max-w-3xl w-full text-center space-y-5 relative z-10">

        {/* Urgency badge */}
        <div className="inline-flex items-center gap-3 px-4 py-2 bg-red-950/60 border border-red-500/40 rounded-full backdrop-blur-sm">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <span className="text-red-300 text-xs md:text-sm font-black tracking-wide">
            Restam <span className="text-white">{vagas} vagas</span>
            {" "}— fecha em{" "}
            <span className="text-white font-mono">{mm}:{ss}</span>
          </span>
        </div>

        {/* Photo — antes e depois (varia por versão; versão sem foto não tem o bloco) */}
        {photo && (
          <div className="flex justify-center">
            <div className="relative w-40 md:w-56 rounded-2xl overflow-hidden border border-[hsl(45,80%,50%)]/30 shadow-[0_0_50px_hsl(45,80%,50%,0.15)]">
              <img
                src={photo}
                alt="Resultado real — método Slim e Definida"
                className="w-full h-auto object-cover"
              />
            </div>
          </div>
        )}

        {/* Heading */}
        <div className="space-y-3">
          <h1 className={`${photo ? "text-3xl md:text-6xl lg:text-7xl" : "text-4xl md:text-7xl lg:text-8xl py-4 md:py-8"} font-black leading-[0.95] tracking-tighter uppercase`}>
            {v.headlineBefore}
            <span className="text-[hsl(45,80%,50%)]">{v.headlineHighlight}</span>
            {v.headlineAfter}
          </h1>
        </div>

        {/* CTA */}
        <button
          type="button"
          onClick={() => {
            const form = document.getElementById("formulario");
            if (!form) return;
            form.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" });
            const firstInput = form.querySelector<HTMLElement>(
              "input:not([type='hidden']), button[role='radio'], [role='button']"
            );
            firstInput?.focus?.();
          }}
          className="group relative inline-flex items-center justify-center w-full max-w-2xl bg-[hsl(45,80%,50%)] hover:bg-[hsl(45,80%,44%)] text-black font-black text-lg md:text-2xl py-5 md:py-8 rounded-3xl transition-all transform hover:scale-[1.02] shadow-[0_0_40px_hsl(45,80%,50%,0.45)] uppercase cursor-pointer"
        >
          <span className="relative z-10 flex items-center gap-2 md:gap-3">
            {v.cta}
            <ChevronRight className="group-hover:translate-x-1 transition-transform" />
          </span>
        </button>

        {/* Promessa — abaixo do botão */}
        <p className="text-sm md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed pt-2">
          {v.subtitleBefore}
          <span className="text-[hsl(45,80%,50%)] font-black">{v.subtitleHighlight}</span>
          {v.subtitleAfter}
        </p>

        {/* Stats */}
        <div className="flex items-center justify-center gap-4 md:gap-6 text-sm md:text-base flex-wrap">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-[hsl(45,80%,50%)]" />
            <span className="font-black text-foreground">+800</span>
            <span className="text-muted-foreground">mulheres transformadas</span>
          </div>
          <div className="hidden sm:block w-px h-6 bg-[hsl(45,80%,50%)]/40" />
          <div className="text-muted-foreground">
            Método <span className="text-foreground font-bold">Slim e Definida</span>
          </div>
        </div>

        <p className="text-muted-foreground text-xs italic">
          O formulário leva menos de 2 minutos. Suas respostas são 100% confidenciais.
        </p>
      </div>
    </section>
  );
};

export default HeroSection;
