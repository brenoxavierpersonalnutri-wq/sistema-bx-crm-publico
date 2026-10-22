import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  db, permissaoGrupo, podeConfigurar, subirMidia, telefoneAdmin, type CampanhaGrupos, type GrupoLinha,
} from "@/lib/grupos";
import { configurarGrupo, problemasConfiguracao, type AcoesGrupo } from "@/lib/disparoGrupos";
import { PermissaoBadge } from "./PermissaoBadge";

type Tri = "manter" | "sim" | "nao";
const seletor = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const triParaBool = (t: Tri) => (t === "manter" ? undefined : t === "sim");
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Aba Configuração dos grupos: foto, descrição, nome, só admins enviam/editam e promover admins, num grupo
// ou em vários da campanha (novos e importados). Só onde o número é admin; um grupo por vez, com pausa.
export function AbaConfigGrupos({ campanha }: { campanha: CampanhaGrupos }) {
  const { toast } = useToast();
  const fotoRef = useRef<HTMLInputElement>(null);
  const [grupos, setGrupos] = useState<GrupoLinha[]>([]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [nome, setNome] = useState("");
  const [mudarDescricao, setMudarDescricao] = useState(false);
  const [descricao, setDescricao] = useState(campanha.descricao_grupo ?? "");
  const [foto, setFoto] = useState<File | null>(null);
  const [usarFotoCampanha, setUsarFotoCampanha] = useState(false);
  const [enviam, setEnviam] = useState<Tri>("manter");
  const [editam, setEditam] = useState<Tri>("manter");
  const [admins, setAdmins] = useState("");
  const [rodando, setRodando] = useState(false);
  const [resultado, setResultado] = useState<{ nome: string; texto: string; ok: boolean }[]>([]);

  const carregar = useCallback(async () => {
    const { data } = await db.from("grupos_campanha_grupos").select("*").eq("campanha_id", campanha.id).order("ordem");
    setGrupos(((data ?? []) as GrupoLinha[]).filter((g) => g.chat_id));
  }, [campanha.id]);
  useEffect(() => { setMarcados(new Set()); setResultado([]); carregar(); }, [carregar]);

  const configuraveis = grupos.filter((g) => podeConfigurar(permissaoGrupo(g)));
  const promover = admins.split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean);
  const promoverNorm = promover.map(telefoneAdmin);
  const acoes: AcoesGrupo = {
    ...(nome.trim() && marcados.size === 1 ? { nome: nome.trim() } : {}),
    ...(mudarDescricao ? { descricao } : {}),
    ...(usarFotoCampanha && campanha.foto_path && !foto ? { foto_path: campanha.foto_path } : {}),
    ...(foto ? { foto_path: "pendente" } : {}),
    ...(triParaBool(enviam) !== undefined ? { so_admins_enviam: triParaBool(enviam) } : {}),
    ...(triParaBool(editam) !== undefined ? { so_admins_editam: triParaBool(editam) } : {}),
    ...(promoverNorm.length ? { promover: promoverNorm.filter((t): t is string => Boolean(t)) } : {}),
  };
  const problemas = problemasConfiguracao(acoes);
  if (!marcados.size) problemas.unshift("Escolha os grupos.");
  if (nome.trim() && marcados.size > 1) problemas.push("Nome só dá para trocar com 1 grupo escolhido.");
  if (promoverNorm.some((t) => !t)) problemas.push("Telefone de admin inválido (DDD + número).");
  if (foto && !/^image\/(jpeg|png|webp)$/.test(foto.type)) problemas.push("Foto: JPG, PNG ou WebP.");

  async function aplicar() {
    const alvo = grupos.filter((g) => marcados.has(g.id));
    if (!confirm(`Aplicar em ${alvo.length} grupo(s) do WhatsApp agora? Isso muda o grupo de verdade.`)) return;
    setRodando(true);
    setResultado([]);
    try {
      const final = { ...acoes };
      if (foto) final.foto_path = await subirMidia(campanha.id, foto);
      for (const [i, g] of alvo.entries()) {
        const n = g.nome || g.chat_id || "grupo";
        try {
          const r = await configurarGrupo(g.id, final);
          setResultado((x) => [...x, { nome: n, ok: r.ok, texto: r.ok ? `ok: ${r.feito.join(", ")}` : [r.feito.length ? `feito: ${r.feito.join(", ")}` : "", ...r.erros].filter(Boolean).join(" · ") }]);
          if (r.erros.some((e) => e.startsWith("parado"))) break;
        } catch (e) {
          setResultado((x) => [...x, { nome: n, ok: false, texto: (e as Error).message }]);
        }
        if (i < alvo.length - 1) await dormir(3000); // ritmo: o proxy limita 20 escritas/min por número
      }
      await carregar();
    } catch (e) {
      toast({ title: "Não deu para aplicar", description: (e as Error).message, variant: "destructive" });
    }
    setRodando(false);
  }

  const alternar = (id: string) => setMarcados((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="rounded-md border p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium flex-1">Grupos</p>
          <Button size="sm" variant="outline" onClick={() => setMarcados(new Set(configuraveis.map((g) => g.id)))} disabled={!configuraveis.length}>
            Todos onde sou admin ({configuraveis.length})
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMarcados(new Set())}>Limpar</Button>
        </div>
        {!grupos.length && <p className="text-sm text-muted-foreground">Nenhum grupo com id nesta campanha. Importe ou cadastre na aba Campanhas.</p>}
        <div className="max-h-64 overflow-y-auto space-y-1">
          {grupos.map((g) => {
            const p = permissaoGrupo(g);
            const pode = podeConfigurar(p);
            return (
              <label key={g.id} className={`flex items-center gap-2 text-sm border rounded px-2 py-1 ${pode ? "cursor-pointer" : "opacity-60"}`}>
                <Checkbox checked={marcados.has(g.id)} disabled={!pode} onCheckedChange={() => alternar(g.id)} aria-label={`Selecionar ${g.nome || g.chat_id}`} />
                <span className="truncate flex-1">{g.nome || g.chat_id}</span>
                <PermissaoBadge permissao={p} />
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">Só grupos em que o número é admin. Permissão "não lida": use "Ler permissões" na aba Campanhas.</p>
      </div>

      <div className="rounded-md border p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Nome do grupo (só com 1 escolhido)</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="deixe vazio para não mudar" maxLength={100} />
          </div>
          <div className="space-y-1">
            <Label>Foto</Label>
            <div className="flex items-center gap-2">
              <input ref={fotoRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
              <Button type="button" variant="outline" size="sm" onClick={() => fotoRef.current?.click()}><Paperclip className="h-4 w-4 mr-1" /> {foto ? "Trocar" : "Escolher"}</Button>
              <span className="text-xs truncate">{foto?.name ?? (usarFotoCampanha ? "foto da campanha" : "não mudar")}</span>
              {foto && <Button type="button" variant="ghost" size="icon" onClick={() => { setFoto(null); if (fotoRef.current) fotoRef.current.value = ""; }}><X className="h-4 w-4" /></Button>}
            </div>
            {campanha.foto_path && !foto && (
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={usarFotoCampanha} onCheckedChange={(v) => setUsarFotoCampanha(v === true)} /> usar a foto salva na campanha</label>
            )}
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={mudarDescricao} onCheckedChange={(v) => setMudarDescricao(v === true)} /> Mudar a descrição (vazio limpa)</label>
            {mudarDescricao && <Textarea rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={1024} />}
          </div>
          <div className="space-y-1">
            <Label>Só admins enviam</Label>
            <select className={seletor} value={enviam} onChange={(e) => setEnviam(e.target.value as Tri)} aria-label="Só admins enviam">
              <option value="manter">não mudar</option><option value="sim">sim (grupo fechado)</option><option value="nao">não (todos enviam)</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Só admins editam nome/foto/descrição</Label>
            <select className={seletor} value={editam} onChange={(e) => setEditam(e.target.value as Tri)} aria-label="Só admins editam">
              <option value="manter">não mudar</option><option value="sim">sim</option><option value="nao">não</option>
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Promover a admin (telefones de quem já está no grupo, um por linha, até 10)</Label>
            <Textarea rows={2} value={admins} onChange={(e) => setAdmins(e.target.value)} placeholder={"11999998888"} />
          </div>
        </div>
        {problemas.length > 0 && <ul className="text-xs text-destructive list-disc pl-4">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>}
        <Button onClick={aplicar} disabled={rodando || problemas.length > 0}>
          {rodando && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Aplicar em {marcados.size} grupo(s)
        </Button>
        {resultado.length > 0 && (
          <div className="space-y-1 text-sm">
            {resultado.map((r, i) => (
              <div key={i} className="flex flex-wrap gap-2"><span className="truncate max-w-[220px]">{r.nome}</span><span className={r.ok ? "text-green-500" : "text-destructive"}>{r.texto}</span></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
