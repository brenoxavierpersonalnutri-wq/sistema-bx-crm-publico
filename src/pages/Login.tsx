import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import logoCoupleImg from "@/assets/logo-couple.png";
import { useAuth } from "@/hooks/useAuth";
import {
  comLimiteDeTempo,
  ehFalhaPassageira,
  ESPERA_ENTRE_TENTATIVAS_MS,
  mensagemDeErroDeAutenticacao,
  TENTATIVAS_DE_LOGIN,
  TIMEOUT_AUTENTICACAO_MS,
} from "@/lib/autenticacao";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { session } = useAuth();

  useEffect(() => {
    if (session) {
      navigate("/");
    }
  }, [session, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Com limite de tempo: quando o servidor de login não responde, a chamada
      // nunca voltava e o botão girava pra sempre — o "logando infinitamente".
      // E com segunda tentativa quando a falha é do servidor: um 500 solto
      // fazia o time achar que o sistema tinha caído.
      let error: unknown = null;
      for (let tentativa = 1; tentativa <= TENTATIVAS_DE_LOGIN; tentativa++) {
        const resposta = await comLimiteDeTempo(
          supabase.auth.signInWithPassword({ email, password }),
          TIMEOUT_AUTENTICACAO_MS
        );
        error = resposta.error;
        if (!error || !ehFalhaPassageira(error) || tentativa === TENTATIVAS_DE_LOGIN) break;
        await new Promise((r) => setTimeout(r, ESPERA_ENTRE_TENTATIVAS_MS));
      }

      if (error) {
        toast.error(mensagemDeErroDeAutenticacao(error));
        return;
      }
      navigate("/");
    } catch (err: unknown) {
      toast.error(mensagemDeErroDeAutenticacao(err));
    } finally {
      // No finally: o botão volta a funcionar em qualquer desfecho.
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <img src={logoCoupleImg} alt="BG Fitness" className="h-16 w-auto rounded-xl" />
          </div>
          <CardTitle className="font-display text-xl">BG FITNESS</CardTitle>
          <CardDescription>Faça login para acessar o painel</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrar"}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground mt-3">
            <Link to="/forgot-password" className="text-primary hover:underline">Esqueci minha senha</Link>
          </p>
          <p className="text-center text-sm text-muted-foreground mt-2">
            Não tem conta? <Link to="/signup" className="text-primary hover:underline">Cadastre-se</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
