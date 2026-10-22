import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Activity, Loader2 } from "lucide-react";
import { comLimiteDeTempo, mensagemDeErroDeAutenticacao, TIMEOUT_AUTENTICACAO_MS } from "@/lib/autenticacao";

export default function Signup() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await comLimiteDeTempo(
        supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: window.location.origin,
          },
        }),
        TIMEOUT_AUTENTICACAO_MS
      );
      if (error) {
        // "Database error saving new user" vira texto que diz o que fazer: o
        // cadastro falha no gatilho que cria o perfil, não na senha de quem
        // está se cadastrando.
        toast.error(mensagemDeErroDeAutenticacao(error));
        return;
      }
      setSubmitted(true);
    } catch (err: unknown) {
      toast.error(mensagemDeErroDeAutenticacao(err));
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-sm text-center">
          <CardHeader>
            <CardTitle className="font-display text-xl">Verifique seu email</CardTitle>
            <CardDescription>
              Enviamos um link de confirmação para <strong>{email}</strong>. Após confirmar, aguarde a aprovação do administrador.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/login">
              <Button variant="outline" className="w-full">Voltar ao login</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <div className="p-2 rounded-xl bg-primary">
              <Activity className="h-5 w-5 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="font-display text-xl">Criar Conta</CardTitle>
          <CardDescription>Solicite acesso ao Monitor Comercial</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome completo</Label>
              <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cadastrar"}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground mt-4">
            Já tem conta? <Link to="/login" className="text-primary hover:underline">Faça login</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
