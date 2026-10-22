import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowUp, ExternalLink, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  type CardPedido, type ContaIg, type Midia, type RespostaPublicar, type TipoMidia, type TipoPub,
  ROTULO_STATUS, ROTULO_TIPO, conferirMidias, listarContas, localParaIsoComFuso, publicar, subirMidia,
} from "@/lib/conteudo/publicacoes";

const LEGENDA_MAX = 2200;

function paraInputLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

interface Props {
  card: CardPedido | null;
  onClose: () => void;
  onConcluido: () => void;
  /** mídia que já vem pronta (ex.: o MP4 do Estúdio React): sobe sozinha quando o painel abre */
  arquivoInicial?: File | null;
  tipoInicial?: TipoPub;
}

export function PublicarInstagramDialog({ card, onClose, onConcluido, arquivoInicial, tipoInicial }: Props) {
  const [contas, setContas] = useState<ContaIg[] | null>(null);
  const [erroContas, setErroContas] = useState<string | null>(null);
  const [carregandoContas, setCarregandoContas] = useState(false);
  const [contaId, setContaId] = useState("");
  const [tipo, setTipo] = useState<TipoPub>("feed");
  const [midias, setMidias] = useState<Midia[]>([]);
  const [legenda, setLegenda] = useState("");
  const [quando, setQuando] = useState<"agora" | "agendar">("agendar");
  const [dataLocal, setDataLocal] = useState("");
  const [urlColada, setUrlColada] = useState("");
  const [tipoColado, setTipoColado] = useState<TipoMidia>("image");
  const [subindo, setSubindo] = useState<{ nome: string; pct: number } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<RespostaPublicar | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const carregarContas = async (forcar = false) => {
    setCarregandoContas(true);
    setErroContas(null);
    try {
      const c = await listarContas(forcar);
      setContas(c);
      setContaId((atual) => atual || c.find((x) => x.ativa)?.id || "");
    } catch (e) {
      setErroContas((e as Error).message);
    } finally {
      setCarregandoContas(false);
    }
  };

  // card novo: zera o formulário
  useEffect(() => {
    if (!card) return;
    setTipo(tipoInicial ?? "feed");
    setMidias([]);
    setLegenda(card.texto.slice(0, LEGENDA_MAX));
    setQuando("agendar");
    setDataLocal(paraInputLocal(new Date(Date.now() + 60 * 60_000)));
    setUrlColada("");
    setResultado(null);
    setErro(null);
    if (!contas) void carregarContas();
    if (arquivoInicial) void escolherArquivos([arquivoInicial]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  const problemaMidia = useMemo(() => conferirMidias(tipo, midias), [tipo, midias]);
  const conta = contas?.find((c) => c.id === contaId) || null;

  const escolherArquivos = async (arquivos: FileList | File[] | null) => {
    if (!arquivos?.length) return;
    for (const a of Array.from(arquivos)) {
      setSubindo({ nome: a.name, pct: 0 });
      try {
        const m = await subirMidia(a, (pct) => setSubindo({ nome: a.name, pct }));
        setMidias((atual) => [...atual, m]);
      } catch (e) {
        toast.error(`${a.name}: ${(e as Error).message}`);
      }
    }
    setSubindo(null);
    if (arquivoRef.current) arquivoRef.current.value = "";
  };

  const colarUrl = () => {
    const u = urlColada.trim();
    if (!/^https:\/\/\S+$/.test(u)) { toast.error("o endereço precisa começar com https://"); return; }
    setMidias((atual) => [...atual, { url: u, tipo: tipoColado }]);
    setUrlColada("");
  };

  const mover = (i: number) => setMidias((m) => { const n = [...m]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; });

  const enviar = async () => {
    if (!card) return;
    setErro(null);
    if (!conta) { setErro("escolha a conta do Instagram"); return; }
    if (!conta.ativa) { setErro(`a conta @${conta.usuario} precisa ser reconectada na Zernio`); return; }
    if (problemaMidia) { setErro(problemaMidia); return; }
    let agendarPara: string | null = null;
    if (quando === "agendar") {
      agendarPara = localParaIsoComFuso(dataLocal);
      if (!agendarPara) { setErro("escolha data e hora"); return; }
      if (Date.parse(agendarPara) < Date.now() + 2 * 60_000) { setErro("o horário precisa estar pelo menos 2 minutos no futuro"); return; }
    }
    setEnviando(true);
    try {
      const r = await publicar({
        card_ref: card.card_ref, perfil: card.perfil, card_texto: card.texto.slice(0, 2000),
        conta_id: conta.id, conta_nome: conta.usuario, tipo, legenda: tipo === "story" ? "" : legenda, midias, agendar_para: agendarPara,
      });
      setResultado(r);
      if (r.status === "erro") toast.error(`Não foi: ${r.erro}`);
      else toast.success(quando === "agora" ? "Enviado: publica em cerca de 1 minuto" : "Agendado na Zernio");
      onConcluido();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={!!card} onOpenChange={(v) => { if (!v && !enviando && !subindo) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Publicar no Instagram</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {card ? `${card.perfil_nome} · ${card.coluna}: ${card.texto}` : ""}
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="space-y-3 text-sm">
            <p>
              <span className="font-semibold">{ROTULO_STATUS[resultado.status]}</span>
              {conta?.usuario ? ` · @${conta.usuario}` : ""}
            </p>
            {resultado.status === "erro" && <p className="text-destructive">{resultado.erro}</p>}
            {resultado.status === "agendado" && quando === "agora" && (
              <p className="text-muted-foreground">A Zernio publica em cerca de 1 minuto. O card mostra "Publicado" com o link quando o post sair.</p>
            )}
            {resultado.link && (
              <a href={resultado.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
                Ver post <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <DialogFooter>
              {resultado.status === "erro" && <Button variant="outline" onClick={() => setResultado(null)}>Corrigir e tentar de novo</Button>}
              <Button onClick={onClose}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Conta</Label>
                <Button type="button" variant="ghost" size="sm" onClick={() => void carregarContas(true)} disabled={carregandoContas}>
                  {carregandoContas ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  <span className="ml-1">Atualizar</span>
                </Button>
              </div>
              {erroContas ? (
                <p className="text-sm text-destructive">{erroContas}</p>
              ) : contas && contas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma conta do Instagram conectada na Zernio ainda.</p>
              ) : (
                <Select value={contaId} onValueChange={setContaId} disabled={!contas}>
                  <SelectTrigger><SelectValue placeholder={contas ? "Escolha a conta" : "Carregando contas…"} /></SelectTrigger>
                  <SelectContent>
                    {(contas || []).map((c) => (
                      <SelectItem key={c.id} value={c.id} disabled={!c.ativa}>
                        @{c.usuario || "?"}{c.nome ? ` · ${c.nome}` : ""}{c.ativa ? "" : " (reconectar na Zernio)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label>Tipo</Label>
              <RadioGroup value={tipo} onValueChange={(v) => setTipo(v as TipoPub)} className="grid grid-cols-2 gap-2">
                {(Object.keys(ROTULO_TIPO) as TipoPub[]).map((t) => (
                  <label key={t} className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer">
                    <RadioGroupItem value={t} /> {ROTULO_TIPO[t]}
                  </label>
                ))}
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label>Mídia</Label>
              {midias.length > 0 && (
                <ol className="space-y-1 text-sm">
                  {midias.map((m, i) => (
                    <li key={`${m.url}-${i}`} className="flex items-center gap-2 rounded border px-2 py-1">
                      <span className="text-muted-foreground w-5">{i + 1}.</span>
                      <span className="shrink-0 text-xs uppercase text-muted-foreground">{m.tipo === "image" ? "img" : "vídeo"}</span>
                      <a href={m.url} target="_blank" rel="noopener noreferrer" className="truncate underline flex-1">{m.nome || m.url}</a>
                      {i > 0 && (
                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => mover(i)} title="Subir"><ArrowUp className="h-3.5 w-3.5" /></Button>
                      )}
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => setMidias((x) => x.filter((_, j) => j !== i))} title="Tirar"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </li>
                  ))}
                </ol>
              )}
              <input
                ref={arquivoRef} type="file" multiple className="hidden"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                onChange={(e) => void escolherArquivos(e.target.files)}
              />
              <Button type="button" variant="outline" onClick={() => arquivoRef.current?.click()} disabled={!!subindo}>
                {subindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                <span className="ml-2">{subindo ? `Enviando ${subindo.nome} (${subindo.pct}%)` : "Enviar arquivo (JPG, PNG, WEBP, MP4, MOV)"}</span>
              </Button>
              <div className="flex gap-2">
                <Input placeholder="ou cole um endereço https da mídia" value={urlColada} onChange={(e) => setUrlColada(e.target.value)} />
                <Select value={tipoColado} onValueChange={(v) => setTipoColado(v as TipoMidia)}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="image">Imagem</SelectItem>
                    <SelectItem value="video">Vídeo</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="button" variant="secondary" onClick={colarUrl} disabled={!urlColada.trim()}>Pôr</Button>
              </div>
              {midias.length > 0 && problemaMidia && <p className="text-xs text-amber-700">{problemaMidia}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="legenda-ig">Legenda</Label>
              <Textarea
                id="legenda-ig" rows={5} value={tipo === "story" ? "" : legenda} maxLength={LEGENDA_MAX}
                disabled={tipo === "story"} placeholder={tipo === "story" ? "Story não tem legenda no Instagram" : ""}
                onChange={(e) => setLegenda(e.target.value)}
              />
              {tipo !== "story" && <p className="text-right text-xs text-muted-foreground">{legenda.length}/{LEGENDA_MAX}</p>}
            </div>

            <div className="space-y-2">
              <Label>Quando</Label>
              <RadioGroup value={quando} onValueChange={(v) => setQuando(v as "agora" | "agendar")} className="flex gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="agora" /> Postar agora</label>
                <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="agendar" /> Agendar</label>
              </RadioGroup>
              {quando === "agendar" && (
                <Input type="datetime-local" value={dataLocal} min={paraInputLocal(new Date(Date.now() + 5 * 60_000))} onChange={(e) => setDataLocal(e.target.value)} />
              )}
              {quando === "agora" && <p className="text-xs text-muted-foreground">Vai para a Zernio agendado para daqui a 1 minuto (dá para cancelar nesse intervalo).</p>}
            </div>

            {erro && <p className="text-sm text-destructive">{erro}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={enviando || !!subindo}>Cancelar</Button>
              <Button onClick={() => void enviar()} disabled={enviando || !!subindo || !conta || !!problemaMidia}>
                {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {quando === "agora" ? "Publicar agora" : "Agendar"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
