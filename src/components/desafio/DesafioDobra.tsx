// Primeira dobra das versões v7..v9 (teste de dobra do DMD). Head campeã,
// botão de compra antes do fim da tela num celular de 390x844 e, abaixo do
// botão, a garantia (método LPSG: garantia logo abaixo do CTA).
import { useEffect, useState } from "react";
import {
  ALUNAS_ATENDIDAS,
  BENEFICIOS_DOBRA,
  HEAD_CAMPEA,
  PRECO_R29_ATE,
  SUBHEAD_CURTA,
  faltaAte,
  type VarianteDobra,
} from "@/content/desafio/dobras";

const IMG = "/desafio";

function BotaoDobra({ checkout }: { checkout: string }) {
  return (
    <div className="space-y-2">
      <a href={checkout} className="dmd-cta dmd-cta-dobra w-full" data-testid="cta-dobra">
        Quero entrar por R$29
      </a>
      <p className="text-xs dmd-muted text-center">Acesso imediato · Garantia de 7 dias ou seu dinheiro de volta</p>
    </div>
  );
}

function Preco() {
  return (
    <p className="dmd-price">
      DE <span className="dmd-strike">R$297</span> <span className="dmd-gold font-bold">POR R$29</span> à vista
    </p>
  );
}

function Titulo() {
  return (
    <h1 className="dmd-h1-dobra font-black">
      {HEAD_CAMPEA.titulo} <span className="dmd-gold">{HEAD_CAMPEA.destaque}</span>
    </h1>
  );
}

function ProvaAbaixo() {
  return (
    <div className="space-y-2 pt-1" data-testid="prova-dobra">
      <p className="text-sm dmd-muted text-center">
        Mais de <span className="dmd-strong">{ALUNAS_ATENDIDAS} mulheres</span> já passaram pelo método
      </p>
      <div className="grid grid-cols-3 gap-2">
        {[1, 3, 5].map((n) => (
          <img
            key={n}
            src={`${IMG}/resultado-${n}.jpg`}
            alt="Antes e depois de aluna"
            width={160}
            height={160}
            loading="eager"
            decoding="async"
            className="dmd-img object-cover w-full h-24"
          />
        ))}
      </div>
    </div>
  );
}

function PrazoReal() {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!PRECO_R29_ATE) return;
    const t = window.setInterval(() => setAgora(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const falta = faltaAte(PRECO_R29_ATE, agora);
  if (!falta || !PRECO_R29_ATE) return null;
  const fim = new Date(PRECO_R29_ATE).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <p className="text-sm text-center dmd-muted" data-testid="prazo-real">
      O preço de R$29 vale até <span className="dmd-strong">{fim}</span> · faltam{" "}
      <span className="dmd-gold font-bold">{falta}</span>
    </p>
  );
}

export function DesafioHeroDobra({ variante, checkout }: { variante: VarianteDobra; checkout: string }) {
  return (
    <section className="dmd-medium px-4 pt-6 pb-10 md:py-14" data-dobra={variante.dobra}>
      <div className="max-w-xl mx-auto space-y-4">
        <Titulo />

        {variante.dobra === "prova" && (
          <>
            <p className="text-base dmd-muted leading-snug">{SUBHEAD_CURTA}</p>
            <Preco />
            <BotaoDobra checkout={checkout} />
            <ProvaAbaixo />
          </>
        )}

        {variante.dobra === "antes-depois" && (
          <>
            {/* React 18 não conhece fetchPriority em camelCase: o atributo HTML vai em minúsculas. */}
            <div className="relative" data-testid="antes-depois-dobra">
              <img
                src={`${IMG}/hero-2.jpg`}
                alt="Antes e depois de aluna do desafio"
                width={600}
                height={574}
                loading="eager"
                {...{ fetchpriority: "high" }}
                decoding="async"
                className="dmd-img object-cover w-full dmd-foto-dobra"
              />
              <span className="dmd-rotulo-foto left-2">Antes</span>
              <span className="dmd-rotulo-foto right-2">Depois</span>
            </div>
            <Preco />
            <BotaoDobra checkout={checkout} />
          </>
        )}

        {variante.dobra === "beneficios" && (
          <>
            <ul className="space-y-2" data-testid="beneficios-dobra">
              {BENEFICIOS_DOBRA.map((b) => (
                <li key={b.forte} className="flex items-start gap-2 dmd-muted leading-snug">
                  <span className="dmd-green font-bold" aria-hidden="true">✓</span>
                  <span>
                    <span className="dmd-strong">{b.forte}</span>
                    {b.resto}
                  </span>
                </li>
              ))}
            </ul>
            <Preco />
            <BotaoDobra checkout={checkout} />
            <PrazoReal />
          </>
        )}
      </div>
    </section>
  );
}
