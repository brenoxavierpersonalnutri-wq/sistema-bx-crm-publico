import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, Instagram } from "lucide-react";
import { useNavigate } from "react-router-dom";
import boardHtml from "@/content/board-conteudo.html?raw";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { PublicarInstagramDialog } from "@/components/conteudo/PublicarInstagramDialog";
import { AgendadosSheet } from "@/components/conteudo/AgendadosSheet";
import {
  type CardPedido, type Publicacao, PENDENTES, listarPublicacoes, podePublicar as calcPodePublicar, ultimaPorCard,
} from "@/lib/conteudo/publicacoes";

// Board de conteúdo (estratégia dos 5 perfis) servido dentro de um iframe para preservar o script/estilos
// próprios do HTML. Fica atrás de ProtectedRoute, então só abre logado.
// Publicar no Instagram: o board manda {fonte:"board-conteudo", tipo:"publicar"} por postMessage; esta página abre
// o painel, fala com o serviço headturbo-zernio (VPS) e devolve ao board o selo de status de cada card.
export default function Conteudo() {
  const { isAdmin, allowedModules } = useAuth();
  const pode = calcPodePublicar(isAdmin, allowedModules);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [card, setCard] = useState<CardPedido | null>(null);
  const [lista, setLista] = useState<Publicacao[]>([]);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const navigate = useNavigate();

  const mandar = useCallback((msg: Record<string, unknown>) => {
    // "*": o iframe é srcDoc (sem navegação própria) e a mensagem só leva permissão e status/link dos posts.
    iframeRef.current?.contentWindow?.postMessage({ fonte: "crm-conteudo", ...msg }, "*");
  }, []);

  const recarregar = useCallback(async () => {
    if (!pode) return;
    setCarregando(true);
    try {
      setLista(await listarPublicacoes());
      setErroLista(null);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setErroLista(code === "42P01" || code === "PGRST205"
        ? "A tabela conteudo_publicacoes ainda não existe: falta rodar a migration 20261124100000 no SQL do Supabase."
        : (e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [pode]);

  // board -> CRM
  useEffect(() => {
    const ouvir = (ev: MessageEvent) => {
      if (ev.source !== iframeRef.current?.contentWindow || !ev.data || ev.data.fonte !== "board-conteudo") return;
      if (ev.data.tipo === "pronto") {
        mandar({ tipo: "config", podePublicar: pode });
        mandar({ tipo: "status", itens: ultimaPorCard(lista) });
      }
      if (ev.data.tipo === "publicar" && pode) {
        const d = ev.data as Partial<CardPedido>;
        if (typeof d.card_ref === "string" && typeof d.texto === "string") {
          setCard({ card_ref: d.card_ref.slice(0, 200), perfil: String(d.perfil || "").slice(0, 40), perfil_nome: String(d.perfil_nome || ""), coluna: String(d.coluna || ""), texto: d.texto });
        }
      }
    };
    window.addEventListener("message", ouvir);
    return () => window.removeEventListener("message", ouvir);
  }, [mandar, pode, lista]);

  // CRM -> board: permissão e selos
  useEffect(() => { mandar({ tipo: "config", podePublicar: pode }); }, [mandar, pode]);
  useEffect(() => { mandar({ tipo: "status", itens: ultimaPorCard(lista) }); }, [mandar, lista]);

  // lista: ao abrir e a cada 30 s com a aba visível (o serviço atualiza o status pela Zernio)
  useEffect(() => {
    if (!pode) return;
    void recarregar();
    const t = setInterval(() => { if (document.visibilityState === "visible") void recarregar(); }, 30_000);
    return () => clearInterval(t);
  }, [pode, recarregar]);

  const nPendentes = lista.filter((p) => PENDENTES.includes(p.status)).length;

  return (
    <div className="relative">
      <iframe
        ref={iframeRef}
        title="Board de Conteúdo"
        srcDoc={boardHtml}
        style={{ width: "100%", height: "100vh", border: "none", display: "block" }}
      />
      {pode && (
        <>
          <div className="absolute right-4 top-4 flex gap-2">
            <Button size="sm" className="shadow" onClick={() => navigate("/conteudo/react")}>
              <Clapperboard className="mr-2 h-4 w-4" /> Estúdio React
            </Button>
            <Button size="sm" variant="secondary" className="shadow" onClick={() => setAberto(true)}>
              <Instagram className="mr-2 h-4 w-4" /> Agendados{nPendentes ? ` (${nPendentes})` : ""}
            </Button>
          </div>
          <PublicarInstagramDialog card={card} onClose={() => setCard(null)} onConcluido={() => void recarregar()} />
          <AgendadosSheet aberto={aberto} onAbrir={setAberto} lista={lista} erroLista={erroLista} carregando={carregando} onRecarregar={() => void recarregar()} />
        </>
      )}
    </div>
  );
}
