// Autenticação da aluna no app nativo.
//
// O SDK do Supabase funciona em React Native desde que você troque o storage
// (o padrão é localStorage, que não existe lá) e desligue o detectSessionInUrl.

import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";

export interface OpcoesAuth {
  supabaseUrl: string;
  anonKey: string;
  /** Passe o AsyncStorage do React Native, ou o expo-secure-store adaptado. */
  storage: {
    getItem: (k: string) => Promise<string | null>;
    setItem: (k: string, v: string) => Promise<void>;
    removeItem: (k: string) => Promise<void>;
  };
}

export function criarSupabase({ supabaseUrl, anonKey, storage }: OpcoesAuth): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: true,
      // Não há URL de callback no app nativo
      detectSessionInUrl: false,
    },
  });
}

export async function entrar(sb: SupabaseClient, email: string, senha: string): Promise<Session> {
  const { data, error } = await sb.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password: senha,
  });
  // Mensagem genérica de propósito: não revela se o e-mail existe
  if (error || !data.session) throw new Error("E-mail ou senha incorretos.");
  return data.session;
}

export async function criarAcesso(sb: SupabaseClient, email: string, senha: string) {
  const { error } = await sb.auth.signUp({
    email: email.trim().toLowerCase(),
    password: senha,
  });
  if (error) throw error;
}

export async function recuperarSenha(sb: SupabaseClient, email: string, redirecionarPara: string) {
  const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: redirecionarPara,
  });
  if (error) throw error;
}

/** Passe direto como `obterToken` para o ClienteApi. */
export function tokenAtual(sb: SupabaseClient) {
  return async (): Promise<string | null> => {
    // getSession já renova sozinho quando está perto de expirar
    const { data } = await sb.auth.getSession();
    return data.session?.access_token ?? null;
  };
}
