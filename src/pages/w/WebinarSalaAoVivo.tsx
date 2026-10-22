// /w/:slug/sala?r=<token> — sala pública do webinário AO VIVO (HLS do Cloudflare Stream).
// Generaliza a WebinarRoom do /webinar (que segue gravada e intacta) para sessão real:
// presença por ping (30 s), chat com limite + broadcast, ofertas manuais e por tempo, roteiro.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { WebinarLiveIndicator } from "@/components/webinar/WebinarLiveIndicator";
import { HlsPlayer } from "@/components/lives/webinar/HlsPlayer";
import { ChatAoVivo, type MsgChat } from "@/components/lives/webinar/ChatAoVivo";
import { OfertaAoVivo } from "@/components/lives/webinar/OfertaAoVivo";
import { webinarJoin, webinarPing } from "@/lib/lives/api";
import { formatarTempo, ofertasVisiveis, roteiroVisivel, tempoDoConteudo, type MensagemRoteiro, type OfertaWebinar } from "@/lib/lives/webinarTempo";

const PING_MS = 30_000;

export default function WebinarSalaAoVivo() {
  const [params] = useSearchParams();
  const token = params.get("r") ?? "";
  const [base, setBase] = useState<any>(null);
  const [sessao, setSessao] = useState<any>(null);
  const [ofertas, setOfertas] = useState<OfertaWebinar[]>([]);
  const [roteiro, setRoteiro] = useState<MensagemRoteiro[]>([]);
  const [presentes, setPresentes] = useState<number | undefined>(undefined);
  const [fixada, setFixada] = useState<MsgChat | null>(null);
  const [reais, setReais] = useState<Map<string, MsgChat>>(new Map());
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(Date.now());
  const [canalOk, setCanalOk] = useState(false);
  const ultimoId = useRef(0);
  const clicou = useRef(false);

  const aplicarEstado = useCallback((r: any) => {
    if (r.sessao) setSessao(r.sessao);
    if (r.ofertas) setOfertas(r.ofertas);
    if (r.presentes !== undefined) setPresentes(r.presentes);
    if ("fixada" in r) setFixada(r.fixada ? { ...r.fixada, id: `m${r.fixada.id}`, ts: 0 } : null);
  }, []);

  const ping = useCallback(async () => {
    try {
      aplicarEstado(await webinarPing(token, clicou.current ? { clicou_oferta: true } : {}));
    } catch { /* tenta de novo no próximo ciclo */ }
  }, [token, aplicarEstado]);

  // entrada
  useEffect(() => {
    if (!token) { setErro("Link incompleto. Use o link que você recebeu na inscrição."); return; }
    webinarJoin(token)
      .then((r) => {
        setBase(r);
        setRoteiro(r.roteiro ?? []);
        aplicarEstado(r);
        document.title = `${r.webinar.titulo} • Ao vivo`;
      })
      .catch((e) => setErro(e.message));
  }, [token, aplicarEstado]);

  // relógio + ping
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    const p = setInterval(ping, PING_MS);
    return () => { clearInterval(t); clearInterval(p); };
  }, [ping]);

  const juntar = useCallback((lista: any[]) => {
    setReais((m) => {
      const n = new Map(m);
      for (const x of lista) {
        n.set(`m${x.id}`, { id: `m${x.id}`, autor_nome: x.autor_nome, texto: x.texto, papel: x.papel, ts: Date.parse(x.created_at) });
        ultimoId.current = Math.max(ultimoId.current, Number(x.id));
      }
      return n;
    });
  }, []);

  const buscarChat = useCallback(async () => {
    const { data } = await (supabase as any).rpc("webinar_chat_recentes", { p_token: token, p_depois_de: ultimoId.current });
    if (data?.length) juntar(data);
  }, [token, juntar]);

  // broadcast + polling de segurança
  const sessaoId = sessao?.id;
  useEffect(() => {
    if (!sessaoId) return;
    buscarChat();
    const canal = supabase
      .channel(`webinar:${sessaoId}`)
      .on("broadcast", { event: "chat" }, ({ payload }) => juntar([payload]))
      .on("broadcast", { event: "moderacao" }, ({ payload }) => {
        if (payload.oculta) setReais((m) => { const n = new Map(m); n.delete(`m${payload.id}`); return n; });
        ping();
      })
      .on("broadcast", { event: "oferta" }, () => ping())
      .subscribe((st) => setCanalOk(st === "SUBSCRIBED"));
    return () => { supabase.removeChannel(canal); };
  }, [sessaoId, buscarChat, juntar, ping]);

  useEffect(() => {
    if (!sessaoId) return;
    const t = setInterval(buscarChat, canalOk ? 30_000 : 5_000);
    return () => clearInterval(t);
  }, [sessaoId, canalOk, buscarChat]);

  const offset = base?.webinar?.hls_offset_seg ?? 0;
  const tConteudo = tempoDoConteudo(sessao?.iniciada_em, agora, offset);
  const visiveis = sessao?.status === "ao_vivo" ? ofertasVisiveis(ofertas, { sessionId: sessao.id, iniciadaEm: sessao.iniciada_em, agoraMs: agora, offsetHlsSeg: offset }) : [];

  const mensagens = useMemo(() => {
    const inicio = sessao?.iniciada_em ? Date.parse(sessao.iniciada_em) : 0;
    const prog: MsgChat[] = sessao?.status === "ao_vivo"
      ? roteiroVisivel(roteiro, tConteudo).map((m) => ({ id: `r${m.id}`, autor_nome: m.autor_nome, texto: m.texto, papel: "participante", ts: inicio + (m.aos_seg + offset) * 1000 }))
      : [];
    return [...prog, ...reais.values()].sort((a, b) => a.ts - b.ts).slice(-200);
  }, [roteiro, reais, tConteudo, sessao, offset]);

  const enviar = async (texto: string) => {
    const { data, error } = await (supabase as any).rpc("webinar_chat_enviar", { p_token: token, p_texto: texto });
    if (error) return { ok: false };
    if (data?.ok) buscarChat();
    return data ?? { ok: false };
  };

  if (erro) return <div className="min-h-screen bg-[#0a0a0a] text-white/70 flex items-center justify-center p-6 text-center">{erro}</div>;
  if (!base || !sessao) return <div className="min-h-screen bg-[#0a0a0a]" />;

  const faltam = Math.max(0, Math.floor((Date.parse(sessao.inicia_em) - agora) / 1000));
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6 space-y-4">
        {sessao.status === "ao_vivo" && <WebinarLiveIndicator presentes={presentes ?? 0} ocultarPresentes={!base.webinar.mostrar_presentes} />}
        <h1 className="text-xl sm:text-2xl font-bold">{base.webinar.titulo}</h1>

        {sessao.status === "agendada" && (
          <div className="bg-[#1a1a1a] rounded-lg border border-[#262626] p-8 text-center space-y-3">
            <p className="text-white/70">Oi, {base.nome}! A aula começa em</p>
            <p className="text-4xl font-bold tabular-nums text-[#00ff00]">{faltam > 0 ? formatarTempo(faltam) : "instantes"}</p>
            <p className="text-sm text-white/50">{new Date(sessao.inicia_em).toLocaleString("pt-BR")}. Deixe esta página aberta: ela entra sozinha quando começar.</p>
          </div>
        )}

        {sessao.status === "encerrada" && (
          <div className="bg-[#1a1a1a] rounded-lg border border-[#262626] p-10 text-center">
            <h2 className="text-2xl font-bold mb-2">A transmissão foi encerrada</h2>
            <p className="text-white/60">Obrigado por participar!</p>
          </div>
        )}

        {sessao.status === "ao_vivo" && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 lg:gap-6">
            <div className="space-y-4">
              <HlsPlayer src={sessao.hls_url} />
              {visiveis.map((o) => (
                <OfertaAoVivo key={o.id} oferta={o} tempoConteudo={tConteudo} utm={base.utm} onClique={() => { clicou.current = true; ping(); }} />
              ))}
            </div>
            <div className="lg:h-[calc(100vh-140px)] lg:sticky lg:top-4">
              <ChatAoVivo mensagens={mensagens} fixada={fixada} podeEscrever={base.webinar.chat_ativo} enviar={enviar} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
