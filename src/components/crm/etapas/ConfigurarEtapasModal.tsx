// "Configurar etapas" do funil (Contatos e funil > engrenagem). Lê/grava public.crm_etapas:
// criar, renomear, cor, reordenar (setas) e arquivar/reativar. As 5 etapas padrão (sistema) só renomeiam e
// reordenam. Arquivar só sem contato: a tela avisa e o banco também barra (trigger crm_etapas_guarda).
// Escrita só para admin (RLS); aprovado vê em modo leitura.
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ArchiveRestore, Archive, ArrowDown, ArrowUp, Loader2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEtapas, type Etapa } from "@/hooks/useEtapas";
import { motivoNaoArquivar, moverEtapa, slugDeEtapa, validarEtapa } from "../../../../supabase/functions/_shared/etapas.ts";

// crm_etapas e ig_contatos estão fora do types.ts gerado
type Resposta = { data?: unknown; error: { message: string } | null; count?: number | null };
const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function contarContatos(slug: string): Promise<number> {
  let n = 0;
  for (const t of ["whatsapp_contacts", "ig_contatos"]) {
    try {
      const r: Resposta = await db.from(t).select("phone", { count: "exact", head: true }).eq("stage", slug);
      if (!r.error) n += r.count ?? 0;
    } catch {
      /* tabela ausente: conta zero */
    }
  }
  return n;
}

const COR_NOVA = "#0ea5e9";

export function ConfigurarEtapasModal({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const { etapas, tabelaOk, recarregar } = useEtapas();
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [contagem, setContagem] = useState<Record<string, number>>({});
  const [novoNome, setNovoNome] = useState("");
  const [novaCor, setNovaCor] = useState(COR_NOVA);
  const [ocupado, setOcupado] = useState(false);
  const [cores, setCores] = useState<Record<string, string>>({});
  const timersCor = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const podeEditar = isAdmin && tabelaOk === true;

  const ativas = etapas.filter((e) => e.ativo);
  const arquivadas = etapas.filter((e) => !e.ativo);

  const contar = useCallback(async () => {
    const pares = await Promise.all(etapas.map(async (e) => [e.slug, await contarContatos(e.slug)] as const));
    setContagem(Object.fromEntries(pares));
  }, [etapas]);

  useEffect(() => {
    if (!aberto) return;
    void recarregar();
  }, [aberto, recarregar]);
  useEffect(() => {
    if (!aberto) return;
    setNomes(Object.fromEntries(etapas.map((e) => [e.slug, e.nome])));
    setCores({});
    void contar();
  }, [aberto, etapas, contar]);

  const falhou = (msg: string) => toast({ title: "Não salvou", description: msg, variant: "destructive" });

  const gravar = async (slug: string, campos: Partial<Etapa>): Promise<boolean> => {
    const { error }: Resposta = await db.from("crm_etapas").update(campos).eq("slug", slug);
    if (error) {
      falhou(error.message);
      return false;
    }
    return true;
  };

  const executar = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    try {
      await fn();
    } finally {
      await recarregar();
      setOcupado(false);
    }
  };

  const renomear = (e: Etapa) => {
    const nome = (nomes[e.slug] ?? "").trim();
    if (nome === e.nome) return;
    const erros = validarEtapa({ ...e, nome }, etapas);
    if (erros.length) {
      falhou(erros.join(" "));
      setNomes((n) => ({ ...n, [e.slug]: e.nome }));
      return;
    }
    void executar(() => gravar(e.slug, { nome }));
  };

  // o seletor de cor dispara onChange enquanto arrasta: grava só quando para (400 ms)
  const mudarCor = (e: Etapa, cor: string) => {
    setCores((c) => ({ ...c, [e.slug]: cor }));
    clearTimeout(timersCor.current[e.slug]);
    timersCor.current[e.slug] = setTimeout(() => {
      if (cor !== e.cor) void executar(() => gravar(e.slug, { cor }));
    }, 400);
  };

  const mover = (e: Etapa, delta: -1 | 1) =>
    executar(async () => {
      const nova = moverEtapa(ativas, e.slug, delta);
      // arquivadas ficam depois das ativas
      const todas = [...nova, ...arquivadas.map((a, i) => ({ ...a, ordem: nova.length + i + 1 }))];
      for (const x of todas) {
        const atual = etapas.find((y) => y.slug === x.slug);
        if (atual && atual.ordem !== x.ordem && !(await gravar(x.slug, { ordem: x.ordem }))) return;
      }
    });

  const arquivar = (e: Etapa) =>
    executar(async () => {
      const n = await contarContatos(e.slug);
      const motivo = motivoNaoArquivar(e, n);
      if (motivo) {
        toast({ title: "Não dá para arquivar ainda", description: motivo, variant: "destructive" });
        return;
      }
      if (await gravar(e.slug, { ativo: false })) toast({ title: `"${e.nome}" arquivada` });
    });

  const reativar = (e: Etapa) =>
    executar(async () => {
      const ordem = Math.max(0, ...ativas.map((a) => a.ordem)) + 1;
      if (await gravar(e.slug, { ativo: true, ordem })) toast({ title: `"${e.nome}" reativada` });
    });

  const criar = () =>
    executar(async () => {
      const nome = novoNome.trim();
      const slug = slugDeEtapa(nome, etapas.map((e) => e.slug));
      const nova = { slug, nome, cor: novaCor, ordem: Math.max(0, ...etapas.map((e) => e.ordem)) + 1, ativo: true, sistema: false };
      const erros = validarEtapa(nova, etapas);
      if (erros.length) {
        falhou(erros.join(" "));
        return;
      }
      const { error }: Resposta = await db.from("crm_etapas").insert(nova);
      if (error) {
        falhou(error.message);
        return;
      }
      setNovoNome("");
      setNovaCor(COR_NOVA);
      toast({ title: `Etapa "${nome}" criada`, description: "Já aparece no funil, nos roteiros e nos fluxos." });
    });

  const linha = (e: Etapa, i: number, lista: Etapa[]) => (
    <li key={e.slug} className="flex items-center gap-2 rounded-md border bg-card p-2" data-testid={`etapa-${e.slug}`}>
      <input
        type="color"
        aria-label={`Cor de ${e.nome}`}
        value={cores[e.slug] ?? e.cor}
        disabled={!podeEditar || ocupado}
        onChange={(ev) => mudarCor(e, ev.target.value)}
        className="h-8 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0 disabled:cursor-not-allowed"
      />
      <Input
        aria-label={`Nome de ${e.nome}`}
        value={nomes[e.slug] ?? e.nome}
        maxLength={40}
        disabled={!podeEditar || ocupado}
        onChange={(ev) => setNomes((n) => ({ ...n, [e.slug]: ev.target.value }))}
        onBlur={() => renomear(e)}
        onKeyDown={(ev) => ev.key === "Enter" && (ev.target as HTMLInputElement).blur()}
        className="h-8"
      />
      {e.sistema && <Badge variant="secondary" title="Etapa padrão: renomeia e reordena, não arquiva">padrão</Badge>}
      <span className="w-14 shrink-0 text-right text-xs text-muted-foreground" title="Contatos nesta etapa">
        {contagem[e.slug] ?? "…"} cont.
      </span>
      {e.ativo ? (
        <>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Subir ${e.nome}`} disabled={!podeEditar || ocupado || i === 0} onClick={() => mover(e, -1)}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Descer ${e.nome}`} disabled={!podeEditar || ocupado || i === lista.length - 1} onClick={() => mover(e, 1)}>
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label={`Arquivar ${e.nome}`}
            title={e.sistema ? "Etapa padrão não é arquivada" : "Arquivar (só sem contatos)"}
            disabled={!podeEditar || ocupado || e.sistema}
            onClick={() => arquivar(e)}
          >
            <Archive className="h-4 w-4" />
          </Button>
        </>
      ) : (
        <Button size="sm" variant="outline" className="h-8" aria-label={`Reativar ${e.nome}`} disabled={!podeEditar || ocupado} onClick={() => reativar(e)}>
          <ArchiveRestore className="mr-1 h-4 w-4" /> Reativar
        </Button>
      )}
    </li>
  );

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar etapas do funil</DialogTitle>
          <DialogDescription>
            Valem para o quadro, os filtros e o seletor de etapa dos roteiros, e para os gatilhos e ações dos fluxos e
            automações. As 5 etapas padrão podem ser renomeadas e reordenadas. Para arquivar uma etapa, mova antes os contatos dela.
          </DialogDescription>
        </DialogHeader>

        {tabelaOk === false && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="alert">
            A tabela de etapas ainda não existe no banco (migration pendente). Por enquanto valem as 5 etapas padrão.
          </p>
        )}
        {tabelaOk === true && !isAdmin && (
          <p className="text-sm text-muted-foreground">Só administrador altera as etapas. Você está vendo em modo leitura.</p>
        )}

        <ol className="space-y-2">{ativas.map((e, i) => linha(e, i, ativas))}</ol>

        {podeEditar && (
          <div className="flex items-center gap-2 border-t pt-3">
            <input
              type="color"
              aria-label="Cor da nova etapa"
              value={novaCor}
              onChange={(ev) => setNovaCor(ev.target.value)}
              className="h-9 w-9 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <Input
              placeholder="Nova etapa (ex.: Proposta enviada)"
              aria-label="Nome da nova etapa"
              value={novoNome}
              maxLength={40}
              onChange={(ev) => setNovoNome(ev.target.value)}
              onKeyDown={(ev) => ev.key === "Enter" && novoNome.trim() && !ocupado && criar()}
            />
            <Button onClick={() => criar()} disabled={!novoNome.trim() || ocupado}>
              {ocupado ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />} Criar
            </Button>
          </div>
        )}

        {arquivadas.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium text-muted-foreground">Arquivadas</p>
            <ol className="space-y-2">{arquivadas.map((e, i) => linha(e, i, arquivadas))}</ol>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
