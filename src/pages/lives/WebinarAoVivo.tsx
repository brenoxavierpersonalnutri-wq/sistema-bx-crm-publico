// /lives/webinar/:id/ao-vivo — painel do produtor durante a sessão: iniciar/encerrar a sessão
// (puxa o HLS da sala do estúdio), soltar/encerrar ofertas manuais, moderar o chat
// (fixar/ocultar), falar como host, ver presentes e inscritos.
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, EyeOff, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { HlsPlayer } from "@/components/lives/webinar/HlsPlayer";
import { db, type Webinar, type WebinarSessao } from "@/lib/lives/api";
import { formatarTempo, ofertasVisiveis, tempoDoConteudo, type OfertaWebinar } from "@/lib/lives/webinarTempo";

interface Msg { id: number; autor_nome: string; texto: string; papel: string; oculta: boolean; fixada: boolean; created_at: string }

export default function WebinarAoVivo() {
  const { id = "" } = useParams();
  const [w, setW] = useState<Webinar | null>(null);
  const [sessoes, setSessoes] = useState<WebinarSessao[]>([]);
  const [sid, setSid] = useState<string>("");
  const [ofertas, setOfertas] = useState<OfertaWebinar[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [presentes, setPresentes] = useState(0);
  const [inscritos, setInscritos] = useState(0);
  const [texto, setTexto] = useState("");
  const [agora, setAgora] = useState(Date.now());

  const sessao = sessoes.find((s) => s.id === sid) ?? null;

  const carregar = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      db.from("webinars").select("*").eq("id", id).maybeSingle(),
      db.from("webinar_sessions").select("*").eq("webinar_id", id).order("inicia_em"),
      db.from("webinar_offers").select("*").eq("webinar_id", id).eq("ativo", true).order("ordem"),
    ]);
    setW(a.data);
    setSessoes(b.data ?? []);
    setOfertas(c.data ?? []);
    setSid((atual) => atual || (b.data ?? []).find((s: WebinarSessao) => s.status !== "encerrada")?.id || b.data?.[0]?.id || "");
  }, [id]);

  const carregarSessao = useCallback(async () => {
    if (!sid) return;
    const [m, p, i] = await Promise.all([
      db.from("webinar_chat_messages").select("*").eq("session_id", sid).order("id", { ascending: false }).limit(200),
      db.from("webinar_attendance").select("id", { count: "exact", head: true }).eq("session_id", sid).gte("ultimo_ping", new Date(Date.now() - 75_000).toISOString()),
      db.from("webinar_registrations").select("id", { count: "exact", head: true }).eq("session_id", sid),
    ]);
    setMsgs((m.data ?? []).reverse());
    setPresentes(p.count ?? 0);
    setInscritos(i.count ?? 0);
  }, [sid]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    carregarSessao();
    const t = setInterval(carregarSessao, 10_000);
    const r = setInterval(() => setAgora(Date.now()), 1000);
    if (!sid) return () => { clearInterval(t); clearInterval(r); };
    const canal = supabase.channel(`webinar:${sid}`).on("broadcast", { event: "chat" }, () => carregarSessao()).subscribe();
    return () => { clearInterval(t); clearInterval(r); supabase.removeChannel(canal); };
  }, [sid, carregarSessao]);

  if (!w) return <div className="p-8 text-center text-muted-foreground">Carregando…</div>;

  const iniciar = async () => {
    let hls: string | null = null;
    if (w.live_room_id) {
      const { data } = await db.from("live_rooms").select("cf_hls_url").eq("id", w.live_room_id).maybeSingle();
      hls = data?.cf_hls_url ?? null;
    }
    if (!hls) return toast.error("Ligue uma sala do estúdio com Cloudflare Stream na edição do webinário");
    const { error } = await db.from("webinar_sessions").update({ status: "ao_vivo", iniciada_em: new Date().toISOString(), hls_url: hls }).eq("id", sid);
    if (error) return toast.error(error.message);
    toast.success("Sessão no ar para os inscritos");
    carregar();
  };
  const encerrar = async () => {
    if (!confirm("Encerrar a sessão para o público?")) return;
    await db.from("webinar_sessions").update({ status: "encerrada", encerrada_em: new Date().toISOString() }).eq("id", sid);
    await db.from("webinar_offers").update({ encerrada_em: new Date().toISOString() }).eq("webinar_id", id).eq("liberada_session_id", sid).is("encerrada_em", null);
    carregar();
  };

  const soltar = async (o: OfertaWebinar) => {
    const { error } = await db.from("webinar_offers").update({ liberada_em: new Date().toISOString(), liberada_session_id: sid, encerrada_em: null }).eq("id", o.id);
    if (error) toast.error(error.message); else toast.success(`"${o.titulo}" aparece em ${w.hls_offset_seg}s para o público`);
    carregar();
  };
  const recolher = async (o: OfertaWebinar) => {
    await db.from("webinar_offers").update({ encerrada_em: new Date().toISOString() }).eq("id", o.id);
    carregar();
  };

  const moderar = async (m: Msg, patch: Partial<Msg>) => {
    if (patch.fixada) await db.from("webinar_chat_messages").update({ fixada: false }).eq("session_id", sid).eq("fixada", true);
    const { error } = await db.from("webinar_chat_messages").update(patch).eq("id", m.id);
    if (error) toast.error(error.message);
    carregarSessao();
  };
  const falar = async () => {
    if (!texto.trim()) return;
    const { error } = await db.from("webinar_chat_messages").insert({ session_id: sid, autor_nome: "Host", texto: texto.trim().slice(0, 500), papel: "produtor" });
    if (error) return toast.error(error.message);
    setTexto("");
    carregarSessao();
  };

  const tConteudo = tempoDoConteudo(sessao?.iniciada_em, agora, w.hls_offset_seg);
  const noAr = sessao?.status === "ao_vivo" ? ofertasVisiveis(ofertas, { sessionId: sid, iniciadaEm: sessao.iniciada_em, agoraMs: agora, offsetHlsSeg: w.hls_offset_seg }) : [];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={`/lives/webinar/${id}/editar`} className="text-muted-foreground"><ArrowLeft className="h-5 w-5" /></Link>
        <h1 className="text-xl font-semibold truncate">{w.titulo}</h1>
        <Select value={sid} onValueChange={setSid}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Sessão" /></SelectTrigger>
          <SelectContent>{sessoes.map((s) => <SelectItem key={s.id} value={s.id}>{new Date(s.inicia_em).toLocaleString("pt-BR")} · {s.status}</SelectItem>)}</SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <Badge variant="secondary">{presentes} presentes</Badge>
          <Badge variant="outline">{inscritos} inscritos</Badge>
          {sessao?.status === "ao_vivo" && <span className="tabular-nums text-muted-foreground">público vê {formatarTempo(tConteudo)}</span>}
          {sessao?.status === "agendada" && <Button onClick={iniciar} className="bg-red-600 hover:bg-red-700 text-white">Abrir sessão ao vivo</Button>}
          {sessao?.status === "ao_vivo" && <Button variant="destructive" onClick={encerrar}>Encerrar sessão</Button>}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_420px] gap-4">
        <div className="space-y-4">
          <HlsPlayer src={sessao?.hls_url ?? null} />
          <p className="text-xs text-muted-foreground">Este é o player do público (com o atraso real do HLS). Para medir o atraso, fale um número no estúdio e conte quantos segundos ele leva para aparecer aqui; ajuste em Editar.</p>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Ofertas</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {ofertas.map((o) => {
                const visivel = noAr.some((x) => x.id === o.id);
                const solta = o.liberada_session_id === sid && o.liberada_em && !o.encerrada_em;
                return (
                  <div key={o.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{o.titulo} {visivel && <Badge className="ml-1 bg-green-600 text-white">na tela</Badge>}</div>
                      <div className="text-[11px] text-muted-foreground">{o.modo === "tempo" ? `por tempo: ${formatarTempo(o.aparece_em_seg ?? 0)}` : "manual"}</div>
                    </div>
                    {o.modo === "manual" && sessao?.status === "ao_vivo" && (
                      solta ? <Button size="sm" variant="outline" onClick={() => recolher(o)}>Recolher</Button> : <Button size="sm" onClick={() => soltar(o)}>Soltar oferta</Button>
                    )}
                  </div>
                );
              })}
              {ofertas.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma oferta ativa. Cadastre em Editar.</p>}
            </CardContent>
          </Card>
        </div>

        <Card className="flex flex-col max-h-[80vh]">
          <CardHeader className="pb-2"><CardTitle className="text-base">Chat</CardTitle></CardHeader>
          <CardContent className="flex-1 overflow-y-auto space-y-1.5">
            {msgs.map((m) => (
              <div key={m.id} className={`group flex items-start gap-2 text-sm rounded px-2 py-1 ${m.oculta ? "opacity-40 line-through" : ""} ${m.fixada ? "bg-yellow-500/10" : ""}`}>
                <div className="flex-1 min-w-0"><b className={m.papel === "produtor" ? "text-green-600" : ""}>{m.autor_nome}:</b> {m.texto}</div>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                  <Button size="icon" variant="ghost" className="h-6 w-6" title={m.fixada ? "Desafixar" : "Fixar"} onClick={() => moderar(m, { fixada: !m.fixada })}>{m.fixada ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}</Button>
                  {!m.oculta && <Button size="icon" variant="ghost" className="h-6 w-6" title="Ocultar" onClick={() => moderar(m, { oculta: true, fixada: false })}><EyeOff className="h-3.5 w-3.5" /></Button>}
                </div>
              </div>
            ))}
          </CardContent>
          <div className="p-3 border-t flex gap-2">
            <Input placeholder="Falar como Host…" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && falar()} />
            <Button onClick={falar}>Enviar</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
