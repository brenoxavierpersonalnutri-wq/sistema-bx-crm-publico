// Captação da consultoria individual (elite) — portada do novaav /individual.
// Qualificada vai direto pro WhatsApp do closer com as respostas.
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import IndividualHero from "@/components/novaav/IndividualHero";
import IndividualAbout from "@/components/novaav/IndividualAbout";
import IndividualResults from "@/components/novaav/IndividualResults";
import QualificationForm from "@/components/novaav/QualificationForm";
import { initializeMetaPixel } from "@/lib/novaavPixel";

const CaptacaoIndividual = () => {
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo(0, 0);
    initializeMetaPixel();
  }, []);

  const handleDisqualified = () => {
    navigate("/vsl");
  };

  return (
    <div className="novaav-theme min-h-screen bg-background text-foreground selection:bg-accent selection:text-accent-foreground">
      <IndividualHero />
      <IndividualResults />
      <IndividualAbout />
      <div id="formulario">
        <QualificationForm onDisqualified={handleDisqualified} isConsultoria />
      </div>
    </div>
  );
};

export default CaptacaoIndividual;
