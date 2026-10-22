import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  db, chatIdGrupoValido, escolherGrupoModo, linkConviteValido, ocupacao, ocupacaoPct, pesoValido, permissaoGrupo,
  recontarCampanha, type CampanhaGrupos, type GrupoLinha,
} from "@/lib/grupos";
import { lerPermissoes } from "@/lib/disparoGrupos";
import { ImportarGrupos } from "@/components/crm/disparoGrupos/ImportarGrupos";
import { PermissaoBadge } from "@/components/crm/disparoGrupos/PermissaoBadge";

// Grupos de uma campanha: cadastrar (colando o link ou importando os que já existem no número), ordem,
// ativo/cheio, peso (modo split), ocupação (participantes + cliques desde a contagem, em % do limite),
// entradas/saídas, o que o número pode fazer em cada grupo e qual é o próximo do link.
export function GruposCampanha({ campanha }: { campanha: CampanhaGrupos }) {
  const { toast } = useToast();
  const [grupos, setGrupos] = useState<GrupoLinha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [link, setLink] = useState("");
  const [nome, setNome] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await db.from("grupos_campanha_grupos").select("*")
      .eq("campanha_id", campanha.id).order("ordem").order("created_at");
    if (error) toast({ title: "Erro ao carregar grupos", description: error.message, variant: "destructive" });
    setGrupos((data ?? []) as GrupoLinha[]);
    setCarregando(false);
  }, [campanha.id, toast]);

  useEffect(() => { setCarregando(true); carregar(); }, [carregar]);

  const split = campanha.modo_distribuicao === "split";
  const proximo = escolherGrupoModo(grupos, campanha.limite_por_grupo, campanha.modo_distribuicao);
  const pesoTotal = grupos.filter((g) => g.ativo && !g.cheio && g.link_convite).reduce((t, g) => t + pesoValido(g.peso ?? 1), 0);
  const proximaOrdem = grupos.reduce((m, g) => Math.max(m, g.ordem), -1) + 1;

  async function inserir(linha: { link_convite: string; nome: string; chat_id: string | null }) {
    const { error } = await db.from("grupos_campanha_grupos").insert({ campanha_id: campanha.id, ordem: proximaOrdem, ...linha });
    if (error) {
      toast({ title: "Não deu para adicionar", description: /duplicate|unique/i.test(error.message) ? "Esse link já está na campanha." : error.message, variant: "destructive" });
      return false;
    }
    await carregar();
    return true;
  }

  async function adicionarLink() {
    const l = link.trim();
    if (!linkConviteValido(l)) {
      toast({ title: "Link inválido", description: "Cole o convite: https://chat.whatsapp.com/XXXX", variant: "destructive" });
      return;
    }
    if (await inserir({ link_convite: l, nome: nome.trim(), chat_id: null })) { setLink(""); setNome(""); }
  }

  async function lerPermissoesDaCampanha() {
    const ids = grupos.map((g) => g.chat_id).filter((c): c is string => chatIdGrupoValido(c));
    if (!ids.length) { toast({ title: "Nenhum grupo com id (@g.us) para ler" }); return; }
    setOcupado("permissoes");
    try {
      let lidos = 0;
      for (let i = 0; i < ids.length; i += 20) {
        const r = await lerPermissoes(campanha.numero_id, ids.slice(i, i + 20));
        lidos += r.grupos.filter((x) => !x.erro).length;
        if (r.grupos.some((x) => x.erro?.includes("limite"))) break;
      }
      toast({ title: `Permissão lida em ${lidos} de ${ids.length} grupo(s)` });
      await carregar();
    } catch (e) {
      toast({ title: "Não deu para ler as permissões", description: (e as Error).message, variant: "destructive" });
    }
    setOcupado(null);
  }

  async function atualizar(id: string, patch: Partial<GrupoLinha>) {
    const { error } = await db.from("grupos_campanha_grupos").update(patch).eq("id", id);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    await carregar();
  }

  async function mover(i: number, d: -1 | 1) {
    const a = grupos[i], b = grupos[i + d];
    if (!a || !b) return;
    // renumera tudo na ordem nova (evita empate de ordem)
    const nova = [...grupos];
    nova[i] = b; nova[i + d] = a;
    for (let k = 0; k < nova.length; k++) {
      if (nova[k].ordem !== k) await db.from("grupos_campanha_grupos").update({ ordem: k }).eq("id", nova[k].id);
    }
    await carregar();
  }

  async function remover(g: GrupoLinha) {
    if (!confirm(`Tirar "${g.nome || g.link_convite || g.chat_id}" da campanha? O histórico de envio desse grupo some junto.`)) return;
    const { error } = await db.from("grupos_campanha_grupos").delete().eq("id", g.id);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    await carregar();
  }

  async function recontar() {
    setOcupado("recontar");
    try {
      const r = await recontarCampanha(campanha.id);
      toast({ title: `${r.recontados} grupo(s) recontado(s)` });
      await carregar();
    } catch (e) {
      toast({ title: "Não deu para recontar", description: (e as Error).message, variant: "destructive" });
    }
    setOcupado(null);
  }

  const jaTem = new Set(grupos.map((g) => g.chat_id).filter(Boolean));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[240px]">
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://chat.whatsapp.com/..." />
        </div>
        <div className="w-48"><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome (opcional)" /></div>
        <Button onClick={adicionarLink}><Plus className="h-4 w-4 mr-1" /> Colar link</Button>
        <Button variant="outline" onClick={lerPermissoesDaCampanha} disabled={ocupado === "permissoes"} title="Só leitura: o número é admin? só admins enviam?">
          {ocupado === "permissoes" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Ler permissões
        </Button>
        <Button variant="outline" onClick={recontar} disabled={ocupado === "recontar"} title="Ler a contagem de participantes agora">
          <RefreshCw className={`h-4 w-4 mr-1 ${ocupado === "recontar" ? "animate-spin" : ""}`} /> Recontar
        </Button>
      </div>

      <ImportarGrupos numeroId={campanha.numero_id} campanhaId={campanha.id} jaTem={jaTem} onImportado={() => carregar()} />

      {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : !grupos.length ? (
        <p className="text-sm text-muted-foreground">Nenhum grupo. Cole o link de convite ou escolha da sessão.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-2">#</th><th className="pr-2">Grupo</th><th className="pr-2">Ocupação</th>
                <th className="pr-2">Cliques</th><th className="pr-2">Entradas</th>{split && <th className="pr-2">Peso</th>}
                <th className="pr-2">Id (@g.us)</th><th className="pr-2">Ativo</th>
                <th className="pr-2">Cheio</th><th />
              </tr>
            </thead>
            <tbody>
              {grupos.map((g, i) => (
                <tr key={g.id} className="border-t align-top">
                  <td className="py-2 pr-2">{i + 1}</td>
                  <td className="pr-2 max-w-[220px]">
                    <div className="font-medium truncate">{g.nome || "(sem nome)"}</div>
                    {g.link_convite
                      ? <a href={g.link_convite} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground truncate block">{g.link_convite}</a>
                      : <span className="text-xs text-amber-600 block">sem convite: fora do link /g/ (recebe disparo)</span>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      <PermissaoBadge permissao={permissaoGrupo(g)} />
                      {g.importado && <Badge variant="secondary">importado</Badge>}
                      {g.criado_pelo_crm && <Badge variant="secondary">criado pelo CRM</Badge>}
                      {proximo?.id === g.id && <Badge>próximo do link</Badge>}
                    </div>
                  </td>
                  <td className="pr-2 whitespace-nowrap">
                    {ocupacao(g)} / {campanha.limite_por_grupo} <span className="text-xs text-muted-foreground">({ocupacaoPct(g, campanha.limite_por_grupo)}%)</span>
                    <div className="h-1.5 w-24 rounded bg-muted mt-1" aria-hidden><div className="h-1.5 rounded bg-primary" style={{ width: `${ocupacaoPct(g, campanha.limite_por_grupo)}%` }} /></div>
                    <div className="text-xs text-muted-foreground">
                      {g.participantes !== null ? `${g.participantes} na contagem` : "sem contagem"}
                    </div>
                  </td>
                  <td className="pr-2">{g.cliques}</td>
                  <td className="pr-2 whitespace-nowrap text-xs">+{g.entradas ?? 0} / -{g.saidas ?? 0}</td>
                  {split && (
                    <td className="pr-2">
                      <Input
                        className="h-7 w-16 text-xs" type="number" min={1} max={100} defaultValue={pesoValido(g.peso ?? 1)}
                        aria-label={`Peso de ${g.nome || "grupo"}`}
                        onBlur={(e) => { const v = pesoValido(e.target.value); if (v !== (g.peso ?? 1)) atualizar(g.id, { peso: v }); }}
                      />
                      {g.ativo && !g.cheio && g.link_convite && pesoTotal > 0 && (
                        <div className="text-xs text-muted-foreground">{Math.round((pesoValido(g.peso ?? 1) / pesoTotal) * 100)}% das entradas</div>
                      )}
                    </td>
                  )}
                  <td className="pr-2">
                    {g.chat_id ? <code className="text-xs">{g.chat_id}</code> : (
                      <Input
                        className="h-7 text-xs w-48"
                        placeholder="opcional, p/ disparo"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (!v) return;
                          if (!chatIdGrupoValido(v)) { toast({ title: "Id inválido", description: "Formato 120363...@g.us", variant: "destructive" }); return; }
                          atualizar(g.id, { chat_id: v });
                        }}
                      />
                    )}
                    {!g.chat_id && <div className="text-xs text-amber-600 mt-1">sem id: não recebe disparo</div>}
                  </td>
                  <td className="pr-2"><Switch checked={g.ativo} onCheckedChange={(v) => atualizar(g.id, { ativo: v })} /></td>
                  <td className="pr-2"><Switch checked={g.cheio} onCheckedChange={(v) => atualizar(g.id, { cheio: v })} /></td>
                  <td className="whitespace-nowrap">
                    <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => mover(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" disabled={i === grupos.length - 1} onClick={() => mover(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => remover(g)}><Trash2 className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!proximo && <p className="text-sm text-destructive mt-2">Todos os grupos estão lotados ou inativos: o link vai para a URL de reserva (se houver).</p>}
        </div>
      )}
    </div>
  );
}
