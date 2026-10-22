import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAlunaAuth } from "@/hooks/useAlunaAuth";

type Modo = "entrar" | "criar" | "recuperar";

export default function AlunaLogin() {
  const navigate = useNavigate();
  const { session, loading } = useAlunaAuth();
  const [modo, setModo] = useState<Modo>("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);

  if (loading) {
    return (
      <div className="dark flex min-h-[100dvh] items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (session) return <Navigate to="/aluna" replace />;

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return toast.error("Informe seu e-mail");
    if (modo !== "recuperar" && senha.length < 6) {
      return toast.error("A senha precisa ter ao menos 6 caracteres");
    }

    setEnviando(true);
    try {
      if (modo === "entrar") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password: senha,
        });
        if (error) throw new Error("E-mail ou senha incorretos.");
        navigate("/aluna", { replace: true });
      } else if (modo === "criar") {
        const { error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password: senha,
          options: { emailRedirectTo: `${window.location.origin}/aluna` },
        });
        if (error) throw error;
        toast.success("Acesso criado. Se pedir confirmação, verifique seu e-mail.");
        navigate("/aluna", { replace: true });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("Enviamos o link de redefinição para seu e-mail.");
        setModo("entrar");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const titulo = {
    entrar: "Entrar",
    criar: "Criar acesso",
    recuperar: "Recuperar senha",
  }[modo];

  return (
    <div className="dark flex min-h-[100dvh] flex-col justify-center bg-background px-6 py-12 text-foreground">
      <div className="mx-auto w-full max-w-sm space-y-8">
        <div className="space-y-2 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent">
            Consultoria
          </p>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Breno Xavier
          </h1>
          <p className="text-sm text-muted-foreground">
            Seu treino, sua dieta e seu acompanhamento em um lugar só.
          </p>
        </div>

        <form onSubmit={submeter} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="al-email">E-mail</Label>
            <Input
              id="al-email" type="email" autoComplete="email" inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
            />
          </div>

          {modo !== "recuperar" && (
            <div className="space-y-2">
              <Label htmlFor="al-senha">Senha</Label>
              <Input
                id="al-senha" type="password"
                autoComplete={modo === "criar" ? "new-password" : "current-password"}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          )}

          <Button type="submit" className="w-full" disabled={enviando}>
            {enviando ? "Aguarde…" : titulo}
          </Button>
        </form>

        <div className="space-y-2 text-center text-sm">
          {modo === "entrar" && (
            <>
              <button
                type="button"
                className="text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => setModo("criar")}
              >
                Primeiro acesso? Criar minha senha
              </button>
              <br />
              <button
                type="button"
                className="text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => setModo("recuperar")}
              >
                Esqueci minha senha
              </button>
            </>
          )}
          {modo !== "entrar" && (
            <button
              type="button"
              className="text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => setModo("entrar")}
            >
              Voltar para o login
            </button>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Use o mesmo e-mail que você passou na contratação.
        </p>
      </div>
    </div>
  );
}
