import { Copy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { linkPublico, numeroCriaGrupo, type CampanhaGrupos, type NumeroWhatsApp } from "@/lib/grupos";
import { CampanhaConfig } from "@/components/crm/grupos/CampanhaConfig";
import { GruposCampanha } from "@/components/crm/grupos/GruposCampanha";
import { FluxoGrupo } from "@/components/crm/grupos/FluxoGrupo";
import { LinksConviteGrupos } from "@/components/crm/grupos/LinksConviteGrupos";
import { nomeDoNumero } from "@/lib/disparoGrupos";

// Aba Campanhas: lista, criar/editar (nome, número, link /g/ com modo de distribuição, pausar link),
// grupos da campanha (novos e importados), evento/ritmo e regras de criação automática.
export function AbaCampanhas({
  campanhas, numeros, selecionada, criando, filtroNumero, onSelecionar, onNova, onSalvo, carregando,
}: {
  campanhas: CampanhaGrupos[];
  numeros: NumeroWhatsApp[];
  selecionada: CampanhaGrupos | null;
  criando: boolean;
  filtroNumero: string | null;
  onSelecionar: (id: string) => void;
  onNova: () => void;
  onSalvo: (id?: string) => Promise<void>;
  carregando: boolean;
}) {
  const { toast } = useToast();
  const visiveis = filtroNumero ? campanhas.filter((c) => c.numero_id === filtroNumero) : campanhas;
  const numeroDa = (c: CampanhaGrupos) => numeros.find((n) => n.id === c.numero_id);
  const atual = selecionada;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          <Button className="w-full" onClick={onNova}><Plus className="mr-2 h-4 w-4" /> Nova campanha</Button>
          {!carregando && !visiveis.length && <p className="text-sm text-muted-foreground">Nenhuma campanha ainda.</p>}
          {visiveis.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelecionar(c.id)}
              className={`w-full text-left rounded-md border p-3 hover:bg-muted/50 ${atual?.id === c.id && !criando ? "border-primary bg-muted/50" : ""}`}
            >
              <div className="font-medium truncate">{c.avulsa ? "Avulsos" : c.nome}</div>
              <div className="text-xs text-muted-foreground truncate">
                {c.avulsa ? "grupos importados sem campanha" : `/g/${c.slug}`} · {nomeDoNumero(numeros, c.numero_id)}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {c.modo_distribuicao === "split" && <Badge variant="secondary">split</Badge>}
                {!c.avulsa && (numeroCriaGrupo(numeroDa(c)?.sessao) ? <Badge variant="secondary">cria grupos</Badge> : <Badge variant="outline">não cria grupos</Badge>)}
                {c.encerrada && <Badge variant="secondary">encerrada</Badge>}
                {c.link_pausado && !c.avulsa && <Badge variant="outline">link pausado</Badge>}
                {c.disparos_pausados && <Badge variant="outline">disparos pausados</Badge>}
              </div>
            </button>
          ))}
        </div>

        <div className="min-w-0 space-y-4">
          {criando && (
            <CampanhaConfig campanha={null} numeros={numeros} numeroInicial={filtroNumero} onSalvo={(id) => onSalvo(id)} />
          )}
          {!criando && !atual && !carregando && <p className="text-sm text-muted-foreground">Escolha uma campanha ou crie uma nova.</p>}
          {!criando && atual && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">{atual.avulsa ? "Avulsos" : atual.nome}</h3>
                {!atual.avulsa && (
                  <>
                    <code className="text-xs bg-muted px-2 py-1 rounded">{linkPublico(atual.slug)}</code>
                    <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(linkPublico(atual.slug)); toast({ title: "Link copiado" }); }}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
                    </Button>
                    {atual.slug.startsWith("grupo-") && <span className="text-xs text-muted-foreground">também em /r/{atual.slug}</span>}
                  </>
                )}
              </div>
              <GruposCampanha key={`g-${atual.id}`} campanha={atual} />
              <details className="rounded-md border p-3" open={!atual.avulsa && !campanhas.length}>
                <summary className="cursor-pointer text-sm font-medium">Dados da campanha, link e distribuição</summary>
                <div className="pt-3">
                  <CampanhaConfig key={`c-${atual.id}-${atual.updated_at ?? ""}`} campanha={atual} numeros={numeros} onSalvo={() => onSalvo()} />
                </div>
              </details>
              {!atual.avulsa && (
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Evento, ritmo e criação automática de grupos</summary>
                  <div className="pt-3">
                    <FluxoGrupo
                      key={`f-${atual.id}-${atual.updated_at ?? ""}`}
                      campanha={atual}
                      partes={["evento", "criacao"]}
                      criaGrupo={numeroCriaGrupo(numeroDa(atual)?.sessao)}
                      onSalvo={() => { void onSalvo(); }}
                    />
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      </div>
      <LinksConviteGrupos />
    </div>
  );
}
