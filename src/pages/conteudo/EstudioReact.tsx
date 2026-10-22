// Estúdio React (/conteudo/react): ele sobe o vídeo que vai reagir, o estúdio toca esse vídeo e grava a câmera dele
// ao mesmo tempo; "Pausar e comentar" congela o original e marca o momento; "Finalizar" manda tudo para a VPS, que
// monta o react vertical (tela dividida, silêncios cortados, legenda automática, volume) — infra/react.
// Modo "Já gravei separado" (beta): ele sobe as duas gravações e a VPS acha as pausas pelo áudio.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Camera, CheckCircle2, Circle, Film, Loader2, Mic, Pause, Play, RefreshCw, RotateCcw, SlidersHorizontal, Square, SwitchCamera, Upload } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ListaReacts } from "@/components/conteudo/react/ListaReacts";
import { OpcoesRecolhidas, ResultadoReact } from "@/components/conteudo/react/ResultadoReact";
import { EditorReact } from "@/components/conteudo/react/EditorReact";
import { CarregarLink } from "@/components/conteudo/react/CarregarLink";
import { OP_PADRAO, colunasOp, opcoesDoProjeto, type OpcoesMontagem } from "@/lib/conteudo/react/opcoes";
import { podePublicar as calcPode } from "@/lib/conteudo/publicacoes";
import { aposMudanca, observarAparelhos, rotuloAparelho, type ListaAparelhos } from "@/lib/lives/dispositivos";
import {
  type EstadoLink, type Modo, type ProjetoReact, MAX_BYTES, apagarProjeto, atualizarProjeto, criarProjeto, fecharArquivo, listarProjetos,
  atualizarColunasIA, atualizarColunasOpcionais, montar, subirArquivo, tituloDoArquivo,
} from "@/lib/conteudo/react/api";
import type { AjustesEdicao, TrechoEd } from "@/lib/conteudo/react/edicao";
import { abrirCamera, ErroCamera, Gravador, listarAparelhos, manterTelaAcesa, pararStream, proximaCamera, type EscolhaCamera } from "@/lib/conteudo/react/gravador";
import { LinhaTempo, formatarTempo, type Trecho } from "@/lib/conteudo/react/linhaTempo";

type Fase = "preparo" | "gravando" | "enviando" | "resultado" | "edicao";
interface Envio { estado: "parado" | "enviando" | "ok" | "erro"; frac: number; erro?: string }
const ENVIO_ZERO: Envio = { estado: "parado", frac: 0 };
const ehVideo = (f: File) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name);
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b > 100 * 1024 * 1024 ? 0 : 1)} MB`;

function BarraEnvio({ rotulo, envio, onTentar }: { rotulo: string; envio: Envio; onTentar?: () => void }) {
  if (envio.estado === "parado") return null;
  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center gap-2">
        {envio.estado === "ok" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : envio.estado === "erro" ? <Circle className="h-3.5 w-3.5 text-destructive" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <span>{envio.estado === "ok" ? `${rotulo}: enviado` : envio.estado === "erro" ? `${rotulo}: ${envio.erro}` : `${rotulo}: enviando ${Math.round(envio.frac * 100)}%`}</span>
        {envio.estado === "erro" && onTentar && <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={onTentar}>tentar de novo</Button>}
      </div>
      {envio.estado === "enviando" && <Progress value={Math.round(envio.frac * 100)} className="h-1.5" />}
    </div>
  );
}

/** Palco no formato do vídeo original (Reels 9:16, horizontal 16:9...): largura = min(100%, altura máx x proporção) e
 *  altura pela proporção. O vídeo preenche o palco inteiro, então não sobra faixa preta de lado nem em cima. */
function palcoEstilo(alturaMax: string, prop: number | null): CSSProperties {
  if (!prop) return { height: alturaMax, scrollMarginTop: 8 };
  return { aspectRatio: String(prop), maxWidth: `calc(${alturaMax} * ${prop.toFixed(4)})`, maxHeight: alturaMax, scrollMarginTop: 8 };
}

export default function EstudioReact() {
  const { isAdmin, allowedModules } = useAuth();
  const pode = calcPode(isAdmin, allowedModules);
  const navigate = useNavigate();

  const [aba, setAba] = useState<Modo>("aqui");
  const [fase, setFase] = useState<Fase>("preparo");
  const [projeto, setProjeto] = useState<ProjetoReact | null>(null);
  const [rodada, setRodada] = useState(0);
  const [op, setOp] = useState<OpcoesMontagem>(OP_PADRAO);
  const [erroFluxo, setErroFluxo] = useState<string | null>(null);

  // vídeo original
  const [arqOriginal, setArqOriginal] = useState<File | null>(null);
  const [urlOriginal, setUrlOriginal] = useState<string | null>(null);
  const [envioOrig, setEnvioOrig] = useState<Envio>(ENVIO_ZERO);
  const envioOrigRef = useRef<Promise<void> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputOrigRef = useRef<HTMLInputElement>(null);

  // câmera
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [escolha, setEscolha] = useState<EscolhaCamera>({ lado: "user" });
  const [aparelhos, setAparelhos] = useState<ListaAparelhos>({ cameras: [], mics: [], saidas: [] });
  const [ligando, setLigando] = useState(false);
  const [erroCam, setErroCam] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // gravação
  const gravRef = useRef<Gravador | null>(null);
  const linhaRef = useRef<LinhaTempo | null>(null);
  const soltarTelaRef = useRef<() => void>(() => undefined);
  const [tocando, setTocando] = useState(false);
  const [tempo, setTempo] = useState(0);
  const [pausas, setPausas] = useState(0);
  const [blobReacao, setBlobReacao] = useState<Blob | null>(null);
  const [trechos, setTrechos] = useState<Trecho[] | null>(null);
  const [envioReac, setEnvioReac] = useState<Envio>(ENVIO_ZERO);
  /** projeto cuja gravação está neste aparelho (a tela de edição usa os arquivos locais na prévia) */
  const [idLocal, setIdLocal] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // separado
  const [arqReacSep, setArqReacSep] = useState<File | null>(null);
  const inputSepRef = useRef<HTMLInputElement>(null);

  // lista
  const [lista, setLista] = useState<ProjetoReact[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(false);
  const [erroLista, setErroLista] = useState<string | null>(null);

  const videoOrigRef = useRef<HTMLVideoElement>(null);
  const palcoRef = useRef<HTMLDivElement>(null);
  /** proporção (largura/altura) do vídeo original: o palco toma a forma dele, sem faixa preta e sem cortar nada */
  const [propOrig, setPropOrig] = useState<number | null>(null);
  const videoCamRef = useRef<HTMLVideoElement>(null);
  const urlBlob = useMemo(() => (blobReacao ? URL.createObjectURL(blobReacao) : null), [blobReacao]);
  useEffect(() => () => { if (urlBlob) URL.revokeObjectURL(urlBlob); }, [urlBlob]);

  const recarregar = useCallback(async () => {
    if (!pode) return;
    setCarregandoLista(true);
    try { setLista(await listarProjetos()); setErroLista(null); } catch (e) { setErroLista((e as Error).message); } finally { setCarregandoLista(false); }
  }, [pode]);
  useEffect(() => { void recarregar(); }, [recarregar]);

  // prévia da câmera
  useEffect(() => {
    streamRef.current = stream;
    if (videoCamRef.current) videoCamRef.current.srcObject = stream;
  }, [stream]);

  // iPhone/AirPods entrando e saindo
  useEffect(() => observarAparelhos(navigator.mediaDevices, () => {
    void listarAparelhos().then((l) => {
      setAparelhos(l);
      setEscolha((esc) => ({ ...esc, ...aposMudanca({ cameraId: esc.cameraId, micId: esc.micId }, l).escolha }));
    });
  }), []);

  // ao sair: solta câmera, cancela envio, libera o arquivo local
  useEffect(() => () => {
    pararStream(streamRef.current);
    abortRef.current?.abort();
    gravRef.current?.descartar();
    soltarTelaRef.current();
  }, []);
  useEffect(() => () => { if (urlOriginal) URL.revokeObjectURL(urlOriginal); }, [urlOriginal]);

  // não perder a gravação fechando a aba sem querer
  useEffect(() => {
    if (fase !== "gravando" && !enviando) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [fase, enviando]);

  // eventos do original -> linha do tempo
  useEffect(() => {
    const v = videoOrigRef.current;
    if (!v) return;
    const ouvir = (tipo: string) => () => {
      const g = gravRef.current;
      const l = linhaRef.current;
      if (!g || !l || !g.gravando) return;
      const t = g.agora();
      if (tipo === "playing") l.tocando(t, v.currentTime);
      else if (tipo === "seeked") l.pulou(t, v.currentTime);
      else l.parado(t, v.currentTime);
      setTocando(l.tocandoAgora);
      setPausas(l.pausas);
    };
    const tipos = ["playing", "pause", "waiting", "ended", "seeked"];
    const fns = tipos.map((t) => [t, ouvir(t)] as const);
    fns.forEach(([t, f]) => v.addEventListener(t, f));
    return () => fns.forEach(([t, f]) => v.removeEventListener(t, f));
  }, [urlOriginal]);

  // gravando: o cabeçalho some; depois de redesenhar, o palco vai para o topo (vídeo, câmera e botões sem rolar)
  useEffect(() => {
    if (fase !== "gravando") return;
    const id = requestAnimationFrame(() => palcoRef.current?.scrollIntoView?.({ block: "start" }));
    return () => cancelAnimationFrame(id);
  }, [fase]);

  // relógio da gravação
  useEffect(() => {
    if (fase !== "gravando") return;
    const t = setInterval(() => setTempo(gravRef.current?.agora() ?? 0), 250);
    return () => clearInterval(t);
  }, [fase]);

  // ------------------------------------------------------------------ original
  const iniciarEnvioOriginal = useCallback((p: ProjetoReact, f: File) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setEnvioOrig({ estado: "enviando", frac: 0 });
    const pr = (async () => {
      await subirArquivo(p.id, "original", f, (frac) => setEnvioOrig({ estado: "enviando", frac }), ac.signal);
      await fecharArquivo(p.id, "original");
      setEnvioOrig({ estado: "ok", frac: 1 });
    })();
    pr.catch((e) => { if (!ac.signal.aborted) setEnvioOrig({ estado: "erro", frac: 0, erro: (e as Error).message }); });
    envioOrigRef.current = pr;
  }, []);

  const escolherOriginal = async (f: File | undefined) => {
    if (!f) return;
    setErroFluxo(null);
    if (!ehVideo(f)) { toast.error("Escolha um arquivo de vídeo (MP4, MOV ou WEBM)."); return; }
    if (f.size > MAX_BYTES) { toast.error("Vídeo acima de 2 GB."); return; }
    setArqOriginal(f);
    setUrlOriginal(URL.createObjectURL(f));
    try {
      const p = await criarProjeto({
        titulo: tituloDoArquivo(f.name), perfil: "fitness", modo: aba, ...colunasOp(op),
        original_nome: f.name.slice(0, 300), original_bytes: f.size, status: "rascunho",
      });
      setProjeto(p);
      iniciarEnvioOriginal(p, f);
      void recarregar();
    } catch (e) {
      setErroFluxo((e as Error).message);
    }
  };

  const esperarOriginal = async (p: ProjetoReact) => {
    if (envioOrig.estado === "erro" || !envioOrigRef.current) {
      if (!arqOriginal) throw new Error("escolha o vídeo original de novo");
      iniciarEnvioOriginal(p, arqOriginal);
    }
    await envioOrigRef.current;
  };

  // ------------------------------------------------------------------ câmera
  const ligarCamera = async (esc: EscolhaCamera = escolha) => {
    setLigando(true);
    setErroCam(null);
    try {
      const s = await abrirCamera(esc);
      pararStream(streamRef.current);
      setStream(s);
      const l = await listarAparelhos();
      setAparelhos(l);
      const cam = s.getVideoTracks()[0]?.getSettings().deviceId;
      const mic = s.getAudioTracks()[0]?.getSettings().deviceId;
      setEscolha({ ...esc, cameraId: cam || esc.cameraId, micId: mic || esc.micId });
    } catch (e) {
      setErroCam(e instanceof ErroCamera ? e.message : (e as Error).message);
    } finally {
      setLigando(false);
    }
  };
  const trocarCamera = () => void ligarCamera(proximaCamera(aparelhos, escolha));

  // ------------------------------------------------------------------ gravação
  const comecar = async () => {
    const v = videoOrigRef.current;
    if (!v || !stream || !projeto) return;
    setErroFluxo(null);
    let g: Gravador;
    try { g = new Gravador(stream); } catch (e) { setErroFluxo((e as Error).message); return; }
    const l = new LinhaTempo();
    gravRef.current = g;
    linhaRef.current = l;
    l.iniciar(0, v.currentTime);
    setPausas(0);
    setTempo(0);
    setBlobReacao(null);
    setTrechos(null);
    const comecou = g.iniciar();
    const tocou = v.play(); // no mesmo toque do botão: o celular só deixa tocar com som assim
    setFase("gravando");
    soltarTelaRef.current = await manterTelaAcesa();
    try { await comecou; } catch (e) { setErroFluxo((e as Error).message); }
    try { await tocou; } catch { setErroFluxo("O navegador não deixou o vídeo tocar sozinho: toque em \"Voltar o vídeo\"."); }
  };

  const pausarOuVoltar = () => {
    const v = videoOrigRef.current;
    if (!v) return;
    if (linhaRef.current?.tocandoAgora) v.pause();
    else void v.play().catch(() => toast.error("Não consegui tocar o vídeo"));
  };

  const descartar = () => {
    gravRef.current?.descartar();
    gravRef.current = null;
    linhaRef.current = null;
    videoOrigRef.current?.pause();
    soltarTelaRef.current();
    setFase("preparo");
    setTocando(false);
  };

  /** colunas opcionais da montagem (migrations 20261201100000 e 20261205100000): falta de coluna não atrapalha */
  const gravarOpcionais = (id: string, o: OpcoesMontagem) => {
    void atualizarColunasIA(id, { edicao_ia: o.ia, duracao_max_seg: o.duracao_max });
    void atualizarColunasOpcionais(id, { modelo_edicao: o.modelo });
  };

  const enviarEMontar = async (p: ProjetoReact, blob: Blob, tr: Trecho[]) => {
    setEnviando(true);
    setErroFluxo(null);
    setFase("enviando");
    try {
      const dur = tr.length ? tr[tr.length - 1].fim : 0;
      await atualizarProjeto(p.id, { linha_tempo: tr, duracao_gravacao_seg: Math.round(dur * 100) / 100, status: "enviando", erro: null, modo: "aqui", ...colunasOp(op) });
      gravarOpcionais(p.id, op);
      await esperarOriginal(p);
      setEnvioReac({ estado: "enviando", frac: 0 });
      await subirArquivo(p.id, "reacao", blob, (frac) => setEnvioReac({ estado: "enviando", frac }));
      await fecharArquivo(p.id, "reacao");
      setEnvioReac({ estado: "ok", frac: 1 });
      await montar(p.id, { modo: "aqui", ...op, trechos: tr });
      await atualizarProjeto(p.id, { status: "montando" });
      setProjeto({ ...p, ...colunasOp(op), edicao_ia: op.ia, duracao_max_seg: op.duracao_max, modelo_edicao: op.modelo, linha_tempo: tr, status: "montando" });
      setRodada((r) => r + 1);
      setFase("resultado");
      void recarregar();
    } catch (e) {
      setEnvioReac((x) => (x.estado === "enviando" ? { ...x, estado: "erro", erro: (e as Error).message } : x));
      setErroFluxo((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const finalizar = async () => {
    const g = gravRef.current;
    const l = linhaRef.current;
    const v = videoOrigRef.current;
    if (!g || !l || !projeto) return;
    v?.pause();
    const t = g.agora();
    const blob = await g.parar();
    const tr = l.finalizar(t);
    soltarTelaRef.current();
    setBlobReacao(blob);
    setIdLocal(projeto.id);
    setTrechos(tr);
    setTocando(false);
    if (!tr.some((x) => x.tipo === "tocando")) {
      setErroFluxo("O vídeo original não chegou a tocar durante a gravação. Grave de novo.");
      setFase("preparo");
      return;
    }
    await enviarEMontar(projeto, blob, tr);
  };

  // ------------------------------------------------------------------ separado (beta)
  const montarSeparado = async () => {
    if (!projeto || !arqReacSep) return;
    setEnviando(true);
    setErroFluxo(null);
    setFase("enviando");
    try {
      await atualizarProjeto(projeto.id, { status: "enviando", modo: "separado", erro: null, ...colunasOp(op) });
      gravarOpcionais(projeto.id, op);
      await esperarOriginal(projeto);
      setEnvioReac({ estado: "enviando", frac: 0 });
      await subirArquivo(projeto.id, "reacao", arqReacSep, (frac) => setEnvioReac({ estado: "enviando", frac }));
      await fecharArquivo(projeto.id, "reacao");
      setEnvioReac({ estado: "ok", frac: 1 });
      await montar(projeto.id, { modo: "separado", ...op, trechos: [] });
      await atualizarProjeto(projeto.id, { status: "montando" });
      setProjeto({ ...projeto, ...colunasOp(op), edicao_ia: op.ia, duracao_max_seg: op.duracao_max, modelo_edicao: op.modelo, modo: "separado", status: "montando" });
      setRodada((r) => r + 1);
      setFase("resultado");
      void recarregar();
    } catch (e) {
      setEnvioReac((x) => (x.estado === "enviando" ? { ...x, estado: "erro", erro: (e as Error).message } : x));
      setErroFluxo((e as Error).message);
      setFase("preparo"); // o botão volta: o envio retoma de onde parou
    } finally {
      setEnviando(false);
    }
  };

  // ------------------------------------------------------------------ resultado / lista
  const remontar = async (o: OpcoesMontagem) => {
    if (!projeto) return;
    await montar(projeto.id, { modo: projeto.modo, ...o, trechos: projeto.modo === "separado" ? [] : projeto.linha_tempo });
    await atualizarProjeto(projeto.id, { ...colunasOp(o), status: "montando", erro: null });
    gravarOpcionais(projeto.id, o);
    setProjeto({ ...projeto, ...colunasOp(o), edicao_ia: o.ia, duracao_max_seg: o.duracao_max, modelo_edicao: o.modelo, status: "montando" });
    setRodada((r) => r + 1);
    void recarregar();
  };

  /** "Montar com estas escolhas" da tela de edição: os trechos dele + os ajustes gerais; a VPS também salva. */
  const montarComEdicao = async (o: OpcoesMontagem, tr: TrechoEd[], ajustes: AjustesEdicao) => {
    if (!projeto) return;
    await montar(projeto.id, { modo: projeto.modo, ...o, trechos: tr, edicao: ajustes });
    await atualizarProjeto(projeto.id, { ...colunasOp(o), status: "montando", erro: null });
    gravarOpcionais(projeto.id, o);
    const salva = { trechos: tr, edicao: ajustes, salvo_em: Math.floor(Date.now() / 1000) };
    void atualizarColunasOpcionais(projeto.id, { edicao: salva });
    setProjeto({ ...projeto, ...colunasOp(o), edicao_ia: o.ia, duracao_max_seg: o.duracao_max, modelo_edicao: o.modelo, edicao: salva, status: "montando" });
    setOp(o);
    setRodada((r) => r + 1);
    setFase("resultado");
    toast.success("Montando com as suas escolhas");
    void recarregar();
  };

  // ------------------------------------------------------------------ original pelo link do Instagram
  const garantirProjeto = async (): Promise<ProjetoReact> => {
    abortRef.current?.abort();   // um upload de arquivo em andamento perde para o link
    if (projeto) return projeto;
    const p = await criarProjeto({ titulo: "React", perfil: "fitness", modo: aba, ...colunasOp(op), status: "rascunho" });
    setProjeto(p);
    return p;
  };

  const originalDoLink = (f: File, info: EstadoLink, p: ProjetoReact) => {
    setErroFluxo(null);
    setArqOriginal(f);
    setUrlOriginal(URL.createObjectURL(f));
    setEnvioOrig({ estado: "ok", frac: 1 });
    envioOrigRef.current = Promise.resolve();   // a VPS já tem o arquivo (subirArquivo confere pelo tamanho e não reenvia)
    const titulo = info.autor ? `React @${info.autor}`.slice(0, 120) : "React";
    void atualizarProjeto(p.id, { titulo, original_nome: f.name.slice(0, 300), original_bytes: f.size }).catch(() => undefined);
    void atualizarColunasOpcionais(p.id, { origem_url: info.url ?? null, origem_autor: info.autor ?? null });
    setProjeto({ ...p, titulo, original_nome: f.name, original_bytes: f.size, origem_url: info.url ?? null, origem_autor: info.autor ?? null });
    toast.success(info.autor ? `Vídeo de @${info.autor} carregado` : "Vídeo carregado");
    void recarregar();
  };

  const novo = () => {
    abortRef.current?.abort();
    setProjeto(null);
    setArqOriginal(null);
    setUrlOriginal(null);
    setArqReacSep(null);
    setEnvioOrig(ENVIO_ZERO);
    setEnvioReac(ENVIO_ZERO);
    setBlobReacao(null);
    setIdLocal(null);
    setTrechos(null);
    setErroFluxo(null);
    setFase("preparo");
    void recarregar();
  };

  const abrir = (p: ProjetoReact) => {
    if (fase === "gravando" || enviando) { toast.error("Termine a gravação atual antes."); return; }
    setProjeto(p);
    setOp(opcoesDoProjeto(p));
    setRodada((r) => r + 1);
    setFase("resultado");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const apagar = async (p: ProjetoReact) => {
    if (!window.confirm(`Apagar "${p.titulo}"? Os vídeos saem da VPS também.`)) return;
    try {
      await apagarProjeto(p.id);
      if (projeto?.id === p.id) novo();
      else void recarregar();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // ------------------------------------------------------------------ tela
  if (!pode) {
    return (
      <div className="mx-auto max-w-xl space-y-3 p-6">
        <h1 className="text-xl font-semibold">Estúdio React</h1>
        <p className="text-sm text-muted-foreground">Seu usuário não tem acesso ao Conteúdo. Peça ao admin o módulo "Conteúdo" em Usuários.</p>
      </div>
    );
  }

  const gravando = fase === "gravando";
  const prontoParaGravar = !!urlOriginal && !!stream && !!projeto && fase === "preparo";
  const faltaParaGravar = !urlOriginal ? "Escolha o vídeo no player." : !stream ? "Ligue a câmera na janelinha." : !projeto ? "Preparando o projeto..." : "";

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 pb-16 sm:p-4">
      {!gravando && fase !== "edicao" && (
        <header className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="shrink-0 px-2" onClick={() => navigate("/conteudo")}><ArrowLeft className="mr-1 h-4 w-4" /> Conteúdo</Button>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold sm:text-xl">Estúdio React</h1>
        </header>
      )}

      {fase !== "resultado" && fase !== "edicao" && !gravando && (
        <Tabs value={aba} onValueChange={(v) => { if (fase === "preparo" && !projeto) setAba(v as Modo); else toast.message("Comece um react novo para trocar o modo."); }}>
          <TabsList>
            <TabsTrigger value="aqui">Gravar aqui</TabsTrigger>
            <TabsTrigger value="separado">Já gravei separado (beta)</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {erroFluxo && <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{erroFluxo}</p>}

      {fase === "resultado" && projeto && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">{projeto.titulo}</h2>
          <ResultadoReact projeto={projeto} podePublicar={pode} rodada={rodada} onRemontar={remontar} onNovo={novo}
            onEditar={() => { setFase("edicao"); window.scrollTo({ top: 0 }); }} />
        </section>
      )}

      {fase === "edicao" && projeto && (
        <EditorReact projeto={projeto} op={op}
          fontesLocais={projeto.id === idLocal && urlOriginal && urlBlob ? { original: urlOriginal, reacao: urlBlob } : undefined}
          onFechar={() => setFase("resultado")} onMontar={montarComEdicao} />
      )}

      <input ref={inputOrigRef} type="file" accept="video/*" className="hidden" onChange={(e) => { void escolherOriginal(e.target.files?.[0]); e.target.value = ""; }} />

      {fase !== "resultado" && fase !== "edicao" && aba === "aqui" && (
        <div className="mx-auto w-full max-w-md space-y-3">
          {/* palco: o vídeo original grande e você numa janelinha no canto, com os controles da câmera nela */}
          <div ref={palcoRef} data-testid="palco" className="relative mx-auto w-full overflow-hidden rounded-xl bg-black"
            style={palcoEstilo(gravando ? "min(64svh, 680px)" : "min(54svh, 600px)", urlOriginal ? propOrig : null)}>
            {urlOriginal ? (
              <video ref={videoOrigRef} src={urlOriginal} playsInline controls={!gravando} preload="auto" className="h-full w-full object-cover"
                onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) setPropOrig(v.videoWidth / v.videoHeight); }} />
            ) : (
              <button type="button" onClick={() => inputOrigRef.current?.click()}
                className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-white">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15"><Film className="h-8 w-8" /></span>
                <span className="text-base font-semibold">Escolher vídeo</span>
                <span className="text-xs text-white/70">o vídeo que você vai reagir (MP4, MOV ou WEBM)</span>
              </button>
            )}
            {urlOriginal && fase === "preparo" && (
              <Button size="sm" variant="secondary" className="absolute left-2 top-2 h-8 bg-black/60 text-white hover:bg-black/80" onClick={() => inputOrigRef.current?.click()}>
                <Upload className="mr-1.5 h-3.5 w-3.5" /> Trocar vídeo
              </Button>
            )}
            {gravando && !tocando && <span className="absolute left-2 top-2 rounded bg-amber-500 px-2 py-0.5 text-xs font-semibold text-black">VÍDEO PAUSADO · COMENTANDO</span>}

            {/* câmera dele: janelinha no canto */}
            <div data-testid="camera-pip" className="absolute right-2 top-2 w-1/3 overflow-hidden rounded-lg border-2 border-white/80 bg-neutral-900 shadow-lg" style={{ aspectRatio: "3 / 4" }}>
              {stream ? (
                <video ref={videoCamRef} autoPlay muted playsInline className="h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} />
              ) : (
                <button type="button" onClick={() => void ligarCamera()} disabled={ligando} className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center text-xs text-white">
                  {ligando ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />} Ligar câmera e microfone
                </button>
              )}
              {gravando && (
                <span className="absolute left-1 top-1 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> REC {formatarTempo(tempo)}
                </span>
              )}
              {stream && fase === "preparo" && (
                <div className="absolute inset-x-1 bottom-1 flex justify-between">
                  <Button size="icon" variant="secondary" className="h-8 w-8 bg-black/60 text-white hover:bg-black/80" title="Trocar câmera" aria-label="Trocar câmera" onClick={trocarCamera} disabled={ligando}>
                    {ligando ? <Loader2 className="h-4 w-4 animate-spin" /> : <SwitchCamera className="h-4 w-4" />}
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button size="icon" variant="secondary" className="h-8 w-8 bg-black/60 text-white hover:bg-black/80" title="Câmera e microfone" aria-label="Câmera e microfone"><SlidersHorizontal className="h-4 w-4" /></Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 space-y-2">
                      {aparelhos.cameras.length > 0 && (
                        <div className="flex items-center gap-2">
                          <Camera className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <Select value={escolha.cameraId || ""} onValueChange={(id) => void ligarCamera({ ...escolha, cameraId: id })}>
                            <SelectTrigger className="h-9"><SelectValue placeholder="Câmera" /></SelectTrigger>
                            <SelectContent>{aparelhos.cameras.map((c, i) => <SelectItem key={c.deviceId} value={c.deviceId}>{rotuloAparelho(c, i)}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      )}
                      {aparelhos.mics.length > 0 && (
                        <div className="flex items-center gap-2">
                          <Mic className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <Select value={escolha.micId || ""} onValueChange={(id) => void ligarCamera({ ...escolha, micId: id })}>
                            <SelectTrigger className="h-9"><SelectValue placeholder="Microfone" /></SelectTrigger>
                            <SelectContent>{aparelhos.mics.map((c, i) => <SelectItem key={c.deviceId} value={c.deviceId}>{rotuloAparelho(c, i)}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">Use fone de ouvido se puder: o som do vídeo não entra na sua voz e a legenda sai mais limpa.</p>
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>
          </div>

          {erroCam && <p className="text-sm text-destructive">{erroCam}</p>}
          {fase === "preparo" && !urlOriginal && <CarregarLink garantirProjeto={garantirProjeto} onPronto={originalDoLink} />}

          {/* botões grandes logo abaixo do vídeo */}
          {fase === "preparo" && (
            <div className="space-y-2">
              <Button className="h-14 w-full text-lg" onClick={() => void comecar()} disabled={!prontoParaGravar}>
                <span className="mr-2 h-3 w-3 rounded-full bg-red-500" /> Começar gravação
              </Button>
              {!prontoParaGravar && faltaParaGravar && <p className="text-center text-xs text-muted-foreground">{faltaParaGravar}</p>}
              <BarraEnvio rotulo="Original" envio={envioOrig} onTentar={() => projeto && arqOriginal && iniciarEnvioOriginal(projeto, arqOriginal)} />
              {arqOriginal && <p className="truncate text-xs text-muted-foreground">{arqOriginal.name} · {mb(arqOriginal.size)} · o envio continua enquanto você grava</p>}
              <OpcoesRecolhidas op={op} onChange={setOp} />
            </div>
          )}

          {gravando && (
            <div className="space-y-2">
              <Button className="h-16 w-full text-lg" variant={tocando ? "default" : "secondary"} onClick={pausarOuVoltar}>
                {tocando ? <><Pause className="mr-2 h-6 w-6" /> Pausar e comentar</> : <><Play className="mr-2 h-6 w-6" /> Voltar o vídeo</>}
              </Button>
              <div className="flex gap-2">
                <Button className="h-14 flex-1 text-base" variant="destructive" onClick={() => void finalizar()}><Square className="mr-2 h-5 w-5" /> Finalizar</Button>
                <Button className="h-14 px-4" variant="outline" onClick={descartar}><RotateCcw className="mr-2 h-4 w-4" /> Descartar</Button>
              </div>
              <p className="text-center text-xs text-muted-foreground">{pausas} pausa(s) · pause quando quiser comentar; Finalizar envia e monta sozinho</p>
              <BarraEnvio rotulo="Original" envio={envioOrig} />
            </div>
          )}

          {fase === "enviando" && (
            <section className="space-y-3 rounded-lg border p-4">
              <h2 className="text-sm font-semibold">Enviando para a montagem</h2>
              <BarraEnvio rotulo="Original" envio={envioOrig} />
              <BarraEnvio rotulo="Sua gravação" envio={envioReac} />
              {trechos && <p className="text-xs text-muted-foreground">{formatarTempo(trechos[trechos.length - 1]?.fim || 0)} gravados · {pausas} pausa(s)</p>}
              {!enviando && projeto && blobReacao && trechos && (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void enviarEMontar(projeto, blobReacao, trechos)}><RefreshCw className="mr-2 h-4 w-4" /> Tentar de novo</Button>
                  <Button variant="outline" asChild><a href={urlBlob || undefined} download={`minha-gravacao.${blobReacao.type.includes("mp4") ? "mp4" : "webm"}`}>Baixar minha gravação</a></Button>
                  <Button variant="ghost" onClick={() => setFase("preparo")}>Gravar de novo</Button>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {fase !== "resultado" && fase !== "edicao" && aba === "separado" && (
        <section className="max-w-2xl space-y-4">
          <p className="text-sm text-muted-foreground">
            Gravou no celular com o vídeo tocando em outro aparelho? Suba as duas gravações. A VPS acha sozinha, pelo som do original que
            vazou no seu microfone, onde o vídeo estava tocando e onde você pausou para comentar. Funciona melhor com o original tocando
            alto e você longe de barulho. Confira a prévia antes de publicar.
          </p>
          <div className="space-y-2 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">1. Vídeo original</h2>
            <Button variant="outline" onClick={() => inputOrigRef.current?.click()} disabled={fase !== "preparo"}><Upload className="mr-2 h-4 w-4" /> {arqOriginal ? "Trocar vídeo" : "Escolher vídeo"}</Button>
            {arqOriginal && <p className="text-xs text-muted-foreground">{arqOriginal.name} · {mb(arqOriginal.size)}</p>}
            <BarraEnvio rotulo="Original" envio={envioOrig} onTentar={() => projeto && arqOriginal && iniciarEnvioOriginal(projeto, arqOriginal)} />
            {fase === "preparo" && <CarregarLink compacto garantirProjeto={garantirProjeto} onPronto={originalDoLink} />}
          </div>
          <div className="space-y-2 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">2. A sua gravação (com o som do original ao fundo)</h2>
            <input ref={inputSepRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && ehVideo(f)) setArqReacSep(f); e.target.value = ""; }} />
            <Button variant="outline" onClick={() => inputSepRef.current?.click()} disabled={fase !== "preparo"}><Upload className="mr-2 h-4 w-4" /> {arqReacSep ? "Trocar gravação" : "Escolher gravação"}</Button>
            {arqReacSep && <p className="text-xs text-muted-foreground">{arqReacSep.name} · {mb(arqReacSep.size)}</p>}
            <BarraEnvio rotulo="Sua gravação" envio={envioReac} />
          </div>
          <OpcoesRecolhidas op={op} onChange={setOp} desativado={fase !== "preparo"} />
          <Button className="h-12" onClick={() => void montarSeparado()} disabled={!projeto || !arqReacSep || enviando}>
            {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Sincronizar e montar
          </Button>
        </section>
      )}

      {!gravando && fase !== "edicao" && <ListaReacts lista={lista} carregando={carregandoLista} erro={erroLista} atualId={projeto?.id} onAbrir={abrir} onApagar={(p) => void apagar(p)} onRecarregar={() => void recarregar()} />}
    </div>
  );
}
