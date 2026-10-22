// "Colar link do Instagram": a VPS baixa o Reels/post (yt-dlp, sem login), deixa em MP4 H.264 e o vídeo vem para o
// player como se ele tivesse escolhido o arquivo. Post privado, apagado ou bloqueio do Instagram: erro legível e a
// sugestão de baixar no celular e usar "Escolher vídeo".
import { useEffect, useRef, useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { type EstadoLink, type ProjetoReact, carregarLink, estadoLink, pareceLink, trazerVideo } from "@/lib/conteudo/react/api";

interface Props {
  /** cria o projeto se ainda não existe (o download mora na pasta dele na VPS) */
  garantirProjeto: () => Promise<ProjetoReact>;
  onPronto: (arquivo: File, info: EstadoLink, projeto: ProjetoReact) => void;
  desativado?: boolean;
  compacto?: boolean;
}

const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export function CarregarLink({ garantirProjeto, onPronto, desativado, compacto }: Props) {
  const [url, setUrl] = useState("");
  const [rodando, setRodando] = useState(false);
  const [etapa, setEtapa] = useState("");
  const [frac, setFrac] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  const carregar = async () => {
    const texto = url.trim();
    setErro(null);
    if (!pareceLink(texto)) { setErro("Cole o link de um Reels ou post do Instagram (o \"Copiar link\" do app)."); return; }
    setRodando(true);
    setEtapa("enviando o link para a VPS");
    setFrac(0.02);
    try {
      const p = await garantirProjeto();
      await carregarLink(p.id, texto);
      let e: EstadoLink = { estado: "baixando" };
      const limite = Date.now() + 6 * 60_000;
      while (vivo.current && Date.now() < limite) {
        await espera(1000);
        e = await estadoLink(p.id);
        if (e.estado === "pronto" || e.estado === "erro") break;
        setEtapa(e.etapa || "baixando");
        setFrac(Math.max(0.03, e.progresso ?? 0) * 0.8);
      }
      if (!vivo.current) return;
      if (e.estado === "erro") throw new Error(e.erro || "não consegui baixar esse vídeo. Baixe no celular e use \"Escolher vídeo\".");
      if (e.estado !== "pronto" || !e.arquivo) throw new Error("o download demorou demais. Baixe o vídeo no celular e use \"Escolher vídeo\".");
      setEtapa("trazendo o vídeo para este aparelho");
      const nome = `${(e.autor || "instagram").replace(/[^\w.-]+/g, "")}-${Date.now().toString(36)}.mp4`;
      const arq = await trazerVideo(e.arquivo, nome, (x) => setFrac(0.8 + x * 0.2));
      if (!vivo.current) return;
      setFrac(1);
      setUrl("");
      onPronto(arq, e, p);
    } catch (err) {
      if (vivo.current) setErro((err as Error).message);
    } finally {
      if (vivo.current) { setRodando(false); setEtapa(""); }
    }
  };

  return (
    <div className={`space-y-2 ${compacto ? "" : "rounded-lg border p-3"}`} data-testid="carregar-link">
      <label className="flex items-center gap-1.5 text-sm font-medium" htmlFor="link-original"><Link2 className="h-4 w-4" /> Colar link do Instagram</label>
      <div className="flex gap-2">
        <Input id="link-original" inputMode="url" autoComplete="off" placeholder="https://www.instagram.com/reel/..." value={url}
          onChange={(e) => setUrl(e.target.value)} disabled={rodando || desativado} className="h-11 min-w-0 flex-1 text-base"
          onKeyDown={(e) => { if (e.key === "Enter") void carregar(); }} />
        <Button className="h-11 shrink-0" onClick={() => void carregar()} disabled={rodando || desativado || !url.trim()}>
          {rodando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Carregar"}
        </Button>
      </div>
      {rodando && (
        <div className="space-y-1">
          <Progress value={Math.round(frac * 100)} className="h-1.5" />
          <p className="text-xs text-muted-foreground">{etapa}...</p>
        </div>
      )}
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {!rodando && !erro && <p className="text-xs text-muted-foreground">Reels ou post público. TikTok e YouTube Shorts em teste.</p>}
    </div>
  );
}
