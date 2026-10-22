import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Check, X, ArrowLeft, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { APP_MODULES, ModuleKey } from "@/lib/modules";

interface Profile {
  id: string;
  full_name: string;
  approved: boolean;
  created_at: string;
}

export default function AdminUsers() {
  const queryClient = useQueryClient();
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Profile[];
    },
  });

  const { data: allUserModules = [] } = useQuery({
    queryKey: ["admin-user-modules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_modules")
        .select("*");
      if (error) throw error;
      return data as { id: string; user_id: string; module: string }[];
    },
  });

  // Dono do sistema (Breno): a linha dele não perde acesso. O banco recusa de
  // qualquer jeito (gatilho proteger_acesso_do_dono); aqui só não oferece.
  const { data: donoId = null } = useQuery({
    queryKey: ["dono-do-sistema"],
    staleTime: Infinity,
    queryFn: async () => {
      const { data: id, error } = await supabase.rpc("dono_do_sistema" as never);
      if (error) return null;
      return (id as unknown as string | null) ?? null;
    },
  });

  const getUserModules = (userId: string): string[] =>
    allUserModules.filter((m) => m.user_id === userId).map((m) => m.module);

  const { data: allUserRoles = [] } = useQuery({
    queryKey: ["admin-user-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("*");
      if (error) throw error;
      return data as { id: string; user_id: string; role: "admin" | "user" }[];
    },
  });

  const getUserRole = (userId: string): "admin" | "user" => {
    const roleObj = allUserRoles.find((r) => r.user_id === userId);
    return roleObj ? roleObj.role : "user";
  };

  const updateUserRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: "admin" | "user" }) => {
      const existing = allUserRoles.find((r) => r.user_id === userId);
      
      if (existing) {
        const { error } = await supabase
          .from("user_roles")
          .update({ role })
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("user_roles")
          .insert({ user_id: userId, role } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user-roles"] });
      toast.success("Nível de acesso atualizado!");
    },
    onError: (err: Error) => toast.error("Erro ao atualizar acesso: " + err.message),
  });

  const toggleApproval = useMutation({
    mutationFn: async ({ id, approved }: { id: string; approved: boolean }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ approved, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
      toast.success("Usuário atualizado!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleModule = useMutation({
    mutationFn: async ({ userId, module, enabled }: { userId: string; module: string; enabled: boolean }) => {
      if (enabled) {
        const { error } = await supabase
          .from("user_modules")
          .insert({ user_id: userId, module } as any);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("user_modules")
          .delete()
          .eq("user_id", userId)
          .eq("module", module);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user-modules"] });
      toast.success("Permissão atualizada!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const grantAllModules = useMutation({
    mutationFn: async (userId: string) => {
      const currentModules = getUserModules(userId);
      const toInsert = APP_MODULES
        .filter((m) => !currentModules.includes(m.key))
        .map((m) => ({ user_id: userId, module: m.key }));
      if (toInsert.length > 0) {
        const { error } = await supabase
          .from("user_modules")
          .insert(toInsert as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user-modules"] });
      toast.success("Todos os módulos liberados!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <h1 className="font-display text-xl font-bold">Gerenciar Usuários</h1>
        </div>
      </header>
      <main className="container max-w-4xl mx-auto px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Usuários Cadastrados</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                ) : profiles.map((p) => {
                  const userModules = getUserModules(p.id);
                  const isExpanded = expandedUser === p.id;
                  const ehDono = !!donoId && p.id === donoId;

                  const handleDelete = async () => {
                    if (window.confirm(`Tem certeza que deseja excluir o usuário ${p.full_name || "sem nome"}? Esta ação não pode ser desfeita.`)) {
                      try {
                        // @ts-ignore - delete_user is a new RPC function
                        const { error } = await supabase.rpc('delete_user', { target_user_id: p.id });
                        
                        if (error) {
                          throw error;
                        }

                        await queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
                        await queryClient.invalidateQueries({ queryKey: ["admin-user-modules"] });
                        toast.success("Usuário removido com sucesso!");
                      } catch (err: any) {
                        console.error("Erro fatal na exclusão:", err);
                        toast.error("Erro ao remover usuário (Você rodou o SQL no Supabase?): " + err.message);
                      }
                    }
                  };

                  return (
                    <TableRow key={p.id} className="border-b-0">
                      <TableCell colSpan={3} className="p-0">
                        <div className="flex items-center px-4 py-3">
                          <div className="flex-1">
                            <div className="font-medium">{p.full_name || "Sem nome"}</div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(p.created_at).toLocaleDateString("pt-BR")}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <Select 
                                disabled={ehDono}
                                value={getUserRole(p.id)} 
                                onValueChange={(val: "admin" | "user") => updateUserRole.mutate({ userId: p.id, role: val })}
                              >
                                <SelectTrigger className="h-7 text-xs w-[130px] border-border/50 bg-background/50">
                                  <SelectValue placeholder="Nível de acesso" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="user" className="text-xs">Visualizador</SelectItem>
                                  <SelectItem value="admin" className="text-xs">Editor</SelectItem>
                                </SelectContent>
                              </Select>
                                
                              {p.approved && (
                                <span className="text-muted-foreground text-xs">
                                  · {userModules.length}/{APP_MODULES.length} módulos
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {p.approved ? (
                              <Badge variant="success">Aprovado</Badge>
                            ) : (
                              <Badge variant="warning">Pendente</Badge>
                            )}

                            <div className="flex items-center gap-1">
                              {p.approved ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-xs gap-1"
                                    onClick={() => setExpandedUser(isExpanded ? null : p.id)}
                                  >
                                    Módulos
                                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-xs gap-1"
                                    disabled={ehDono}
                                    title={ehDono ? "O dono do sistema não perde acesso" : undefined}
                                    onClick={() => toggleApproval.mutate({ id: p.id, approved: false })}
                                  >
                                    <X className="h-3 w-3" /> Revogar
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="text-xs gap-1"
                                  onClick={() => {
                                    toggleApproval.mutate({ id: p.id, approved: true });
                                    setExpandedUser(p.id);
                                  }}
                                >
                                  <Check className="h-3 w-3" /> Aprovar
                                </Button>
                              )}

                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10 p-2"
                                onClick={handleDelete}
                                disabled={ehDono}
                                title={ehDono ? "O dono do sistema não pode ser excluído" : "Excluir Usuário"}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>

                        {isExpanded && p.approved && (
                          <div className="px-4 pb-4 pt-1">
                            <div className="rounded-lg border border-border bg-secondary/30 p-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-medium text-foreground">Módulos liberados</p>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-xs h-7"
                                  onClick={() => grantAllModules.mutate(p.id)}
                                >
                                  Liberar todos
                                </Button>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {APP_MODULES.map((mod) => {
                                  const checked = userModules.includes(mod.key);
                                  return (
                                    <label
                                      key={mod.key}
                                      className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
                                    >
                                      <Checkbox
                                        checked={checked}
                                        disabled={ehDono && checked}
                                        onCheckedChange={(v) =>
                                          toggleModule.mutate({ userId: p.id, module: mod.key, enabled: !!v })
                                        }
                                      />
                                      <span className="text-sm">{mod.label}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
