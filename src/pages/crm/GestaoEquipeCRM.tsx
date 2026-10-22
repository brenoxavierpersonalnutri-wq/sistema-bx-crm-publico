// /crm/equipe — Gestão de equipe (só admin): por usuário aprovado, perfis prontos (SDR, Closer, CS, Admin), áreas do
// CRM com sem acesso/ver/editar e ações, números e departamentos visíveis, "só as dele". Também o padrão do usuário
// novo e a gestão/importação de departamentos. Quem barra de verdade é o banco (RLS + RPCs + edge functions):
// esta tela só grava crm_acessos, crm_acessos_padrao e crm_departamento_membros (policies: só admin grava).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Save, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TituloPaginaCRM } from "@/components/crm/ui/SecaoCRM";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { recarregarMeuAcesso, useDepartamentos, useMeuAcessoCrm } from "@/hooks/useCrmEquipe";
import { EditorAcesso } from "@/components/crm/equipe/EditorAcesso";
import { GestaoDepartamentos } from "@/components/crm/equipe/GestaoDepartamentos";
import { rotuloPerfil, type AcessoCrm, type AplicacaoPerfil, type NumeroRef } from "@/lib/crm/acesso";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

interface Usuario { id: string; nome: string; admin: boolean }
const PADRAO = "__padrao__";

const vazio = (): AcessoCrm => ({ todos_numeros: false, numeros: [], areas: { conversas: "ver" }, acoes: {}, so_minhas: false, so_departamentos: false, perfil: null });
const daLinha = (l: Record<string, unknown> | null | undefined): AcessoCrm => l ? ({
  todos_numeros: !!l.todos_numeros,
  numeros: (l.numeros as string[] | null) ?? [],
  areas: (l.areas as AcessoCrm["areas"]) ?? {},
  acoes: (l.acoes as AcessoCrm["acoes"]) ?? {},
  so_minhas: !!l.so_minhas,
  so_departamentos: !!l.so_departamentos,
  perfil: (l.perfil as string | null) ?? null,
}) : vazio();

async function ok<T>(p: PromiseLike<{ data: T; error: { message?: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message ?? "erro");
  return data;
}

export default function GestaoEquipeCRM() {
  const { toast } = useToast();
  const meu = useMeuAcessoCrm();
  const departamentos = useDepartamentos();
  const [carregando, setCarregando] = useState(true);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [acessos, setAcessos] = useState<Record<string, AcessoCrm>>({});
  const [padrao, setPadrao] = useState<AcessoCrm>(vazio());
  const [membros, setMembros] = useState<{ departamento_id: string; user_id: string }[]>([]);
  const [numeros, setNumeros] = useState<NumeroRef[]>([]);
  const [sel, setSel] = useState<string>(PADRAO);
  const [rascunho, setRascunho] = useState<AcessoCrm>(vazio());
  const [rascunhoMembros, setRascunhoMembros] = useState<string[]>([]);
  const [modulos, setModulos] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [ps, rs, as, pd, ms, ns] = await Promise.all([
        ok(db.from("profiles").select("id, full_name").eq("approved", true).order("full_name")),
        ok(db.from("user_roles").select("user_id, role").eq("role", "admin")),
        ok(db.from("crm_acessos").select("*")),
        ok(db.from("crm_acessos_padrao").select("*").maybeSingle()),
        ok(db.from("crm_departamento_membros").select("departamento_id, user_id")),
        ok(db.from("crm_numeros").select("id, chave, apelido, sessao_openwa, ordem").order("ordem")),
      ]);
      const admins = new Set(((rs ?? []) as { user_id: string }[]).map((r) => r.user_id));
      setUsuarios(((ps ?? []) as { id: string; full_name: string }[]).map((p) => ({ id: p.id, nome: p.full_name?.trim() || "Sem nome", admin: admins.has(p.id) })));
      setAcessos(Object.fromEntries(((as ?? []) as Record<string, unknown>[]).map((l) => [String(l.user_id), daLinha(l)])));
      setPadrao(daLinha(pd as Record<string, unknown> | null));
      setMembros((ms ?? []) as { departamento_id: string; user_id: string }[]);
      setNumeros((ns ?? []) as NumeroRef[]);
    } catch (e) {
      toast({ title: "Gestão de equipe", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setCarregando(false);
    }
  }, [toast]);
  useEffect(() => { void carregar(); }, [carregar]);

  // trocar de usuário: o rascunho volta ao que está gravado
  useEffect(() => {
    setModulos([]);
    if (sel === PADRAO) { setRascunho(padrao); setRascunhoMembros([]); return; }
    setRascunho(acessos[sel] ?? padrao);
    setRascunhoMembros(membros.filter((m) => m.user_id === sel).map((m) => m.departamento_id));
  }, [sel, acessos, padrao, membros]);

  const deps = useMemo(() => departamentos.map((d) => ({ id: d.id, nome: d.nome, regra: d.regra, cor: d.cor })), [departamentos]);
  const membrosDe = useCallback((u: string) => membros.filter((m) => m.user_id === u).map((m) => m.departamento_id), [membros]);

  const aplicar = (a: AplicacaoPerfil) => {
    setRascunho(a.acesso);
    if (sel !== PADRAO) setRascunhoMembros(a.departamentos);
    setModulos(a.modulos);
  };

  const salvar = async () => {
    setSalvando(true);
    try {
      const linha = {
        todos_numeros: rascunho.todos_numeros, numeros: rascunho.todos_numeros ? [] : rascunho.numeros,
        areas: rascunho.areas, acoes: rascunho.acoes, so_minhas: rascunho.so_minhas, so_departamentos: rascunho.so_departamentos,
      };
      if (sel === PADRAO) {
        await ok(db.from("crm_acessos_padrao").upsert({ id: true, ...linha }));
      } else {
        await ok(db.from("crm_acessos").upsert({ user_id: sel, ...linha, perfil: rascunho.perfil ?? null }));
        const atuais = membrosDe(sel);
        const sair = atuais.filter((d) => !rascunhoMembros.includes(d));
        const entrar = rascunhoMembros.filter((d) => !atuais.includes(d));
        if (sair.length) await ok(db.from("crm_departamento_membros").delete().eq("user_id", sel).in("departamento_id", sair));
        if (entrar.length) await ok(db.from("crm_departamento_membros").insert(entrar.map((d) => ({ departamento_id: d, user_id: sel }))));
        // perfil com liberação fora do CRM (CS: Gestão de Alunas)
        for (const m of modulos) {
          const { error } = await db.from("user_modules").insert({ user_id: sel, module: m });
          if (error && error.code !== "23505") throw new Error(error.message);
        }
      }
      toast({ title: "Acesso salvo", description: "Vale a partir da próxima tela que a pessoa abrir." });
      await carregar();
      void recarregarMeuAcesso();
    } catch (e) {
      toast({ title: "Não salvou", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  if (meu && !meu.admin) return null; // o layout já mostra "sem acesso"

  const usuarioSel = usuarios.find((u) => u.id === sel);

  return (
    <div className="px-4 py-5 md:px-8 md:py-7 space-y-5">
      <TituloPaginaCRM titulo="Gestão de equipe" descricao="Quem vê o quê no CRM: áreas, ações, números, departamentos. Só o admin mexe aqui." />
      <Tabs defaultValue="acessos">
        <TabsList>
          <TabsTrigger value="acessos">Acessos</TabsTrigger>
          <TabsTrigger value="departamentos">Departamentos</TabsTrigger>
        </TabsList>
        <TabsContent value="acessos">
          {carregando ? (
            <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
              <nav className="space-y-1" aria-label="Usuários">
                <button
                  type="button"
                  onClick={() => setSel(PADRAO)}
                  className={`w-full text-left rounded-md px-3 py-2 text-sm flex items-center gap-2 ${sel === PADRAO ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"}`}
                >
                  <UserPlus className="h-4 w-4" /> Padrão do usuário novo
                </button>
                {usuarios.map((u) => {
                  const a = acessos[u.id];
                  const etiqueta = u.admin ? "Admin do sistema" : a ? rotuloPerfil(a, membrosDe(u.id), numeros, deps) : "sem linha de acesso";
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setSel(u.id)}
                      data-testid="usuario-equipe"
                      className={`w-full text-left rounded-md px-3 py-2 text-sm ${sel === u.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"}`}
                    >
                      <span className="block truncate">{u.nome}</span>
                      {etiqueta && <span className="block text-xs text-muted-foreground truncate">{etiqueta}</span>}
                    </button>
                  );
                })}
              </nav>
              <div className="space-y-4 max-w-3xl">
                {sel === PADRAO ? (
                  <p className="text-sm text-muted-foreground">
                    Com o que nasce cada usuário aprovado daqui pra frente. Sugerido: nenhum número e só "ver" em Conversas,
                    até você liberar (assim ninguém novo enxerga conversa de cliente antes de você decidir).
                  </p>
                ) : usuarioSel?.admin ? (
                  <p className="text-sm text-muted-foreground">{usuarioSel.nome} é admin do sistema: vê e edita tudo, o que estiver aqui não restringe.</p>
                ) : null}
                <EditorAcesso
                  valor={rascunho}
                  onChange={(v) => setRascunho(v)}
                  numeros={numeros}
                  departamentos={deps}
                  membroDe={sel === PADRAO ? null : rascunhoMembros}
                  onMembroDe={setRascunhoMembros}
                  onAplicarPerfil={sel === PADRAO ? undefined : aplicar}
                  rotuloPerfil={sel === PADRAO ? null : rotuloPerfil(rascunho, rascunhoMembros, numeros, deps)}
                />
                <div className="sticky bottom-0 bg-background py-3 flex items-center gap-3 border-t">
                  <Button onClick={salvar} disabled={salvando} data-testid="salvar-acesso">
                    {salvando ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />} Salvar
                  </Button>
                  {modulos.length > 0 && <span className="text-xs text-muted-foreground">Também libera fora do CRM: {modulos.join(", ")}</span>}
                </div>
              </div>
            </div>
          )}
        </TabsContent>
        <TabsContent value="departamentos">
          <GestaoDepartamentos numeros={numeros} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
