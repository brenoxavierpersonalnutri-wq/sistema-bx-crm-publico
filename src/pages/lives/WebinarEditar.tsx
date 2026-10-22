// /lives/webinar/:id/editar — dados do webinário, sessões, ofertas, roteiro do chat e lembretes.
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { db, type LiveRoom, type Webinar, type WebinarSessao } from "@/lib/lives/api";
import { formatarTempo, lerTempo, type MensagemRoteiro, type OfertaWebinar } from "@/lib/lives/webinarTempo";

const TIPOS_LEMBRETE = [
  { k: "confirmacao", r: "Confirmação (na inscrição)" },
  { k: "24h", r: "24 horas antes" },
  { k: "1h", r: "1 hora antes" },
  { k: "15min", r: "15 minutos antes" },
  { k: "ao_vivo", r: "Começou" },
];

export default function WebinarEditar() {
  const { id = "" } = useParams();
  const [w, setW] = useState<Webinar | null>(null);
  const [sessoes, setSessoes] = useState<WebinarSessao[]>([]);
  const [ofertas, setOfertas] = useState<OfertaWebinar[]>([]);
  const [roteiro, setRoteiro] = useState<MensagemRoteiro[]>([]);
  const [salas, setSalas] = useState<LiveRoom[]>([]);
  const [links, setLinks] = useState<{ id: string; nome_produto: string; slug: string }[]>([]);
  const [novaSessao, setNovaSessao] = useState("");
  const [of, setOf] = useState({ titulo: "", preco_texto: "", cta_texto: "Quero garantir minha vaga", destino: "checkout", checkout_link_id: "", url: "", modo: "manual", aparece: "", dura: "" });
  const [msg, setMsg] = useState({ aos: "", autor: "", texto: "" });

  const carregar = useCallback(async () => {
    const [a, b, c, d, e, f] = await Promise.all([
      db.from("webinars").select("*").eq("id", id).maybeSingle(),
      db.from("webinar_sessions").select("*").eq("webinar_id", id).order("inicia_em"),
      db.from("webinar_offers").select("*").eq("webinar_id", id).order("ordem"),
      db.from("webinar_chat_script").select("*").eq("webinar_id", id).order("aos_seg"),
      db.from("live_rooms").select("id, titulo, cf_hls_url").order("created_at", { ascending: false }),
      db.from("gateway_links").select("id, nome_produto, slug").eq("ativo", true).order("created_at", { ascending: false }),
    ]);
    setW(a.data);
    setSessoes(b.data ?? []);
    setOfertas(c.data ?? []);
    setRoteiro(d.data ?? []);
    setSalas(e.data ?? []);
    setLinks(f.data ?? []);
  }, [id]);
  useEffect(() => { carregar(); }, [carregar]);

  if (!w) return <div className="p-8 text-center text-muted-foreground">Carregando…</div>;
  const set = (patch: Partial<Webinar>) => setW({ ...w, ...patch });

  const salvar = async () => {
    const { id: _id, ...resto } = w as any;
    const campos = ["slug", "titulo", "descricao", "capa_url", "live_room_id", "hls_offset_seg", "chat_ativo", "mostrar_presentes", "lembretes_ativos", "lembretes", "status"];
    const patch = Object.fromEntries(campos.map((k) => [k, resto[k] === "" ? null : resto[k]]));
    const { error } = await db.from("webinars").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Salvo");
  };

  const addSessao = async () => {
    if (!novaSessao) return;
    const { error } = await db.from("webinar_sessions").insert({ webinar_id: id, inicia_em: new Date(novaSessao).toISOString() });
    if (error) return toast.error(error.message);
    setNovaSessao("");
    carregar();
  };

  const addOferta = async () => {
    const aparece = of.modo === "tempo" ? lerTempo(of.aparece) : null;
    if (of.modo === "tempo" && aparece == null) return toast.error("Momento da oferta inválido (ex.: 45:00)");
    const dura = of.dura ? Math.round(Number(of.dura) * 60) : null;
    const linha = {
      webinar_id: id,
      titulo: of.titulo.trim(),
      preco_texto: of.preco_texto.trim() || null,
      cta_texto: of.cta_texto.trim() || "Quero garantir minha vaga",
      checkout_link_id: of.destino === "checkout" ? of.checkout_link_id || null : null,
      url: of.destino === "url" ? of.url.trim() || null : null,
      modo: of.modo,
      aparece_em_seg: aparece,
      dura_seg: dura,
      ordem: ofertas.length,
    };
    if (!linha.titulo) return toast.error("Título da oferta");
    if (!linha.checkout_link_id && !linha.url) return toast.error("Escolha um checkout ou informe a URL https");
    const { error } = await db.from("webinar_offers").insert(linha);
    if (error) return toast.error(error.message);
    setOf({ ...of, titulo: "", preco_texto: "", aparece: "", dura: "" });
    carregar();
  };

  const addMsg = async () => {
    const aos = lerTempo(msg.aos);
    if (aos == null || !msg.autor.trim() || !msg.texto.trim()) return toast.error("Preencha tempo (mm:ss), autor e texto");
    const { error } = await db.from("webinar_chat_script").insert({ webinar_id: id, aos_seg: aos, autor_nome: msg.autor.trim(), texto: msg.texto.trim() });
    if (error) return toast.error(error.message);
    setMsg({ aos: "", autor: msg.autor, texto: "" });
    carregar();
  };

  const apagar = async (tabela: string, linhaId: string) => {
    const { error } = await db.from(tabela).delete().eq("id", linhaId);
    if (error) toast.error(error.message);
    carregar();
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/lives" className="text-muted-foreground"><ArrowLeft className="h-5 w-5" /></Link>
        <h1 className="text-xl font-semibold flex-1 truncate">{w.titulo}</h1>
        <Button variant="ghost" size="sm" asChild><a href={`/w/${w.slug}`} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-1" />Página de inscrição</a></Button>
        <Button variant="outline" size="sm" asChild><Link to={`/lives/webinar/${id}/ao-vivo`}>Painel ao vivo</Link></Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Dados</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1"><Label>Título</Label><Input value={w.titulo} onChange={(e) => set({ titulo: e.target.value })} /></div>
          <div className="space-y-1"><Label>Endereço (/w/…)</Label><Input value={w.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Descrição</Label><Textarea value={w.descricao ?? ""} onChange={(e) => set({ descricao: e.target.value })} /></div>
          <div className="space-y-1"><Label>Imagem de capa (https)</Label><Input value={w.capa_url ?? ""} onChange={(e) => set({ capa_url: e.target.value })} /></div>
          <div className="space-y-1">
            <Label>Situação</Label>
            <Select value={w.status} onValueChange={(v) => set({ status: v as Webinar["status"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rascunho">Rascunho</SelectItem>
                <SelectItem value="publicado">Publicado (inscrição aberta)</SelectItem>
                <SelectItem value="arquivado">Arquivado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Sala do estúdio (fonte do vídeo)</Label>
            <Select value={w.live_room_id ?? "nenhuma"} onValueChange={(v) => set({ live_room_id: v === "nenhuma" ? null : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhuma">Nenhuma</SelectItem>
                {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.titulo}{s.cf_hls_url ? "" : " (sem Cloudflare Stream)"}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Atraso do vídeo para o público (s)</Label>
            <Input type="number" min={0} max={600} value={w.hls_offset_seg} onChange={(e) => set({ hls_offset_seg: Number(e.target.value) || 0 })} />
            <p className="text-[11px] text-muted-foreground">Ofertas e roteiro esperam esse atraso para casar com o vídeo. Meça no painel ao vivo.</p>
          </div>
          <div className="flex items-center gap-6 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm"><Switch checked={w.chat_ativo} onCheckedChange={(v) => set({ chat_ativo: v })} />Chat aberto</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={w.mostrar_presentes} onCheckedChange={(v) => set({ mostrar_presentes: v })} />Mostrar presentes</label>
          </div>
          <div className="sm:col-span-2"><Button onClick={salvar}>Salvar dados</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Sessões</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {sessoes.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-sm">
              <span>{new Date(s.inicia_em).toLocaleString("pt-BR")} · {s.status}</span>
              {s.status === "agendada" && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => apagar("webinar_sessions", s.id)}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          ))}
          <div className="flex gap-2"><Input type="datetime-local" value={novaSessao} onChange={(e) => setNovaSessao(e.target.value)} /><Button onClick={addSessao}>Adicionar</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Ofertas</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {ofertas.map((o) => (
            <div key={o.id} className="flex items-center justify-between text-sm gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{o.titulo} {o.preco_texto ? `· ${o.preco_texto}` : ""}</div>
                <div className="text-[11px] text-muted-foreground">
                  {o.modo === "tempo" ? `aparece em ${formatarTempo(o.aparece_em_seg ?? 0)}${o.dura_seg ? ` por ${Math.round(o.dura_seg / 60)} min` : ""}` : "manual (solta no painel ao vivo)"}
                  {" · "}{o.checkout_link_id ? "checkout" : o.url}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={o.ativo !== false} onCheckedChange={async (v) => { await db.from("webinar_offers").update({ ativo: v }).eq("id", o.id); carregar(); }} />
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => apagar("webinar_offers", o.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
          <div className="grid sm:grid-cols-2 gap-2 border-t pt-3">
            <Input placeholder="Título (ex.: Mentoria 50% OFF)" value={of.titulo} onChange={(e) => setOf({ ...of, titulo: e.target.value })} />
            <Input placeholder="Preço (ex.: 12x R$ 97)" value={of.preco_texto} onChange={(e) => setOf({ ...of, preco_texto: e.target.value })} />
            <Input placeholder="Texto do botão" value={of.cta_texto} onChange={(e) => setOf({ ...of, cta_texto: e.target.value })} />
            <Select value={of.destino} onValueChange={(v) => setOf({ ...of, destino: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="checkout">Checkout do gateway</SelectItem><SelectItem value="url">URL externa</SelectItem></SelectContent>
            </Select>
            {of.destino === "checkout" ? (
              <Select value={of.checkout_link_id} onValueChange={(v) => setOf({ ...of, checkout_link_id: v })}>
                <SelectTrigger><SelectValue placeholder="Escolha o link de checkout" /></SelectTrigger>
                <SelectContent>{links.map((l) => <SelectItem key={l.id} value={l.id}>{l.nome_produto}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Input placeholder="https://..." value={of.url} onChange={(e) => setOf({ ...of, url: e.target.value })} />
            )}
            <Select value={of.modo} onValueChange={(v) => setOf({ ...of, modo: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="manual">Manual (eu solto)</SelectItem><SelectItem value="tempo">Por tempo</SelectItem></SelectContent>
            </Select>
            {of.modo === "tempo" && (
              <>
                <Input placeholder="Aparece em (mm:ss, ex.: 45:00)" value={of.aparece} onChange={(e) => setOf({ ...of, aparece: e.target.value })} />
                <Input placeholder="Fica por (minutos, vazio = até o fim)" value={of.dura} onChange={(e) => setOf({ ...of, dura: e.target.value })} />
              </>
            )}
            <div className="sm:col-span-2"><Button onClick={addOferta}>Adicionar oferta</Button></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Roteiro do chat (mensagens programadas)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {roteiro.map((m) => (
            <div key={m.id} className="flex items-center justify-between text-sm">
              <span className="truncate"><span className="text-muted-foreground tabular-nums">{formatarTempo(m.aos_seg)}</span> · <b>{m.autor_nome}</b>: {m.texto}</span>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => apagar("webinar_chat_script", m.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <div className="grid grid-cols-[90px_140px_1fr_auto] gap-2">
            <Input placeholder="mm:ss" value={msg.aos} onChange={(e) => setMsg({ ...msg, aos: e.target.value })} />
            <Input placeholder="Autor" value={msg.autor} onChange={(e) => setMsg({ ...msg, autor: e.target.value })} />
            <Input placeholder="Mensagem" value={msg.texto} onChange={(e) => setMsg({ ...msg, texto: e.target.value })} />
            <Button onClick={addMsg}>Adicionar</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Lembretes no WhatsApp</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm"><Switch checked={w.lembretes_ativos} onCheckedChange={(v) => set({ lembretes_ativos: v })} />Enviar lembretes (número não oficial do CRM)</label>
          <p className="text-[11px] text-muted-foreground">Variáveis: {"{nome} {titulo} {link} {data} {hora}"}. Vazio usa o texto padrão.</p>
          {TIPOS_LEMBRETE.map((t) => (
            <div key={t.k} className="space-y-1">
              <Label>{t.r}</Label>
              <Textarea rows={2} value={w.lembretes?.[t.k] ?? ""} onChange={(e) => set({ lembretes: { ...(w.lembretes ?? {}), [t.k]: e.target.value } })} />
            </div>
          ))}
          <Button onClick={salvar}>Salvar lembretes</Button>
        </CardContent>
      </Card>
    </div>
  );
}
