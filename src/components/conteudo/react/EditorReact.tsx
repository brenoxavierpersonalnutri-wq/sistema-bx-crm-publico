// Tela de edição do react, no jeito dos editores de vídeo de celular (tela cheia, escura, uma mão só):
//   topo: fechar · desfazer · refazer · salvar · Exportar (manda montar na VPS);
//   prévia 9:16 grande, CONTÍNUA (toca o vídeo inteiro como vai sair: layout de cada bloco, congelado, volume, mudo,
//   removidos, cortes da IA, silêncio cortado e o gancho), play/pause e tempo atual / total;
//   linha do tempo com a agulha fixa no centro (original, sua câmera, áudio, texto), pinça para zoom, alças de aparar;
//   barra de ferramentas: Dividir, Layout, Volume, Mudo, Congelar, Apagar, Juntar, Texto, Modelo, Cortes da IA, Ajustes.
// A escolha dele vence a da IA na montagem (infra/react/montagem.py).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Pause, Play, Redo2, Save, Undo2, X } from "lucide-react";
import { OpcoesReact } from "@/components/conteudo/react/ResultadoReact";
import { LinhaTempoEdicao } from "@/components/conteudo/react/LinhaTempoEdicao";
import { PreviaEdicao, type PreviaHandle, type TituloPrevia } from "@/components/conteudo/react/PreviaEdicao";
import { useOnda } from "@/components/conteudo/react/midiaEdicao";
import {
  BarraFerramentas, COM_PAINEL, ControleCongelar, ControleCortes, ControleLayout, ControleModelo, ControleTexto, ControleVolume, ICONES, PainelInferior,
  type Ferramenta,
} from "@/components/conteudo/react/FerramentasEdicao";
import { type ProjetoReact, type RespostaEdicao, lerEdicao, salvarEdicao } from "@/lib/conteudo/react/api";
import {
  AJUSTES_PADRAO, aparar, aplicar, cortesDoTrecho, desfazerPausa, dividirEm, edicaoInicial, falaDepois, juntarCompativeis, juntarComProximo,
  paraPedido, pausarAqui, rotuloTrecho, simplificar,
  type AjustesEdicao, type Retomar, type TrechoEd,
} from "@/lib/conteudo/react/edicao";
import { blocosDaLinha, duracaoSaida, planoPrevia, saidaParaGravacao, trechoFora } from "@/lib/conteudo/react/plano";
import { formatarTempo } from "@/lib/conteudo/react/linhaTempo";
import type { OpcoesMontagem } from "@/lib/conteudo/react/opcoes";

interface Props {
  projeto: ProjetoReact;
  op: OpcoesMontagem;
  /** os arquivos deste aparelho (recém-gravado): a prévia não precisa esperar a VPS */
  fontesLocais?: { original: string | null; reacao: string | null };
  onFechar: () => void;
  onMontar: (op: OpcoesMontagem, trechos: TrechoEd[], ajustes: AjustesEdicao) => Promise<void>;
}

interface Estado { trechos: TrechoEd[]; ajustes: AjustesEdicao }

const TITULO_PAINEL: Record<Ferramenta, string> = {
  dividir: "Dividir", layout: "Layout", volume: "Volume", mudo: "Mudo", congelar: "Congelar", apagar: "Apagar", juntar: "Juntar",
  texto: "Texto e título", modelo: "Modelo de edição", cortes: "Cortes da IA", ajustes: "Ajustes",
};

export function EditorReact({ projeto, op: opInicial, fontesLocais, onFechar, onMontar }: Props) {
  const previa = useRef<PreviaHandle>(null);
  const [resp, setResp] = useState<RespostaEdicao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [ed, setEd] = useState<Estado>({ trechos: [], ajustes: AJUSTES_PADRAO });
  const passado = useRef<{ estado: Estado; chave: string; em: number }[]>([]);
  const futuro = useRef<Estado[]>([]);
  const [, setVersao] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [s, setS] = useState(0);
  const [tocando, setTocando] = useState(false);
  const [pps, setPps] = useState(36);
  const [painel, setPainel] = useState<Ferramenta | null>(null);
  const foto = useRef<Estado | null>(null);
  const [retomar, setRetomar] = useState<Retomar>("onde_parou");
  const [op, setOp] = useState<OpcoesMontagem>(opInicial);
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [sujo, setSujo] = useState(false);
  // aviso curto sobre a prévia, sem capturar toque (o toast do app cobriria a barra de ferramentas ou o topo)
  const [aviso, setAviso] = useState<{ texto: string; erro: boolean; n: number } | null>(null);
  const avisoTimer = useRef<number | null>(null);
  const avisar = useCallback((texto: string, erro = false) => {
    if (avisoTimer.current) window.clearTimeout(avisoTimer.current);
    setAviso({ texto, erro, n: Date.now() });
    avisoTimer.current = window.setTimeout(() => setAviso(null), erro ? 3200 : 2200);
  }, []);
  useEffect(() => () => { if (avisoTimer.current) window.clearTimeout(avisoTimer.current); }, []);

  // carrega: edição salva (banco ou VPS), base da última montagem, falas e prévias; já com menos blocos
  useEffect(() => {
    let vivo = true;
    void (async () => {
      let r: RespostaEdicao | null = null;
      try { r = await lerEdicao(projeto.id); } catch (e) { if (vivo) setErro((e as Error).message); }
      if (!vivo) return;
      setResp(r);
      const ini = edicaoInicial([projeto.edicao, r?.salva], r?.base, projeto.linha_tempo || []);
      setEd({ trechos: simplificar(ini.trechos), ajustes: ini.edicao });
      setCarregado(true);
    })();
    return () => { vivo = false; };
  }, [projeto.id, projeto.edicao, projeto.linha_tempo]);

  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sujo]);

  /** Toda mudança passa aqui: guarda o estado anterior (arrastar um slider vira uma entrada só) e zera o refazer. */
  const mudar = useCallback((novo: Estado, chave: string) => {
    setEd((ant) => {
      const h = passado.current;
      const u = h[h.length - 1];
      if (!(u && u.chave === chave && Date.now() - u.em < 1200)) h.push({ estado: ant, chave, em: Date.now() });
      else u.em = Date.now();
      if (h.length > 80) h.shift();
      return novo;
    });
    futuro.current = [];
    setVersao((v) => v + 1);
    setSujo(true);
  }, []);

  const desfazer = () => {
    const h = passado.current.pop();
    if (!h) return;
    futuro.current.push(ed);
    setEd(h.estado);
    setSel((x) => (x !== null && x < h.estado.trechos.length ? x : null));
    setVersao((v) => v + 1);
    setSujo(true);
  };
  const refazer = () => {
    const f = futuro.current.pop();
    if (!f) return;
    passado.current.push({ estado: ed, chave: `refazer:${Date.now()}`, em: 0 });
    setEd(f);
    setSel((x) => (x !== null && x < f.trechos.length ? x : null));
    setVersao((v) => v + 1);
    setSujo(true);
  };

  const fontes = useMemo(() => {
    if (fontesLocais?.original && fontesLocais?.reacao) return { original: fontesLocais.original, reacao: fontesLocais.reacao, remoto: false };
    return { original: resp?.previas.original ?? null, reacao: resp?.previas.reacao ?? null, remoto: true };
  }, [fontesLocais, resp]);

  const { trechos, ajustes } = ed;
  const base = resp?.base ?? null;
  const falas = resp?.falas ?? base?.falas ?? null;
  const opPlano = useMemo(() => ({ cortar_silencio: op.cortar_silencio, layout: op.layout, ia: op.ia, modelo: op.modelo }), [op]);
  const plano = useMemo(() => planoPrevia(trechos, base, ajustes, falas, opPlano), [trechos, base, ajustes, falas, opPlano]);
  const blocos = useMemo(() => blocosDaLinha(trechos, plano), [trechos, plano]);
  const dur = duracaoSaida(plano);
  const picos = useOnda(fontes.reacao);
  const noGancho = !!plano[0]?.gancho && s < plano[0].fim - plano[0].ini;
  const atual = noGancho ? -1 : blocos.findIndex((b) => b.s1 > b.s0 && s >= b.s0 - 1e-3 && s < b.s1 - 1e-3);
  const atualFinal = atual >= 0 ? atual : (!noGancho && blocos.length && s >= dur - 0.05 ? blocos.length - 1 : -1);
  const alvo = sel ?? (atualFinal >= 0 ? atualFinal : null);
  const trAlvo = alvo !== null ? trechos[alvo] : undefined;
  const tGrav = saidaParaGravacao(plano, s)?.t ?? 0;
  const restaurados = ajustes.cortes_ia_restaurados;
  const tituloIA = base?.ia?.titulo || "";
  const edu = op.modelo === "eduestevesfitness";
  const titulo: TituloPrevia | null = op.ia && ajustes.ia_titulo && tituloIA ? { texto: tituloIA, estilo: edu ? "gancho" : "caixa", ate: edu ? 4 : null } : null;

  const pausarPrevia = () => previa.current?.pausar();
  const procurar = (sx: number) => { if (previa.current?.tocando()) pausarPrevia(); previa.current?.ir(sx); };
  const selecionar = (k: number) => {
    setSel(k);
    const b = blocos[k];
    if (b) previa.current?.ir(b.s1 > b.s0 ? b.s0 + 0.001 : b.s0);
  };

  const comTrecho = (f: (tr: TrechoEd, k: number) => void) => {
    if (alvo === null || !trAlvo) { avisar("Toque num bloco ou ponha a agulha sobre ele.", true); return; }
    f(trAlvo, alvo);
  };
  const patch = (p: Partial<TrechoEd>, chave: string, indices?: number[]) => {
    const ix = indices ?? (alvo !== null ? [alvo] : []);
    if (!ix.length) return;
    mudar({ trechos: aplicar(trechos, ix, p), ajustes }, `${chave}:${ix.join(",")}`);
  };
  const mudarAjuste = (p: Partial<AjustesEdicao>, chave: string) => mudar({ trechos, ajustes: { ...ajustes, ...p } }, `geral:${chave}`);

  const usar = (f: Ferramenta) => {
    if (COM_PAINEL.includes(f)) { pausarPrevia(); foto.current = ed; setPainel(f); return; }
    if (f === "dividir") {
      if (noGancho) { avisar("A agulha está no gancho: leve-a para um bloco.", true); return; }
      const r = dividirEm(trechos, tGrav);
      if ("erro" in r) { avisar(r.erro, true); return; }
      mudar({ trechos: r.trechos, ajustes }, `dividir:${Date.now()}`);
      setSel(r.indice);
      return;
    }
    if (f === "juntar") {
      comTrecho((_, k) => {
        const r = juntarComProximo(trechos, k);
        if ("erro" in r) { avisar(r.erro, true); return; }
        mudar({ trechos: r.trechos, ajustes }, `juntar:${Date.now()}`);
        setSel(r.indice);
      });
      return;
    }
    if (f === "mudo") {
      comTrecho((tr) => {
        if (tr.tipo === "comentario" || tr.congelar) { avisar("Neste bloco o original está parado: não tem som dele."); return; }
        patch({ mudo: tr.mudo ? undefined : true }, "mudo");
      });
      return;
    }
    if (f === "apagar") {
      comTrecho((tr, k) => {
        if (trechoFora(tr, base, opPlano)) {
          const iaTirou = tr.removido !== true || trechoFora({ ...tr, removido: undefined }, base, opPlano);
          patch({ removido: iaTirou ? false : undefined }, "restaurar", [k]);
          avisar("Bloco de volta no vídeo");
        } else {
          patch({ removido: true }, "apagar", [k]);
          avisar("Bloco fora do vídeo · Desfazer no topo traz de volta");
        }
      });
    }
  };

  const fecharPainel = (confirmar: boolean) => {
    if (!confirmar && foto.current) mudar(foto.current, `cancelar:${Date.now()}`);
    foto.current = null;
    setPainel(null);
  };

  const pausar = (d: number) => {
    const r = pausarAqui(trechos, tGrav, d, retomar);
    if ("erro" in r) { avisar(r.erro, true); return; }
    mudar({ trechos: r.trechos, ajustes }, `pausa:${Date.now()}`);
    setSel(r.indice);
    const p = r.trechos[r.indice];
    avisar(`Original pausado por ${(p.fim - p.ini).toFixed(1)} s`);
  };

  const aoAparar = (k: number, lado: "ini" | "fim", t: number) => {
    const novos = aparar(trechos, k, lado, t);
    const junt = juntarCompativeis(novos, Math.max(0, k - 2), k + 3);
    mudar({ trechos: junt, ajustes }, `aparar:${Date.now()}`);
    const centro = lado === "ini" ? Math.max(t, trechos[k].ini) + 0.05 : Math.min(t, trechos[k].fim) - 0.05;
    const i = junt.findIndex((x) => x.ini - 1e-3 <= centro && centro < x.fim && x.removido !== true);
    setSel(i >= 0 ? i : null);
  };

  const salvar = async () => {
    setSalvando(true);
    try {
      const { banco } = await salvarEdicao(projeto.id, paraPedido(trechos), ajustes);
      setSujo(false);
      avisar(banco ? "Edição salva no projeto" : "Edição salva na VPS");
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setSalvando(false);
    }
  };

  const exportar = async () => {
    if (!plano.some((p) => !p.gancho)) { avisar("Todos os blocos estão fora do vídeo.", true); return; }
    pausarPrevia();
    setEnviando(true);
    try {
      await onMontar(op, paraPedido(trechos), ajustes);
      setSujo(false);
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setEnviando(false);
    }
  };

  const fechar = () => {
    if (sujo && !window.confirm("Sair sem salvar a edição?")) return;
    pausarPrevia();
    onFechar();
  };

  if (!carregado) {
    return <div className="dark fixed inset-0 z-50 flex items-center justify-center gap-2 bg-neutral-950 text-sm text-neutral-300"><Loader2 className="h-4 w-4 animate-spin" /> Abrindo a edição...</div>;
  }

  const fora = trAlvo ? trechoFora(trAlvo, base, opPlano) : false;
  const cortesAlvo = trAlvo && op.ia ? cortesDoTrecho(base, trAlvo) : [];
  const temCortes = op.ia && !!base?.ia?.cortes?.length;
  const itens = [
    { id: "dividir" as const, rotulo: "Dividir", icone: ICONES.dividir },
    { id: "layout" as const, rotulo: "Layout", icone: ICONES.layout, ativo: !!trAlvo?.layout },
    { id: "volume" as const, rotulo: "Volume", icone: ICONES.volume, ativo: trAlvo?.volume !== undefined },
    { id: "mudo" as const, rotulo: trAlvo?.mudo ? "Com som" : "Mudo", icone: ICONES.mudo, ativo: !!trAlvo?.mudo },
    { id: "congelar" as const, rotulo: "Congelar", icone: ICONES.congelar, ativo: !!(trAlvo?.congelar || trAlvo?.pausa) },
    { id: "apagar" as const, rotulo: fora ? "Restaurar" : "Apagar", icone: fora ? ICONES.restaurar : ICONES.apagar },
    { id: "juntar" as const, rotulo: "Juntar", icone: ICONES.juntar, desligado: alvo === null || alvo >= trechos.length - 1 },
    { id: "texto" as const, rotulo: "Texto", icone: ICONES.texto },
    { id: "modelo" as const, rotulo: "Modelo", icone: ICONES.modelo },
    ...(temCortes ? [{ id: "cortes" as const, rotulo: "Cortes IA", icone: ICONES.cortes, ativo: cortesAlvo.some((c) => restaurados.includes(c.id)) }] : []),
    { id: "ajustes" as const, rotulo: "Ajustes", icone: ICONES.ajustes },
  ];
  const nVisiveis = blocos.filter((b) => b.s1 > b.s0).length;
  const subtitulo = trAlvo && alvo !== null ? `Bloco ${alvo + 1} de ${trechos.length} · ${rotuloTrecho(trAlvo)} · ${formatarTempo(trAlvo.ini)}` : undefined;

  return (
    <div data-testid="editor-react" className="dark fixed inset-0 z-50 flex flex-col overflow-hidden bg-neutral-950 text-neutral-100"
      style={{ height: "100dvh", paddingTop: "env(safe-area-inset-top)" }}>
      {/* topo */}
      <div className="flex h-12 shrink-0 items-center gap-1 px-1">
        <button type="button" onClick={fechar} aria-label="Fechar" className="flex h-11 w-11 items-center justify-center rounded-full active:bg-white/10"><X className="h-5 w-5" /></button>
        <button type="button" onClick={desfazer} disabled={!passado.current.length} aria-label="Desfazer" className="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30 active:bg-white/10"><Undo2 className="h-5 w-5" /></button>
        <button type="button" onClick={refazer} disabled={!futuro.current.length} aria-label="Refazer" className="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30 active:bg-white/10"><Redo2 className="h-5 w-5" /></button>
        <div className="flex-1" />
        <button type="button" onClick={() => void salvar()} disabled={salvando || enviando} aria-label="Salvar edição" className="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-40 active:bg-white/10">
          {salvando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
        </button>
        <button type="button" onClick={() => void exportar()} disabled={enviando || salvando}
          className="mr-1 flex h-9 items-center gap-1.5 rounded-full bg-sky-500 px-4 text-sm font-semibold text-white disabled:opacity-50 active:bg-sky-600">
          {enviando && <Loader2 className="h-4 w-4 animate-spin" />} Exportar
        </button>
      </div>
      {erro && <p className="mx-2 rounded-md bg-amber-500/15 p-1.5 text-[11px] text-amber-200">{erro} · editando com a linha do tempo da gravação.</p>}
      {resp?.montando && <p className="mx-2 rounded-md bg-white/5 p-1.5 text-[11px] text-neutral-300">A primeira montagem ainda está rodando: dá para editar e exportar depois.</p>}

      {/* prévia */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 py-1">
        {aviso && (
          <p key={aviso.n} role="status" data-testid="aviso"
            className={`pointer-events-none absolute inset-x-6 bottom-3 z-30 mx-auto w-fit max-w-[90%] rounded-full px-3 py-1.5 text-center text-xs font-medium shadow-lg ${aviso.erro ? "bg-red-600 text-white" : "bg-white text-black"}`}>
            {aviso.texto}
          </p>
        )}
        <PreviaEdicao ref={previa} srcOriginal={fontes.original} srcReacao={fontes.reacao} remoto={fontes.remoto} trechos={trechos} plano={plano}
          titulo={titulo} onTempo={setS} onTocando={setTocando} />
      </div>

      {/* play/pause e tempo */}
      <div className="relative flex h-11 shrink-0 items-center px-3">
        <span className="text-xs tabular-nums text-neutral-300" data-testid="tempo">{formatarTempo(s)} <span className="text-neutral-500">/ {formatarTempo(dur)}</span></span>
        <button type="button" onClick={() => (tocando ? pausarPrevia() : previa.current?.tocar())} aria-label={tocando ? "Pausar" : "Tocar"}
          className="absolute left-1/2 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full active:bg-white/10">
          {tocando ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
        </button>
        <span className="ml-auto text-[11px] text-neutral-400">{noGancho ? "Gancho" : alvo !== null ? `Bloco ${alvo + 1}/${trechos.length}` : ""} · {nVisiveis} no vídeo</span>
      </div>

      {/* linha do tempo */}
      <div className="shrink-0 pb-1">
        <LinhaTempoEdicao trechos={trechos} plano={plano} blocos={blocos} dur={dur} s={s} pps={pps} onPps={setPps}
          selecionado={sel} atual={atualFinal} srcOriginal={fontes.original} srcReacao={fontes.reacao} remoto={fontes.remoto} picos={picos} falas={falas}
          titulo={titulo ? { texto: titulo.texto, ate: titulo.ate } : null} legenda={op.legenda && !edu}
          onSeek={procurar} onSelecionar={selecionar} onAparar={aoAparar} onGancho={() => usar("texto")} />
      </div>

      {/* ferramentas */}
      <div className="shrink-0 border-t border-white/10 pt-1" style={{ paddingBottom: "max(6px, env(safe-area-inset-bottom))" }}>
        <BarraFerramentas itens={itens} onEscolher={usar} />
      </div>

      {painel && (
        <PainelInferior titulo={TITULO_PAINEL[painel]} subtitulo={["layout", "volume", "congelar", "cortes"].includes(painel) ? subtitulo : undefined}
          onCancelar={() => fecharPainel(false)} onConfirmar={() => fecharPainel(true)}>
          {painel === "layout" && (
            <ControleLayout valor={trAlvo?.layout} onEscolher={(l) => patch({ layout: l }, "layout")}
              onTodos={() => patch({ layout: trAlvo?.layout }, "layout-todos", trechos.map((_, i) => i))} />
          )}
          {painel === "volume" && (
            <ControleVolume trecho={trAlvo} geral={ajustes.volume_geral}
              onBloco={(v) => patch({ volume: v >= 0.995 ? undefined : v, mudo: v <= 0.001 ? true : undefined }, "volume")}
              onMudo={(m) => patch({ mudo: m ? true : undefined }, "mudo")} onGeral={(v) => mudarAjuste({ volume_geral: v }, "volume")} />
          )}
          {painel === "congelar" && (
            <ControleCongelar trecho={trAlvo} falaSeg={falaDepois(falas, tGrav)} falasMedidas={!!falas} retomar={retomar} onRetomar={setRetomar}
              onCongelar={(v) => patch({ congelar: v ? true : undefined }, "congelar")} onPausar={pausar}
              onDesfazerPausa={() => { if (alvo === null) return; const n = desfazerPausa(trechos, alvo); mudar({ trechos: n, ajustes }, `despausa:${Date.now()}`); setSel(null); }} />
          )}
          {painel === "texto" && (
            <ControleTexto ia={op.ia} titulo={tituloIA} gancho={!!base?.ia?.gancho} tituloLigado={ajustes.ia_titulo} ganchoLigado={ajustes.ia_gancho}
              legenda={op.legenda} legendaNoModelo={!edu}
              onTitulo={(v) => mudarAjuste({ ia_titulo: v }, "titulo")} onGancho={(v) => mudarAjuste({ ia_gancho: v }, "gancho")}
              onLegenda={(v) => { setOp({ ...op, legenda: v }); setSujo(true); }} />
          )}
          {painel === "modelo" && <ControleModelo valor={op.modelo} onEscolher={(m) => { setOp({ ...op, modelo: m }); setSujo(true); }} />}
          {painel === "cortes" && (
            <ControleCortes cortes={cortesAlvo} restaurados={restaurados}
              onRestaurar={(id, v) => mudarAjuste({ cortes_ia_restaurados: v ? Array.from(new Set([...restaurados, id])) : restaurados.filter((x) => x !== id) }, `corte:${id}`)} />
          )}
          {painel === "ajustes" && <OpcoesReact op={op} onChange={(o) => { setOp(o); setSujo(true); }} />}
        </PainelInferior>
      )}
    </div>
  );
}
