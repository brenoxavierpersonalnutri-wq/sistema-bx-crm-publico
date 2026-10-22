// Construtor de um fluxo (pegada do Builder do Full Funnel): cabeçalho com nome editável, abas Construtor /
// Configurações / Histórico de inscrição / Logs de execução, "Testar fluxo", alternância Rascunho ↔ Publicar e
// indicador "Salvo". Rascunho salva sozinho; fluxo publicado só salva no botão (muda o que está rodando).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Check, FlaskConical, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  FF_REFERENCIA,
  acharNo,
  errosPorNo,
  gatilhosDoFluxo,
  inserirNo,
  no,
  removerNo,
  trocarPasso,
  validarConstrutor,
  type CatalogoConstrutor,
  type FluxoConstrutor,
  type GatilhoFluxo,
} from "@/lib/crm/fluxosConstrutor";
import { CanvasFluxo } from "./CanvasFluxo";
import { PainelPasso, passoNovo } from "./PainelPasso";
import { PainelGatilho } from "./PainelGatilho";
import { AbaConfiguracoes, AbaHistorico, AbaLogs, TestarFluxo } from "./AbasFluxo";
import { useFluxos } from "./contexto";

type Aba = "construtor" | "configuracoes" | "historico" | "logs";
type EstadoSalvo = "salvo" | "salvando" | "pendente" | "erro";

export function ConstrutorFluxo() {
  const { id = "" } = useParams();
  const { fonte, base } = useFluxos();
  const { toast } = useToast();
  const [f, setF] = useState<FluxoConstrutor | null>(null);
  const [naoAchou, setNaoAchou] = useState(false);
  const [catalogo, setCatalogo] = useState<CatalogoConstrutor | null>(null);
  const [aba, setAba] = useState<Aba>("construtor");
  const [salvo, setSalvo] = useState<EstadoSalvo>("salvo");
  const [noAberto, setNoAberto] = useState<string | null>(null);
  const [gatilhoAberto, setGatilhoAberto] = useState<number | null | undefined>(undefined); // undefined = fechado; null = novo
  const [testar, setTestar] = useState(false);
  const [destaque, setDestaque] = useState<Set<string>>(new Set());
  const [errosPublicar, setErrosPublicar] = useState<string[] | null>(null);
  const [confirmarPublicar, setConfirmarPublicar] = useState(false);
  const [telefoneLogs, setTelefoneLogs] = useState("");
  const mudou = useRef(false);

  useEffect(() => {
    fonte.obter(id).then((x) => { if (x) setF(x); else setNaoAchou(true); }).catch(() => setNaoAchou(true));
    fonte.catalogo().then(setCatalogo).catch(() => setCatalogo(null));
  }, [id, fonte]);

  const salvar = useCallback(async (x: FluxoConstrutor) => {
    setSalvo("salvando");
    try {
      const updated_at = await fonte.salvar(x);
      mudou.current = false;
      setF((atual) => (atual ? { ...atual, updated_at } : atual));
      setSalvo("salvo");
    } catch (e) {
      setSalvo("erro");
      toast({ title: "Não salvou", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }, [fonte, toast]);

  // rascunho: salva sozinho 1,2 s depois da última mudança
  useEffect(() => {
    if (!f || !mudou.current || f.ativo) return;
    const t = window.setTimeout(() => salvar(f), 1200);
    return () => window.clearTimeout(t);
  }, [f, salvar]);

  const mudar = (p: Partial<FluxoConstrutor>) => {
    mudou.current = true;
    setSalvo("pendente");
    setF((x) => (x ? { ...x, ...p } : x));
  };

  const gatilhos = useMemo(() => (f ? gatilhosDoFluxo(f) : []), [f]);
  const erros = useMemo(() => (f ? errosPorNo(f.arvore, f.numero_id, catalogo?.numeros ?? [], catalogo?.templates ?? [], catalogo?.agentes) : {}), [f, catalogo]);
  const noSel = f && noAberto ? acharNo(f.arvore, noAberto) : null;

  if (naoAchou) return <div className="p-6 text-sm">Fluxo não encontrado. <Link className="underline" to={base}>Voltar para a lista</Link></div>;
  if (!f) return <div className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando fluxo...</div>;

  const ff = f.origem_ff_workflow_id ? FF_REFERENCIA[f.origem_ff_workflow_id] : undefined;

  const pedirPublicar = () => {
    const e = validarConstrutor({ ...f, gatilhos }, { numeros: catalogo?.numeros ?? [], templates: catalogo?.templates ?? [], agentes: catalogo?.agentes });
    if (e.length) { setErrosPublicar(e); return; }
    setConfirmarPublicar(true);
  };
  const publicar = async (ativo: boolean) => {
    try {
      if (mudou.current || ativo) await salvar(f);
      await fonte.publicar(f.id, ativo);
      setF({ ...f, ativo });
      toast({ title: ativo ? "Fluxo publicado" : "Voltou para rascunho", description: ativo ? "Vale para gatilhos a partir de agora." : "Execuções em andamento ficam paradas até publicar de novo." });
    } catch (e) {
      toast({ title: "Não deu certo", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };
  const salvarGatilhos = (lista: GatilhoFluxo[]) => mudar({ gatilhos: lista });
  const temBase = gatilhos.some((g) => g.tipo === "segmento" || g.tipo === "data" || (g.tipo === "banco" && (g.fonte === "base_leads" || g.fonte === "contato_whatsapp")));

  return (
    <div className="space-y-2 px-3 py-3 md:px-5">
      <header className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild aria-label="Voltar para a lista"><Link to={base}><ArrowLeft className="h-4 w-4" /></Link></Button>
        <input value={f.nome} onChange={(e) => mudar({ nome: e.target.value })} aria-label="Nome do fluxo" maxLength={120}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-lg font-semibold tracking-tight hover:border-border focus:border-primary focus:outline-none" />
        {ff && <span className="text-xs text-muted-foreground">no Full Funnel: {ff.inscritos} inscritos</span>}
        <span className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
          {salvo === "salvando" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Salvando...</>
            : salvo === "pendente" ? (f.ativo ? "Alterações não salvas" : "Editando...")
            : salvo === "erro" ? <span className="text-destructive">Não salvou</span>
            : <><Check className="h-3.5 w-3.5 text-emerald-600" />Salvo</>}
        </span>
        {f.ativo && salvo === "pendente" && (
          <Button size="sm" className="h-8" onClick={() => salvar(f)}><Save className="h-4 w-4" /><span className="ml-1.5">Salvar alterações</span></Button>
        )}
        <Button variant="outline" size="sm" className="h-8" onClick={() => setTestar(true)}><FlaskConical className="h-4 w-4" /><span className="ml-1.5">Testar fluxo</span></Button>
        <div className="flex items-center rounded-md border p-0.5 text-sm" role="group" aria-label="Status do fluxo">
          <button onClick={() => f.ativo && publicar(false)} aria-pressed={!f.ativo}
            className={`rounded px-2.5 py-1 ${!f.ativo ? "bg-muted font-medium" : "text-muted-foreground"}`}>Rascunho</button>
          <button onClick={() => !f.ativo && pedirPublicar()} aria-pressed={f.ativo}
            className={`rounded px-2.5 py-1 ${f.ativo ? "bg-emerald-500 font-semibold text-[#0f1115]" : "text-muted-foreground"}`}>Publicar</button>
        </div>
        {fonte.demo && <Badge variant="outline">dados fictícios</Badge>}
      </header>

      <nav className="flex gap-1 border-b" role="tablist">
        {([["construtor", "Construtor"], ["configuracoes", "Configurações"], ["historico", "Histórico de inscrição"], ["logs", "Logs de execução"]] as [Aba, string][]).map(([k, r]) => (
          <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === k ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{r}</button>
        ))}
      </nav>

      {aba === "construtor" && (
        <CanvasFluxo
          gatilhos={gatilhos}
          arvore={f.arvore}
          catalogo={catalogo}
          erros={erros}
          destaque={destaque}
          canvas={f.canvas ?? {}}
          onCanvas={(c) => fonte.salvarCanvas(f.id, c)}
          onAbrirGatilho={(i) => setGatilhoAberto(i)}
          onAbrirNo={setNoAberto}
          onInserir={(caminho, pos, tipo) => {
            const n = no(passoNovo(tipo, null));
            mudar({ arvore: inserirNo(f.arvore, caminho, pos, n) });
            if (tipo !== "parar") setNoAberto(n.id);
          }}
          onRemover={(nid) => mudar({ arvore: removerNo(f.arvore, nid) })}
        />
      )}
      {aba === "configuracoes" && <AbaConfiguracoes f={f} catalogo={catalogo} onMudar={mudar} />}
      {aba === "historico" && <AbaHistorico fluxoId={f.id} onVerLogs={(t) => { setTelefoneLogs(t); setAba("logs"); }} />}
      {aba === "logs" && <AbaLogs fluxoId={f.id} telefone={telefoneLogs} onTelefone={setTelefoneLogs} />}

      <PainelPasso
        passo={noSel?.passo ?? null}
        catalogo={catalogo}
        numeroPadrao={f.numero_id ?? null}
        fluxoId={f.id}
        onFechar={() => setNoAberto(null)}
        onSalvar={(p) => { if (noAberto) mudar({ arvore: trocarPasso(f.arvore, noAberto, p) }); setNoAberto(null); }}
        onRemover={() => { if (noAberto) mudar({ arvore: removerNo(f.arvore, noAberto) }); setNoAberto(null); }}
      />
      <PainelGatilho
        fluxoId={f.id}
        fluxoNome={f.nome}
        aberto={gatilhoAberto !== undefined}
        gatilho={typeof gatilhoAberto === "number" ? gatilhos[gatilhoAberto] ?? null : null}
        config={f.config}
        catalogo={catalogo}
        onFechar={() => setGatilhoAberto(undefined)}
        onSalvar={(g) => {
          salvarGatilhos(typeof gatilhoAberto === "number" ? gatilhos.map((x, i) => (i === gatilhoAberto ? g : x)) : [...gatilhos, g]);
          setGatilhoAberto(undefined);
        }}
        onRemover={typeof gatilhoAberto === "number" ? () => { salvarGatilhos(gatilhos.filter((_, i) => i !== gatilhoAberto)); setGatilhoAberto(undefined); } : undefined}
      />
      <TestarFluxo aberto={testar} onFechar={() => setTestar(false)} f={f} catalogo={catalogo} onDestacar={(s) => { setDestaque(s); if (s.size) setTestar(false); }} />

      <AlertDialog open={errosPublicar !== null} onOpenChange={(v) => !v && setErrosPublicar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Falta ajustar antes de publicar</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <ul className="list-disc space-y-1 pl-5 text-sm">{(errosPublicar ?? []).map((e) => <li key={e}>{e}</li>)}</ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogAction onClick={() => setErrosPublicar(null)}>Entendi</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmarPublicar} onOpenChange={setConfirmarPublicar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publicar "{f.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Gatilhos de evento, tag e etapa valem a partir de agora (no máximo 24 h para trás).
              {temBase && ` Gatilho por base/data inscreve até ${f.config?.limite_dia ?? "?"} contatos por dia.`}
              {ff && " Este fluxo espelha um workflow do Full Funnel: desligue lá antes, senão a lead recebe duas vezes."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => publicar(true)}>Publicar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
