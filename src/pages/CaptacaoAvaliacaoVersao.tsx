// Versões de teste da captação: /avaliacao/v1 .. /avaliacao/v6.
// Mesma página da /avaliacao (controle, intacta); troca só título e foto do
// meio (config/avaliacaoVersoes). A versão vai no `origem` da resposta e no
// parâmetro `versao` do Lead / Lead_qualificado. Versão inexistente cai na
// /avaliacao, com a query string, pra não perder clique de anúncio.
import { useEffect, lazy, Suspense } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import HeroSection from "@/components/novaav/HeroSection";
import IndividualResults from "@/components/novaav/IndividualResults";
import AboutSection from "@/components/novaav/AboutSection";
import { avaliacaoVersao } from "@/config/avaliacaoVersoes";
import { initializeMetaPixel } from "@/lib/novaavPixel";
import { iniciarBeaconDaPagina } from "@/lib/pageBeacon";
import { iniciarEventosDoRotador } from "@/lib/rotatorEventos";

const QualificationForm = lazy(() => import("@/components/novaav/QualificationForm"));

const FormFallback = () => (
  <div className="min-h-[80vh] flex items-center justify-center">
    <div className="text-xs text-muted-foreground uppercase tracking-widest">
      Carregando formulário…
    </div>
  </div>
);

const CaptacaoAvaliacaoVersao = () => {
  const navigate = useNavigate();
  const { search } = useLocation();
  const { versao: param } = useParams();
  const versao = avaliacaoVersao(param);

  useEffect(() => {
    if (!versao) return;
    window.scrollTo(0, 0);
    initializeMetaPixel();
    // Teste /r/avaliacao-4v: conexão e velocidade (page_beacons) e o pageview
    // do rotador, que também deixa window.cmTrack pronto pro 'checkout' do
    // formulário. Os dois só contam quando a URL traz o cm_click do rotador.
    iniciarBeaconDaPagina("avaliacao", versao.key);
    return iniciarEventosDoRotador();
  }, [versao]);

  if (!versao) return <Navigate to={`/avaliacao${search}`} replace />;

  const handleDisqualified = () => {
    navigate("/vsl");
  };

  return (
    <div
      data-versao={versao.rotulo}
      className="novaav-theme min-h-screen bg-background text-foreground selection:bg-accent selection:text-accent-foreground"
    >
      <HeroSection
        variation="v1"
        override={{
          headlineBefore: versao.headlineBefore,
          headlineHighlight: versao.headlineHighlight,
          photo: versao.photo,
        }}
      />
      <div id="formulario">
        <Suspense fallback={<FormFallback />}>
          <QualificationForm onDisqualified={handleDisqualified} versao={versao.rotulo} />
        </Suspense>
      </div>
      <IndividualResults />
      <AboutSection />
    </div>
  );
};

export default CaptacaoAvaliacaoVersao;
