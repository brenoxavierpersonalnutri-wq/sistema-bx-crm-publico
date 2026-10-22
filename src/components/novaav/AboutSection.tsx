import { GraduationCap } from "lucide-react";
import brenoQuemSouEu from "@/assets/novaav/breno-quem-sou-eu.jpg";

const credentials = [
  "Pós-graduado em Biomecânica e Cinesiologia",
  "Pós-graduado em Bases Fisiológicas do Exercício",
  "Graduado em Educação Física",
  "Graduado em Nutrição",
];

const desires = [
  {
    title: "Corpo seco e definido",
    sub: "Eliminando gordura localizada e definindo o físico de verdade",
  },
  {
    title: "Barriga seca",
    sub: "Gordura abdominal e gordura de sutiã que ninguém consegue tirar",
  },
  {
    title: "Coxa definida",
    sub: "Gordura da coxa, celulite e lipedema — reduzindo e definindo",
  },
  {
    title: "Braço magro e definido",
    sub: "Acabando com o \"braço de confeiteira\" sem precisar passar fome",
  },
];

const AboutSection = () => {
  return (
    <section className="px-4 py-16 md:py-24 border-b border-border bg-secondary/20">
      <div className="max-w-3xl mx-auto space-y-10">

        {/* Header */}
        <div className="flex items-center gap-3">
          <GraduationCap size={24} className="text-[hsl(45,80%,50%)]" />
          <h2 className="text-2xl md:text-4xl font-black tracking-tighter uppercase">
            Quem sou eu
          </h2>
        </div>

        {/* Photo */}
        <div className="flex justify-center">
          <div className="rounded-2xl overflow-hidden border border-[hsl(45,80%,50%)]/30 bg-secondary/20 max-w-[300px] shadow-[0_0_30px_hsl(45,80%,50%,0.1)]">
            <img
              src={brenoQuemSouEu}
              alt="Breno Xavier"
              className="w-full h-auto object-cover"
            />
          </div>
        </div>

        {/* Bio */}
        <div className="space-y-4 text-muted-foreground text-base md:text-lg leading-relaxed">
          <p>
            Tudo que aprendi nas graduações em{" "}
            <span className="text-foreground font-bold">Educação Física e Nutrição</span>,
            e nas pós-graduações em{" "}
            <span className="text-foreground font-bold">Biomecânica e Bases Fisiológicas</span>{" "}
            — eu trouxe pra uma vida real.
          </p>
          <p>
            Sem protocolo genérico. Sem dieta burra e impossível de seguir. Sem treino de duas horas por dia.
          </p>
          <p>
            Específico pra mulher que parece magra mas carrega gordura localizada — e quer, de verdade,
            um corpo{" "}
            <span className="text-foreground font-bold">slim, seco e definido</span>,
            com barriga lisa, braço magro e coxa definida.
          </p>
        </div>

        {/* Mechanism */}
        <div className="bg-[hsl(45,80%,50%)]/10 border border-[hsl(45,80%,50%)]/40 rounded-2xl p-5 space-y-2">
          <p className="text-xs font-black tracking-[0.2em] uppercase text-[hsl(45,80%,50%)]">Método Slim Definida</p>
          <p className="text-base md:text-lg text-foreground font-bold leading-snug">
            Mais de 800 mulheres perderam gordura localizada, secaram a barriga e têm braços finos e definidos, coxas e glúteos firmes e desenhados — com pequenos ajustes.
          </p>
        </div>

        {/* Desires */}
        <div className="space-y-4">
          <p className="text-xs font-black tracking-[0.2em] uppercase text-[hsl(45,80%,50%)]">
            Para quem quer
          </p>
          <div className="grid gap-3">
            {desires.map((d) => (
              <div
                key={d.title}
                className="flex items-start gap-4 bg-secondary/30 border border-[hsl(45,80%,50%)]/20 rounded-2xl p-5"
              >
                <div className="w-3 h-3 rounded-full bg-[hsl(45,80%,50%)] mt-1 shrink-0" />
                <div className="space-y-1">
                  <p className="text-base md:text-lg font-black text-foreground">{d.title}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{d.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
};

export default AboutSection;
