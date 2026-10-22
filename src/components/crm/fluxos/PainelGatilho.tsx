// Painel de um gatilho ("puxo, coloco tag, mostro qual base eu quero"): tag, etapa, formulário/evento,
// segmento/base de dados (todos agora ou só os novos), sem resposta, data/agenda, novo lead no banco
// (formulário, agendamento, compra, base, WhatsApp; só registros novos) e webhook/API (URL própria do fluxo).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertTriangle } from "lucide-react";
import { SeletorTags } from "@/components/crm/SeletorTags";
import { EntradaWebhook } from "./EntradaWebhook";
import { useFluxos } from "./contexto";
import {
  FONTES_BANCO,
  NIVEIS_FORMULARIO,
  ORIGENS_FORMULARIO,
  ROTULO_FONTE_BANCO,
  ROTULO_GATILHO,
  eventosParaEscolher,
  validarGatilho,
  type FonteBanco,
  type CatalogoConstrutor,
  type ConfigFluxo,
  type GatilhoFluxo,
} from "@/lib/crm/fluxosConstrutor";
import { ItensEtapa } from "@/components/crm/etapas/ItensEtapa";

const novo = (tipo: GatilhoFluxo["tipo"]): GatilhoFluxo => {
  switch (tipo) {
    case "tag": return { tipo, valor: "" };
    case "etapa": return { tipo, valor: "contato" };
    case "evento": return { tipo, valor: "" };
    case "segmento": return { tipo, segmento_id: null, lista_origem: null, modo: "novos" };
    case "sem_resposta": return { tipo, horas: 24 };
    case "data": return { tipo, em: "", segmento_id: null, tag: null };
    case "banco": return { tipo, fonte: "formulario", niveis: [], origens: [], criado_em: new Date().toISOString() };
    case "webhook": return { tipo, criado_em: new Date().toISOString() };
  }
};

const alternar = (lista: string[] | undefined, v: string) => ((lista ?? []).includes(v) ? (lista ?? []).filter((x) => x !== v) : [...(lista ?? []), v]);

function Chips({ opcoes, valor, onMudar, rotulo }: { opcoes: string[]; valor: string[] | undefined; onMudar: (v: string[]) => void; rotulo: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={rotulo}>
      {opcoes.map((o) => (
        <button key={o} type="button" aria-pressed={(valor ?? []).includes(o)} onClick={() => onMudar(alternar(valor, o))}
          className={`rounded-full border px-2.5 py-1 text-xs ${(valor ?? []).includes(o) ? "border-primary bg-primary text-primary-foreground" : ""}`}>{o}</button>
      ))}
    </div>
  );
}

/** datetime-local (horário local do navegador) <-> ISO */
const paraLocal = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

interface Props {
  fluxoId: string;
  fluxoNome: string;
  aberto: boolean;
  gatilho: GatilhoFluxo | null; // null = novo
  config: ConfigFluxo | null | undefined;
  catalogo: CatalogoConstrutor | null;
  onFechar: () => void;
  onSalvar: (g: GatilhoFluxo) => void;
  onRemover?: () => void;
}

export function PainelGatilho({ fluxoId, fluxoNome, aberto, gatilho, config, catalogo, onFechar, onSalvar, onRemover }: Props) {
  const { fonte } = useFluxos();
  const fonteTags = { listar: fonte.tags, criar: fonte.criarTag };
  const [g, setG] = useState<GatilhoFluxo>(gatilho ?? novo("evento"));
  // erro só aparece depois de tentar salvar (antes, campo vazio é "ainda não escolhi", não erro)
  const [tentou, setTentou] = useState(false);
  useEffect(() => { if (aberto) { setG(gatilho ?? novo("evento")); setTentou(false); } }, [aberto, gatilho]);
  const erros = validarGatilho(g, 1, config).map((e) => e.replace(/^Gatilho 1: /, ""));
  const eventos = eventosParaEscolher(catalogo?.eventosVistos ?? []);
  const eventoAtual = g.tipo === "evento" ? eventos.find((e) => e.valor === g.valor) : undefined;
  const salvar = () => { if (erros.length) { setTentou(true); return; } onSalvar(g); };
  const segAlunas = (g.tipo === "segmento" || g.tipo === "data") && catalogo?.segmentos.find((s) => s.id === g.segmento_id)?.alunas;

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{gatilho ? "Editar gatilho" : "Adicionar gatilho"}</SheetTitle>
          <SheetDescription>Vários gatilhos funcionam com "Ou": qualquer um inscreve o contato.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-1"><Label>Quando</Label>
            <Select value={g.tipo} onValueChange={(v) => setG(novo(v as GatilhoFluxo["tipo"]))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(ROTULO_GATILHO) as GatilhoFluxo["tipo"][]).map((t) => <SelectItem key={t} value={t}>{ROTULO_GATILHO[t]}</SelectItem>)}</SelectContent>
            </Select></div>

          {g.tipo === "tag" && <div className="space-y-1"><Label>Tag</Label><SeletorTags valor={g.valor ? [g.valor] : []} onMudar={(t) => setG({ ...g, valor: t[0] ?? "" })} fonte={fonteTags} /></div>}

          {g.tipo === "etapa" && (
            <div className="space-y-1"><Label>Etapa</Label>
              <Select value={g.valor} onValueChange={(v) => setG({ ...g, valor: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><ItensEtapa incluir={g.valor} /></SelectContent>
              </Select></div>
          )}

          {g.tipo === "evento" && (
            <div className="space-y-1"><Label>Formulário / evento</Label>
              <Select value={g.valor || undefined} onValueChange={(v) => setG({ ...g, valor: v })}>
                <SelectTrigger aria-label="Evento"><SelectValue placeholder="Escolha o formulário ou evento" /></SelectTrigger>
                <SelectContent>
                  {eventos.map((e) => (
                    <SelectItem key={e.valor} value={e.valor}>
                      {e.rotulo}{!e.produtor && <span className="ml-1 text-muted-foreground">(sem produtor ligado)</span>}{e.total > 0 && <span className="ml-1 text-muted-foreground">· {e.total}</span>}
                    </SelectItem>
                  ))}
                  {g.valor && !eventos.some((e) => e.valor === g.valor) && <SelectItem value={g.valor}>{g.valor}</SelectItem>}
                </SelectContent>
              </Select>
              {eventoAtual && !eventoAtual.produtor && <p className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />Ninguém grava este evento ainda: o fluxo não dispara. Para compra do PagTrust use "Banco: Compra PagTrust".</p>}
              <p className="text-xs text-muted-foreground">Eventos "wh_..." chegam pela URL de entrada de algum fluxo (campo Evento do mapeamento). Para filtrar nível ou origem, use o gatilho "Novo lead no banco de dados".</p>
            </div>
          )}

          {g.tipo === "banco" && (
            <>
              <div className="space-y-1"><Label>Fonte</Label>
                <Select value={g.fonte} onValueChange={(v) => setG({ ...g, fonte: v as FonteBanco, niveis: [], origens: [] })}>
                  <SelectTrigger aria-label="Fonte"><SelectValue /></SelectTrigger>
                  <SelectContent>{FONTES_BANCO.map((f) => <SelectItem key={f} value={f}>{ROTULO_FONTE_BANCO[f].rotulo}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{ROTULO_FONTE_BANCO[g.fonte]?.ajuda}</p></div>
              {(g.fonte === "formulario" || g.fonte === "base_leads") && (
                <div className="space-y-1"><Label>Nível {g.fonte === "formulario" ? "da avaliação" : "(da lead na base)"}</Label>
                  <Chips rotulo="Nível" opcoes={NIVEIS_FORMULARIO} valor={g.niveis} onMudar={(v) => setG({ ...g, niveis: v })} />
                  <p className="text-xs text-muted-foreground">Nenhum marcado = qualquer nível.</p></div>
              )}
              {g.fonte === "formulario" && (
                <div className="space-y-1"><Label>Origem</Label>
                  <Chips rotulo="Origem" opcoes={ORIGENS_FORMULARIO} valor={g.origens} onMudar={(v) => setG({ ...g, origens: v })} /></div>
              )}
              {g.fonte === "base_leads" && (
                <div className="space-y-1"><Label>Origem na base</Label>
                  <Chips rotulo="Origem na base" opcoes={catalogo?.listas ?? []} valor={g.origens} onMudar={(v) => setG({ ...g, origens: v })} />
                  <p className="text-xs text-muted-foreground">Nenhuma marcada = qualquer origem.</p></div>
              )}
              <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">Só registros NOVOS, criados depois de publicar o fluxo (e de criar este gatilho). A base que já existe nunca entra por aqui; para ela use "Segmento / base de dados".</p>
            </>
          )}

          {g.tipo === "webhook" && <EntradaWebhook fluxoId={fluxoId} fluxoNome={fluxoNome} />}

          {g.tipo === "segmento" && (
            <>
              <div className="space-y-1"><Label>Base</Label>
                <Select value={g.segmento_id ? `s:${g.segmento_id}` : g.lista_origem ? `l:${g.lista_origem}` : ""}
                  onValueChange={(v) => setG({ ...g, segmento_id: v.startsWith("s:") ? v.slice(2) : null, lista_origem: v.startsWith("l:") ? v.slice(2) : null })}>
                  <SelectTrigger><SelectValue placeholder="Segmento salvo ou lista importada" /></SelectTrigger>
                  <SelectContent>
                    <div className="px-2 py-1 text-[11px] font-semibold uppercase text-muted-foreground">Segmentos (Banco de dados)</div>
                    {catalogo?.segmentos.map((s) => <SelectItem key={s.id} value={`s:${s.id}`}>{s.nome}</SelectItem>)}
                    <div className="px-2 py-1 text-[11px] font-semibold uppercase text-muted-foreground">Listas importadas</div>
                    {catalogo?.listas.map((l) => <SelectItem key={l} value={`l:${l}`}>{l}</SelectItem>)}
                  </SelectContent>
                </Select></div>
              <RadioGroup value={g.modo} onValueChange={(v) => setG({ ...g, modo: v as "todos" })} className="space-y-1.5">
                <label className="flex items-start gap-2 rounded-md border p-2.5 text-sm"><RadioGroupItem value="novos" className="mt-0.5" />
                  <span>Só os novos<span className="block text-xs text-muted-foreground">Fotografa a base ao publicar; entra só quem chegar depois.</span></span></label>
                <label className="flex items-start gap-2 rounded-md border p-2.5 text-sm"><RadioGroupItem value="todos" className="mt-0.5" />
                  <span>Inscrever todos agora<span className="block text-xs text-muted-foreground">A base já preenchida entra, no ritmo do limite por dia (e quem chegar depois também).</span></span></label>
              </RadioGroup>
            </>
          )}

          {g.tipo === "sem_resposta" && (
            <div className="space-y-1"><Label>Sem resposta há (horas)</Label>
              <Input type="number" min={1} max={1440} value={g.horas} onChange={(e) => setG({ ...g, horas: Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground">A última mensagem da conversa é nossa e a lead não respondeu nesse prazo. Silêncio de antes de publicar não conta.</p></div>
          )}

          {g.tipo === "data" && (
            <>
              <div className="space-y-1"><Label>Data e hora</Label>
                <Input type="datetime-local" value={paraLocal(g.em)} onChange={(e) => setG({ ...g, em: e.target.value ? new Date(e.target.value).toISOString() : "" })} /></div>
              <div className="space-y-1"><Label>Quem entra</Label>
                <Select value={g.segmento_id ? `s:${g.segmento_id}` : g.tag !== null ? "tag" : ""} onValueChange={(v) => setG({ ...g, segmento_id: v.startsWith("s:") ? v.slice(2) : null, tag: v === "tag" ? (g.tag ?? "") : null })}>
                  <SelectTrigger><SelectValue placeholder="Segmento ou tag" /></SelectTrigger>
                  <SelectContent>
                    {catalogo?.segmentos.map((s) => <SelectItem key={s.id} value={`s:${s.id}`}>{s.nome}</SelectItem>)}
                    <SelectItem value="tag">Quem tem a tag...</SelectItem>
                  </SelectContent>
                </Select>
                {g.tag !== null && !g.segmento_id && <SeletorTags valor={g.tag ? [g.tag] : []} onMudar={(t) => setG({ ...g, tag: t[0] ?? "" })} fonte={fonteTags} />}
              </div>
            </>
          )}

          {segAlunas && <p className="text-xs text-muted-foreground">Lista vem da Gestão de Alunas (plano vigente ou não, conforme o segmento), uma vez por telefone; quem não tem telefone fica de fora.</p>}
          {tentou && erros.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">{erros.map((e) => <p key={e}>{e}</p>)}</div>
          )}
        </div>
        <SheetFooter className="gap-2 sm:justify-between">
          {onRemover ? <Button variant="ghost" className="text-destructive" onClick={onRemover}>Remover gatilho</Button> : <span />}
          <Button onClick={salvar}>{gatilho ? "Salvar gatilho" : "Adicionar"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
