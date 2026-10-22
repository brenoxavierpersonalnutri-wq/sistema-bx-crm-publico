// Kanban = departamentos (parte C, 22/11/2026). As colunas são as mesmas abas de /crm/conversas (crm_departamentos),
// na mesma ordem e cor: criou/renomeou/excluiu lá, muda aqui (mesma tabela). Mais a coluna fixa "Em atendimento com
// IA" (regra: não se arrasta para dentro; arrastar para fora pede "Humano assume?") e "Sem departamento".
// Só conversas individuais do WhatsApp (sem grupo, sem Direct), um card por contato e número, sem números ocultos
// (a lista vem de useConversas, que já tira os ocultos e passa pelo RLS). 1000+ cards: cada coluna mostra 50 e
// carrega mais ao pedir (a contagem é a real).
import { memo, useMemo, useState, type DragEvent } from "react";
import { Bot, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { AvatarContato } from "@/components/crm/conversas/AvatarContato";
import { canalDoContato, contatoEhGrupo, nomeExibido, rotuloNumero, type ContatoCRM, type NumeroConversa } from "@/lib/crm/conversas";
import { iaAtendendo, type Departamento } from "@/lib/crm/departamentos";

export const POR_PAGINA_COLUNA = 50;
export const SEM_DEPARTAMENTO = "__sem__";

export interface ColunaKanban {
  id: string; // id do departamento ou SEM_DEPARTAMENTO
  nome: string;
  cor: string;
  ia: boolean;
  cards: ContatoCRM[];
}

/** Monta as colunas: departamentos ativos (na ordem), IA por regra, e "Sem departamento" no fim. Puro. */
export function montarColunasKanban(contatos: ContatoCRM[], departamentos: Departamento[], numeroId: string | null): ColunaKanban[] {
  const vistos = new Set<string>();
  const cards = contatos.filter((c) => {
    if (contatoEhGrupo(c) || canalDoContato(c) !== "whatsapp") return false;
    if (numeroId && c.numero_id !== numeroId) return false;
    const k = `${c.numero_id ?? ""}|${c.phone}`; // um card por contato e número
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  const ativos = departamentos.filter((d) => d.ativo);
  const idsManuais = new Set(ativos.filter((d) => d.regra === "manual").map((d) => d.id));
  const porId = new Map<string, ContatoCRM[]>();
  const ia: ContatoCRM[] = [];
  const sem: ContatoCRM[] = [];
  for (const c of cards) {
    if (iaAtendendo(c)) { ia.push(c); continue; }
    const d = c.departamento_id;
    if (d && idsManuais.has(d)) {
      const l = porId.get(d) ?? [];
      l.push(c);
      porId.set(d, l);
    } else sem.push(c); // sem departamento, ou num departamento desativado
  }
  const recentes = (l: ContatoCRM[]) => l.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  const colunas: ColunaKanban[] = ativos.map((d) => ({
    id: d.id, nome: d.nome, cor: d.cor, ia: d.regra === "ia", cards: recentes(d.regra === "ia" ? ia : porId.get(d.id) ?? []),
  }));
  colunas.push({ id: SEM_DEPARTAMENTO, nome: "Sem departamento", cor: "#94a3b8", ia: false, cards: recentes(sem) });
  return colunas;
}

interface Props {
  contatos: ContatoCRM[];
  departamentos: Departamento[];
  numeros: NumeroConversa[];
  carregando?: boolean;
  selecionadoId?: string | null;
  onAbrir: (c: ContatoCRM) => void;
  /** pode arrastar (ação "mover card" ou "transferir") */
  podeMover: boolean;
  /** pode assumir da IA (para arrastar para fora da coluna da IA) */
  podeAssumir: boolean;
  mover: (c: ContatoCRM, departamentoId: string | null) => Promise<void>;
  assumir: (c: ContatoCRM) => Promise<void>;
}

export function KanbanDepartamentos({
  contatos, departamentos, numeros, carregando, selecionadoId, onAbrir, podeMover, podeAssumir, mover, assumir,
}: Props) {
  const { toast } = useToast();
  const [numeroId, setNumeroId] = useState<string | null>(null);
  const [limite, setLimite] = useState<Record<string, number>>({});
  const [arrastado, setArrastado] = useState<ContatoCRM | null>(null);
  const [pedindo, setPedindo] = useState<{ c: ContatoCRM; destino: string | null } | null>(null);
  const colunas = useMemo(() => montarColunasKanban(contatos, departamentos, numeroId), [contatos, departamentos, numeroId]);

  const executar = async (c: ContatoCRM, destino: string | null, assumirAntes: boolean) => {
    try {
      if (assumirAntes) await assumir(c);
      await mover(c, destino);
    } catch (e) {
      toast({ title: "Não deu para mover", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const soltar = (coluna: ColunaKanban) => (ev: DragEvent) => {
    ev.preventDefault();
    const c = arrastado;
    setArrastado(null);
    if (!c || coluna.ia) return;
    const destino = coluna.id === SEM_DEPARTAMENTO ? null : coluna.id;
    if (iaAtendendo(c)) {
      if (!podeAssumir) {
        toast({ title: "A IA está atendendo", description: "Seu usuário não pode assumir da IA.", variant: "destructive" });
        return;
      }
      setPedindo({ c, destino });
      return;
    }
    if ((c.departamento_id ?? null) === destino) return;
    void executar(c, destino, false);
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {numeros.length > 1 && (
        <div className="px-3 pt-2 pb-1 shrink-0">
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span>Número</span>
            <select
              value={numeroId ?? ""}
              onChange={(e) => setNumeroId(e.target.value || null)}
              aria-label="Número do WhatsApp"
              data-testid="kanban-seletor-numero"
              className="h-8 min-w-48 rounded-lg bg-muted px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/20"
            >
              <option value="">Todos os números</option>
              {numeros.map((n) => <option key={n.id} value={n.id}>{n.apelido}</option>)}
            </select>
          </label>
        </div>
      )}
      <div className="flex-1 min-h-0 flex gap-3 overflow-x-auto p-2" data-testid="kanban-departamentos">
        {colunas.map((col) => {
          const max = limite[col.id] ?? POR_PAGINA_COLUNA;
          const visiveis = col.cards.slice(0, max);
          return (
            <div
              key={col.id}
              data-testid="kanban-coluna"
              data-coluna={col.id}
              className={`min-w-[272px] w-[272px] flex flex-col rounded-lg p-2.5 border border-border/50 ${col.ia ? "bg-violet-50/60 dark:bg-violet-950/20" : "bg-muted/30"}`}
              onDragOver={(ev) => { if (!col.ia && podeMover) ev.preventDefault(); }}
              onDrop={soltar(col)}
            >
              <div className="flex items-center justify-between mb-2 px-1">
                <h3 className="font-semibold text-sm flex items-center gap-2 min-w-0">
                  {col.ia ? <Bot className="h-4 w-4 shrink-0" style={{ color: col.cor }} /> : <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: col.cor }} aria-hidden />}
                  <span className="truncate">{col.nome}</span>
                </h3>
                <Badge variant="secondary" className="bg-background shadow-sm" data-testid="kanban-total">{col.cards.length}</Badge>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2">
                {carregando && col.cards.length === 0 ? (
                  <div className="py-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                ) : visiveis.map((c) => (
                  <CartaoKanban
                    key={c.id}
                    contato={c}
                    selecionado={selecionadoId === c.id}
                    numero={numeros.length > 1 && !numeroId ? rotuloNumero(numeros, c.numero_id) : null}
                    arrastavel={podeMover}
                    onArrastar={setArrastado}
                    onAbrir={onAbrir}
                  />
                ))}
                {col.cards.length > max && (
                  <button
                    type="button"
                    onClick={() => setLimite((l) => ({ ...l, [col.id]: max + POR_PAGINA_COLUNA }))}
                    className="w-full h-8 rounded-md text-xs text-muted-foreground hover:bg-muted"
                    data-testid="kanban-mais"
                  >
                    Mostrar mais ({col.cards.length - max})
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={!!pedindo} onOpenChange={(o) => { if (!o) setPedindo(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Humano assume?</AlertDialogTitle>
            <AlertDialogDescription>
              A IA está atendendo {pedindo ? nomeExibido(pedindo.c) : "esta conversa"}. Tirar daqui pausa a IA (só volta por
              follow-up ou "Devolver para IA") e você vira o atendente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const p = pedindo; setPedindo(null); if (p) void executar(p.c, p.destino, true); }}>
              Humano assume
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const CartaoKanban = memo(function CartaoKanban({
  contato, selecionado, numero, arrastavel, onArrastar, onAbrir,
}: {
  contato: ContatoCRM; selecionado: boolean; numero: string | null; arrastavel: boolean;
  onArrastar: (c: ContatoCRM | null) => void; onAbrir: (c: ContatoCRM) => void;
}) {
  return (
    <button
      type="button"
      draggable={arrastavel}
      onDragStart={() => onArrastar(contato)}
      onDragEnd={() => onArrastar(null)}
      onClick={() => onAbrir(contato)}
      data-testid="kanban-card"
      data-phone={contato.phone}
      className={`w-full text-left rounded-md border bg-card px-2.5 py-2 flex items-center gap-2.5 shadow-sm transition-colors ${
        selecionado ? "border-primary ring-1 ring-primary/40" : "border-border/60 hover:border-border"
      } ${arrastavel ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
    >
      <AvatarContato contato={contato} className="h-8 w-8" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium truncate">{nomeExibido(contato)}</span>
        <span className="block text-xs text-muted-foreground truncate">{numero ? `${numero} · ` : ""}{contato.phone}</span>
      </span>
    </button>
  );
});
