// Editor de roteiros (o time cria e edita): filtro por etapa ou "Todas", busca, roteiros com
// passos ordenados (texto, áudio, imagem, documento) e upload de mídia para o Storage.
// Roteiro desativado = rascunho: não aparece no painel "Roteiros" do chat.
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowDown, ArrowUp, Copy, Loader2, Plus, Search, Trash2, Upload } from "lucide-react";
import "@/components/crm/roteiros-dark.css";
import { GravadorAudioPasso } from "@/components/crm/GravadorAudioPasso";
import { filtrarRoteiros, passoParaPreencher } from "@/lib/crm/roteirosChat";
import { useEtapas } from "@/hooks/useEtapas";
import { ItensEtapa } from "@/components/crm/etapas/ItensEtapa";
import {
  db,
  FUNIS,
  formatarAtraso,
  subirMidiaRoteiro,
  TIPOS_PASSO,
  type PassoRoteiro,
  type Roteiro,
  type TipoPasso,
} from "@/lib/crmRoteiros";

export function RoteirosEditorModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const { colunas: KANBAN_COLUMNS, nomeEtapa } = useEtapas(); // etapas de crm_etapas
  const [stage, setStage] = useState<string>("todas");
  const [busca, setBusca] = useState("");
  const [todosPassos, setTodosPassos] = useState<PassoRoteiro[]>([]);
  const [roteiros, setRoteiros] = useState<Roteiro[]>([]);
  const [roteiroId, setRoteiroId] = useState("");
  const [passos, setPassos] = useState<PassoRoteiro[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [subindo, setSubindo] = useState<string | null>(null);

  const erro = (e: unknown) =>
    toast({ title: "Erro", description: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e), variant: "destructive" });

  const carregarRoteiros = async (s = stage, manter?: string) => {
    setCarregando(true);
    let q = db.from("crm_roteiros").select("*");
    if (s !== "todas") q = q.eq("stage", s);
    const { data, error } = await q.order("stage").order("ordem");
    if (error) erro(error);
    const lista = (data ?? []) as Roteiro[];
    if (lista.length) {
      const { data: ps } = await db.from("crm_roteiro_passos").select("id, roteiro_id, ordem, tipo, rotulo, conteudo, media_url, file_name")
        .in("roteiro_id", lista.map((r) => r.id));
      setTodosPassos((ps ?? []) as PassoRoteiro[]);
    } else setTodosPassos([]);
    setRoteiros(lista);
    setRoteiroId(manter && lista.some((r) => r.id === manter) ? manter : lista[0]?.id ?? "");
    setCarregando(false);
  };

  const carregarPassos = async (id: string) => {
    if (!id) return setPassos([]);
    const { data, error } = await db.from("crm_roteiro_passos").select("*").eq("roteiro_id", id).order("ordem");
    if (error) erro(error);
    const lista = (data ?? []) as PassoRoteiro[];
    setPassos(lista);
    setTodosPassos((ps) => [...ps.filter((p) => p.roteiro_id !== id), ...lista]);
  };

  useEffect(() => {
    if (isOpen) carregarRoteiros(stage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, stage]);

  useEffect(() => {
    carregarPassos(roteiroId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roteiroId]);

  const roteiro = useMemo(() => roteiros.find((r) => r.id === roteiroId), [roteiros, roteiroId]);
  const listados = useMemo(() => filtrarRoteiros(roteiros, todosPassos, busca), [roteiros, todosPassos, busca]);
  const paraPreencher = (id: string) => {
    const ps = todosPassos.filter((p) => p.roteiro_id === id);
    return ps.length === 0 || ps.some((p) => passoParaPreencher(p));
  };

  const novoRoteiro = async () => {
    const { data, error } = await db
      .from("crm_roteiros")
      .insert({ stage: stage === "todas" ? KANBAN_COLUMNS[0].id : stage, funil: "geral", nome: "Novo roteiro", ordem: roteiros.length + 1, ativo: false })
      .select("id")
      .single();
    if (error) return erro(error);
    await carregarRoteiros(stage, data.id);
  };

  const salvarRoteiro = async (patch: Partial<Roteiro>) => {
    if (!roteiro) return;
    setRoteiros((rs) => rs.map((r) => (r.id === roteiro.id ? { ...r, ...patch } : r)));
    const { error } = await db.from("crm_roteiros").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", roteiro.id);
    if (error) erro(error);
  };

  const duplicarRoteiro = async () => {
    if (!roteiro) return;
    const { data, error } = await db.from("crm_roteiros")
      .insert({ stage: roteiro.stage, funil: roteiro.funil, nome: `${roteiro.nome} (cópia)`, descricao: roteiro.descricao, ordem: roteiro.ordem + 1, ativo: false })
      .select("id").single();
    if (error) return erro(error);
    if (passos.length) {
      const { error: e2 } = await db.from("crm_roteiro_passos").insert(passos.map((p) => ({
        roteiro_id: data.id, ordem: p.ordem, tipo: p.tipo, rotulo: p.rotulo, conteudo: p.conteudo, media_url: p.media_url,
        media_path: p.media_path, file_name: p.file_name, atraso_segundos: p.atraso_segundos, aguarda_resposta: p.aguarda_resposta,
      })));
      if (e2) erro(e2);
    }
    toast({ title: "Cópia criada como rascunho" });
    await carregarRoteiros(stage, data.id);
  };

  const apagarRoteiro = async () => {
    if (!roteiro || !window.confirm(`Apagar o roteiro "${roteiro.nome}" e todos os passos?`)) return;
    const { error } = await db.from("crm_roteiros").delete().eq("id", roteiro.id);
    if (error) return erro(error);
    await carregarRoteiros(stage);
  };

  const novoPasso = async () => {
    if (!roteiro) return;
    const ordem = (passos[passos.length - 1]?.ordem ?? 0) + 1;
    const { error } = await db.from("crm_roteiro_passos").insert({ roteiro_id: roteiro.id, ordem, tipo: "text", rotulo: `Passo ${ordem}`, conteudo: "" });
    if (error) return erro(error);
    await carregarPassos(roteiro.id);
  };

  // Edição local imediata; grava ao sair do campo (onBlur) ou na hora para selects.
  const mudarLocal = (id: string, patch: Partial<PassoRoteiro>) => {
    setPassos((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setTodosPassos((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const gravarPasso = async (id: string, patch: Partial<PassoRoteiro>) => {
    const { error } = await db.from("crm_roteiro_passos").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) erro(error);
  };

  const mover = async (i: number, dir: -1 | 1) => {
    const a = passos[i];
    const b = passos[i + dir];
    if (!a || !b) return;
    await Promise.all([gravarPasso(a.id, { ordem: b.ordem }), gravarPasso(b.id, { ordem: a.ordem })]);
    await carregarPassos(roteiroId);
  };

  const apagarPasso = async (p: PassoRoteiro) => {
    if (!window.confirm(`Apagar "${p.rotulo || "passo"}"?`)) return;
    const { error } = await db.from("crm_roteiro_passos").delete().eq("id", p.id);
    if (error) return erro(error);
    await carregarPassos(roteiroId);
  };

  const subir = async (p: PassoRoteiro, file: File): Promise<boolean> => {
    setSubindo(p.id);
    try {
      const { url, path } = await subirMidiaRoteiro(p.roteiro_id, file);
      const patch = { media_url: url, media_path: path, file_name: file.name };
      mudarLocal(p.id, patch);
      await gravarPasso(p.id, patch);
      toast({ title: "Arquivo salvo no passo" });
      return true;
    } catch (e) {
      erro(e);
      return false;
    } finally {
      setSubindo(null);
    }
  };

  const aceitar: Record<TipoPasso, string> = { text: "", image: "image/*", audio: "audio/mpeg,audio/ogg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,.mp3,.ogg,.oga,.opus,.m4a,.wav", document: "application/pdf,.pdf,.doc,.docx" };

  const chip = (ativo: boolean) =>
    `h-7 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      ativo ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:border-[#3f444e] hover:text-foreground"
    }`;
  const selo = "inline-flex h-4 items-center rounded border px-1.5 text-[10px] font-medium uppercase tracking-wide";
  const rotulo = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
  const acaoIcone = "h-8 w-8 text-muted-foreground hover:text-foreground";

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rot-dark flex max-h-[90vh] max-w-5xl flex-col gap-0 overflow-hidden border-border p-0 md:h-[85vh]">
        <DialogHeader className="space-y-1 border-b border-border px-6 pb-4 pt-5 text-left">
          <DialogTitle className="text-base font-semibold tracking-tight">Roteiros</DialogTitle>
          <DialogDescription className="text-[13px]">
            Mensagens prontas do painel "Roteiros" do chat. "Usar" joga texto e mídia na caixa de mensagem; rascunho não aparece no chat.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5 border-b border-border px-6 py-3" role="group" aria-label="Filtrar por etapa">
          <button type="button" className={chip(stage === "todas")} aria-pressed={stage === "todas"} onClick={() => setStage("todas")}>Todas</button>
          {KANBAN_COLUMNS.map((c) => (
            <button key={c.id} type="button" className={chip(c.id === stage)} aria-pressed={c.id === stage} onClick={() => setStage(c.id)}>
              {c.title}
            </button>
          ))}
        </div>

        {carregando ? (
          <div className="flex flex-1 justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[260px_1fr] md:overflow-hidden">
            <aside className="flex flex-col border-b border-border bg-[#14161b] md:min-h-0 md:border-b-0 md:border-r">
              <div className="p-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar" className="h-8 pl-8" aria-label="Buscar roteiro" />
                </div>
              </div>
              <div className="space-y-1 px-2 pb-2 md:min-h-0 md:flex-1 md:overflow-y-auto">
                {listados.map((r) => {
                  const sel = r.id === roteiroId;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRoteiroId(r.id)}
                      aria-current={sel ? "true" : undefined}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        sel ? "border-primary/40 bg-secondary" : "border-transparent hover:bg-card"
                      }`}
                    >
                      <div className={`truncate font-medium ${sel ? "text-foreground" : "text-[#d3d6db]"}`}>{r.nome}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        {stage === "todas" && <span>{nomeEtapa(r.stage)} ·</span>}
                        <span>{FUNIS.find((f) => f.id === r.funil)?.nome ?? r.funil}</span>
                        {!r.ativo && <span className={`${selo} border-[#333] text-muted-foreground`}>rascunho</span>}
                        {paraPreencher(r.id) && <span className={`${selo} border-amber-400/30 text-amber-300`}>preencher</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="border-t border-border p-3">
                <Button size="sm" variant="outline" className="w-full" onClick={novoRoteiro}>
                  <Plus className="mr-1 h-4 w-4" /> Novo roteiro
                </Button>
              </div>
            </aside>

            <section className="p-6 md:min-h-0 md:overflow-y-auto">
              {!roteiro ? (
                <p className="text-sm text-muted-foreground">Nenhum roteiro nesta etapa.</p>
              ) : (
                <div className="space-y-5">
                  <div className="space-y-4 rounded-lg border border-border bg-card p-4">
                    <div className="grid items-end gap-3 sm:grid-cols-[1fr_140px_140px_auto_auto_auto]">
                      <div className="space-y-1.5">
                        <Label className={rotulo}>Nome</Label>
                        <Input value={roteiro.nome}
                          onChange={(e) => setRoteiros((rs) => rs.map((r) => (r.id === roteiro.id ? { ...r, nome: e.target.value } : r)))}
                          onBlur={(e) => salvarRoteiro({ nome: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className={rotulo}>Etapa</Label>
                        <Select value={roteiro.stage} onValueChange={(v) => salvarRoteiro({ stage: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent className="rot-dark"><ItensEtapa incluir={roteiro.stage} /></SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className={rotulo}>Categoria</Label>
                        <Select value={roteiro.funil} onValueChange={(v) => salvarRoteiro({ funil: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent className="rot-dark">{FUNIS.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="flex h-10 items-center gap-2">
                        <Switch checked={roteiro.ativo} onCheckedChange={(v) => salvarRoteiro({ ativo: v })} />
                        <span className={`text-xs ${roteiro.ativo ? "text-primary" : "text-muted-foreground"}`}>{roteiro.ativo ? "Ativo no chat" : "Rascunho"}</span>
                      </div>
                      <Button variant="ghost" size="icon" className={acaoIcone} onClick={duplicarRoteiro} aria-label="Duplicar roteiro" title="Duplicar">
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className={`${acaoIcone} hover:text-destructive`} onClick={apagarRoteiro} aria-label="Apagar roteiro" title="Apagar roteiro">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      <Label className={rotulo}>Descrição (aparece no painel)</Label>
                      <Input value={roteiro.descricao ?? ""}
                        onChange={(e) => setRoteiros((rs) => rs.map((r) => (r.id === roteiro.id ? { ...r, descricao: e.target.value } : r)))}
                        onBlur={(e) => salvarRoteiro({ descricao: e.target.value })} />
                    </div>
                  </div>

                  <div className="flex items-baseline justify-between gap-3">
                    <h4 className="text-sm font-semibold">Passos <span className="font-normal text-muted-foreground">({passos.length})</span></h4>
                    <p className="text-[11px] text-muted-foreground">
                      Variáveis: {"{primeiro_nome}"}, {"{nome}"}, {"{telefone}"} e qualquer outra entre chaves (ex.: {"{data}"}), preenchida na hora de enviar.
                    </p>
                  </div>

                  <ol className="space-y-3">
                    {passos.map((p, i) => (
                      <li key={p.id} className="group space-y-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-[#3f444e]">
                        <div className="grid items-center gap-2 sm:grid-cols-[28px_1fr_130px_120px_auto]">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-xs font-semibold tabular-nums text-primary">{i + 1}</span>
                          <Input value={p.rotulo ?? ""} placeholder="Nome do passo" className="font-medium"
                            onChange={(e) => mudarLocal(p.id, { rotulo: e.target.value })}
                            onBlur={(e) => gravarPasso(p.id, { rotulo: e.target.value })} />
                          <Select value={p.tipo} onValueChange={(v) => { mudarLocal(p.id, { tipo: v as TipoPasso }); gravarPasso(p.id, { tipo: v as TipoPasso }); }}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent className="rot-dark">{TIPOS_PASSO.map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}</SelectContent>
                          </Select>
                          <div className="flex items-center gap-1.5" title="Atraso sugerido antes deste passo, em segundos">
                            <Input type="number" min={0} value={p.atraso_segundos} className="tabular-nums"
                              onChange={(e) => mudarLocal(p.id, { atraso_segundos: Number(e.target.value) || 0 })}
                              onBlur={(e) => gravarPasso(p.id, { atraso_segundos: Number(e.target.value) || 0 })} />
                            <span className="w-10 shrink-0 text-[11px] text-muted-foreground">{formatarAtraso(p.atraso_segundos)}</span>
                          </div>
                          <div className="flex transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                            <Button variant="ghost" size="icon" className={acaoIcone} disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir" title="Subir"><ArrowUp className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" className={acaoIcone} disabled={i === passos.length - 1} onClick={() => mover(i, 1)} aria-label="Descer" title="Descer"><ArrowDown className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" className={`${acaoIcone} hover:text-destructive`} onClick={() => apagarPasso(p)} aria-label="Apagar passo" title="Apagar passo"><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </div>
                        {passoParaPreencher(p) && (
                          <p className="text-xs text-amber-300">Preencher: escreva o texto ou suba o arquivo deste passo.</p>
                        )}
                        {p.tipo === "image" && p.media_url && (
                          <div className="flex w-fit max-w-full items-center justify-center overflow-hidden rounded-md border border-border bg-black p-1">
                            <img src={p.media_url} alt={p.file_name || "imagem"} className="max-h-40 max-w-full rounded object-contain" loading="lazy" />
                          </div>
                        )}
                        {p.tipo === "audio" && p.media_url && (
                          <div className="w-full max-w-sm rounded-full border border-border bg-[#14161b] p-1">
                            <audio controls preload="none" src={p.media_url} className="h-8 w-full" />
                          </div>
                        )}
                        <Textarea value={p.conteudo} placeholder={p.tipo === "text" ? "Texto da mensagem. Use {primeiro_nome} para o nome da lead." : "Legenda (opcional)"}
                          className="min-h-[80px] leading-relaxed"
                          onChange={(e) => mudarLocal(p.id, { conteudo: e.target.value })}
                          onBlur={(e) => gravarPasso(p.id, { conteudo: e.target.value })} />
                        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
                          {p.tipo !== "text" && (
                            <>
                              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-[#14161b] px-2.5 text-xs transition-colors hover:border-[#3f444e] hover:bg-secondary focus-within:ring-2 focus-within:ring-ring">
                                {subindo === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                                {p.media_url ? "Trocar arquivo" : "Subir arquivo"}
                                <input type="file" className="sr-only" accept={aceitar[p.tipo]}
                                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) subir(p, f); }} />
                              </label>
                              {p.tipo === "audio" && (
                                <GravadorAudioPasso desabilitado={subindo === p.id} onUsar={(f) => subir(p, f)}
                                  onAviso={(d) => toast({ title: "Gravação", description: d, variant: "destructive" })} />
                              )}
                              {p.media_url
                                ? <a href={p.media_url} target="_blank" rel="noopener noreferrer" className="max-w-[260px] truncate text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">{p.file_name || "arquivo"}</a>
                                : <span className="text-xs text-destructive">sem arquivo</span>}
                            </>
                          )}
                          <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
                            <Switch checked={p.aguarda_resposta}
                              onCheckedChange={(v) => { mudarLocal(p.id, { aguarda_resposta: v }); gravarPasso(p.id, { aguarda_resposta: v }); }} />
                            Só depois da resposta da lead
                          </label>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <Button size="sm" variant="outline" className="w-full border-dashed" onClick={novoPasso}><Plus className="mr-1 h-4 w-4" /> Novo passo</Button>
                </div>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
