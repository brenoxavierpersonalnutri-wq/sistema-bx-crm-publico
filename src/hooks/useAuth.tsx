import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Session, User } from "@supabase/supabase-js";
import { comLimiteDeTempo } from "@/lib/autenticacao";
import { deveRecarregarTudo } from "@/lib/esperaDeAcesso";
import { esquecerAcesso, guardarAcesso, lerAcessoGuardado } from "@/lib/acessoGuardado";

interface Profile {
  id: string;
  full_name: string;
  approved: boolean;
  avatar_url?: string;
  tracking_token?: string;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  allowedModules: string[];
  loading: boolean;
  accessError: string | null;
  refreshAuth: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  isAdmin: false,
  allowedModules: [],
  loading: true,
  accessError: null,
  refreshAuth: async () => { },
  signOut: async () => { },
});

/**
 * Nenhuma consulta do Supabase tem timeout por padrão. Como o perfil carrega
 * com Promise.allSettled — que só resolve quando as TRÊS consultas respondem —
 * uma pendurada deixava o `loading` preso em true, e o ProtectedRoute girava o
 * spinner pra sempre: sem erro, sem botão, sem saída.
 *
 * Melhor falhar visível. O ProtectedRoute já tem a tela "Falha ao validar seu
 * acesso" com botão de tentar de novo — ela só nunca chegava a aparecer.
 *
 * O limite de tempo vive em lib/autenticacao junto com o do login, pra que as
 * duas telas envelheçam com a mesma regra.
 */
const TIMEOUT_PERFIL_MS = 15_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [allowedModules, setAllowedModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  const resetAuthState = () => {
    setProfile(null);
    setIsAdmin(false);
    setAllowedModules([]);
    setAccessError(null);
  };

  const fetchProfile = async (userId: string) => {
    const [profileResult, rolesResult, modulesResult] = await Promise.allSettled([
      supabase
        .from("profiles")
        .select("id, full_name, approved, avatar_url, tracking_token" as any)
        .eq("id", userId)
        .single(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("user_modules").select("module").eq("user_id", userId),
    ]);

    const errors: string[] = [];

    const profileData = profileResult.status === "fulfilled"
      ? profileResult.value.data
      : (errors.push("perfil"), null);

    const roles = rolesResult.status === "fulfilled"
      ? rolesResult.value.data
      : (errors.push("papéis de acesso"), null);

    const modules = modulesResult.status === "fulfilled"
      ? modulesResult.value.data
      : (errors.push("módulos permitidos"), null);

    return {
      profile: (profileData as any as Profile | null) ?? null,
      isAdmin: roles?.some((r: any) => r.role === "admin") ?? false,
      allowedModules: modules?.map((m: any) => m.module) ?? [],
      errors,
    };
  };

  const currentUserIdRef = useRef<string | null>(null);

  const syncAuthState = useCallback(async (nextSession: Session | null, opts?: { silent?: boolean }) => {
    const requestId = ++requestIdRef.current;
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);
    setAccessError(null);
    setSession(nextSession);

    if (!nextSession?.user) {
      currentUserIdRef.current = null;
      esquecerAcesso();
      resetAuthState();
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
      return;
    }

    // Marcado aqui, e não depois do perfil voltar: enquanto esse registro
    // ficava vazio, todo evento de auth do mesmo usuário refazia a carga e
    // devolvia a tela pro branco com o giro. Ver lib/esperaDeAcesso.
    currentUserIdRef.current = nextSession.user.id;

    // Acesso da última visita (lib/acessoGuardado): a tela abre já e o servidor confere por trás (22/10/2026).
    // Só na carga "cheia" — a silenciosa nunca fechou o portão.
    const guardado = silent ? null : lerAcessoGuardado(nextSession.user.id);
    if (guardado) {
      setProfile(guardado.profile);
      setIsAdmin(guardado.isAdmin);
      setAllowedModules(guardado.allowedModules);
      setLoading(false);
    }

    try {
      const authState = await comLimiteDeTempo(
        fetchProfile(nextSession.user.id),
        TIMEOUT_PERFIL_MS
      );

      if (!mountedRef.current || requestId !== requestIdRef.current) return;

      // conferência por trás falhou: fica o acesso guardado (o RLS segue valendo no banco); sem guardado, a tela
      // de "Falha ao validar" de sempre
      if (authState.errors.length > 0 && guardado) return;

      setProfile(authState.profile);
      setIsAdmin(authState.isAdmin);
      setAllowedModules(authState.allowedModules);

      if (authState.errors.length > 0) {
        setAccessError("Não consegui validar suas permissões agora. Tente recarregar este módulo.");
      } else {
        guardarAcesso(nextSession.user.id, authState);
      }
    } catch (err: unknown) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      if (guardado) return;
      // O motivo entra na mensagem: sem ele, uma consulta pendurada e um erro
      // de permissão viram o mesmo texto genérico, e não dá pra diagnosticar.
      const motivo = err instanceof Error ? err.message : "erro desconhecido";
      setAccessError(`Falha ao restaurar sua sessão (${motivo}). Tente novamente.`);
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const { data: { session } } = await comLimiteDeTempo(
        supabase.auth.getSession(),
        TIMEOUT_PERFIL_MS
      );
      await syncAuthState(session);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const motivo = err instanceof Error ? err.message : "erro desconhecido";
      setAccessError(`Não foi possível revalidar sua sessão (${motivo}).`);
      setLoading(false);
    }
  }, [syncAuthState]);

  useEffect(() => {
    mountedRef.current = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Evita "resetar" a UI quando o Supabase apenas revalida o token
        // ao voltar de outra aba (TOKEN_REFRESHED / INITIAL_SESSION / SIGNED_IN
        // para o mesmo usuário). Sem isso, o ProtectedRoute exibia o spinner
        // e desmontava os filhos, perdendo estado interno (aba, filtros, etc.).
        if (!deveRecarregarTudo(event, session?.user?.id, currentUserIdRef.current)) {
          setSession(session);
          return;
        }
        void syncAuthState(session);
      }
    );

    comLimiteDeTempo(supabase.auth.getSession(), TIMEOUT_PERFIL_MS)
      .then(({ data: { session } }) => {
        // Observado no navegador, com relógio: o SIGNED_IN chega pelo listener
        // 20ms ANTES deste .then resolver, e já dispara a carga. Chamar
        // syncAuthState aqui sem passar pelo mesmo crivo disparava a trinca
        // (perfil, papéis, módulos) DUAS vezes em toda abertura — e como só o
        // último pedido vale, a tela sempre esperava o mais lento dos dois.
        // Numa rede ruim, isso dobrava a chance de bater no limite do login.
        // Quem chegar primeiro carrega; o segundo só guarda a sessão.
        if (!deveRecarregarTudo("INITIAL_SESSION", session?.user?.id, currentUserIdRef.current)) {
          setSession(session);
          return;
        }
        void syncAuthState(session);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        const motivo = err instanceof Error ? err.message : "erro desconhecido";
        setAccessError(`Não foi possível carregar sua sessão (${motivo}).`);
        setLoading(false);
      });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [syncAuthState]);

  const signOut = async () => {
    esquecerAcesso();
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, isAdmin, allowedModules, loading, accessError, refreshAuth, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
