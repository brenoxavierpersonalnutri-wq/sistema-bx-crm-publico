import { useMemo, useState } from "react";
import { Download, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { listarGruposDaSessao, permissaoGrupo } from "@/lib/grupos";
import { campanhaAvulsa, importarGrupos, lerPermissoes, type PermissaoLida } from "@/lib/disparoGrupos";
import { PermissaoBadge } from "./PermissaoBadge";

interface GrupoDaSessao extends PermissaoLida { name: string | null }

// Importar grupos que JÁ EXISTEM no WhatsApp do número: lista pela sessão (rota de leitura `groups`), lê se o
// número é admin de cada um (group-info) e vincula os escolhidos a uma campanha (ou à "Avulsos" do número).
// Nada é alterado no WhatsApp aqui: só leitura e cadastro no CRM (que entra na allowlist do proxy).
export function ImportarGrupos({
  numeroId, campanhaId, jaTem, onImportado,
}: {
  numeroId: string | null;
  /** campanha de destino; null = Avulsos do número */
  campanhaId: string | null;
  jaTem: Set<string>;
  onImportado: (campanhaId: string) => void;
}) {
  const { toast } = useToast();
  const [grupos, setGrupos] = useState<GrupoDaSessao[] | null>(null);
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState<"" | "listar" | "permissoes" | "importar">("");

  async function listar() {
    setOcupado("listar");
    try {
      const r = await listarGruposDaSessao(numeroId);
      const lista: GrupoDaSessao[] = r.grupos.map((g) => ({ chatId: g.chatId, name: g.name }));
      setGrupos(lista);
      setMarcados(new Set());
      if (!lista.length) toast({ title: "Nenhum grupo recente neste número" });
      else await lerTodas(lista);
    } catch (e) {
      toast({ title: "Não deu para listar os grupos do número", description: (e as Error).message, variant: "destructive" });
    }
    setOcupado("");
  }

  async function lerTodas(lista: GrupoDaSessao[]) {
    setOcupado("permissoes");
    const mapa = new Map<string, PermissaoLida>();
    for (let i = 0; i < lista.length; i += 20) {
      try {
        const r = await lerPermissoes(numeroId, lista.slice(i, i + 20).map((g) => g.chatId));
        for (const p of r.grupos) mapa.set(p.chatId, p);
        if (r.grupos.some((p) => p.erro?.includes("limite"))) break;
      } catch (e) {
        toast({ title: "Não deu para ler as permissões", description: (e as Error).message, variant: "destructive" });
        break;
      }
    }
    setGrupos(lista.map((g) => ({ ...g, ...(mapa.get(g.chatId) ?? {}), name: mapa.get(g.chatId)?.name ?? g.name })));
  }

  async function importar() {
    if (!grupos || !marcados.size) return;
    setOcupado("importar");
    try {
      const destino = campanhaId ?? await campanhaAvulsa(numeroId);
      const escolhidos = grupos.filter((g) => marcados.has(g.chatId));
      const r = await importarGrupos(destino, numeroId, escolhidos.map((g) => ({
        chatId: g.chatId, name: g.name ?? null, souAdmin: g.souAdmin ?? null, announce: g.announce ?? null,
      })));
      const ok = r.filter((x) => x.ok);
      const falhas = r.filter((x) => !x.ok);
      toast({
        title: `${ok.length} grupo(s) vinculado(s)${campanhaId ? "" : " em Avulsos"}`,
        description: [
          ok.filter((x) => !x.comLink).length ? `${ok.filter((x) => !x.comLink).length} sem convite (fora do link /g/, mas recebem disparo)` : "",
          falhas.length ? `${falhas.length} não: ${falhas.map((f) => f.motivo).join("; ")}` : "",
        ].filter(Boolean).join(" · ") || undefined,
        variant: falhas.length && !ok.length ? "destructive" : undefined,
      });
      setMarcados(new Set());
      onImportado(destino);
    } catch (e) {
      toast({ title: "Não deu para importar", description: (e as Error).message, variant: "destructive" });
    }
    setOcupado("");
  }

  const visiveis = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (grupos ?? []).filter((g) => !b || (g.name ?? g.chatId).toLowerCase().includes(b));
  }, [grupos, busca]);

  const alternar = (id: string) => setMarcados((m) => {
    const n = new Set(m);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div className="rounded-md border p-3 space-y-2" data-testid="importar-grupos">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium flex-1 min-w-[200px]">Importar grupos que já existem no WhatsApp deste número</p>
        <Button size="sm" variant="outline" onClick={listar} disabled={Boolean(ocupado)}>
          {ocupado === "listar" || ocupado === "permissoes" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
          {grupos ? "Listar de novo" : "Listar grupos do número"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Só leitura no WhatsApp. Admin: dispara e configura (foto, descrição, nome, admins) e o convite entra no link da campanha.
        Não admin: só disparo, e só se o grupo deixar membros enviarem.
      </p>
      {grupos && (
        <>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar grupo pelo nome" />
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {visiveis.map((g) => {
              const ja = jaTem.has(g.chatId);
              return (
                <label key={g.chatId} className={`flex items-center gap-2 text-sm border rounded px-2 py-1 ${ja ? "opacity-60" : "cursor-pointer"}`}>
                  <Checkbox checked={marcados.has(g.chatId)} disabled={ja} onCheckedChange={() => alternar(g.chatId)} aria-label={`Selecionar ${g.name ?? g.chatId}`} />
                  <span className="truncate flex-1">{g.name || g.chatId}</span>
                  {typeof g.participants === "number" && <span className="text-xs text-muted-foreground">{g.participants} membros</span>}
                  {g.erro ? <span className="text-xs text-destructive">{g.erro}</span>
                    : <PermissaoBadge permissao={permissaoGrupo({ sou_admin: g.souAdmin, anuncio: g.announce })} />}
                  {ja && <span className="text-xs text-muted-foreground">já está</span>}
                </label>
              );
            })}
            {!visiveis.length && <p className="text-xs text-muted-foreground">Nada com esse nome.</p>}
          </div>
          <Button size="sm" onClick={importar} disabled={!marcados.size || Boolean(ocupado)}>
            {ocupado === "importar" && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Vincular {marcados.size || ""} {campanhaId ? "à campanha" : "em Avulsos"}
          </Button>
        </>
      )}
    </div>
  );
}
