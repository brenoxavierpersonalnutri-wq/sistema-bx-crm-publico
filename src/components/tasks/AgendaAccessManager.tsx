import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { AGENDA_ALUNAS_MODULE, AGENDA_CONTEUDO_MODULE } from "@/lib/agendaCamadas";
import { COMERCIAL_MODULE } from "@/lib/modules";
import { CampoAcesso, MODULO_DO_CAMPO, linhaTravada, podeAlterarAcesso } from "@/lib/acessoUsuarios";
import { useAuth } from "@/hooks/useAuth";

const COLUNAS: { campo: CampoAcesso; titulo: string; largura: string }[] = [
  { campo: "reavaliacoes", titulo: "Reavaliações", largura: "w-[84px]" },
  { campo: "conteudo", titulo: "Conteúdo", largura: "w-[64px]" },
  { campo: "comercial", titulo: "Comercial", largura: "w-[72px]" },
  { campo: "admin", titulo: "Admin", largura: "w-[44px]" },
];

const GRADE = "grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4";

export function AgendaAccessManager() {
  const qc = useQueryClient();
  const { user, isAdmin } = useAuth();

  const { data } = useQuery({
    queryKey: ["agenda-access"],
    enabled: isAdmin,
    queryFn: async () => {
      const [p, m, r] = await Promise.all([
        supabase.from("profiles").select("id, full_name").eq("approved", true).order("full_name"),
        supabase
          .from("user_modules")
          .select("user_id, module")
          .in("module", [AGENDA_ALUNAS_MODULE, AGENDA_CONTEUDO_MODULE, COMERCIAL_MODULE]),
        supabase.from("user_roles").select("user_id, role").eq("role", "admin"),
      ]);
      if (p.error) throw p.error;
      const comModulo = (mod: string) =>
        new Set((m.data ?? []).filter((x) => x.module === mod).map((x) => x.user_id));
      return {
        users: p.data ?? [],
        modulos: {
          [AGENDA_ALUNAS_MODULE]: comModulo(AGENDA_ALUNAS_MODULE),
          [AGENDA_CONTEUDO_MODULE]: comModulo(AGENDA_CONTEUDO_MODULE),
          [COMERCIAL_MODULE]: comModulo(COMERCIAL_MODULE),
        } as Record<string, Set<string>>,
        admins: new Set((r.data ?? []).map((x) => x.user_id)),
      };
    },
  });

  // Quem é o dono do sistema vem do banco (pelo e-mail, dentro da função), pra
  // tela e gatilho concordarem. Se a função ainda não existe (SQL não rodou),
  // fica null: nada trava na tela, e o banco também ainda não protege.
  const { data: donoId = null } = useQuery({
    queryKey: ["dono-do-sistema"],
    enabled: isAdmin,
    staleTime: Infinity,
    queryFn: async () => {
      const { data: id, error } = await supabase.rpc("dono_do_sistema" as never);
      if (error) return null;
      return (id as unknown as string | null) ?? null;
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["agenda-access"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  const toggleAccess = useMutation({
    // Mesma mecânica para as três camadas: uma linha em user_modules por pessoa.
    mutationFn: async ({ id, on, module }: { id: string; on: boolean; module: string }) => {
      const { error } = on
        ? await supabase.from("user_modules").insert({ user_id: id, module })
        : await supabase.from("user_modules").delete().eq("user_id", id).eq("module", module);
      if (error) throw error;
    },
    onSuccess: () => { refresh(); toast.success("Acesso atualizado"); },
    onError: (e: Error) => { refresh(); toast.error(e.message); },
  });

  const toggleAdmin = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => {
      const del = await supabase.from("user_roles").delete().eq("user_id", id).in("role", ["admin", "user"]);
      if (del.error) throw del.error;
      const { error } = await supabase.from("user_roles").insert({ user_id: id, role: on ? "admin" : "user" });
      if (error) throw error;
    },
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["admin-user-roles"] }); toast.success("Admin atualizado"); },
    onError: (e: Error) => { refresh(); toast.error(e.message); },
  });

  if (!isAdmin) return null;

  const quem = { euId: user?.id, euAdmin: isAdmin, donoId };

  const ligado = (id: string, campo: CampoAcesso) =>
    campo === "admin" ? data!.admins.has(id) : data!.modulos[MODULO_DO_CAMPO[campo]].has(id);

  const alternar = (id: string, campo: CampoAcesso, on: boolean) => {
    if (!podeAlterarAcesso(id, campo, quem).pode) return;
    if (campo === "admin") toggleAdmin.mutate({ id, on });
    else toggleAccess.mutate({ id, on, module: MODULO_DO_CAMPO[campo] });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" /> Quem tem acesso
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          "Reavaliações" mostra na agenda da pessoa as reavaliações e liberações das alunas. "Conteúdo" libera a agenda do time de conteúdo e criativo. "Comercial" libera o Monitoramento das Consultas (consultas, funil, sinais, mensal, anual e banco de respostas). "Admin" dá acesso total ao sistema. O dono do sistema não perde acesso.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className={`${GRADE} px-4 py-2 text-xs font-medium text-muted-foreground border-b border-border`}>
          <span>Usuário</span>
          {COLUNAS.map((c) => (
            <span key={c.campo} className={`${c.largura} text-center`}>{c.titulo}</span>
          ))}
        </div>
        {(data?.users ?? []).map((u) => {
          const travada = linhaTravada(u.id, quem);
          return (
            <div
              key={u.id}
              data-testid={`acesso-${u.id}`}
              className={`${GRADE} items-center px-4 py-2 border-b border-border/50 last:border-0`}
            >
              <span className="text-sm truncate flex items-center gap-1.5">
                {u.full_name || "Sem nome"}
                {travada && (
                  <Lock className="h-3 w-3 text-muted-foreground shrink-0" aria-label="Dono do sistema: acesso travado" />
                )}
              </span>
              {COLUNAS.map((c) => {
                const decisao = podeAlterarAcesso(u.id, c.campo, quem);
                return (
                  <div key={c.campo} className={`${c.largura} flex justify-center`} title={decisao.motivo}>
                    <Switch
                      checked={ligado(u.id, c.campo)}
                      disabled={!decisao.pode}
                      onCheckedChange={(on) => alternar(u.id, c.campo, on)}
                      aria-label={`${c.titulo} para ${u.full_name}`}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
