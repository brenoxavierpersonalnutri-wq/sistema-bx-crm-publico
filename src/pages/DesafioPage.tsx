// /desafio/v1..v9: Desafio Magra e Definida (R$29).
// v1..v6: 6 promessas na dobra principal, resto idêntico (split /r/desafio).
// v7..v9: teste de primeira dobra com a head campeã e o botão visível sem
// rolar (src/content/desafio/dobras.ts). Do bloco "Dores" para baixo, igual.
import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { varianteDesafio } from "@/content/desafio/variantes";
import { varianteDobra } from "@/content/desafio/dobras";
import { checkoutComVariante, checkoutDoDesafio, enviarCheckoutDoRotador } from "@/lib/desafioCheckout";
import { initializeMetaPixel, trackDesafioVariante } from "@/lib/novaavPixel";
import { iniciarBeaconDaPagina } from "@/lib/pageBeacon";
import { captureUtmsFromUrl } from "@/lib/utmCapture";
import NotFound from "@/pages/NotFound";
import { DesafioHeroDobra } from "@/components/desafio/DesafioDobra";
import {
  DesafioComoFunciona,
  DesafioDores,
  DesafioGarantia,
  DesafioHero,
  DesafioMetodo,
  DesafioOferta,
  DesafioResultados,
  DesafioSobre,
  DesafioWhatsApp,
} from "@/components/desafio/DesafioSecoes";
import "@/components/desafio/desafio.css";

export default function DesafioPage() {
  const { variante: id } = useParams<{ variante: string }>();
  const variante = varianteDesafio(id);
  const dobra = variante ? null : varianteDobra(id);
  const idVariante = variante?.id ?? dobra?.id ?? null;
  // utm_* do anúncio + marcador do clique do rotador (sck/src/utm_term) para a venda voltar com a variação.
  const checkout = useMemo(() => {
    const base = checkoutDoDesafio(window.location.search, idVariante);
    return dobra ? checkoutComVariante(base, dobra.id) : base;
  }, [idVariante, dobra]);

  // Clique em qualquer botão de compra: 'checkout' no rotator-track (keepalive, não segura a navegação).
  const aoClicar = (e: React.MouseEvent<HTMLElement>) => {
    const alvo = e.target as HTMLElement | null;
    if (!alvo?.closest?.("a.dmd-cta")) return;
    enviarCheckoutDoRotador();
    if (dobra) trackDesafioVariante("DMD_CliqueCheckout", dobra.id);
  };

  useEffect(() => {
    if (!idVariante) return;
    document.title = "Desafio Magra e Definida | Breno Xavier";
    captureUtmsFromUrl();
    // Pixel SEU_PIXEL_ID: init + 1 PageView por carga (trava em window.__metaPixelInitialized).
    initializeMetaPixel();
    if (dobra) trackDesafioVariante("DMD_VerPagina", dobra.id);
    iniciarBeaconDaPagina("desafio", idVariante);
  }, [idVariante, dobra]);

  if (!variante && !dobra) return <NotFound />;

  return (
    <main className="dmd" onClick={aoClicar} onAuxClick={aoClicar}>
      {dobra ? (
        <DesafioHeroDobra variante={dobra} checkout={checkout} />
      ) : (
        <DesafioHero variante={variante!} checkout={checkout} />
      )}
      <DesafioDores />
      <DesafioResultados checkout={checkout} />
      <DesafioMetodo checkout={checkout} />
      <DesafioComoFunciona />
      <DesafioOferta checkout={checkout} />
      <DesafioSobre />
      <DesafioGarantia checkout={checkout} />
      <DesafioWhatsApp />
    </main>
  );
}
