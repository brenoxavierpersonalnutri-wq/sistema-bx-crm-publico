// Linha do tempo da edição, no jeito dos editores de celular: a AGULHA fica parada no centro e o vídeo corre por baixo.
// Rola com o dedo (arrastar = procurar), pinça (ou ctrl + roda) = zoom. Faixas empilhadas, todas no tempo do VÍDEO
// FINAL: original (miniaturas), sua câmera (com o layout do bloco), áudio (forma de onda da sua voz + o som do original)
// e texto (título, gancho, legendas). Tocar num bloco seleciona: borda branca e alças nas pontas para aparar.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MessageCircle, Play, Snowflake, VolumeX } from "lucide-react";
import { origEm, rotuloTrecho, type TrechoEd } from "@/lib/conteudo/react/edicao";
import { saidaParaGravacao, type BlocoLinha, type Pedaco } from "@/lib/conteudo/react/plano";
import { formatarTempo } from "@/lib/conteudo/react/linhaTempo";
import { PASSO_ONDA, useMiniaturas } from "@/components/conteudo/react/midiaEdicao";

export const PPS_MIN = 8;
export const PPS_MAX = 240;
const TILE = 34;          // largura de cada miniatura do original
const Y = { regua: 0, orig: 18, ele: 74, audio: 110, texto: 144, total: 168 };
const ROTULO_LAYOUT_CURTO = { dividido: "Dividido", ele: "Só você", original: "Só original", original_pip: "Canto", cheia: "Você + quadrinho" } as const;

interface Props {
  trechos: TrechoEd[];
  plano: Pedaco[];
  blocos: BlocoLinha[];
  dur: number;
  s: number;
  pps: number;
  onPps: (pps: number) => void;
  selecionado: number | null;
  atual: number;
  srcOriginal: string | null;
  srcReacao: string | null;
  remoto: boolean;
  picos: Float32Array | null;
  falas: [number, number][] | null;
  titulo: { texto: string; ate: number | null } | null;
  legenda: boolean;
  onSeek: (s: number) => void;
  onSelecionar: (k: number) => void;
  onAparar: (k: number, lado: "ini" | "fim", t: number) => void;
  onGancho: () => void;
}

const corBloco = (t: TrechoEd) => (t.pausa || t.congelar ? "border-sky-400" : t.tipo === "comentario" ? "border-amber-400" : "border-emerald-400");

export function LinhaTempoEdicao(props: Props) {
  const { trechos, plano, blocos, dur, s, pps, onPps, selecionado, atual, srcOriginal, srcReacao, remoto, picos, falas, titulo, legenda } = props;
  const caixa = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(360);
  const esperado = useRef(-1);
  const cbs = useRef(props);
  cbs.current = props;
  const [arrasto, setArrasto] = useState<{ k: number; lado: "ini" | "fim"; x0: number; dx: number } | null>(null);

  // largura visível (a agulha é o centro dela)
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setW(el.clientWidth || 360);
    medir();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // a agulha acompanha o tempo: rola a faixa para que o instante s fique no centro
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const x = s * pps;
    if (Math.abs(el.scrollLeft - x) > 0.5) {
      esperado.current = x;
      el.scrollLeft = x;
    }
  }, [s, pps, W]);

  // pinça e ctrl+roda = zoom (listeners não passivos para segurar o zoom da página)
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    let d0 = 0;
    let p0 = 0;
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const ini = (e: TouchEvent) => { if (e.touches.length === 2) { d0 = dist(e); p0 = cbs.current.pps; e.preventDefault(); } };
    const mov = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      cbs.current.onPps(Math.max(PPS_MIN, Math.min(PPS_MAX, (p0 * dist(e)) / d0)));
    };
    const fim = (e: TouchEvent) => { if (e.touches.length < 2) d0 = 0; };
    const roda = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      cbs.current.onPps(Math.max(PPS_MIN, Math.min(PPS_MAX, cbs.current.pps * Math.exp(-e.deltaY * 0.01))));
    };
    el.addEventListener("touchstart", ini, { passive: false });
    el.addEventListener("touchmove", mov, { passive: false });
    el.addEventListener("touchend", fim);
    el.addEventListener("wheel", roda, { passive: false });
    return () => {
      el.removeEventListener("touchstart", ini);
      el.removeEventListener("touchmove", mov);
      el.removeEventListener("touchend", fim);
      el.removeEventListener("wheel", roda);
    };
  }, []);

  const aoRolar = () => {
    const el = caixa.current;
    if (!el) return;
    if (Math.abs(el.scrollLeft - esperado.current) <= 1.5) return;   // fui eu que rolei (agulha andando)
    esperado.current = el.scrollLeft;
    cbs.current.onSeek(Math.max(0, Math.min(dur, el.scrollLeft / pps)));
  };

  const X = (sx: number) => W / 2 + sx * pps;
  const gancho = plano[0]?.gancho ? plano[0] : null;
  const gDur = gancho ? gancho.fim - gancho.ini : 0;

  // miniaturas: uma a cada TILE px de cada bloco, no ponto do original que aparece ali
  const { tiles, temposOrig } = useMemo(() => {
    const ts: { k: number; x: number; chave: string }[] = [];
    let grade = 0.5;
    const calc = () => {
      ts.length = 0;
      const set = new Set<string>();
      blocos.forEach((b) => {
        const w = (b.s1 - b.s0) * pps;
        if (w <= 0) return;
        const tr = trechos[b.k];
        for (let x = 0; x < w; x += TILE) {
          const r = saidaParaGravacao(plano, b.s0 + Math.min(w - 1, x + TILE / 2) / pps);
          const o = origEm(tr, r ? Math.max(tr.ini, Math.min(tr.fim, r.t)) : tr.ini);
          const chave = (Math.round(o / grade) * grade).toFixed(1);
          ts.push({ k: b.k, x, chave });
          set.add(chave);
        }
      });
      return set;
    };
    let set = calc();
    while (set.size > 90 && grade < 30) { grade *= 2; set = calc(); }
    if (gancho) set.add(origEm(trechos[gancho.k], gancho.ini).toFixed(1));
    return { tiles: ts, temposOrig: Array.from(set).map(Number) };
  }, [blocos, trechos, plano, pps, gancho]);
  const miniOrig = useMiniaturas(srcOriginal, temposOrig, remoto, 48);
  const temposEle = useMemo(() => [...trechos.map((t) => t.ini + Math.min(0.5, (t.fim - t.ini) / 2)), ...(gancho ? [gancho.ini + 0.3] : [])], [trechos, gancho]);
  const miniEle = useMiniaturas(srcReacao, temposEle, remoto, 48);

  // régua: rótulo a cada passo que dê pelo menos 48 px
  const passoRegua = [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((p) => p * pps >= 48) ?? 300;
  const marcas = useMemo(() => {
    const m: number[] = [];
    for (let t = 0; t <= dur + 1e-6; t += passoRegua / 2) m.push(Math.round(t * 1000) / 1000);
    return m;
  }, [dur, passoRegua]);

  // legendas: as falas dele que ficam no vídeo, no tempo de saída
  const chipsFala = useMemo(() => {
    if (!falas?.length) return [] as [number, number][];
    const out: [number, number][] = [];
    for (const p of plano) {
      for (const [a, b] of falas) {
        const s0 = Math.max(a, p.ini);
        const e0 = Math.min(b, p.fim);
        if (e0 - s0 > 0.08) out.push([p.s0 + s0 - p.ini, p.s0 + e0 - p.ini]);
      }
    }
    return out;
  }, [falas, plano]);

  const iniciarArrasto = (e: ReactPointerEvent, k: number, lado: "ini" | "fim") => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setArrasto({ k, lado, x0: e.clientX, dx: 0 });
  };
  const moverArrasto = (e: ReactPointerEvent) => { if (arrasto) setArrasto({ ...arrasto, dx: e.clientX - arrasto.x0 }); };
  const soltarArrasto = () => {
    if (!arrasto) return;
    const tr = trechos[arrasto.k];
    const d = arrasto.dx / pps;
    if (tr && Math.abs(arrasto.dx) > 3) cbs.current.onAparar(arrasto.k, arrasto.lado, arrasto.lado === "ini" ? tr.ini + d : tr.fim + d);
    setArrasto(null);
  };

  const zerados = new Map<number, number>();
  return (
    <div className="relative select-none" style={{ height: Y.total }} data-testid="linha-tempo">
      <div ref={caixa} data-testid="linha-rolagem" onScroll={aoRolar}
        className="h-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ touchAction: "pan-x", WebkitOverflowScrolling: "touch", overscrollBehaviorX: "contain" }}>
        <div className="relative h-full" style={{ width: dur * pps + W }}>
          {/* régua */}
          {marcas.map((t, i) => (
            <span key={t} className="absolute text-[9px] tabular-nums text-neutral-500" style={{ left: X(t), top: Y.regua, transform: "translateX(-50%)" }}>
              {i % 2 === 0 ? formatarTempo(t) : "·"}
            </span>
          ))}

          {/* gancho da IA abrindo o vídeo */}
          {gancho && (
            <button type="button" onClick={() => cbs.current.onGancho()} aria-label="Gancho da IA"
              className="absolute overflow-hidden rounded-md border-2 border-fuchsia-500 bg-fuchsia-950 text-left"
              style={{ left: X(0), width: Math.max(6, gDur * pps - 2), top: Y.orig, height: Y.ele - Y.orig + 34 }}>
              {miniEle[(gancho.ini + 0.3).toFixed(1)] && <img src={miniEle[(gancho.ini + 0.3).toFixed(1)]} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />}
              <span className="absolute left-1 top-1 rounded bg-fuchsia-600 px-1 text-[9px] font-bold text-white">GANCHO</span>
            </button>
          )}

          {/* original + câmera, um bloco por trecho */}
          {blocos.map((b) => {
            const tr = trechos[b.k];
            if (!tr) return null;
            let w = (b.s1 - b.s0) * pps;
            let left = X(b.s0);
            const sel = selecionado === b.k;
            if (w <= 0) {
              const n = zerados.get(Math.round(b.s0 * 100)) ?? 0;
              zerados.set(Math.round(b.s0 * 100), n + 1);
              return (
                <button key={`z${b.k}`} type="button" data-k={b.k} onClick={() => cbs.current.onSelecionar(b.k)}
                  aria-label={`${rotuloTrecho(tr)} de ${formatarTempo(tr.ini)}, fora do vídeo`}
                  className={`absolute z-10 rounded-sm border ${sel ? "border-white" : "border-red-400/70"} bg-[repeating-linear-gradient(135deg,#7f1d1d_0_4px,#1f1f1f_4px_8px)]`}
                  style={{ left: left - 7 + n * 15, width: 14, top: Y.orig + 8, height: 36 }} />
              );
            }
            if (arrasto?.k === b.k) {
              if (arrasto.lado === "ini") { left += arrasto.dx; w -= arrasto.dx; } else w += arrasto.dx;
              w = Math.max(10, w);
            }
            const lay = plano.find((p) => p.k === b.k && !p.gancho)?.layout ?? "dividido";
            const mini = miniEle[(tr.ini + Math.min(0.5, (tr.fim - tr.ini) / 2)).toFixed(1)];
            return (
              <div key={`b${b.k}-${tr.ini}`}>
                <button type="button" data-k={b.k} aria-pressed={sel} onClick={() => cbs.current.onSelecionar(b.k)}
                  aria-label={`${rotuloTrecho(tr)} de ${formatarTempo(tr.ini)} a ${formatarTempo(tr.fim)}`}
                  className={`absolute overflow-hidden rounded-md border-2 bg-neutral-800 text-left ${sel ? "z-10 border-white" : corBloco(tr)} ${atual === b.k && !sel ? "brightness-125" : ""}`}
                  style={{ left, width: Math.max(4, w - 2), top: Y.orig, height: 52 }}>
                  <span className="absolute inset-0 flex">
                    {tiles.filter((x) => x.k === b.k).map((x) => (
                      miniOrig[x.chave]
                        ? <img key={x.x} src={miniOrig[x.chave]} alt="" className="h-full shrink-0 object-cover" style={{ width: TILE }} />
                        : <span key={x.x} className="h-full shrink-0 border-r border-neutral-700 bg-neutral-700/60" style={{ width: TILE }} />
                    ))}
                  </span>
                  <span className="absolute left-1 top-0.5 flex items-center gap-0.5 rounded bg-black/60 px-1 text-[9px] font-semibold text-white">
                    {tr.tipo === "comentario" ? <MessageCircle className="h-2.5 w-2.5" /> : tr.congelar ? <Snowflake className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5" />}
                    {w > 70 && rotuloTrecho(tr)}
                  </span>
                  {w > 44 && <span className="absolute bottom-0.5 right-1 rounded bg-black/60 px-1 text-[9px] tabular-nums text-white">{(b.s1 - b.s0).toFixed(1)}s</span>}
                </button>
                <button type="button" onClick={() => cbs.current.onSelecionar(b.k)} tabIndex={-1} aria-hidden
                  className={`absolute flex items-center gap-1 overflow-hidden rounded-md border px-1 text-[10px] font-medium text-white ${sel ? "border-white bg-neutral-600" : "border-neutral-600 bg-neutral-800"}`}
                  style={{ left, width: Math.max(4, w - 2), top: Y.ele, height: 32 }} data-layout-bloco={lay}>
                  {mini && <img src={mini} alt="" className="h-6 w-4 shrink-0 rounded-sm object-cover" />}
                  {w > 50 && <span className="truncate">{tr.layout ? ROTULO_LAYOUT_CURTO[lay] : `Auto · ${ROTULO_LAYOUT_CURTO[lay]}`}</span>}
                </button>
                {sel && (["ini", "fim"] as const).map((lado) => (
                  <span key={lado} role="slider" aria-label={lado === "ini" ? "Aparar o começo" : "Aparar o fim"} aria-valuenow={lado === "ini" ? tr.ini : tr.fim}
                    onPointerDown={(e) => iniciarArrasto(e, b.k, lado)} onPointerMove={moverArrasto} onPointerUp={soltarArrasto} onPointerCancel={() => setArrasto(null)}
                    className="absolute z-20 flex items-center justify-center rounded-sm bg-white"
                    style={{ left: lado === "ini" ? left - 12 : left + Math.max(4, w - 2) - 2, width: 14, top: Y.orig, height: 52, touchAction: "none" }}>
                    <span className="h-5 w-0.5 rounded bg-neutral-800" />
                  </span>
                ))}
              </div>
            );
          })}

          {/* áudio: onda da sua voz e, nos trechos com o original tocando, a linha do som dele */}
          {plano.map((p, i) => {
            const w = (p.fim - p.ini) * pps;
            if (w < 2) return null;
            const barras: { x: number; h: number }[] = [];
            if (picos) {
              for (let x = 0; x < w; x += 3) {
                const a = Math.floor((p.ini + x / pps) / PASSO_ONDA);
                const b = Math.max(a + 1, Math.floor((p.ini + (x + 3) / pps) / PASSO_ONDA));
                let m = 0;
                for (let j = a; j < b && j < picos.length; j += 1) m = Math.max(m, picos[j]);
                barras.push({ x, h: Math.max(1, m * 24) });
              }
            }
            return (
              <svg key={`a${i}`} className="absolute overflow-hidden rounded-sm bg-teal-950/70" width={Math.max(2, w - 2)} height={28}
                style={{ left: X(p.s0), top: Y.audio }} aria-hidden>
                {barras.map((r) => <rect key={r.x} x={r.x} y={14 - r.h / 2} width={2} height={r.h} rx={1} className="fill-teal-300/80" />)}
                {!p.congelado && p.volume > 0.001 && <line x1={0} x2={w} y1={2 + (1 - p.volume) * 24} y2={2 + (1 - p.volume) * 24} className="stroke-amber-300" strokeWidth={1.5} strokeDasharray="4 3" />}
                {!p.congelado && p.volume <= 0.001 && w > 16 && <foreignObject x={2} y={2} width={14} height={14}><VolumeX className="h-3 w-3 text-red-300" /></foreignObject>}
              </svg>
            );
          })}

          {/* texto: título da IA, gancho e as legendas (onde você fala) */}
          {titulo?.texto && (
            <span className="absolute truncate rounded-sm bg-white px-1 text-[9px] font-bold leading-[11px] text-black"
              style={{ left: X(0), width: Math.max(8, (Math.min(dur, titulo.ate ?? dur)) * pps - 2), top: Y.texto, height: 11 }}>
              {titulo.texto}
            </span>
          )}
          {legenda && chipsFala.map(([a, b], i) => (
            <span key={`f${i}`} className="absolute rounded-sm bg-yellow-400/80" style={{ left: X(a), width: Math.max(3, (b - a) * pps - 1), top: Y.texto + 13, height: 9 }} />
          ))}
        </div>
      </div>
      {/* agulha fixa no centro */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 z-30 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_4px_rgba(0,0,0,.8)]" data-testid="agulha">
        <span className="absolute -left-[5px] -top-0.5 h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent border-t-white" />
      </div>
    </div>
  );
}
