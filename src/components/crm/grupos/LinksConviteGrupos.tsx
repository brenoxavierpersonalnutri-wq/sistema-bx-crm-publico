// Seção "Links de convite dos grupos" (Automação → Grupos e /crm/grupos): o admin cola o destino de cada
// slug, ativa, vê os cliques e copia a URL curta (equipe.brenoxavier.com.br/grupo/<slug> ou /ir/<slug>).
// Tabela crm_grupo_links (migration 20261104100000).
import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, Plus, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  avisoLink,
  criarLinkCurto,
  listarLinksCurtos,
  problemaLink,
  salvarLinkCurto,
  slugLinkValido,
  urlCurta,
  type LinkCurto,
  type TipoLinkCurto,
} from "@/lib/crmGrupoLinks";

function LinhaLink({ link, onSalvo }: { link: LinkCurto; onSalvo: () => void }) {
  const { toast } = useToast();
  const [url, setUrl] = useState(link.url ?? "");
  const [ativo, setAtivo] = useState(link.ativo);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { setUrl(link.url ?? ""); setAtivo(link.ativo); }, [link.url, link.ativo]);

  const alterado = (url.trim() || null) !== (link.url ?? null) || ativo !== link.ativo;
  const problema = problemaLink({ tipo: link.tipo, url, ativo });
  const aviso = avisoLink({ tipo: link.tipo, url });
  const curta = urlCurta(link.slug, link.tipo);

  const salvar = async () => {
    if (problema) return;
    setSalvando(true);
    const erro = await salvarLinkCurto({ slug: link.slug, nome: link.nome, url, ativo });
    setSalvando(false);
    if (erro) toast({ title: "Erro ao salvar", description: erro, variant: "destructive" });
    else { toast({ title: "Link salvo" }); onSalvo(); }
  };

  return (
    <div className="rounded-md border p-3 space-y-2" data-testid={`link-curto-${link.slug}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{link.nome || link.slug}</span>
        <Badge variant="outline">{link.tipo === "grupo" ? "grupo" : "link"}</Badge>
        <Badge variant={link.ativo ? "default" : "secondary"}>{link.ativo ? "ativo" : "inativo"}</Badge>
        <span className="text-xs text-muted-foreground">{link.cliques} clique{link.cliques === 1 ? "" : "s"}</span>
        <code className="ml-auto text-xs bg-muted px-2 py-1 rounded">{curta}</code>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { navigator.clipboard.writeText(`https://${curta}`); toast({ title: "URL curta copiada" }); }}
        >
          <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={link.tipo === "grupo" ? "https://chat.whatsapp.com/..." : "https://..."}
          className="flex-1 min-w-[220px]"
          aria-label={`Destino de ${link.slug}`}
        />
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={ativo} onCheckedChange={setAtivo} aria-label={`Ativar ${link.slug}`} /> Ativo
        </label>
        <Button size="sm" onClick={salvar} disabled={!alterado || !!problema || salvando}>
          {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <span className="ml-1.5">Salvar</span>
        </Button>
      </div>
      {problema && <p className="text-xs text-destructive">{problema}</p>}
      {!problema && aviso && <p className="text-xs text-amber-600">{aviso}</p>}
    </div>
  );
}

export function LinksConviteGrupos() {
  const { toast } = useToast();
  const [links, setLinks] = useState<LinkCurto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [novoSlug, setNovoSlug] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novoTipo, setNovoTipo] = useState<TipoLinkCurto>("grupo");

  const carregar = useCallback(async () => {
    const r = await listarLinksCurtos();
    setLinks(r.dados);
    setErro(r.erro);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const slugNovo = novoSlug.trim().toLowerCase();
  const criar = async () => {
    if (!slugLinkValido(slugNovo)) return;
    const e = await criarLinkCurto({ slug: slugNovo, nome: novoNome.trim(), tipo: novoTipo });
    if (e) toast({ title: "Erro ao criar", description: e, variant: "destructive" });
    else { setNovoSlug(""); setNovoNome(""); await carregar(); }
  };

  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <div>
        <h3 className="text-lg font-semibold">Links de convite dos grupos</h3>
        <p className="text-sm text-muted-foreground">
          URL curta para o botão do template oficial (a Meta não aceita chat.whatsapp.com direto no botão).
          Grupo abre em /grupo/&lt;slug&gt;; outros destinos em /ir/&lt;slug&gt;. Inativo ou sem link mostra "Link indisponível".
        </p>
      </div>
      {carregando && <Loader2 className="h-4 w-4 animate-spin" />}
      {erro && (
        <p className="text-sm text-destructive">
          Não consegui ler os links ({erro}). Se a tabela ainda não existe, falta rodar a migration 20261104100000_crm_grupo_links.sql.
        </p>
      )}
      {!carregando && !erro && !links.length && <p className="text-sm text-muted-foreground">Nenhum link cadastrado.</p>}
      <div className="space-y-2">
        {links.map((l) => <LinhaLink key={l.slug} link={l} onSalvo={carregar} />)}
      </div>
      {!erro && !carregando && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Input value={novoSlug} onChange={(e) => setNovoSlug(e.target.value)} placeholder="slug (ex.: vip)" className="w-36" aria-label="Novo slug" />
          <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="nome" className="w-44" aria-label="Novo nome" />
          <select
            value={novoTipo}
            onChange={(e) => setNovoTipo(e.target.value as TipoLinkCurto)}
            className="h-10 rounded-md border bg-background px-2 text-sm"
            aria-label="Tipo do novo link"
          >
            <option value="grupo">grupo (/grupo)</option>
            <option value="link">link (/ir)</option>
          </select>
          <Button size="sm" variant="outline" onClick={criar} disabled={!slugLinkValido(slugNovo)}>
            <Plus className="h-4 w-4" /><span className="ml-1.5">Novo link</span>
          </Button>
        </div>
      )}
    </section>
  );
}
