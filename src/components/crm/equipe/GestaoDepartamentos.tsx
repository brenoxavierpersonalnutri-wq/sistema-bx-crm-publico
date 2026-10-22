// Gestão de departamentos (Gestão de equipe > Departamentos): cadastrar, editar nome/cor, ativar/desativar,
// excluir (com confirmação), ligar números e IMPORTAR a lista (ex.: departamentos da SellFlux), colando JSON ou
// uma linha por departamento ("Nome" ou "Nome;#cor"). Os mesmos departamentos são as abas de Conversas e as
// colunas do Kanban.
import { useEffect, useMemo, useState } from "react";
import { Bot, Lock, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  criarDepartamento, editarDepartamento, excluirDepartamento, importarDepartamentos, useDepartamentos,
} from "@/hooks/useCrmEquipe";
import { CORES_DEPARTAMENTO, lerListaDepartamentos, type Departamento } from "@/lib/crm/departamentos";
import type { NumeroRef } from "@/lib/crm/acesso";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

export function GestaoDepartamentos({ numeros }: { numeros: NumeroRef[] }) {
  const { toast } = useToast();
  const departamentos = useDepartamentos();
  const [novo, setNovo] = useState("");
  const [lista, setLista] = useState("");
  const [excluindo, setExcluindo] = useState<Departamento | null>(null);
  const [ligacoes, setLigacoes] = useState<{ departamento_id: string; numero_id: string }[]>([]);
  const previa = useMemo(() => lerListaDepartamentos(lista), [lista]);

  const erro = (e: unknown) => toast({ title: "Departamentos", description: e instanceof Error ? e.message : String(e), variant: "destructive" });

  const lerLigacoes = async () => {
    const { data } = await db.from("crm_departamento_numeros").select("departamento_id, numero_id");
    setLigacoes((data ?? []) as { departamento_id: string; numero_id: string }[]);
  };
  useEffect(() => { void lerLigacoes(); }, []);

  const ligar = async (dep: string, num: string, ligado: boolean) => {
    try {
      const r = ligado
        ? await db.from("crm_departamento_numeros").insert({ departamento_id: dep, numero_id: num })
        : await db.from("crm_departamento_numeros").delete().eq("departamento_id", dep).eq("numero_id", num);
      if (r.error) throw new Error(r.error.message);
      await lerLigacoes();
    } catch (e) { erro(e); }
  };

  const criar = async () => {
    if (!novo.trim()) return;
    try {
      await criarDepartamento(novo, CORES_DEPARTAMENTO[(departamentos.length + 1) % CORES_DEPARTAMENTO.length]);
      setNovo("");
    } catch (e) { erro(e); }
  };

  const importar = async () => {
    try {
      const n = await importarDepartamentos(previa);
      toast({ title: "Departamentos importados", description: `${n} departamento(s) criados ou atualizados. Nenhum foi apagado.` });
      setLista("");
    } catch (e) { erro(e); }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex gap-2">
          <Input value={novo} onChange={(e) => setNovo(e.target.value)} maxLength={60} placeholder="Novo departamento (ex.: Comercial)"
            aria-label="Nome do novo departamento" onKeyDown={(e) => { if (e.key === "Enter") void criar(); }} />
          <Button onClick={criar} disabled={!novo.trim()}>Criar</Button>
        </div>
        <div className="rounded-lg border divide-y">
          {departamentos.map((d) => (
            <div key={d.id} className="px-3 py-2.5 space-y-2" data-testid="linha-departamento">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={d.cor}
                  aria-label={`Cor de ${d.nome}`}
                  onChange={(e) => editarDepartamento(d.id, { cor: e.target.value }).catch(erro)}
                  className="h-7 w-7 rounded border-0 bg-transparent p-0"
                />
                {d.regra === "ia" && <Bot className="h-4 w-4 text-muted-foreground" />}
                <Input
                  defaultValue={d.nome}
                  maxLength={60}
                  aria-label={`Nome de ${d.nome}`}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== d.nome) editarDepartamento(d.id, { nome: v }).catch(erro); }}
                  className="h-8"
                />
                {d.fixo ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap" title="Regra automática: não exclui"><Lock className="h-3.5 w-3.5" /> fixo</span>
                ) : (
                  <>
                    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
                      <Switch checked={d.ativo} aria-label={`${d.nome} ativo`} onCheckedChange={(c) => editarDepartamento(d.id, { ativo: c }).catch(erro)} /> ativo
                    </label>
                    <Button variant="ghost" size="icon" aria-label={`Excluir ${d.nome}`} onClick={() => setExcluindo(d)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
              {d.regra === "manual" && numeros.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 pl-9 text-xs text-muted-foreground">
                  <span>Conversa nova destes números entra aqui:</span>
                  {numeros.map((n) => (
                    <label key={n.id} className="inline-flex items-center gap-1.5">
                      <Checkbox
                        checked={ligacoes.some((l) => l.departamento_id === d.id && l.numero_id === n.id)}
                        aria-label={`${n.apelido} em ${d.nome}`}
                        onCheckedChange={(c) => ligar(d.id, n.id, c === true)}
                      />
                      {n.apelido}
                    </label>
                  ))}
                </div>
              )}
              {d.etapa_origem && <p className="pl-9 text-xs text-muted-foreground">Veio da etapa "{d.etapa_origem}": mover a conversa para cá também muda a etapa.</p>}
            </div>
          ))}
          {departamentos.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">Nenhum departamento (rode as migrations de permissões).</p>}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Upload className="h-4 w-4" /> Importar lista</h3>
        <p className="text-xs text-muted-foreground">
          Cole a lista (por exemplo, os departamentos da SellFlux): JSON <code>[{"{"}"nome":"Comercial","cor":"#2563eb"{"}"}]</code> ou um por linha,
          <code> Nome</code> ou <code>Nome;#cor</code>. Casa pelo nome; não apaga nenhum que já existe.
        </p>
        <textarea
          value={lista}
          onChange={(e) => setLista(e.target.value)}
          rows={5}
          aria-label="Lista de departamentos para importar"
          className="w-full rounded-md border bg-background p-2 text-sm font-mono"
          placeholder={"Comercial;#2563eb\nSuporte;#16a34a\nCS"}
        />
        <div className="flex items-center gap-3">
          <Button onClick={importar} disabled={previa.length === 0}>Importar {previa.length || ""}</Button>
          {previa.length > 0 && <span className="text-xs text-muted-foreground truncate">{previa.map((p) => p.nome).join(", ")}</span>}
        </div>
      </section>

      <AlertDialog open={!!excluindo} onOpenChange={(o) => { if (!o) setExcluindo(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o departamento "{excluindo?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>
              As conversas dele ficam sem departamento e continuam aparecendo em "Tudo". A aba e a coluna do Kanban somem.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { const d = excluindo; setExcluindo(null); if (d) excluirDepartamento(d.id).catch(erro); }}
            >Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
