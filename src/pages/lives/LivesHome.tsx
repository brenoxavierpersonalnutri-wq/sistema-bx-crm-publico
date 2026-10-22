// /lives — painel de lives, gravações e webinários (criar, listar por aba, destinos).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LivesPainelView } from "@/components/lives/painel/LivesPainelView";
import { CriarLiveDialog, type DadosCriacao } from "@/components/lives/painel/CriarLiveDialog";
import type { DestinoComSala } from "@/components/lives/painel/DestinosLateral";
import { db, lerDestinos, type Webinar } from "@/lib/lives/api";
import { acaoLive } from "@/lib/lives/acoes";
import { itensDoPainel, type ItemPainel, type LiveRoomExtra, type TipoCriacao } from "@/lib/lives/painel";
import { avisoComecaAgora } from "@/lib/lives/aula";
import { garantirYoutube } from "@/lib/lives/youtube";

const slugDe = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "aula";
const slugNovo = (titulo: string) => `${slugDe(titulo)}-${Math.random().toString(36).slice(2, 6)}`;

export default function LivesHome() {
  const nav = useNavigate();
  const [salas, setSalas] = useState<LiveRoomExtra[]>([]);
  const [webinars, setWebinars] = useState<(Webinar & { created_at?: string })[]>([]);
  const [destinos, setDestinos] = useState<DestinoComSala[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [criar, setCriar] = useState<TipoCriacao | null>(null);
  const [criando, setCriando] = useState(false);
  const [editar, setEditar] = useState<{ item: ItemPainel; titulo: string } | null>(null);
  const [excluir, setExcluir] = useState<ItemPainel | null>(null);

  const carregar = useCallback(async () => {
    const [s, w, d] = await Promise.all([
      db.from("live_rooms").select("*").order("created_at", { ascending: false }),
      db.from("webinars").select("*").order("created_at", { ascending: false }),
      lerDestinos((q) => q.order("created_at")),
    ]);
    if (s.error) toast.error(s.error.message);
    setSalas(s.data ?? []);
    setWebinars(w.data ?? []);
    setDestinos(d.data ?? []);
    setCarregando(false);
  }, []);
  useEffect(() => {
    carregar();
    // a agenda (tick de 1 min) marca "começa agora" e liga as lives automáticas: o painel acompanha sem recarregar
    const t = setInterval(carregar, 60_000);
    return () => clearInterval(t);
  }, [carregar]);
  const comecandoAgora = salas.filter((s) => avisoComecaAgora(s, Date.now()));

  const itens = useMemo(() => itensDoPainel(salas, webinars, destinos), [salas, webinars, destinos]);

  const onCriar = async (d: DadosCriacao) => {
    setCriando(true);
    try {
      const quandoIso = d.quando ? new Date(d.quando).toISOString() : null;
      const { data: sala, error } = await db.from("live_rooms").insert({ titulo: d.titulo }).select("id").single();
      if (error) throw error;
      // descrição e agendamento da live: colunas opcionais (dependem da migração que as cria)
      if (d.tipo !== "webinario" && (d.descricao || quandoIso)) {
        const { error: e2 } = await db.from("live_rooms").update({ descricao: d.descricao || null, agendada_em: quandoIso }).eq("id", sala.id);
        if (e2) toast.warning("A live foi criada, mas descrição e data ainda não são salvas: falta a migração que cria live_rooms.descricao e live_rooms.agendada_em.");
      }
      let webinarId: string | null = null;
      if (d.tipo === "webinario" || d.destinos.includes("cloudflare")) {
        const { data: w, error: ew } = await db
          .from("webinars")
          .insert({ titulo: d.titulo, slug: slugNovo(d.titulo), descricao: d.descricao || null, live_room_id: sala.id })
          .select("id")
          .single();
        if (ew) throw ew;
        webinarId = w.id;
        if (quandoIso) await db.from("webinar_sessions").insert({ webinar_id: w.id, inicia_em: quandoIso });
        await acaoLive("criar-cf-input", { room_id: sala.id });
      }
      // live: o canal do YouTube conectado já entra como destino (ativo, Não listado), sem clique (depois do
      // webinário: sala de webinário não vai pro YouTube sozinha e o servidor confere isso)
      if (d.tipo === "live") await garantirYoutube(sala.id, { contaId: d.ytContaId });
      setCriar(null);
      await carregar();
      if (quandoIso && new Date(quandoIso) > new Date()) {
        toast.success(webinarId ? "Webinário agendado. Edite a página e as ofertas pelo menu ..." : "Live agendada em Próximas. No estúdio, aba Programação: link do YouTube e vídeo da aula.");
        return;
      }
      const qs = new URLSearchParams();
      if (d.tipo === "gravacao") qs.set("modo", "gravacao");
      const rtmp = d.destinos.filter((t) => t !== "cloudflare");
      if (rtmp.length) qs.set("destinos", rtmp.join(","));
      nav(`/lives/estudio/${sala.id}${qs.toString() ? `?${qs}` : ""}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCriando(false);
    }
  };

  const duplicar = async (i: ItemPainel) => {
    if (i.tipo === "sala" && i.sala) {
      const { data, error } = await db.from("live_rooms").insert({ titulo: `Cópia de ${i.titulo}`.slice(0, 160), layout: i.sala.layout, cor: i.sala.cor }).select("id").single();
      if (error) return toast.error(error.message);
      const { data: ovs } = await db.from("live_overlays").select("tipo, conteudo, ordem").eq("room_id", i.id);
      if (ovs?.length) await db.from("live_overlays").insert(ovs.map((o: Record<string, unknown>) => ({ ...o, room_id: data.id, visivel: false })));
      await garantirYoutube(data.id);
      toast.success("Live duplicada (chaves coladas não são copiadas; o canal do YouTube conectado entra sozinho)");
    } else if (i.webinar) {
      const w = i.webinar;
      const { error } = await db.from("webinars").insert({
        titulo: `Cópia de ${w.titulo}`.slice(0, 160), slug: slugNovo(w.titulo), descricao: w.descricao, capa_url: w.capa_url,
        chat_ativo: w.chat_ativo, mostrar_presentes: w.mostrar_presentes, lembretes_ativos: w.lembretes_ativos, lembretes: w.lembretes,
      });
      if (error) return toast.error(error.message);
      toast.success("Webinário duplicado como rascunho");
    }
    carregar();
  };

  const confirmarExcluir = async () => {
    if (!excluir) return;
    if (excluir.aoVivo) {
      setExcluir(null);
      return toast.error("Encerre a transmissão antes de excluir");
    }
    const tabela = excluir.tipo === "sala" ? "live_rooms" : "webinars";
    const { error } = await db.from(tabela).delete().eq("id", excluir.id);
    setExcluir(null);
    if (error) return toast.error(error.message);
    toast.success("Excluído");
    carregar();
  };

  const salvarEdicao = async () => {
    if (!editar) return;
    const { error } = await db.from("live_rooms").update({ titulo: editar.titulo.trim() || editar.item.titulo }).eq("id", editar.item.id);
    if (error) return toast.error(error.message);
    setEditar(null);
    carregar();
  };

  return (
    <>
      <LivesPainelView
        itens={itens}
        salas={salas}
        destinos={destinos}
        carregando={carregando}
        onCriar={setCriar}
        onEditar={(item) => setEditar({ item, titulo: item.titulo })}
        onDuplicar={duplicar}
        onExcluir={setExcluir}
        recarregar={carregar}
      />
      {comecandoAgora.length > 0 && (
        <div role="status" className="fixed bottom-4 right-4 z-50 w-[min(92vw,380px)] space-y-2">
          {comecandoAgora.map((s) => (
            <div key={s.id} className="rounded-lg border bg-background p-3 shadow-lg">
              <p className="text-sm font-medium">Sua live programada começa agora: entre no estúdio</p>
              <p className="truncate text-xs text-muted-foreground">{s.titulo}</p>
              <Button size="sm" className="mt-2" onClick={() => nav(`/lives/estudio/${s.id}`)}>Entrar no estúdio</Button>
            </div>
          ))}
        </div>
      )}
      <CriarLiveDialog tipo={criar} aberto={!!criar} onFechar={() => setCriar(null)} onCriar={onCriar} criando={criando} />
      <Dialog open={!!editar} onOpenChange={(v) => !v && setEditar(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar live</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="editar-titulo">Título</Label>
            <Input id="editar-titulo" maxLength={160} value={editar?.titulo ?? ""} onChange={(e) => editar && setEditar({ ...editar, titulo: e.target.value })} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditar(null)}>Cancelar</Button>
            <Button onClick={salvarEdicao}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!excluir} onOpenChange={(v) => !v && setExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{excluir?.titulo}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluir?.tipo === "sala" ? "Apaga a sala, os destinos, banners, faixas e convites dela." : "Apaga o webinário, as sessões, inscrições e ofertas."} Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmarExcluir}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
