// O quadro 16:9 da transmissão, sem LiveKit: recebe os blocos já calculados (calcularCena) e desenha
// vídeo/avatares e overlays. CenaLive (estúdio, convite e render do Egress) usa este mesmo componente,
// então o que o produtor vê é o que sai.
import type { ReactNode } from "react";
import { ehAulaCena, type Bloco, type OverlayCena } from "@/lib/lives/layout";

export function iniciais(nome: string) {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
}

/** O que aparece no bloco sem vídeo: as iniciais na cor da marca (e um aviso curto, ex.: vídeo da aula sem imagem). */
export function AvatarBloco({ nome, cor, aviso }: { nome: string; cor: string; aviso?: string }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-neutral-900">
      <div className="rounded-full flex items-center justify-center text-white font-semibold" style={{ background: cor, width: "18%", aspectRatio: "1" }}>
        {iniciais(nome)}
      </div>
      {aviso && <div className="text-white/60" style={{ fontSize: "1.2cqw" }}>{aviso}</div>}
    </div>
  );
}

interface Props {
  blocos: Bloco[];
  overlays: OverlayCena[];
  cor?: string;
  nomeDe: (identity: string) => string;
  /** devolve o elemento de vídeo do bloco, ou null para mostrar o avatar */
  renderVideo: (b: Bloco) => ReactNode | null;
  className?: string;
  children?: ReactNode;
  /**
   * Quadro que vai pro ar (render do Egress): palco vazio e "Vídeo da aula" ainda sem imagem ficam pretos e limpos
   * (só banners/marca), nunca "Ninguém no palco" nem as iniciais do vídeo.
   */
  transmissao?: boolean;
}

function Faixa({ o, cor }: { o: OverlayCena; cor: string }) {
  const c = o.conteudo.cor ?? cor;
  const tema = o.conteudo.tema ?? "bloco";
  if (tema === "bloco") {
    return (
      <>
        <div className="text-white font-bold leading-tight" style={{ background: c, fontSize: "2.2cqw", padding: "0.4em 0.7em" }}>{o.conteudo.texto}</div>
        {o.conteudo.subtitulo && <div className="bg-black/80 text-white" style={{ fontSize: "1.4cqw", padding: "0.3em 1.1em" }}>{o.conteudo.subtitulo}</div>}
      </>
    );
  }
  const claro = tema === "claro";
  return (
    <div className={claro ? "bg-white text-neutral-900" : "bg-neutral-900/90 text-white"} style={{ borderLeft: `0.5cqw solid ${c}`, padding: "0.5em 0.9em" }}>
      <div className="font-bold leading-tight" style={{ fontSize: "2.2cqw" }}>{o.conteudo.texto}</div>
      {o.conteudo.subtitulo && <div className="opacity-80" style={{ fontSize: "1.4cqw" }}>{o.conteudo.subtitulo}</div>}
    </div>
  );
}

export function QuadroCena({ blocos, overlays, cor = "#10b981", nomeDe, renderVideo, className = "", children, transmissao = false }: Props) {
  return (
    <div className={`relative w-full aspect-video bg-black overflow-hidden ${className}`} style={{ containerType: "inline-size" }}>
      {blocos.length === 0 && !transmissao && (
        <div className="absolute inset-0 flex items-center justify-center text-white/40 text-sm">Ninguém no palco</div>
      )}
      {blocos.map((b) => {
        const video = renderVideo(b);
        const nome = nomeDe(b.identity);
        return (
          <div
            key={b.key}
            data-bloco-cena={b.key}
            className={`absolute overflow-hidden rounded-md ${transmissao && !video && ehAulaCena(b.identity) ? "bg-black" : "bg-neutral-900"}`}
            style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, zIndex: b.z }}
          >
            {video ?? (transmissao && ehAulaCena(b.identity) ? null : <AvatarBloco nome={nome} cor={cor} />)}
            {b.fonte === "camera" && !ehAulaCena(b.identity) && (
              <div className="absolute left-2 bottom-2 px-2 py-0.5 rounded bg-black/60 text-white" style={{ fontSize: "1.1cqw" }}>{nome}</div>
            )}
          </div>
        );
      })}

      {overlays.filter((o) => o.visivel).map((o) => {
        if (o.tipo === "logo" && o.conteudo.url_imagem) {
          return <img key={o.id} src={o.conteudo.url_imagem} alt="" className="absolute top-[3%] right-[2%] h-[12%] object-contain" style={{ zIndex: 20 }} />;
        }
        if (o.tipo === "lower_third") {
          return (
            <div key={o.id} className="absolute left-[3%] bottom-[8%] max-w-[60%]" style={{ zIndex: 21 }}>
              <Faixa o={o} cor={cor} />
            </div>
          );
        }
        if (o.tipo === "banner") {
          return (
            <div key={o.id} className="absolute left-0 right-0 top-[3%] flex justify-center px-4" style={{ zIndex: 22 }}>
              <div className="rounded text-white font-semibold shadow-lg" style={{ background: o.conteudo.cor ?? cor, fontSize: "1.8cqw", padding: "0.4em 0.9em" }}>
                {o.conteudo.subtitulo && o.conteudo.origem === "comentario" && <div className="font-normal opacity-80" style={{ fontSize: "1.2cqw" }}>{o.conteudo.subtitulo}</div>}
                {o.conteudo.texto}
              </div>
            </div>
          );
        }
        return null;
      })}
      {children}
    </div>
  );
}
