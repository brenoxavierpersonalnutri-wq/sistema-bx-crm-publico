import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { vincularMeuAcesso, fetchMeuPerfil } from "@/lib/appAluna/store";
import type { PerfilAluna } from "@/lib/appAluna/types";

interface AlunaAuthContextType {
  session: Session | null;
  perfil: PerfilAluna | null;
  loading: boolean;
  /** Logada no Supabase mas sem vínculo com nenhuma aluna liberada */
  semAcesso: boolean;
  recarregar: () => Promise<void>;
  sair: () => Promise<void>;
}

const AlunaAuthContext = createContext<AlunaAuthContextType>({
  session: null,
  perfil: null,
  loading: true,
  semAcesso: false,
  recarregar: async () => {},
  sair: async () => {},
});

export function AlunaAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<PerfilAluna | null>(null);
  const [loading, setLoading] = useState(true);
  const [semAcesso, setSemAcesso] = useState(false);
  const montado = useRef(true);
  const requisicao = useRef(0);

  const carregarPerfil = useCallback(async (s: Session | null) => {
    const id = ++requisicao.current;
    setSession(s);

    if (!s?.user) {
      setPerfil(null);
      setSemAcesso(false);
      setLoading(false);
      return;
    }

    try {
      // Casa o e-mail do login com o cadastro que o time liberou.
      await vincularMeuAcesso();
      const p = await fetchMeuPerfil();
      if (!montado.current || id !== requisicao.current) return;
      setPerfil(p);
      setSemAcesso(!p);
    } catch {
      if (!montado.current || id !== requisicao.current) return;
      setPerfil(null);
      setSemAcesso(true);
    } finally {
      if (montado.current && id === requisicao.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    montado.current = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento, s) => {
      // Revalidação de token não deve derrubar a tela
      if (evento === "TOKEN_REFRESHED" && s?.user?.id === session?.user?.id) {
        setSession(s);
        return;
      }
      void carregarPerfil(s);
    });

    supabase.auth.getSession()
      .then(({ data: { session: s } }) => void carregarPerfil(s))
      .catch(() => montado.current && setLoading(false));

    return () => {
      montado.current = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregarPerfil]);

  const recarregar = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    await carregarPerfil(s);
  }, [carregarPerfil]);

  const sair = useCallback(async () => {
    await supabase.auth.signOut();
    setPerfil(null);
    setSemAcesso(false);
  }, []);

  return (
    <AlunaAuthContext.Provider value={{ session, perfil, loading, semAcesso, recarregar, sair }}>
      {children}
    </AlunaAuthContext.Provider>
  );
}

export const useAlunaAuth = () => useContext(AlunaAuthContext);
