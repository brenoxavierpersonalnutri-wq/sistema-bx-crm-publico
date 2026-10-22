// Abas de departamento na lista de conversas (depois de Tudo · Não lidas · Grupos, que são fixas).
// Admin: "+" cria; lápis ou botão direito edita (nome, cor) e exclui (com confirmação); arrastar reordena.
// "Em atendimento com IA" é regra e fixa: edita nome/cor, não exclui. Excluir um departamento deixa as conversas
// dele sem departamento (continuam em "Tudo").
import { useState, type DragEvent } from "react";
import { Bot, Pencil, Plus, Trash2 } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CORES_DEPARTAMENTO, reordenar, type Departamento } from "@/lib/crm/departamentos";
import type { FiltroConversa } from "@/lib/crm/conversas";

export interface AcoesDepartamento {
  criar: (nome: string, cor: string) => Promise<void>;
  editar: (id: string, patch: { nome: string; cor: string }) => Promise<void>;
  excluir: (id: string) => Promise<void>;
  reordenar: (lista: Departamento[]) => Promise<void>;
}

interface Props {
  departamentos: Departamento[];
  filtro: FiltroConversa;
  onFiltro: (f: FiltroConversa) => void;
  /** contagem por aba (opcional) */
  contagem?: Record<string, number>;
  /** admin: cria, edita, exclui e reordena */
  acoes?: AcoesDepartamento;
  onErro?: (msg: string) => void;
}

type Edicao = { id: string | null; nome: string; cor: string };

export function AbasDepartamentos({ departamentos, filtro, onFiltro, contagem, acoes, onErro }: Props) {
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [excluindo, setExcluindo] = useState<Departamento | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const ativos = departamentos.filter((d) => d.ativo);

  const salvar = async () => {
    if (!edicao || !acoes || !edicao.nome.trim()) return;
    setSalvando(true);
    try {
      if (edicao.id) await acoes.editar(edicao.id, { nome: edicao.nome.trim(), cor: edicao.cor });
      else await acoes.criar(edicao.nome.trim(), edicao.cor);
      setEdicao(null);
    } catch (e) {
      onErro?.(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  };

  const confirmarExclusao = async () => {
    if (!excluindo || !acoes) return;
    const d = excluindo;
    setExcluindo(null);
    try {
      await acoes.excluir(d.id);
      if (filtro === `dep:${d.id}`) onFiltro("tudo");
    } catch (e) {
      onErro?.(e instanceof Error ? e.message : String(e));
    }
  };

  const soltar = (para: string) => (ev: DragEvent) => {
    ev.preventDefault();
    const de = arrastando;
    setArrastando(null);
    if (!acoes || !de || de === para) return;
    acoes.reordenar(reordenar(ativos, de, para)).catch((e) => onErro?.(e instanceof Error ? e.message : String(e)));
  };

  return (
    <>
      {ativos.map((d) => {
        const ativo = filtro === `dep:${d.id}`;
        const n = contagem?.[d.id];
        const aba = (
          <button
            key={d.id}
            type="button"
            role="tab"
            aria-selected={ativo}
            data-testid="aba-departamento"
            data-departamento={d.id}
            draggable={!!acoes}
            onDragStart={() => setArrastando(d.id)}
            onDragOver={(ev) => { if (acoes) ev.preventDefault(); }}
            onDrop={soltar(d.id)}
            onClick={() => onFiltro(`dep:${d.id}`)}
            className={`group shrink-0 h-8 rounded-full pl-2.5 pr-3 text-sm whitespace-nowrap transition-colors inline-flex items-center gap-1.5 ${
              ativo ? "bg-success/15 text-success font-medium" : "bg-muted text-muted-foreground hover:bg-muted/70"
            } ${arrastando === d.id ? "opacity-50" : ""}`}
          >
            {d.regra === "ia" ? <Bot className="h-3.5 w-3.5" style={{ color: d.cor }} /> : <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.cor }} />}
            {d.nome}{n ? ` ${n}` : ""}
            {acoes && (
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Editar ${d.nome}`}
                onClick={(ev) => { ev.stopPropagation(); setEdicao({ id: d.id, nome: d.nome, cor: d.cor }); }}
                className="hidden group-hover:inline-flex ml-0.5 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-3 w-3" />
              </span>
            )}
          </button>
        );
        if (!acoes) return aba;
        return (
          <ContextMenu key={d.id}>
            <ContextMenuTrigger asChild>{aba}</ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => setEdicao({ id: d.id, nome: d.nome, cor: d.cor })}>
                <Pencil className="h-4 w-4 mr-2" /> Editar nome e cor
              </ContextMenuItem>
              {!d.fixo && (
                <ContextMenuItem onSelect={() => setExcluindo(d)} className="text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" /> Excluir departamento
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      {acoes && (
        <button
          type="button"
          aria-label="Criar departamento"
          title="Criar departamento"
          data-testid="criar-departamento"
          onClick={() => setEdicao({ id: null, nome: "", cor: CORES_DEPARTAMENTO[(ativos.length + 1) % CORES_DEPARTAMENTO.length] })}
          className="shrink-0 h-8 w-8 rounded-full bg-muted text-muted-foreground hover:bg-muted/70 inline-flex items-center justify-center"
        >
          <Plus className="h-4 w-4" />
        </button>
      )}

      <Dialog open={!!edicao} onOpenChange={(o) => { if (!o) setEdicao(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{edicao?.id ? "Editar departamento" : "Novo departamento"}</DialogTitle></DialogHeader>
          {edicao && (
            <div className="space-y-3">
              <Input
                autoFocus
                value={edicao.nome}
                maxLength={60}
                placeholder="Ex.: Comercial, Suporte, CS"
                aria-label="Nome do departamento"
                onChange={(e) => setEdicao({ ...edicao, nome: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") void salvar(); }}
              />
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor">
                {CORES_DEPARTAMENTO.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={edicao.cor === c}
                    aria-label={`Cor ${c}`}
                    onClick={() => setEdicao({ ...edicao, cor: c })}
                    className={`h-7 w-7 rounded-full border-2 ${edicao.cor === c ? "border-foreground" : "border-transparent"}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            {edicao?.id && !departamentos.find((d) => d.id === edicao.id)?.fixo && (
              <Button variant="ghost" className="mr-auto text-destructive" onClick={() => {
                const d = departamentos.find((x) => x.id === edicao.id) ?? null;
                setEdicao(null);
                setExcluindo(d);
              }}>Excluir</Button>
            )}
            <Button variant="outline" onClick={() => setEdicao(null)}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando || !edicao?.nome.trim()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!excluindo} onOpenChange={(o) => { if (!o) setExcluindo(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o departamento "{excluindo?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>
              As conversas dele ficam sem departamento e continuam aparecendo em "Tudo". Nada é apagado das conversas.
              A coluna some também do Kanban.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarExclusao} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
