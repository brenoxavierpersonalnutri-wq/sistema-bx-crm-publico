// Seções da página do Desafio Magra e Definida, portadas da página original
// (repo breno-remix-showcase, desafio.brenoxavier.com.br). Idênticas nas 5
// variações; só a promessa da dobra principal (Hero) muda.
import { useEffect, useState } from "react";
import { trechosDoSubtitulo, type VarianteDesafio } from "@/content/desafio/variantes";

const IMG = "/desafio";

type ComCheckout = { checkout: string };

function Cta({ checkout, children, className = "" }: ComCheckout & { children: React.ReactNode; className?: string }) {
  return (
    <a href={checkout} className={`dmd-cta ${className}`}>
      {children}
    </a>
  );
}

function useContagem() {
  const [restante, setRestante] = useState(9 * 60 + 58);
  useEffect(() => {
    const t = window.setInterval(() => setRestante((s) => (s <= 0 ? 9 * 60 + 59 : s - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);
  const mm = String(Math.floor(restante / 60)).padStart(2, "0");
  const ss = String(restante % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function DesafioHero({ variante, checkout }: ComCheckout & { variante: VarianteDesafio }) {
  const contagem = useContagem();
  return (
    <section className="dmd-medium py-10 px-4 md:py-14">
      <div className="max-w-6xl mx-auto flex flex-col lg:flex-row items-center gap-8 lg:gap-10">
        <div className="flex-1 space-y-5">
          <span className="dmd-badge">Não é dieta, é reset do seu metabolismo</span>

          <h1 className="text-3xl md:text-5xl lg:text-6xl font-black leading-tight">
            {variante.titulo} <span className="dmd-gold">{variante.destaque}</span>
          </h1>

          <div className="dmd-price">
            DE <span className="dmd-strike">R$297</span> <span className="dmd-gold font-bold">POR R$29</span> - Expira em{" "}
            <span className="dmd-gold" aria-hidden="true">{contagem}</span>
          </div>

          <p className="text-lg dmd-muted leading-relaxed">
            {trechosDoSubtitulo(variante).map((t, i) =>
              t.negrito ? (
                <span key={i} className="dmd-strong">{t.texto}</span>
              ) : (
                <span key={i}>{t.texto}</span>
              ),
            )}
          </p>

          <Cta checkout={checkout} className="w-full md:w-auto text-xl">
            Quero ficar magra e definida
          </Cta>

          <div className="pt-1">
            <h2 className="text-xl font-bold mb-2">🔥 Metodologia completa de personal e nutri</h2>
            <p className="dmd-muted">
              Treino e alimentação <span className="dmd-strong">em um só lugar</span>, tudo pensado junto para
              garantir seus resultados.
            </p>
          </div>
        </div>

        {/* React 18 não conhece fetchPriority em camelCase: o atributo HTML vai em minúsculas. */}
        <div className="flex-1 grid grid-cols-2 gap-3 max-w-lg w-full">
          {[1, 2, 3, 4].map((n) => (
            <img
              key={n}
              src={`${IMG}/hero-${n}.jpg`}
              alt="Transformação, antes e depois"
              width={300}
              height={300}
              loading={n <= 2 ? "eager" : "lazy"}
              {...{ fetchpriority: n <= 2 ? "high" : "auto" }}
              decoding="async"
              className={`dmd-img object-cover w-full h-48 md:h-56 ${n === 1 ? "dmd-hero-img-1" : ""}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

const DORES = [
  { titulo: "Falsa magra", desc: "Mesmo fazendo dieta, perdendo peso… a gordura abdominal não sai" },
  {
    titulo: "Autoestima baixa",
    desc: "Você não se sente bem com seu corpo de frente ao espelho (a flacidez e falta de definição te incomoda)",
  },
  {
    titulo: "Roupa apertada na barriga, e um corpo flácido sem roupa",
    desc: "Você se olha nas fotos e pensa: \"Esse corpo não me representa, não me faz feliz, preciso mudar\"",
  },
  {
    titulo: "Efeito sanfona",
    desc: "Às vezes até consegue sustentar um pequeno resultado por curto prazo, e depois parece que volta pior do que era né?",
  },
];

export function DesafioDores() {
  return (
    <section className="dmd-dark py-14 px-4">
      <div className="max-w-4xl mx-auto text-center space-y-8">
        <h2 className="text-3xl md:text-4xl font-black leading-tight">
          Já tentou todas dietas possíveis e todos os treinos e parece que nada funciona?{" "}
          <span className="dmd-gold">Calma, o problema não é você!</span>
        </h2>
        <h3 className="text-2xl font-bold">Você sente isso?</h3>
        <div className="grid md:grid-cols-2 gap-4">
          {DORES.map((d) => (
            <div key={d.titulo} className="dmd-card text-left">
              <div className="flex items-start gap-3">
                <span className="dmd-red text-2xl font-bold" aria-hidden="true">❌</span>
                <div className="space-y-1">
                  <h4 className="font-bold text-lg">{d.titulo}</h4>
                  <p className="dmd-muted text-sm">{d.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-lg dmd-muted">
          Se você se identificou com pelo menos 2 pontos, você não precisa de dieta ou mais exercício, precisa de um{" "}
          <strong className="dmd-gold">RESET METABÓLICO</strong>
        </p>
      </div>
    </section>
  );
}

export function DesafioResultados({ checkout }: ComCheckout) {
  return (
    <section className="dmd-medium py-14 px-4">
      <div className="max-w-5xl mx-auto text-center space-y-8">
        <h2 className="text-3xl md:text-4xl font-black">
          Resultados Reais de Quem Fez o <span className="dmd-gold">Reset</span>
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <img
              key={n}
              src={`${IMG}/resultado-${n}.jpg`}
              alt="Transformação, antes e depois"
              loading="lazy"
              decoding="async"
              width={300}
              height={400}
              className="dmd-img object-cover w-full h-48 md:h-64"
            />
          ))}
        </div>
        <Cta checkout={checkout}>Quero meu resultado também</Cta>
      </div>
    </section>
  );
}

const PASSOS_METODO = [
  { forte: "Destrave a queima de gordura", resto: " e acelere seus resultados já nos primeiros dias." },
  { forte: "Queima a gordura mais teimosa:", resto: " barriga, flancos e áreas que parecem nunca sair." },
  { forte: "Promove a definição feminina eficiente:", resto: " menos flacidez e mais firmeza, mesmo com rotina corrida." },
  {
    forte: "Métodos avançados de treino + Dieta AGE:",
    resto: " combinação única de treinos estratégicos e alimentação gostosa e sustentável, sem dietas impossíveis.",
  },
];

export function DesafioMetodo({ checkout }: ComCheckout) {
  return (
    <section className="dmd-dark py-14 px-4">
      <div className="max-w-5xl mx-auto space-y-10">
        <h2 className="text-3xl md:text-4xl font-black text-center">
          Nada deu certo? Esse é o método que <span className="dmd-gold">RESETA</span> o seu{" "}
          <span className="dmd-gold">METABOLISMO</span>.
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-6">
            {PASSOS_METODO.map((p, i) => (
              <div key={p.forte} className="flex items-start gap-4">
                <div className="dmd-step">{i + 1}</div>
                <p className="dmd-muted pt-2">
                  <span className="dmd-strong">{p.forte}</span>
                  {p.resto}
                </p>
              </div>
            ))}
          </div>
          <img
            src={`${IMG}/depoimento.jpg`}
            alt="Depoimento de aluna"
            loading="lazy"
            decoding="async"
            width={720}
            height={1000}
            className="dmd-img w-full h-auto object-contain"
          />
        </div>
        <div className="flex flex-col md:flex-row items-center gap-8 pt-6">
          <img
            src={`${IMG}/breno-hamburguer.png`}
            alt="Breno comendo hambúrguer"
            loading="lazy"
            decoding="async"
            width={415}
            height={600}
            className="dmd-img w-full md:w-1/2 max-h-96 object-cover"
          />
          <div className="space-y-4 text-center md:text-left">
            <h3 className="text-2xl md:text-3xl font-black">
              SOFRER NA DIETA É <span className="dmd-gold">LOUCURA!</span>
            </h3>
            <p className="dmd-muted uppercase font-semibold text-sm">
              (Aqui é proibido dieta chata e impossível de ser seguida)
            </p>
            <Cta checkout={checkout}>Quero ficar magra e definida</Cta>
          </div>
        </div>
      </div>
    </section>
  );
}

const COMO_FUNCIONA = [
  {
    titulo: "Pré-diagnóstico metabólico",
    desc: "Descobrimos onde seu metabolismo travou e ajustamos para seu biotipo e peso atual.",
  },
  {
    titulo: "Método AGE + treinos pilares anti-golpe",
    desc: "Combinação única de alimentação gostosa e estratégica com treinos que ativam fibras musculares para máxima definição.",
  },
  {
    titulo: "Metodologia completa de personal e nutri",
    desc: "O método de quem vive isso na pele diariamente, organizado para você ter constância e resultado.",
  },
];

export function DesafioComoFunciona() {
  return (
    <section className="dmd-medium py-14 px-4">
      <div className="max-w-4xl mx-auto text-center space-y-8">
        <h2 className="text-3xl md:text-4xl font-black">
          COMO FUNCIONA O DESAFIO 14 DIAS <span className="dmd-gold">MAGRA</span> E{" "}
          <span className="dmd-gold">DEFINIDA</span>
        </h2>
        <p className="dmd-muted text-lg">3 passos simples para resetar seu metabolismo e acelerar seus resultados.</p>
        <div className="grid md:grid-cols-3 gap-5">
          {COMO_FUNCIONA.map((p, i) => (
            <div key={p.titulo} className="dmd-card text-center space-y-4">
              <div className="dmd-step mx-auto">{i + 1}</div>
              <h4 className="font-bold text-sm uppercase">{p.titulo}</h4>
              <p className="dmd-muted text-sm">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const ENTREGAVEIS = [
  {
    forte: "Protocolo Reset 14D:",
    resto: " plano dia a dia de reativação do metabolismo, para acelerar a queima de gordura e potencializar sua definição.",
  },
  {
    forte: "Dieta AGE (Alimentação Gostosa e Estratégica):",
    resto: " feita para o seu biotipo e peso atual, garantindo prazer em comer, sem passar fome.",
  },
  {
    forte: "Treino Queima e Defina (academia ou em casa):",
    resto: " métodos avançados e combinação de exercícios estratégicos para modelar seu corpo.",
  },
];

export function DesafioOferta({ checkout }: ComCheckout) {
  return (
    <section id="oferta" className="dmd-light py-14 px-4">
      <div className="max-w-3xl mx-auto text-center space-y-8">
        <h2 className="text-3xl md:text-4xl font-black">O QUE VOCÊ VAI RECEBER:</h2>
        <div className="space-y-4 text-left">
          {ENTREGAVEIS.map((e) => (
            <div key={e.forte} className="flex items-start gap-3">
              <span className="dmd-green text-xl mt-0.5" aria-hidden="true">✅</span>
              <p className="dmd-muted">
                <span className="dmd-strong">{e.forte}</span>
                {e.resto}
              </p>
            </div>
          ))}
          <div className="flex items-start gap-3">
            <span className="text-xl mt-0.5" aria-hidden="true">💬</span>
            <p className="dmd-muted">
              <span className="dmd-strong">Estratégia de Personal e Nutri:</span> especialistas em construir físico
              definido, tudo em um só lugar.
            </p>
          </div>
        </div>
        <div className="space-y-1 pt-2">
          <p className="dmd-strike text-lg">R$ 297</p>
          <p className="text-7xl md:text-8xl font-black dmd-gold">R$ 29</p>
          <p className="dmd-muted text-sm">à vista</p>
        </div>
        <Cta checkout={checkout} className="text-xl">
          Quero ativar meu reset agora
        </Cta>
        <div className="dmd-guarantee space-y-2" data-testid="garantia-preco">
          <h3 className="text-xl font-black dmd-gold">Garantia de resultado</h3>
          <p className="dmd-muted">
            Se você seguir o desafio e não tiver resultado, devolvo cada centavo do seu dinheiro. Garantia de 7 dias.
          </p>
        </div>
      </div>
    </section>
  );
}

export function DesafioSobre() {
  return (
    <section className="dmd-dark py-14 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col items-center gap-8">
          <img
            src={`${IMG}/breno.png`}
            alt="Breno Xavier"
            loading="lazy"
            decoding="async"
            width={560}
            height={529}
            className="rounded-2xl w-80 h-auto object-contain mx-auto"
          />
          <div className="space-y-3 text-center">
            <h2 className="text-3xl font-black">QUEM SOU EU PARA TE ENSINAR ISSO?</h2>
            <h3 className="text-xl font-bold dmd-gold">Especialista em METABOLISMO FEMININO</h3>
            <p className="dmd-muted">Pós graduado em FISIOLOGIA DO EXERCÍCIO</p>
            <p className="dmd-muted">Pós graduado em BIOMECÂNICA E CINESIOLOGIA</p>
            <p className="dmd-muted leading-relaxed">
              Já ajudei mais de <span className="dmd-strong">2.847 mulheres</span> a quebrarem o ciclo do efeito sanfona
              usando o método que vai transformar seu corpo em 14 dias.
            </p>
            <p className="dmd-muted font-semibold">Minha missão: fazer você PARAR de lutar contra seu próprio corpo.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mt-8 max-w-lg mx-auto">
          <img
            src={`${IMG}/breno-antes.jpg`}
            alt="Breno antes"
            loading="lazy"
            decoding="async"
            width={480}
            height={640}
            className="dmd-img object-cover object-top h-72 w-full"
          />
          <img
            src={`${IMG}/breno-depois.jpg`}
            alt="Breno depois"
            loading="lazy"
            decoding="async"
            width={480}
            height={640}
            className="dmd-img object-cover object-top h-72 w-full"
          />
        </div>
        <p className="text-center dmd-muted mt-6 max-w-2xl mx-auto">
          Comecei a ajudar milhares de alunas depois de sofrer com uma barriga inchada, mudei primeiro o meu corpo. Sem
          hipocrisia, eu vivo o que eu defendo diariamente.
        </p>
      </div>
    </section>
  );
}

export function DesafioGarantia({ checkout }: ComCheckout) {
  return (
    <section className="dmd-medium py-14 px-4">
      <div className="max-w-3xl mx-auto space-y-10">
        <div className="dmd-guarantee space-y-4">
          <h3 className="text-2xl font-black dmd-gold">GARANTIA BLINDADA - 7 DIAS</h3>
          <p className="dmd-muted">
            Se você não sentir seu metabolismo mais acelerado, devolvemos 100% do seu dinheiro. Sem perguntas.
          </p>
        </div>
        <div className="text-center space-y-5">
          <h2 className="text-3xl md:text-4xl font-black">
            PARE DE LUTAR CONTRA SEU <span className="dmd-gold">CORPO!</span>
          </h2>
          <p className="dmd-muted text-lg">A transformação que você precisa está a apenas um clique de distância.</p>
          <p className="dmd-muted">
            Se você aplicar e não tiver resultado DEVOLVO CADA CENTAVO DO SEU INVESTIMENTO, nunca ninguém te deu uma
            garantia assim né?
          </p>
          <p className="dmd-muted font-semibold">Eu vivo isso diariamente, vamos juntos nessa!</p>
          <Cta checkout={checkout} className="text-xl">
            Quero ficar magra e definida
          </Cta>
          <div className="flex flex-col sm:flex-row justify-center gap-2 sm:gap-6 text-sm dmd-muted pt-3">
            <span>✓ Acesso imediato após a compra</span>
            <span>✓ Garantia incondicional de 7 dias</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function DesafioWhatsApp() {
  return (
    <a
      href="https://wa.me/5531970000106"
      target="_blank"
      rel="noopener noreferrer"
      className="dmd-whats"
      aria-label="Falar no WhatsApp"
    >
      <svg viewBox="0 0 32 32" width="28" height="28" fill="white" aria-hidden="true">
        <path d="M16.004 3.2C9.158 3.2 3.6 8.758 3.6 15.604c0 2.178.57 4.308 1.654 6.186L3.2 28.8l7.216-2.012a12.36 12.36 0 005.588 1.336c6.846 0 12.396-5.55 12.396-12.396S22.85 3.2 16.004 3.2zm0 22.596a10.16 10.16 0 01-5.178-1.418l-.372-.22-4.282 1.194 1.214-4.18-.242-.386A10.14 10.14 0 015.8 15.604c0-5.626 4.578-10.204 10.204-10.204 5.626 0 10.196 4.578 10.196 10.204 0 5.634-4.57 10.192-10.196 10.192zm5.594-7.636c-.306-.154-1.818-.898-2.1-.998-.282-.102-.488-.154-.694.152-.206.308-.794.998-.974 1.204-.18.206-.358.23-.664.076-.306-.152-1.294-.476-2.464-1.52-.91-.812-1.526-1.816-1.704-2.122-.18-.306-.02-.472.134-.624.138-.138.306-.358.46-.538.152-.18.204-.308.306-.512.102-.206.052-.386-.026-.538-.076-.154-.694-1.672-.95-2.29-.25-.6-.506-.518-.694-.528-.18-.008-.386-.01-.592-.01s-.538.076-.82.386c-.282.306-1.078 1.054-1.078 2.57 0 1.518 1.104 2.984 1.258 3.19.154.206 2.172 3.316 5.264 4.65.736.318 1.31.508 1.758.65.738.234 1.41.2 1.942.122.592-.088 1.818-.744 2.074-1.462.258-.718.258-1.334.18-1.462-.076-.128-.282-.206-.59-.358z" />
      </svg>
    </a>
  );
}
