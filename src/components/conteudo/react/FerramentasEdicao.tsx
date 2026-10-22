// Barra de ferramentas da edição (embaixo, rolável, ícone + rótulo curto) e o painel que sobe de baixo quando uma
// ferramenta precisa de controle (layout, volume, congelar, texto, modelo, cortes da IA, ajustes), com ✓ para confirmar.
import type { ReactNode } from "react";
import { Check, Combine, LayoutPanelTop, Scissors, Settings2, Snowflake, Sparkles, Trash2, Type, Undo2, Volume2, VolumeX, Wand2, X } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useModelos } from "@/components/conteudo/react/ResultadoReact";
import { Switch } from "@/components/ui/switch";
import { ROTULO_LAYOUT, type CorteIA, type LayoutTrecho, type Retomar, type TrechoEd } from "@/lib/conteudo/react/edicao";

export type Ferramenta = "dividir" | "layout" | "volume" | "mudo" | "congelar" | "apagar" | "juntar" | "texto" | "modelo" | "cortes" | "ajustes";
export const COM_PAINEL: Ferramenta[] = ["layout", "volume", "congelar", "texto", "modelo", "cortes", "ajustes"];

interface ItemBarra { id: Ferramenta; rotulo: string; icone: ReactNode; ativo?: boolean; desligado?: boolean }

export function BarraFerramentas({ itens, onEscolher }: { itens: ItemBarra[]; onEscolher: (f: Ferramenta) => void }) {
  return (
    <div data-testid="barra-ferramentas" className="flex gap-1 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ touchAction: "pan-x" }}>
      {itens.map((it) => (
        <button key={it.id} type="button" onClick={() => onEscolher(it.id)} disabled={it.desligado} aria-label={it.rotulo} aria-pressed={!!it.ativo}
          className={`flex h-[60px] w-[62px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg text-[11px] ${it.ativo ? "bg-white/15 text-white" : "text-neutral-300"} disabled:opacity-35 active:bg-white/20`}>
          <span className="flex h-6 items-center">{it.icone}</span>
          <span className="max-w-full truncate leading-none">{it.rotulo}</span>
        </button>
      ))}
    </div>
  );
}

export const ICONES = {
  dividir: <Scissors className="h-5 w-5" />, layout: <LayoutPanelTop className="h-5 w-5" />, volume: <Volume2 className="h-5 w-5" />,
  mudo: <VolumeX className="h-5 w-5" />, congelar: <Snowflake className="h-5 w-5" />, apagar: <Trash2 className="h-5 w-5" />,
  restaurar: <Undo2 className="h-5 w-5" />, juntar: <Combine className="h-5 w-5" />, texto: <Type className="h-5 w-5" />,
  modelo: <Wand2 className="h-5 w-5" />, cortes: <Sparkles className="h-5 w-5" />, ajustes: <Settings2 className="h-5 w-5" />,
};

/** Painel inferior: título, X (desfaz o que mudou desde que abriu) e ✓ (confirma). As mudanças já aparecem na prévia. */
export function PainelInferior({ titulo, subtitulo, onCancelar, onConfirmar, children }: {
  titulo: string; subtitulo?: string; onCancelar: () => void; onConfirmar: () => void; children: ReactNode;
}) {
  return (
    <div data-testid="painel-ferramenta" role="dialog" aria-label={titulo}
      className="absolute inset-x-0 bottom-0 z-40 max-h-[58%] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-neutral-900 shadow-2xl"
      style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-neutral-900 px-2 pb-1 pt-2">
        <button type="button" onClick={onCancelar} aria-label="Cancelar" className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-300 active:bg-white/10"><X className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold">{titulo}</p>
          {subtitulo && <p className="truncate text-[11px] text-neutral-400">{subtitulo}</p>}
        </div>
        <button type="button" onClick={onConfirmar} aria-label="Confirmar" className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black active:bg-neutral-300"><Check className="h-5 w-5" /></button>
      </div>
      <div className="space-y-3 px-4 pb-2 pt-1">{children}</div>
    </div>
  );
}

/** Desenho pequeno de cada layout (o quadro 9:16 com as áreas do original e da sua câmera). */
function Miniatura({ l }: { l: LayoutTrecho | "auto" }) {
  const o = "absolute bg-sky-400";
  const e = "absolute bg-amber-300";
  return (
    <span className="relative block h-12 w-[27px] overflow-hidden rounded-sm border border-white/30 bg-neutral-800">
      {l === "dividido" && <><span className={`${o} inset-x-0 top-0 h-1/2`} /><span className={`${e} inset-x-0 bottom-0 h-1/2`} /></>}
      {l === "ele" && <span className={`${e} inset-0`} />}
      {l === "original" && <span className={`${o} inset-0`} />}
      {l === "original_pip" && <><span className={`${o} inset-0`} /><span className={`${e} right-[2px] top-[3px] h-3 w-2.5 ring-1 ring-white`} /></>}
      {l === "auto" && <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white">A</span>}
    </span>
  );
}

const LAYOUTS: (LayoutTrecho | "auto")[] = ["auto", "dividido", "ele", "original", "original_pip"];
const ROTULO_CURTO: Record<LayoutTrecho | "auto", string> = { auto: "Automático", dividido: "Dividido", ele: "Só você", original: "Só original", original_pip: "Canto" };

export function ControleLayout({ valor, onEscolher, onTodos }: { valor: LayoutTrecho | undefined; onEscolher: (l: LayoutTrecho | undefined) => void; onTodos: () => void }) {
  return (
    <>
      <div role="radiogroup" aria-label="Layout do bloco" className="grid grid-cols-5 gap-1.5">
        {LAYOUTS.map((l) => {
          const marcado = (valor ?? "auto") === l;
          return (
            <button key={l} type="button" role="radio" aria-checked={marcado} aria-label={l === "auto" ? "Automático" : ROTULO_LAYOUT[l]}
              onClick={() => onEscolher(l === "auto" ? undefined : l)}
              className={`flex min-h-[78px] flex-col items-center justify-center gap-1 rounded-lg border p-1 text-[10px] ${marcado ? "border-white bg-white/15" : "border-white/15"}`}>
              <Miniatura l={l} />
              <span className="leading-tight">{ROTULO_CURTO[l]}</span>
            </button>
          );
        })}
      </div>
      <button type="button" onClick={onTodos} className="h-10 w-full rounded-lg border border-white/15 text-xs text-neutral-200 active:bg-white/10">Usar este layout em todos os blocos</button>
    </>
  );
}

export function ControleVolume({ trecho, geral, onBloco, onMudo, onGeral }: {
  trecho: TrechoEd | undefined; geral: number; onBloco: (v: number) => void; onMudo: (m: boolean) => void; onGeral: (v: number) => void;
}) {
  const parado = !trecho || trecho.tipo === "comentario" || !!trecho.congelar;
  const v = trecho?.mudo ? 0 : Math.round((trecho?.volume ?? 1) * 100);
  return (
    <>
      <div className="space-y-1">
        <p className="text-xs text-neutral-400">Som do original neste bloco</p>
        {parado ? <p className="text-xs text-neutral-500">Aqui o original está parado: não tem som dele.</p> : (
          <div className="flex items-center gap-3">
            <Slider value={[v]} min={0} max={100} step={5} aria-label="Som do original neste bloco" className="flex-1 py-3" onValueChange={([x]) => onBloco(x / 100)} />
            <span className="w-11 text-right text-sm tabular-nums">{v}%</span>
          </div>
        )}
        {!parado && (
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <Switch className="data-[state=unchecked]:bg-neutral-600" checked={!!trecho?.mudo} onCheckedChange={onMudo} aria-label="Original mudo neste bloco" /> Original mudo neste bloco
          </label>
        )}
      </div>
      <div className="space-y-1 border-t border-white/10 pt-2">
        <p className="text-xs text-neutral-400">Som do original no vídeo todo</p>
        <div className="flex items-center gap-3">
          <Slider value={[Math.round(geral * 100)]} min={0} max={100} step={5} aria-label="Som do original no vídeo todo" className="flex-1 py-3" onValueChange={([x]) => onGeral(x / 100)} />
          <span className="w-11 text-right text-sm tabular-nums">{Math.round(geral * 100)}%</span>
        </div>
      </div>
    </>
  );
}

export function ControleCongelar({ trecho, falaSeg, falasMedidas, retomar, onRetomar, onCongelar, onPausar, onDesfazerPausa }: {
  trecho: TrechoEd | undefined; falaSeg: number | null; falasMedidas: boolean; retomar: Retomar; onRetomar: (r: Retomar) => void;
  onCongelar: (v: boolean) => void; onPausar: (dur: number) => void; onDesfazerPausa: () => void;
}) {
  if (!trecho) return <p className="text-sm text-neutral-400">Posicione a agulha sobre um bloco.</p>;
  if (trecho.tipo === "comentario") return <p className="text-sm text-neutral-300">Neste bloco você comenta e o original já fica parado no quadro da pausa.</p>;
  if (trecho.pausa) {
    return (
      <>
        <p className="text-sm text-neutral-300">Pausa que você criou: o original fica parado {(trecho.fim - trecho.ini).toFixed(1)} s.</p>
        <button type="button" onClick={onDesfazerPausa} className="h-11 w-full rounded-lg border border-white/15 text-sm active:bg-white/10">Desfazer esta pausa</button>
      </>
    );
  }
  const pode = !trecho.congelar && trecho.removido !== true;
  return (
    <>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <Switch className="data-[state=unchecked]:bg-neutral-600" checked={!!trecho.congelar} onCheckedChange={onCongelar} aria-label="Original parado neste bloco" /> Original parado no bloco inteiro
      </label>
      <div className="space-y-2 border-t border-white/10 pt-2">
        <p className="text-xs text-neutral-400">Pausar o original na agulha (e depois continuar)</p>
        <div className="grid grid-cols-4 gap-1.5">
          {[2, 3, 5].map((d) => (
            <button key={d} type="button" disabled={!pode} onClick={() => onPausar(d)} className="h-11 rounded-lg border border-white/15 text-sm disabled:opacity-40 active:bg-white/10">{d} s</button>
          ))}
          <button type="button" disabled={!pode || falaSeg === null} onClick={() => falaSeg !== null && onPausar(falaSeg)}
            className="h-11 rounded-lg border border-white/15 text-[11px] leading-tight disabled:opacity-40 active:bg-white/10"
            title={falasMedidas ? undefined : "as falas aparecem depois da primeira montagem"}>
            {falaSeg !== null ? `Enquanto falo (${falaSeg.toFixed(1)} s)` : "Enquanto falo"}
          </button>
        </div>
        <div role="radiogroup" aria-label="Depois da pausa" className="grid grid-cols-2 gap-1.5">
          {([["onde_parou", "Continua de onde parou"], ["pular", "Pula o que tocou"]] as const).map(([v, r]) => (
            <button key={v} type="button" role="radio" aria-checked={retomar === v} onClick={() => onRetomar(v)}
              className={`h-10 rounded-lg border text-xs ${retomar === v ? "border-white bg-white/15" : "border-white/15"}`}>{r}</button>
          ))}
        </div>
      </div>
    </>
  );
}

export function ControleTexto({ ia, titulo, gancho, tituloLigado, ganchoLigado, legenda, legendaNoModelo, onTitulo, onGancho, onLegenda }: {
  ia: boolean; titulo: string; gancho: boolean; tituloLigado: boolean; ganchoLigado: boolean; legenda: boolean; legendaNoModelo: boolean;
  onTitulo: (v: boolean) => void; onGancho: (v: boolean) => void; onLegenda: (v: boolean) => void;
}) {
  return (
    <>
      {!ia && <p className="rounded-md bg-white/5 p-2 text-xs text-neutral-300">Título e gancho vêm da Edição com IA (ligue em Ajustes).</p>}
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <Switch className="data-[state=unchecked]:bg-neutral-600" checked={tituloLigado} disabled={!ia || !titulo} onCheckedChange={onTitulo} aria-label="Título da IA" />
        <span className="min-w-0 flex-1"><span className="block">Título no vídeo</span>{titulo && <span className="block truncate text-xs text-neutral-400">"{titulo}"</span>}</span>
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <Switch className="data-[state=unchecked]:bg-neutral-600" checked={ganchoLigado} disabled={!ia || !gancho} onCheckedChange={onGancho} aria-label="Gancho da IA" />
        <span><span className="block">Gancho abrindo o vídeo</span><span className="block text-xs text-neutral-400">{gancho ? "2 a 4 s do seu melhor comentário antes do começo" : "a IA não escolheu gancho"}</span></span>
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <Switch className="data-[state=unchecked]:bg-neutral-600" checked={legenda} onCheckedChange={onLegenda} aria-label="Legenda automática" />
        <span><span className="block">Legenda automática</span>{!legendaNoModelo && <span className="block text-xs text-neutral-400">o modelo escolhido não usa legenda</span>}</span>
      </label>
    </>
  );
}

export function ControleCortes({ cortes, restaurados, onRestaurar }: { cortes: CorteIA[]; restaurados: string[]; onRestaurar: (id: string, v: boolean) => void }) {
  if (!cortes.length) return <p className="text-sm text-neutral-400">A IA não cortou nada neste bloco.</p>;
  return (
    <ul className="space-y-1">
      {cortes.map((c) => {
        const volta = restaurados.includes(c.id);
        return (
          <li key={c.id} className="flex min-h-11 items-center gap-3 text-sm">
            <Switch className="data-[state=unchecked]:bg-neutral-600" checked={volta} onCheckedChange={(v) => onRestaurar(c.id, v)} aria-label={`Manter "${c.texto}"`} />
            <span className={`min-w-0 flex-1 truncate ${volta ? "" : "text-neutral-400 line-through"}`}>"{c.texto}"</span>
            <span className="text-xs text-neutral-500">{(c.fim - c.ini).toFixed(1)} s</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Modelo de edição em opções grandes de toque (lista da VPS: Nativo, Edu Esteves...). */
export function ControleModelo({ valor, onEscolher }: { valor: string; onEscolher: (id: string) => void }) {
  const lista = useModelos();
  return (
    <div role="radiogroup" aria-label="Modelo de edição" className="space-y-1.5">
      {lista.modelos.map((m) => {
        const marcado = (lista.modelos.some((x) => x.id === valor) ? valor : lista.padrao) === m.id;
        return (
          <button key={m.id} type="button" role="radio" aria-checked={marcado} aria-label={m.nome} onClick={() => onEscolher(m.id)}
            className={`flex min-h-14 w-full flex-col items-start justify-center rounded-lg border px-3 py-2 text-left ${marcado ? "border-white bg-white/15" : "border-white/15"}`}>
            <span className="text-sm font-semibold">{m.nome}</span>
            {m.descricao && <span className="line-clamp-2 text-[11px] leading-snug text-neutral-400">{m.descricao}</span>}
          </button>
        );
      })}
      {lista.planejados.map((m) => (
        <p key={m.id} className="rounded-lg border border-dashed border-white/15 px-3 py-2 text-xs text-neutral-500">{m.nome} · em preparação</p>
      ))}
    </div>
  );
}
