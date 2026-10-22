// Acesso da última visita, por usuário (22/10/2026).
//
// Toda abertura de tela logada esperava perfil, papéis e módulos (três consultas) antes de mostrar qualquer coisa:
// no celular (4G) eram ~0,3 a 0,9 s de giro mesmo com a sessão já no aparelho. Agora o portão abre na hora com o
// que valeu da última vez e confere com o servidor por trás; se o servidor disser outra coisa (acesso tirado,
// aprovação revogada), o estado é trocado e o ProtectedRoute redireciona como sempre.
//
// Isto decide só o que a TELA mostra. Quem decide o que a pessoa lê e grava é o RLS no banco — nada aqui libera dado.
// Fica fora o tracking_token do perfil (chega com a consulta, ~0,3 s depois).

export interface AcessoGuardado {
  profile: { id: string; full_name: string; approved: boolean; avatar_url?: string };
  isAdmin: boolean;
  allowedModules: string[];
  salvoEm: string;
}

const PREFIXO = "auth:acesso:";
/** Acesso guardado há mais que isto não abre o portão sozinho: espera o servidor, como antes. */
export const VALIDADE_ACESSO_MS = 14 * 24 * 60 * 60 * 1000;

const chave = (usuario: string) => `${PREFIXO}${usuario}`;

export function lerAcessoGuardado(usuario: string, agora: Date = new Date()): AcessoGuardado | null {
  try {
    const cru = window.localStorage.getItem(chave(usuario));
    if (!cru) return null;
    const a = JSON.parse(cru) as Partial<AcessoGuardado>;
    if (!a || typeof a !== "object" || !a.profile || a.profile.id !== usuario || typeof a.profile.approved !== "boolean") return null;
    if (typeof a.isAdmin !== "boolean" || !Array.isArray(a.allowedModules)) return null;
    const t = Date.parse(String(a.salvoEm));
    if (!Number.isFinite(t) || agora.getTime() - t > VALIDADE_ACESSO_MS) return null;
    return {
      profile: { id: a.profile.id, full_name: String(a.profile.full_name ?? ""), approved: a.profile.approved, avatar_url: a.profile.avatar_url },
      isAdmin: a.isAdmin,
      allowedModules: a.allowedModules.filter((m): m is string => typeof m === "string"),
      salvoEm: String(a.salvoEm),
    };
  } catch {
    return null;
  }
}

export function guardarAcesso(
  usuario: string,
  dados: { profile: { id: string; full_name: string; approved: boolean; avatar_url?: string } | null; isAdmin: boolean; allowedModules: string[] },
  agora: Date = new Date(),
): void {
  try {
    if (!dados.profile || dados.profile.id !== usuario) { esquecerAcesso(usuario); return; }
    const { id, full_name, approved, avatar_url } = dados.profile;
    const a: AcessoGuardado = {
      profile: { id, full_name, approved, ...(avatar_url ? { avatar_url } : {}) },
      isAdmin: dados.isAdmin,
      allowedModules: dados.allowedModules,
      salvoEm: agora.toISOString(),
    };
    window.localStorage.setItem(chave(usuario), JSON.stringify(a));
  } catch {
    /* sem storage: a próxima abertura espera o servidor, como antes */
  }
}

export function esquecerAcesso(usuario?: string): void {
  try {
    if (usuario) { window.localStorage.removeItem(chave(usuario)); return; }
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(PREFIXO)) window.localStorage.removeItem(k);
    }
  } catch {
    /* nada a fazer */
  }
}
