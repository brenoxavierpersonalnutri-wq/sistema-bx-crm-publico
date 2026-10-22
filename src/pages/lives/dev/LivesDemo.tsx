// SÓ EM DESENVOLVIMENTO (rota registrada atrás de import.meta.env.DEV, fora do bundle de produção):
// painel, pré-sala e estúdio com dados fictícios, para conferir a interface sem login nem servidor.
// /dev/lives?tela=painel | presala | estudio[&aba=marca|banners|...][&status=fora][&layout=solo|...|tela-cheia][&compartilhando=1]
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { LivesPainelView } from "@/components/lives/painel/LivesPainelView";
import { CriarLiveDialog } from "@/components/lives/painel/CriarLiveDialog";
import type { TipoCriacao } from "@/lib/lives/painel";
import { PreSala } from "@/components/lives/estudio/PreSala";
import { EstudioView, type AbaEstudio } from "@/components/lives/estudio/EstudioView";
import { QuadroCena } from "@/components/lives/QuadroCena";
import type { PessoaFila } from "@/components/lives/estudio/FilaBastidores";
import type { LiveDestino, LiveOverlay } from "@/lib/lives/api";
import { inverterDoisPrimeiros, noPalco, ordemAoSubir, ordemParaDestacar, calcularCena, LAYOUTS, type LayoutLive, type ParticipanteCena } from "@/lib/lives/layout";
import { itensDoPainel, type LiveRoomExtra } from "@/lib/lives/painel";

const agora = Date.now();
const iso = (dh: number) => new Date(agora + dh * 3600_000).toISOString();

const SALAS: LiveRoomExtra[] = [
  { id: "s1", titulo: "Aula aberta: tráfego para negócio local", livekit_room: "x", layout: "lado-a-lado", cor: "#2563eb", status: "ao_vivo", egress_id: "e", gravacao_egress_id: "g", cf_live_input_uid: null, cf_hls_url: null, cf_conectado: false, ultimo_erro: null, iniciada_em: iso(-0.4), created_at: iso(-2) },
  { id: "s2", titulo: "Bate-papo com cliente: case de 30 dias", livekit_room: "x", layout: "grade", cor: null, status: "rascunho", egress_id: null, gravacao_egress_id: null, cf_live_input_uid: null, cf_hls_url: null, cf_conectado: false, ultimo_erro: null, iniciada_em: null, created_at: iso(-30), agendada_em: iso(26) },
  { id: "s3", titulo: "Live de lançamento da turma", livekit_room: "x", layout: "solo", cor: "#7c3aed", status: "encerrada", egress_id: null, gravacao_egress_id: null, cf_live_input_uid: "in1", cf_hls_url: "https://customer-demo.cloudflarestream.com/in1/manifest/video.m3u8", cf_conectado: false, ultimo_erro: null, iniciada_em: iso(-72), created_at: iso(-80), cf_ultima_gravacao: "vid1" },
  { id: "s4", titulo: "Webinário: método de 3 passos", livekit_room: "x", layout: "tela-pip", cor: "#10b981", status: "rascunho", egress_id: null, gravacao_egress_id: null, cf_live_input_uid: "in2", cf_hls_url: null, cf_conectado: false, ultimo_erro: null, iniciada_em: null, created_at: iso(-5) },
];
const WEBINARS = [
  { id: "w1", slug: "metodo-3-passos-ab12", titulo: "Webinário: método de 3 passos", descricao: null, capa_url: null, live_room_id: "s4", hls_offset_seg: 0, chat_ativo: true, mostrar_presentes: true, lembretes_ativos: true, lembretes: {}, status: "publicado" as const, created_at: iso(-5) },
];
const DESTINOS: (LiveDestino & { room_id: string })[] = [
  { id: "d1", room_id: "s1", tipo: "youtube", nome: "Canal principal", rtmp_url: "rtmp://a", chave_final: "••a9f2", ativo: true, no_ar: true },
  { id: "d2", room_id: "s1", tipo: "facebook", nome: "Página da empresa", rtmp_url: "rtmps://b", chave_final: "••7c1d", ativo: true, no_ar: true },
  { id: "d3", room_id: "s1", tipo: "instagram", nome: "Perfil profissional", rtmp_url: "rtmps://c", chave_final: "••0b3e", ativo: false, no_ar: false },
  { id: "d4", room_id: "s2", tipo: "custom", nome: "Servidor próprio", rtmp_url: "rtmp://d", chave_final: "••55aa", ativo: true, no_ar: false },
];
const OVERLAYS: LiveOverlay[] = [
  { id: "o1", room_id: "s1", tipo: "banner", conteudo: { texto: "Link da aula gratuita na descrição" }, visivel: true, ordem: 0 },
  { id: "o2", room_id: "s1", tipo: "banner", conteudo: { texto: "Comente QUERO para receber o material" }, visivel: false, ordem: 1 },
  { id: "o3", room_id: "s1", tipo: "lower_third", conteudo: { texto: "Ana Souza", subtitulo: "Gestora de tráfego", tema: "escuro" } as LiveOverlay["conteudo"], visivel: true, ordem: 2 },
  { id: "o4", room_id: "s1", tipo: "lower_third", conteudo: { texto: "Carlos Lima", subtitulo: "Cliente convidado" }, visivel: false, ordem: 3 },
];
const PESSOAS: (ParticipanteCena & { nome: string; papel?: string; mic?: boolean })[] = [
  { identity: "voce", nome: "Ana Souza", attributes: { stage: "1", stage_ordem: "0", papel: "produtor" }, papel: "produtor" },
  { identity: "carlos", nome: "Carlos Lima", attributes: { stage: "1", stage_ordem: "1" } },
  { identity: "julia", nome: "Júlia Martins", attributes: { stage: "0" }, mic: false },
  { identity: "rafa", nome: "Rafael Costa", attributes: { stage: "0" } },
];

function Fundo({ i }: { i: number }) {
  const tons = ["bg-slate-700", "bg-zinc-600", "bg-stone-600", "bg-neutral-600"];
  return <div className={`h-full w-full ${tons[i % tons.length]}`} />;
}

/** "Tela compartilhada" fictícia: um slide com título, para distinguir da câmera no print. */
function TelaFicticia() {
  return (
    <div data-testid="tela-ficticia" className="flex h-full w-full flex-col justify-center gap-[3%] bg-white px-[8%] text-neutral-900">
      <div className="font-bold" style={{ fontSize: "4cqw" }}>Tela compartilhada</div>
      <div className="h-[4%] w-[60%] rounded bg-blue-500" />
      <div className="h-[4%] w-[45%] rounded bg-neutral-300" />
      <div className="h-[4%] w-[52%] rounded bg-neutral-300" />
    </div>
  );
}

// ?yt=1: soma um destino YouTube conectado (aba Programação com título, playlist e miniatura)
const DESTINO_YT_DEMO: LiveDestino & { room_id: string } = {
  id: "d5", room_id: "s1", tipo: "youtube", nome: "YouTube · Canal demo", rtmp_url: "rtmps://a.rtmps.youtube.com/live2", chave_final: "conta conectada",
  ativo: true, no_ar: false, modo: "youtube_api", yt_conta_id: "00000000-0000-4000-8000-000000000000", yt_titulo: "Aula demo", yt_privacidade: "unlisted",
};

function EstudioDemo({ aba, foraDoAr, layoutInicial, compartilhando, comYt }: { aba?: AbaEstudio; foraDoAr?: boolean; layoutInicial?: LayoutLive; compartilhando?: boolean; comYt?: boolean }) {
  const [layout, setLayout] = useState<LayoutLive>(layoutInicial ?? "lado-a-lado");
  const [pessoas, setPessoas] = useState(() => (compartilhando ? PESSOAS.map((p) => (p.identity === "voce" ? { ...p, temTela: true } : p)) : PESSOAS));
  const sala = foraDoAr ? { ...SALAS[0], layout, status: "rascunho" as const, gravacao_egress_id: null, iniciada_em: null } : { ...SALAS[0], layout };
  const blocos = calcularCena(layout, pessoas);
  const ordem = noPalco(pessoas).map((p) => p.identity);
  const fila: PessoaFila[] = pessoas.map((p, i) => ({
    identity: p.identity, nome: p.nome, noPalco: p.attributes?.stage === "1", papel: p.papel, voce: p.identity === "voce", micDesligado: p.mic === false,
    posicao: ordem.includes(p.identity) ? ordem.indexOf(p.identity) + 1 : undefined, destaque: ordem.length > 1 && ordem[0] === p.identity,
    video: i % 2 === 0 ? <Fundo i={i} /> : undefined,
  }));
  const aplicar = (trocas: { identity: string; ordem: number }[]) =>
    setPessoas((ps) => ps.map((p) => {
      const t = trocas.filter((x) => x.identity === p.identity).pop();
      return t ? { ...p, attributes: { ...p.attributes, stage: "1", stage_ordem: String(t.ordem) } } : p;
    }));
  return (
    <EstudioView
      demo
      sala={sala}
      destinos={[...DESTINOS.filter((d) => d.room_id === "s1"), ...(comYt ? [DESTINO_YT_DEMO] : [])]}
      overlays={OVERLAYS}
      convites={[{ id: "c1", nome_convidado: "Carlos Lima", expira_em: iso(20), usado_em: iso(-0.3), revogado: false }]}
      comentarios={[
        { id: "k1", origem: "youtube", autor: "Marcos P.", texto: "Funciona para clínica de estética?", em: iso(-0.1) },
        { id: "k2", origem: "facebook", autor: "Patrícia R.", texto: "Qual orçamento mínimo por dia?", em: iso(-0.05) },
      ]}
      palco={<QuadroCena className="rounded-lg" blocos={blocos} overlays={OVERLAYS} cor={sala.cor ?? undefined} nomeDe={(id) => pessoas.find((p) => p.identity === id)?.nome ?? id} renderVideo={(b) => (b.fonte === "tela" ? <TelaFicticia /> : b.identity === "voce" ? <Fundo i={0} /> : null)} />}
      pessoas={fila}
      onAlternarPalco={(id, subir) => {
        if (!subir) return setPessoas((ps) => ps.map((p) => (p.identity === id ? { ...p, attributes: { ...p.attributes, stage: "0" } } : p)));
        const { ordem: o, trocas } = ordemAoSubir(pessoas, id);
        aplicar([...trocas, { identity: id, ordem: o }]);
      }}
      onDestacar={(id) => aplicar([{ identity: id, ordem: ordemParaDestacar(pessoas, id) }])}
      onInverter={() => aplicar(inverterDoisPrimeiros(pessoas))}
      onRemover={() => toast("demo")}
      midia={{ mic: true, cam: true, tela: !!compartilhando, onMic: () => undefined, onCam: () => undefined, onTela: () => undefined }}
      onConvidar={() => toast.success("Link de convite copiado (demo)")}
      onConfig={() => undefined}
      onSair={() => undefined}
      ocupado={false}
      onIrAoVivo={() => undefined}
      onEncerrar={() => undefined}
      onGravar={() => undefined}
      onLayout={setLayout}
      conectado={false}
      recarregar={() => undefined}
      abaInicial={aba}
    />
  );
}

export default function LivesDemo() {
  const [params] = useSearchParams();
  const tela = params.get("tela") ?? "painel";
  if (tela === "presala") return <PreSala titulo={SALAS[0].titulo} subtitulo="Estúdio" nomeInicial="Ana Souza" onEntrar={() => toast("entrar (demo)")} />;
  if (tela === "estudio") {
    const l = params.get("layout") as LayoutLive | null;
    return (
      <EstudioDemo
        aba={(params.get("aba") as AbaEstudio) ?? undefined}
        foraDoAr={params.get("status") === "fora"}
        layoutInicial={l && LAYOUTS.some((x) => x.key === l) ? l : undefined}
        compartilhando={params.get("compartilhando") === "1"}
        comYt={params.get("yt") === "1"}
      />
    );
  }
  return <PainelDemo />;
}

function PainelDemo() {
  const [criar, setCriar] = useState<TipoCriacao | null>(null);
  return (
    <>
    <LivesPainelView
      itens={itensDoPainel(SALAS, WEBINARS, DESTINOS)}
      salas={SALAS}
      destinos={DESTINOS}
      onCriar={setCriar}
      onEditar={() => undefined}
      onDuplicar={() => undefined}
      onExcluir={() => undefined}
      recarregar={() => undefined}
    />
    <CriarLiveDialog tipo={criar} aberto={!!criar} onFechar={() => setCriar(null)} onCriar={(d) => toast(JSON.stringify(d))} />
    </>
  );
}
