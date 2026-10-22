import { GraduationCap } from "lucide-react";

import brenoQuemSouEu from "@/assets/novaav/breno-quem-sou-eu.jpg";
import brenoTransformacao from "@/assets/novaav/breno-transformacao.jpg";

const credentials = [
  "Pós-graduado em Biomecânica e Cinesiologia",
  "Pós-graduado em Bases Fisiológicas",
  "Ed. Física",
  "Nutrição",
];

const IndividualAbout = () => {
  return (
    <section className="px-4 py-16 md:py-24 border-b border-border">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex items-center gap-3">
          <GraduationCap size={24} className="text-[hsl(45,80%,50%)]" />
          <h2 className="text-xl md:text-2xl font-black tracking-wider uppercase">
            Quem sou eu
          </h2>
        </div>

        <div className="flex justify-center">
          <div className="rounded-2xl overflow-hidden border border-border bg-secondary/20 max-w-[300px]">
            <img
              src={brenoQuemSouEu}
              alt="Breno Xavier"
              className="w-full h-auto object-cover"
            />
          </div>
        </div>

        <p className="text-muted-foreground text-sm md:text-base leading-relaxed">
          Além de me capacitar há muito tempo, eu <span className="text-foreground font-bold">vivo isso na prática</span>, sem hormônio, sem loucura, sem deixar de viver 🍔🍫
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {credentials.map((item) => (
            <div
              key={item}
              className="flex items-start gap-3 bg-secondary/30 border border-border rounded-xl p-4"
            >
              <div className="w-2 h-2 rounded-full bg-[hsl(45,80%,50%)] mt-2 shrink-0" />
              <p className="text-sm md:text-base text-foreground font-medium">{item}</p>
            </div>
          ))}
        </div>

        <div className="flex justify-center pt-4">
          <div className="rounded-2xl overflow-hidden border border-border bg-secondary/20 max-w-[200px]">
            <img
              src={brenoTransformacao}
              alt="Breno Xavier - transformação pessoal"
              className="w-full h-auto object-cover scale-105"
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default IndividualAbout;
