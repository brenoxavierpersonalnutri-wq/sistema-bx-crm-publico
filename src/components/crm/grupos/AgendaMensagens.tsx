import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, ChevronDown, ChevronRight, Loader2, Paperclip, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  db, offsetDe, problemasMensagem, rotuloRelativo, ROTULO_STATUS, subirMidia, tipoDoArquivo, TIPOS_COM_MENCAO,
  type CampanhaGrupos, type EnvioGrupo, type MensagemAgendada, type TipoMensagemGrupo,
} from "@/lib/grupos";

/** "2026-10-20T19:30" (hora local do navegador) <-> ISO. */
const paraInputLocal = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const ROTULO_TIPO: Record<TipoMensagemGrupo, string> = {
  texto: "Texto", imagem: "Imagem", video: "Vídeo", audio: "Áudio", documento: "Documento",
  enquete: "Enquete", travar: "Fechar grupo", destravar: "Abrir grupo",
};
type Especial = "conteudo" | "enquete" | "travar" | "destravar";
const seletor = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const COR_ENVIO: Record<EnvioGrupo["status"], string> = {
  pendente: "text-muted-foreground", enviando: "text-blue-600", enviado: "text-green-600",
  falhou: "text-destructive", cancelado: "text-muted-foreground line-through",
};

// Agenda de mensagens para TODOS os grupos (com id) da campanha. Sai grupo a grupo com intervalo
// aleatório; editar/apagar só antes de começar; cancelar vale também no meio do envio.
export function AgendaMensagens({ campanha }: { campanha: CampanhaGrupos }) {
  const { toast } = useToast();
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [mensagens, setMensagens] = useState<MensagemAgendada[]>([]);
  const [envios, setEnvios] = useState<Record<string, EnvioGrupo[]>>({});
  const [nomesGrupo, setNomesGrupo] = useState<Record<string, string>>({});
  const [aberta, setAberta] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [quando, setQuando] = useState(() => paraInputLocal(new Date(Date.now() + 15 * 60_000).toISOString()));
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [midiaAtual, setMidiaAtual] = useState<{ path: string; tipo: TipoMensagemGrupo; nome: string | null } | null>(null);
  const [linkPreview, setLinkPreview] = useState(true);
  const [especial, setEspecial] = useState<Especial>("conteudo");
  const [opcoes, setOpcoes] = useState("");
  const [multipla, setMultipla] = useState(false);
  const [ptt, setPtt] = useState(true);
  const [mencionar, setMencionar] = useState(false);
  const [relativo, setRelativo] = useState(false);
  const [rel, setRel] = useState({ dias: 1, horas: 0, minutos: 0, antes: true });
  const [salvando, setSalvando] = useState(false);
  const [gruposComId, setGruposComId] = useState(0);

  const carregar = useCallback(async () => {
    const [{ data: ms }, { data: gs }] = await Promise.all([
      db.from("grupos_mensagens").select("*").eq("campanha_id", campanha.id).order("agendado_para", { ascending: false }).limit(100),
      db.from("grupos_campanha_grupos").select("id, nome, chat_id, ativo").eq("campanha_id", campanha.id),
    ]);
    setMensagens((ms ?? []) as MensagemAgendada[]);
    const nomes: Record<string, string> = {};
    for (const g of gs ?? []) nomes[g.id] = g.nome || g.chat_id || g.id;
    setNomesGrupo(nomes);
    setGruposComId((gs ?? []).filter((g: { chat_id: string | null; ativo: boolean }) => g.chat_id && g.ativo).length);
  }, [campanha.id]);

  useEffect(() => { carregar(); }, [carregar]);
  // enquanto houver mensagem enviando, atualiza a cada 10 s
  useEffect(() => {
    if (!mensagens.some((m) => m.status === "enviando")) return;
    const t = setInterval(() => { carregar(); if (aberta) abrirEnvios(aberta, true); }, 10_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensagens, aberta, carregar]);

  async function abrirEnvios(id: string, manter = false) {
    if (!manter && aberta === id) { setAberta(null); return; }
    setAberta(id);
    const { data } = await db.from("grupos_envios").select("*").eq("mensagem_id", id).order("ordem");
    setEnvios((e) => ({ ...e, [id]: (data ?? []) as EnvioGrupo[] }));
  }

  function limpar() {
    setEditando(null); setTexto(""); setArquivo(null); setMidiaAtual(null); setLinkPreview(true);
    setEspecial("conteudo"); setOpcoes(""); setMultipla(false); setPtt(true); setMencionar(false); setRelativo(false);
    setQuando(paraInputLocal(new Date(Date.now() + 15 * 60_000).toISOString()));
    if (arquivoRef.current) arquivoRef.current.value = "";
  }

  function editar(m: MensagemAgendada) {
    setEditando(m.id);
    setQuando(paraInputLocal(m.agendado_para));
    setTexto(m.texto ?? "");
    setArquivo(null);
    setMidiaAtual(m.midia_path ? { path: m.midia_path, tipo: m.tipo, nome: m.nome_arquivo } : null);
    setLinkPreview(m.link_preview);
    setEspecial(m.tipo === "enquete" || m.tipo === "travar" || m.tipo === "destravar" ? m.tipo : "conteudo");
    setOpcoes((m.enquete_opcoes ?? []).join("\n"));
    setMultipla(Boolean(m.enquete_multipla));
    setPtt(m.tipo === "audio" ? Boolean(m.ptt) : true);
    setMencionar(Boolean(m.mencionar_todos));
    setRelativo(Boolean(m.relativo_evento));
    if (m.relativo_evento && typeof m.offset_min === "number") {
      const abs = Math.abs(m.offset_min);
      setRel({ dias: Math.floor(abs / 1440), horas: Math.floor((abs % 1440) / 60), minutos: abs % 60, antes: m.offset_min < 0 });
    }
  }

  const tipo: TipoMensagemGrupo = especial !== "conteudo" ? especial
    : arquivo ? tipoDoArquivo(arquivo.type) : midiaAtual ? midiaAtual.tipo : "texto";
  const semConteudo = tipo === "travar" || tipo === "destravar";
  const offset = offsetDe(rel.dias, rel.horas, rel.minutos, rel.antes);
  const evento = campanha.data_evento ? Date.parse(campanha.data_evento) : NaN;
  const agendadoIso = (() => {
    if (relativo) return Number.isFinite(evento) ? new Date(evento + offset * 60_000).toISOString() : "x";
    const d = new Date(quando);
    return Number.isFinite(d.getTime()) ? d.toISOString() : "x";
  })();
  const listaOpcoes = opcoes.split("\n").map((o) => o.trim()).filter(Boolean);
  const problemas = problemasMensagem({
    tipo, texto: semConteudo ? null : texto.trim() || null,
    midia_path: semConteudo || tipo === "enquete" ? null : arquivo ? "pendente" : midiaAtual?.path ?? null,
    agendado_para: agendadoIso, enquete_opcoes: listaOpcoes, ptt: tipo === "audio" && ptt,
    mencionar_todos: mencionar && TIPOS_COM_MENCAO.includes(tipo),
  });
  if (relativo && !Number.isFinite(evento)) problemas.push("Defina a data do evento na aba Fluxo automático.");
  if (arquivo && arquivo.size > 50 * 1024 * 1024) problemas.push("Arquivo passa de 50 MB.");

  async function salvar() {
    if (problemas.length) return;
    setSalvando(true);
    try {
      let midia_path = midiaAtual?.path ?? null;
      let nome_arquivo = midiaAtual?.nome ?? null;
      if (arquivo) {
        midia_path = await subirMidia(campanha.id, arquivo);
        nome_arquivo = arquivo.name.slice(0, 255);
      }
      const comMidia = ["imagem", "video", "audio", "documento"].includes(tipo);
      const linha = {
        campanha_id: campanha.id, agendado_para: agendadoIso, tipo,
        texto: tipo === "audio" || semConteudo ? null : texto.trim() || null,
        midia_path: comMidia ? midia_path : null, nome_arquivo: tipo === "documento" ? nome_arquivo : null,
        link_preview: linkPreview, updated_at: new Date().toISOString(),
        // colunas da migration 20261106100000: só vão quando usadas (mensagem simples funciona sem ela)
        ...(relativo || editando ? { relativo_evento: relativo, offset_min: relativo ? offset : null } : {}),
        ...(tipo === "enquete" ? { enquete_opcoes: listaOpcoes, enquete_multipla: multipla } : editando ? { enquete_opcoes: null, enquete_multipla: false } : {}),
        ...(tipo === "audio" && ptt ? { ptt: true } : editando ? { ptt: false } : {}),
        ...(mencionar && TIPOS_COM_MENCAO.includes(tipo) ? { mencionar_todos: true } : editando ? { mencionar_todos: false } : {}),
      };
      const { error } = editando
        ? await db.from("grupos_mensagens").update(linha).eq("id", editando).eq("status", "agendada")
        : await db.from("grupos_mensagens").insert(linha);
      if (error) throw new Error(error.message);
      toast({ title: editando ? "Mensagem atualizada" : "Mensagem agendada" });
      limpar();
      await carregar();
    } catch (e) {
      toast({ title: "Não deu para salvar", description: (e as Error).message, variant: "destructive" });
    }
    setSalvando(false);
  }

  async function cancelar(m: MensagemAgendada) {
    if (!confirm("Cancelar esta mensagem? O que ainda não saiu não sai mais.")) return;
    const { data, error } = await db.rpc("grupos_cancelar_mensagem", { p_id: m.id });
    toast({ title: error ? "Erro" : `Mensagem ${data}`, description: error?.message, variant: error ? "destructive" : undefined });
    await carregar();
  }

  async function apagar(m: MensagemAgendada) {
    if (!confirm("Apagar esta mensagem e o histórico dela?")) return;
    const { error } = await db.from("grupos_mensagens").delete().eq("id", m.id);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    if (editando === m.id) limpar();
    await carregar();
  }

  const duracaoMin = gruposComId > 1
    ? `${Math.round(((gruposComId - 1) * campanha.intervalo_min_s) / 60)}-${Math.round(((gruposComId - 1) * campanha.intervalo_max_s) / 60)} min`
    : "imediato";

  return (
    <div className="space-y-5">
      <div className="rounded-md border p-4 space-y-3 max-w-2xl">
        <div className="flex items-center justify-between">
          <p className="font-medium">{editando ? "Editar mensagem agendada" : "Agendar mensagem"}</p>
          {editando && <Button size="sm" variant="ghost" onClick={limpar}><X className="h-4 w-4 mr-1" /> Cancelar edição</Button>}
        </div>
        <p className="text-xs text-muted-foreground">
          Vai para {gruposComId} grupo(s) ativos com id, um por vez, a cada {campanha.intervalo_min_s}-{campanha.intervalo_max_s} s (total ≈ {duracaoMin}).
          {campanha.disparos_pausados && <b className="text-amber-600"> Disparos pausados nesta campanha.</b>}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Label>O que enviar</Label>
          <select className={seletor} value={especial} onChange={(e) => setEspecial(e.target.value as Especial)}>
            <option value="conteudo">Texto ou mídia</option>
            <option value="enquete">Enquete</option>
            <option value="travar">Fechar grupo (só admins enviam)</option>
            <option value="destravar">Abrir grupo (todos enviam)</option>
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label>Quando</Label>
              <select className={seletor} value={relativo ? "rel" : "abs"} onChange={(e) => setRelativo(e.target.value === "rel")}>
                <option value="abs">data e hora</option>
                <option value="rel">relativo ao evento</option>
              </select>
            </div>
            {!relativo && <Input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />}
            {relativo && (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-1 text-sm">
                  <Input className="w-16" type="number" min={0} max={30} value={rel.dias} onChange={(e) => setRel({ ...rel, dias: Number(e.target.value) })} /> d
                  <Input className="w-16" type="number" min={0} max={23} value={rel.horas} onChange={(e) => setRel({ ...rel, horas: Number(e.target.value) })} /> h
                  <Input className="w-16" type="number" min={0} max={59} value={rel.minutos} onChange={(e) => setRel({ ...rel, minutos: Number(e.target.value) })} /> min
                  <select className={seletor} value={rel.antes ? "antes" : "depois"} onChange={(e) => setRel({ ...rel, antes: e.target.value === "antes" })}>
                    <option value="antes">antes</option>
                    <option value="depois">depois</option>
                  </select>
                </div>
                <p className="text-xs text-muted-foreground">
                  {Number.isFinite(evento)
                    ? `${rotuloRelativo(offset)}: ${new Date(evento + offset * 60_000).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
                    : "Sem data do evento (aba Fluxo automático)."}
                </p>
              </div>
            )}
          </div>
          {especial === "conteudo" && <div className="space-y-1">
            <Label>Mídia (imagem, vídeo, áudio ou PDF)</Label>
            <div className="flex items-center gap-2">
              <input
                ref={arquivoRef} type="file" className="hidden"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,video/quicktime,audio/mpeg,audio/ogg,audio/mp4,audio/aac,audio/wav,audio/x-m4a,application/pdf"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => arquivoRef.current?.click()}>
                <Paperclip className="h-4 w-4 mr-1" /> {arquivo ? "Trocar" : "Escolher"}
              </Button>
              <span className="text-xs truncate">{arquivo?.name ?? midiaAtual?.nome ?? (midiaAtual ? ROTULO_TIPO[midiaAtual.tipo] : "só texto")}</span>
              {(arquivo || midiaAtual) && (
                <Button type="button" variant="ghost" size="icon" onClick={() => { setArquivo(null); setMidiaAtual(null); if (arquivoRef.current) arquivoRef.current.value = ""; }}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>}
        </div>
        {tipo === "enquete" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Pergunta</Label>
              <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Qual horário é melhor pra você?" />
              <label className="flex items-center gap-2 text-sm"><Switch checked={multipla} onCheckedChange={setMultipla} /> Permitir mais de uma resposta</label>
            </div>
            <div className="space-y-1">
              <Label>Opções (uma por linha, 2 a 12)</Label>
              <Textarea rows={4} value={opcoes} onChange={(e) => setOpcoes(e.target.value)} placeholder={"19h\n20h\n21h"} />
            </div>
          </div>
        )}
        {semConteudo && (
          <p className="text-xs text-muted-foreground">
            {tipo === "travar" ? "Fecha" : "Abre"} todos os grupos da campanha no horário (o número precisa ser admin de cada grupo).
          </p>
        )}
        {tipo === "audio" && (
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm"><Switch checked={ptt} onCheckedChange={setPtt} /> Enviar como nota de voz (gravado na hora)</label>
            {ptt && arquivo && !/ogg|opus/i.test(arquivo.type + arquivo.name) && (
              <p className="text-xs text-muted-foreground">MP3/M4A é convertido para nota de voz (.ogg Opus) na hora do envio.</p>
            )}
          </div>
        )}
        {TIPOS_COM_MENCAO.includes(tipo) && (
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={mencionar} onCheckedChange={setMencionar} /> Mencionar todos (notifica todo mundo sem aparecer @ no texto)
          </label>
        )}
        {tipo !== "audio" && tipo !== "enquete" && !semConteudo && (
          <div className="space-y-1">
            <Label>{tipo === "texto" ? "Texto" : "Legenda (opcional)"}</Label>
            <Textarea rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Texto da mensagem. Links com https:// viram prévia." />
          </div>
        )}
        {tipo === "texto" && (
          <label className="flex items-center gap-2 text-sm"><Switch checked={linkPreview} onCheckedChange={setLinkPreview} /> Mostrar prévia do link</label>
        )}
        {tipo === "video" && <p className="text-xs text-muted-foreground">Vídeo: prefira MP4 até 16 MB (limite comum do WhatsApp).</p>}
        {problemas.length > 0 && <ul className="text-xs text-destructive list-disc pl-4">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>}
        <Button onClick={salvar} disabled={salvando || problemas.length > 0}>
          {salvando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} {editando ? "Salvar alterações" : `Agendar (${ROTULO_TIPO[tipo]})`}
        </Button>
      </div>

      <div className="space-y-2">
        {!mensagens.length && <p className="text-sm text-muted-foreground">Nenhuma mensagem agendada.</p>}
        {mensagens.map((m) => (
          <div key={m.id} className="rounded-md border">
            <div className="flex flex-wrap items-center gap-2 p-3">
              <button type="button" onClick={() => abrirEnvios(m.id)} className="flex items-center gap-1 text-sm font-medium">
                {aberta === m.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {new Date(m.agendado_para).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
              </button>
              <Badge variant="outline">{ROTULO_TIPO[m.tipo]}</Badge>
              {m.relativo_evento && typeof m.offset_min === "number" && <Badge variant="secondary">{rotuloRelativo(m.offset_min)}</Badge>}
              {m.mencionar_todos && <Badge variant="secondary">@todos</Badge>}
              {m.ptt && <Badge variant="secondary">nota de voz</Badge>}
              <Badge variant={m.status === "erro" ? "destructive" : m.status === "concluida" ? "default" : "secondary"}>{ROTULO_STATUS[m.status]}</Badge>
              {m.total_grupos > 0 && <span className="text-xs text-muted-foreground">{m.enviados}/{m.total_grupos} enviados{m.falhas ? ` · ${m.falhas} falha(s)` : ""}</span>}
              <span className="text-sm text-muted-foreground truncate flex-1 min-w-[120px]">{m.texto ?? m.nome_arquivo ?? ""}</span>
              {m.status === "agendada" && <Button size="sm" variant="ghost" onClick={() => editar(m)}><Pencil className="h-4 w-4" /></Button>}
              {(m.status === "agendada" || m.status === "enviando") && <Button size="sm" variant="ghost" onClick={() => cancelar(m)} title="Cancelar"><Ban className="h-4 w-4" /></Button>}
              {m.status !== "enviando" && <Button size="sm" variant="ghost" onClick={() => apagar(m)} title="Apagar"><Trash2 className="h-4 w-4" /></Button>}
            </div>
            {m.motivo && <p className="px-3 pb-2 text-xs text-destructive">{m.motivo}</p>}
            {aberta === m.id && (
              <div className="border-t px-3 py-2 text-sm space-y-1">
                {!(envios[m.id]?.length) && <p className="text-xs text-muted-foreground">{m.status === "agendada" ? "A fila por grupo é montada no horário." : "Sem envios."}</p>}
                {envios[m.id]?.map((e) => (
                  <div key={e.id} className="flex flex-wrap gap-2">
                    <span className="truncate max-w-[220px]">{nomesGrupo[e.grupo_id] ?? e.grupo_id}</span>
                    <span className={COR_ENVIO[e.status]}>{e.status}</span>
                    <span className="text-xs text-muted-foreground">
                      {e.enviado_em ? new Date(e.enviado_em).toLocaleTimeString("pt-BR") : e.status === "pendente" ? `previsto ${new Date(e.proximo_em).toLocaleTimeString("pt-BR")}` : ""}
                    </span>
                    {e.erro && <span className="text-xs text-destructive">{e.erro}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
