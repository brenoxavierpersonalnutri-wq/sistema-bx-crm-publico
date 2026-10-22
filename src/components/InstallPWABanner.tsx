import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Download, Share, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const VISIT_KEY = "bx_visit_count";
const DISMISS_KEY = "bx_install_dismissed";

// Instalar o app é coisa do sistema INTERNO do time. Regra:
// - na tela de login, pode oferecer;
// - fora dela, só com usuário logado e fora de qualquer página pública.
// Lead/aluna em formulário, captação, avaliação, agendamento, checkout,
// landing, obrigado, rotator etc. nunca vê o convite.
const ROTAS_LOGIN = ["/login", "/auth"];

// Prefixos públicos (casa a rota exata ou qualquer subrota dela).
const ROTAS_PUBLICAS = [
  "/agendar", "/marcar", "/agendamento", "/teste-agendamento",
  "/avaliacao", "/captacao", "/quiz", "/quiz-obrigado", "/qualificacao",
  "/vsl", "/lp", "/landing", "/aula", "/mentoria", "/instagram", "/paginas-e-criativos",
  "/individual", "/nqualf", "/nao-selecionada", "/obrigado",
  "/parceria", "/proposta-parceria", "/implementacao", "/desafio", "/v1", "/v2", "/v3", "/v4", "/v5",
  "/pesquisa-satisfacao", "/feedback", "/anamnese", "/substituicoes", "/troca",
  "/briefing", "/convite", "/google-auth-callback", "/mapamental",
  "/webinar", "/checkout", "/pagamento-sucesso", "/r", "/aluna",
];

// Neste projeto a raiz "/" é do sistema interno (ou redireciona pra captação).
const RAIZ_E_PUBLICA = false;

// Quem chega de anúncio/link rastreado é lead, mesmo que o navegador tenha sessão.
const VEIO_DE_TRAFEGO = /[?&](utm_[a-z]+|fbclid|gclid|ttclid)=/i;

const casa = (pathname: string, rota: string) =>
  pathname === rota || pathname.startsWith(rota + "/");

// O navegador dispara beforeinstallprompt em QUALQUER rota (o manifest é global).
// Seguramos sempre: preventDefault impede o convite automático do navegador
// (mini-barra do Chrome) e o evento fica guardado pro banner usar só onde pode.
let promptGuardado: BeforeInstallPromptEvent | null = null;
const avisarQuandoChegar = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    promptGuardado = e as BeforeInstallPromptEvent;
    avisarQuandoChegar.forEach((fn) => fn());
  });
}

export default function InstallPWABanner() {
  const { pathname, search } = useLocation();
  const { user } = useAuth();
  const naTelaDeLogin = ROTAS_LOGIN.some((r) => casa(pathname, r));
  const emPaginaPublica =
    ROTAS_PUBLICAS.some((r) => casa(pathname, r)) ||
    (RAIZ_E_PUBLICA && pathname === "/") ||
    VEIO_DE_TRAFEGO.test(search);
  const podeOferecer = (naTelaDeLogin && !VEIO_DE_TRAFEGO.test(search)) || (!!user && !emPaginaPublica);

  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const visitaContada = useRef<number | null>(null);

  useEffect(() => {
    if (!podeOferecer) {
      setShow(false);
      return;
    }

    // Conta a visita uma vez por carregamento, e só no sistema interno.
    if (visitaContada.current === null) {
      visitaContada.current = parseInt(localStorage.getItem(VISIT_KEY) || "0", 10) + 1;
      localStorage.setItem(VISIT_KEY, String(visitaContada.current));
    }
    const count = visitaContada.current;

    const dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS Safari
      window.navigator.standalone === true;

    if (dismissed || isStandalone) return;

    const ua = window.navigator.userAgent.toLowerCase();
    const iOS = /iphone|ipad|ipod/.test(ua) && !/crios|fxios/.test(ua);
    setIsIOS(iOS);

    // iOS não tem o evento: mostra a dica a partir da 2ª visita.
    if (iOS && count >= 2) {
      setShow(true);
      return;
    }

    const quandoChegar = () => {
      if (promptGuardado && count >= 2) setShow(true);
    };
    quandoChegar();
    avisarQuandoChegar.add(quandoChegar);
    return () => {
      avisarQuandoChegar.delete(quandoChegar);
    };
  }, [podeOferecer]);

  const handleInstall = async () => {
    const evento = promptGuardado;
    if (!evento) return;
    await evento.prompt();
    const choice = await evento.userChoice;
    if (choice.outcome === "accepted") {
      localStorage.setItem(DISMISS_KEY, "1");
      setShow(false);
    }
    promptGuardado = null;
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  };

  if (!podeOferecer || !show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-xl border border-border bg-card p-4 shadow-2xl animate-in slide-in-from-bottom-4">
      <button
        onClick={handleDismiss}
        className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
        aria-label="Fechar"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <img src="/icons/icon-192.png" alt="Time BX" className="h-12 w-12 rounded-lg" />
        <div className="flex-1">
          <h3 className="text-sm font-bold text-foreground">
            Instalar Time Breno Xavier no celular
          </h3>
          {isIOS ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              Toque em <Share className="inline h-3 w-3" /> compartilhar → Adicionar à Tela de Início
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                Acesso rápido direto da sua tela inicial.
              </p>
              <Button size="sm" onClick={handleInstall} className="mt-2 h-8">
                <Download className="mr-1 h-3 w-3" />
                Instalar
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
