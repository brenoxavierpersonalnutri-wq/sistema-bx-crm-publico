import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

export default function TesteAgendamento() {
  const simulatedParams = new URLSearchParams({
    nome: "Teste Novo",
    whatsapp: "69984719845",
    "Qual seu objetivo estético?": "Apenas emagrecer",
    "Qual sua altura? (em cm)": "145 cm",
    "Qual seu peso? (em kg)": "56 kg",
    "Qual o seu Instagram?": "@joaoteste",
    "Você fica sentada no seu trabalho? Quantas horas por dia?": "5 horas",
    "Qual a sua profissão?": "Empresária",
    "Você já teve algum acompanhamento individual?": "Sim - acompanhamento nutricional",
    "Quanto você já investiu no último ano?": "Entre R$ 700 e R$ 3.000"
  }).toString();

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 font-sans text-center text-white">
      <div className="max-w-md w-full space-y-8 flex flex-col items-center">
        <div className="mx-auto w-16 h-16 bg-[#25D366] rounded-full flex items-center justify-center">
          <CheckCircle2 className="w-10 h-10 text-white" />
        </div>
        
        <h1 className="text-4xl font-black uppercase text-white tracking-tight leading-none">
          PARABÉNS, VOCÊ FOI <br/>
          <span className="text-[#FBBF24]">SELECIONADA!</span>
        </h1>
        
        <p className="text-zinc-400 text-sm max-w-[300px]">
          Clique no botão abaixo para falar com nosso time e agendar sua avaliação gratuita.
        </p>

        <Button 
          onClick={() => window.open(`/agendar?${simulatedParams}`, "_self")}
          className="w-full bg-[#25D366] hover:bg-[#1DA851] text-white font-bold h-14 rounded-full text-base uppercase tracking-wide mt-8 shadow-[0_0_20px_rgba(37,211,102,0.3)] transition-all hover:scale-105"
        >
          Falar com o time no WhatsApp {" >"}
        </Button>

        <p className="text-xs text-zinc-600 mt-12">
          Página de simulação nativa para testes de roteamento.
        </p>
      </div>
    </div>
  );
}
