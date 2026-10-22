// Captação da avaliação gratuita — portada do novaav (novaav.brenoxavier.com.br).
// Roda no mesmo app do agendamento: formulário → qualifica → /agendar interno.
// Variações de copy: /avaliacao?v=v1..v5 (default v1).
import { useEffect, lazy, Suspense } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import HeroSection from "@/components/novaav/HeroSection";
import IndividualResults from "@/components/novaav/IndividualResults";
import AboutSection from "@/components/novaav/AboutSection";
import { variations, type VariationKey } from "@/config/novaavVariations";
import { initializeMetaPixel } from "@/lib/novaavPixel";

// Formulário é o componente mais pesado da página — carrega sob demanda
// enquanto o usuário lê o hero.
const QualificationForm = lazy(() => import("@/components/novaav/QualificationForm"));

const FormFallback = () => (
  <div className="min-h-[80vh] flex items-center justify-center">
    <div className="text-xs text-muted-foreground uppercase tracking-widest">
      Carregando formulário…
    </div>
  </div>
);

const CaptacaoAvaliacao = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const vParam = (searchParams.get("v") || "v1") as VariationKey;
  const variation: VariationKey = variations[vParam] ? vParam : "v1";

  useEffect(() => {
    window.scrollTo(0, 0);
    initializeMetaPixel();
  }, []);

  const handleDisqualified = () => {
    navigate("/vsl");
  };

  return (
    <div className="novaav-theme min-h-screen bg-background text-foreground selection:bg-accent selection:text-accent-foreground">
      <HeroSection variation={variation} />
      <div id="formulario">
        <Suspense fallback={<FormFallback />}>
          <QualificationForm onDisqualified={handleDisqualified} />
        </Suspense>
      </div>
      <IndividualResults />
      <AboutSection />
    </div>
  );
};

export default CaptacaoAvaliacao;
