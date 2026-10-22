import { ChevronRight, Crown, TrendingUp } from "lucide-react";
import brenoPhoto from "@/assets/novaav/breno-xavier.jpg";

const IndividualHero = () => {
  return (
    <section className="relative flex flex-col items-center justify-center px-4 py-16 md:py-28 overflow-hidden border-b border-border">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[60%] h-[300px] bg-[hsl(45,80%,50%)]/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="max-w-3xl w-full text-center space-y-8 relative z-10">
        {/* Photo */}
        <div className="flex justify-center">
          <div className="w-36 h-36 md:w-44 md:h-44 rounded-full border-[3px] border-[hsl(45,80%,50%)] p-1 shadow-[0_0_30px_hsl(45,80%,50%,0.25)]">
            <img
              src={brenoPhoto}
              alt="Breno Xavier"
              className="w-full h-full rounded-full object-cover object-top"
            />
          </div>
        </div>

        {/* Name */}
        <div className="space-y-3">
          <h2 className="text-2xl md:text-4xl font-black tracking-tight uppercase">
            Breno Xavier
          </h2>
          <p className="text-[hsl(45,80%,50%)] font-bold text-sm md:text-base">
            Ed. Física · Nutrição · Pós em Biomecânica · Pós em Bases Fisiológicas
          </p>
          <p className="text-muted-foreground text-base md:text-lg leading-relaxed">
            Pego o que realmente funciona na ciência e aplico na vida real, sem dieta maluca, nem treino longo e burro.
          </p>
        </div>

        {/* Stats */}
        <div className="flex items-center justify-center gap-6 text-sm md:text-base">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-[hsl(45,80%,50%)]" />
            <span className="font-black text-foreground">+500</span>
            <span className="text-muted-foreground">mulheres transformadas</span>
          </div>
          <div className="w-px h-6 bg-[hsl(45,80%,50%)]/40" />
          <div className="text-muted-foreground">
            Método <span className="text-foreground font-bold">Slim e Definida</span>
          </div>
        </div>

        <p className="text-muted-foreground text-sm md:text-base">
          Aplicando método validado em <span className="text-foreground font-bold">mulheres reais</span> que querem físico slim e definido — com treino de 50 min e dieta gostosa, sabendo como encaixar o fim de semana.
        </p>

        {/* CTA Button */}
        <a
          href="#formulario"
          className="group flex items-center justify-center w-full bg-[hsl(45,80%,50%)] hover:bg-[hsl(45,80%,45%)] text-background font-black text-lg md:text-2xl py-5 md:py-6 rounded-2xl transition-all transform hover:scale-[1.02] active:scale-[0.98] uppercase cursor-pointer"
        >
          <span className="flex items-center gap-3">
            Preciso desse projeto
            <ChevronRight className="group-hover:translate-x-1 transition-transform" />
          </span>
        </a>

        <div className="w-full h-px bg-border" />

        {/* Consultoria Card */}
        <div className="border border-[hsl(45,80%,50%)]/40 rounded-2xl p-6 md:p-8 space-y-4 bg-secondary/30">
          <div className="flex items-center gap-3">
            <Crown size={22} className="text-[hsl(45,80%,50%)]" />
            <h1 className="text-lg md:text-xl font-black tracking-wider uppercase">
              Consultoria de Elite
            </h1>
          </div>
          <p className="text-muted-foreground text-sm md:text-base leading-relaxed text-left">
            Acompanhamento individual completo com treino, dieta e estratégia personalizada para construir um <span className="text-foreground font-bold">físico magro, definido e proporcional</span>.
          </p>
        </div>

        <p className="text-muted-foreground text-xs italic">
          O formulário leva menos de 2 minutos. Suas respostas são 100% confidenciais.
        </p>
      </div>
    </section>
  );
};

export default IndividualHero;
