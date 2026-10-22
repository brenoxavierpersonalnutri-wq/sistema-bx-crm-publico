// Abas do construtor além do canvas: Configurações, Histórico de inscrição, Logs de execução, e o "Testar fluxo".
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  acharNo,
  fmtData,
  simularArvore,
  type CatalogoConstrutor,
  type ExecucaoLinha,
  type FluxoConstrutor,
  type LogLinha,
} from "@/lib/crm/fluxosConstrutor";
import { infoTipo, resumoNo } from "./CanvasFluxo";
import { useFluxos } from "./contexto";
import { ItensEtapa } from "@/components/crm/etapas/ItensEtapa";

const PADRAO = "__padrao__";

export function AbaConfiguracoes({ f, catalogo, onMudar }: { f: FluxoConstrutor; catalogo: CatalogoConstrutor | null; onMudar: (p: Partial<FluxoConstrutor>) => void }) {
  const cfg = f.config ?? {};
  const setCfg = (p: Partial<NonNullable<FluxoConstrutor["config"]>>) => onMudar({ config: { ...cfg, ...p } });
  const horas = Array.from({ length: 25 }, (_, i) => i);
  return (
    <div className="mx-auto max-w-2xl space-y-5 py-2">
      <section className="space-y-2 rounded-md border p-4">
        <h4 className="font-medium">Horário permitido</h4>
        <p className="text-xs text-muted-foreground">Mensagem que cair fora da janela espera a próxima abertura (horário de Brasília). Os limites do número continuam valendo.</p>
        <div className="flex items-center gap-2 text-sm">
          das
          <Select value={String(cfg.hora_inicio ?? 0)} onValueChange={(v) => setCfg({ hora_inicio: Number(v) })}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{horas.slice(0, 24).map((h) => <SelectItem key={h} value={String(h)}>{h}h</SelectItem>)}</SelectContent>
          </Select>
          às
          <Select value={String(cfg.hora_fim ?? 24)} onValueChange={(v) => setCfg({ hora_fim: Number(v) })}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{horas.slice(1).map((h) => <SelectItem key={h} value={String(h)}>{h}h</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </section>

      <section className="space-y-2 rounded-md border p-4">
        <h4 className="font-medium">Limite por dia</h4>
        <p className="text-xs text-muted-foreground">Máximo de contatos inscritos por dia neste fluxo. Obrigatório quando há gatilho por segmento/base ou por data.</p>
        <Input type="number" min={1} max={1000} className="w-32" value={cfg.limite_dia ?? ""} placeholder="sem limite"
          onChange={(e) => setCfg({ limite_dia: e.target.value ? Number(e.target.value) : null })} />
      </section>

      <section className="space-y-3 rounded-md border p-4">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span><span className="font-medium">Parar se a lead responder</span><span className="block text-xs text-muted-foreground">Ela saiu do automático: a conversa é com gente.</span></span>
          <Switch checked={f.parar_se_responder} onCheckedChange={(v) => onMudar({ parar_se_responder: v })} />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span><span className="font-medium">Permitir reentrada</span><span className="block text-xs text-muted-foreground">O mesmo contato pode entrar de novo depois de sair (nunca com uma execução em andamento).</span></span>
          <Switch checked={f.permitir_repetir} onCheckedChange={(v) => onMudar({ permitir_repetir: v })} />
        </label>
      </section>

      <section className="space-y-2 rounded-md border p-4">
        <Label className="font-medium">Número padrão</Label>
        <p className="text-xs text-muted-foreground">Usado pelos passos "Enviar WhatsApp" sem número próprio.</p>
        <Select value={f.numero_id ?? PADRAO} onValueChange={(v) => onMudar({ numero_id: v === PADRAO ? null : v })}>
          <SelectTrigger className="w-80"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={PADRAO}>Sessão padrão (closer)</SelectItem>
            {catalogo?.numeros.map((n) => <SelectItem key={n.id} value={n.id}>{n.apelido} · {n.tipo === "oficial" ? "oficial" : "não oficial"}</SelectItem>)}
          </SelectContent>
        </Select>
      </section>

      <section className="space-y-2 rounded-md border p-4">
        <Label className="font-medium">Descrição</Label>
        <Input value={f.descricao ?? ""} onChange={(e) => onMudar({ descricao: e.target.value })} placeholder="Para que serve este fluxo" />
      </section>
    </div>
  );
}

const STATUS: Record<string, { rotulo: string; cor: string }> = {
  ativo: { rotulo: "Em andamento", cor: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
  concluido: { rotulo: "Concluído", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  parado: { rotulo: "Parou (respondeu)", cor: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  erro: { rotulo: "Erro", cor: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
  cancelado: { rotulo: "Cancelado", cor: "bg-muted text-muted-foreground" },
};

export function AbaHistorico({ fluxoId, onVerLogs }: { fluxoId: string; onVerLogs: (phone: string) => void }) {
  const { fonte } = useFluxos();
  const { toast } = useToast();
  const [linhas, setLinhas] = useState<ExecucaoLinha[] | null>(null);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("todos");
  const carregar = () => fonte.historico(fluxoId).then(setLinhas).catch((e) => { setLinhas([]); toast({ title: "Histórico", description: String(e), variant: "destructive" }); });
  useEffect(() => { carregar(); }, [fluxoId]); // eslint-disable-line react-hooks/exhaustive-deps
  const vis = useMemo(() => (linhas ?? []).filter((l) => (status === "todos" || l.status === status)
    && (!busca || `${l.nome_contato ?? ""} ${l.contact_phone}`.toLowerCase().includes(busca.toLowerCase()))), [linhas, busca, status]);
  return (
    <div className="space-y-3 py-2">
      <div className="flex flex-wrap gap-2">
        <div className="relative w-64"><Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input className="h-8 pl-8" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou telefone" /></div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="todos">Todos os status</SelectItem>{Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.rotulo}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr><th className="p-2">Contato</th><th className="p-2">Status</th><th className="p-2">Passo</th><th className="p-2">Inscrito em</th><th className="p-2">Próxima ação</th><th className="p-2">Motivo</th><th className="p-2" /></tr>
          </thead>
          <tbody>
            {linhas === null && <tr><td colSpan={7} className="p-6 text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></td></tr>}
            {linhas !== null && !vis.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Ninguém inscrito ainda.</td></tr>}
            {vis.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-2"><span className="font-medium">{l.nome_contato || "Sem nome"}</span><span className="block text-xs text-muted-foreground">{l.contact_phone}</span></td>
                <td className="p-2"><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[l.status]?.cor ?? ""}`}>{STATUS[l.status]?.rotulo ?? l.status}</span></td>
                <td className="p-2 tabular-nums">{l.passo_idx + 1}{l.aguardando_resposta ? <span className="block text-xs text-muted-foreground">esperando resposta</span> : null}</td>
                <td className="p-2 text-xs whitespace-nowrap">{fmtData(l.iniciado_em)}</td>
                <td className="p-2 text-xs whitespace-nowrap">{l.status === "ativo" ? fmtData(l.proximo_em) : "-"}</td>
                <td className="p-2 text-xs text-muted-foreground">{l.motivo ?? ""}</td>
                <td className="p-2 text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" className="h-7" onClick={() => onVerLogs(l.contact_phone)}>Logs</Button>
                  {l.status === "ativo" && <Button variant="ghost" size="sm" className="h-7 text-destructive" onClick={async () => { await fonte.cancelarExecucao(l.id); carregar(); }}>Cancelar</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AbaLogs({ fluxoId, telefone, onTelefone }: { fluxoId: string; telefone: string; onTelefone: (t: string) => void }) {
  const { fonte } = useFluxos();
  const [linhas, setLinhas] = useState<LogLinha[] | null>(null);
  const [st, setSt] = useState("todos");
  useEffect(() => { fonte.logs(fluxoId).then(setLinhas).catch(() => setLinhas([])); }, [fluxoId, fonte]);
  const vis = (linhas ?? []).filter((l) => (st === "todos" || l.status === st) && (!telefone || l.contact_phone.includes(telefone.replace(/\D/g, ""))));
  return (
    <div className="space-y-3 py-2">
      <div className="flex flex-wrap gap-2">
        <div className="relative w-64"><Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input className="h-8 pl-8" value={telefone} onChange={(e) => onTelefone(e.target.value)} placeholder="Filtrar por telefone" /></div>
        <Select value={st} onValueChange={setSt}>
          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="todos">Tudo</SelectItem><SelectItem value="ok">Só ok</SelectItem><SelectItem value="erro">Só falhas</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr><th className="p-2">Quando</th><th className="p-2">Contato</th><th className="p-2">Canal</th><th className="p-2">Ação</th><th className="p-2">Resultado</th><th className="p-2">Detalhe</th></tr>
          </thead>
          <tbody>
            {linhas === null && <tr><td colSpan={6} className="p-6 text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></td></tr>}
            {linhas !== null && !vis.length && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Sem registros.</td></tr>}
            {vis.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-2 text-xs whitespace-nowrap">{fmtData(l.created_at)}</td>
                <td className="p-2 text-xs">{l.contact_phone}</td>
                <td className="p-2 text-xs">{l.canal === "oficial" ? "oficial" : l.canal === "whatsapp" ? "não oficial" : "CRM"}</td>
                <td className="p-2 text-xs">{l.tipo === "ia_followup" ? "Mensagem da IA" : l.tipo === "transferir_ia" ? "Transferir para agente IA" : l.tipo}</td>
                <td className="p-2">{l.status === "ok" ? <Badge variant="secondary">ok</Badge> : <Badge variant="destructive">falha</Badge>}</td>
                <td className="p-2 text-xs text-muted-foreground">{l.detalhe}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TestarFluxo({ aberto, onFechar, f, catalogo, onDestacar }: { aberto: boolean; onFechar: () => void; f: FluxoConstrutor; catalogo: CatalogoConstrutor | null; onDestacar: (ids: Set<string>) => void }) {
  const [respondeu, setRespondeu] = useState(false);
  const [tags, setTags] = useState("");
  const [etapa, setEtapa] = useState("leads");
  const [produto, setProduto] = useState("");
  const caminho = useMemo(() => simularArvore(f.arvore, {
    respondeu, etapa, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), dados: { produto },
  }), [f.arvore, respondeu, tags, etapa, produto]);
  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) { onDestacar(new Set()); onFechar(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Testar fluxo</DialogTitle>
          <DialogDescription>Simula um contato andando pelo fluxo. Nada é enviado e ninguém é inscrito.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-2 flex items-center justify-between rounded-md border p-2">A lead respondeu <Switch checked={respondeu} onCheckedChange={setRespondeu} /></label>
          <div className="space-y-1"><Label>Tags (vírgula)</Label><Input value={tags} onChange={(e) => setTags(e.target.value)} /></div>
          <div className="space-y-1"><Label>Etapa</Label>
            <Select value={etapa} onValueChange={setEtapa}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><ItensEtapa incluir={etapa} /></SelectContent></Select></div>
          <div className="col-span-2 space-y-1"><Label>dados.produto (do evento)</Label><Input value={produto} onChange={(e) => setProduto(e.target.value)} /></div>
        </div>
        <ol className="max-h-64 space-y-1 overflow-y-auto rounded-md bg-muted/50 p-3 text-sm">
          {caminho.map((c, i) => {
            const n = c.id === "fim" ? null : acharNo(f.arvore, c.id);
            return (
              <li key={`${c.id}-${i}`} className="flex gap-2">
                <span className="w-5 text-right text-xs text-muted-foreground">{i + 1}.</span>
                <span>{n ? <><b>{infoTipo(n.passo.tipo).rotulo}</b>{n.passo.tipo === "se" ? ` → ${c.texto.replace("Se: ", "")}` : ""} <span className="text-muted-foreground">{resumoNo(n.passo, catalogo)}</span></> : <b>FIM</b>}</span>
              </li>
            );
          })}
        </ol>
        <Button variant="outline" onClick={() => onDestacar(new Set(caminho.map((c) => c.id)))}>Destacar o caminho no canvas</Button>
      </DialogContent>
    </Dialog>
  );
}
