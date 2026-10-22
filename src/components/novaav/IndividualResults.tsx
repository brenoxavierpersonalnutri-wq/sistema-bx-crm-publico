import resultado1 from "@/assets/novaav/resultado-1.jpg";
import resultado2 from "@/assets/novaav/resultado-2.jpg";
import resultado3 from "@/assets/novaav/resultado-3.jpg";
import resultado4 from "@/assets/novaav/resultado-4.jpg";
import resultado5 from "@/assets/novaav/resultado-5.jpg";
import resultado6 from "@/assets/novaav/resultado-6.jpg";

const results = [
  { src: resultado1, alt: "Transformação corporal - recomposição frontal" },
  { src: resultado2, alt: "Transformação corporal - correção postural e glúteo" },
  { src: resultado3, alt: "Transformação corporal - costas e definição" },
  { src: resultado4, alt: "Transformação corporal - redução de gordura" },
  { src: resultado5, alt: "Transformação corporal - resultado na academia" },
  { src: resultado6, alt: "Transformação corporal - 1 mês de acompanhamento individual" },
];

const IndividualResults = () => {
  return (
    <section className="px-4 py-16 md:py-24 border-b border-border">
      <div className="max-w-4xl mx-auto space-y-10">
        <h2 className="text-xl md:text-2xl font-black tracking-wider uppercase text-center">
          O único protocolo desenvolvido para a <span className="text-[hsl(45,80%,50%)]">falsa magra</span>: corpo slim, seco e definido com uma vida real.
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {results.map((item, i) => (
            <div
              key={i}
              className="rounded-2xl overflow-hidden border border-border bg-secondary/20"
            >
              <img
                src={item.src}
                alt={item.alt}
                className="w-full h-auto object-cover"
                loading="lazy"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default IndividualResults;
