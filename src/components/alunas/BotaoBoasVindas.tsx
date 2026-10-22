import { useState } from "react";
import { Check, FileText, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { linkAnamnese, mensagemBoasVindas } from "@/types/anamnese";
import type { Aluna } from "@/lib/alunaTypes";
import { comLimiteDeTempo, textoDeErro } from "@/lib/chamadaAoBanco";

interface Props {
  aluna: Aluna;
}

const tabela = (nome: string) => supabase.from(nome as never);

/**
 * Gera a anamnese da aluna e deixa pronta a mensagem de boas-vindas com o link
 * dela dentro.
 *
 * Em dois passos de propósito: gerar a anamnese é uma ida ao banco, e abrir o
 * WhatsApp por script depois de um await é o tipo de coisa que o bloqueador de
 * pop-up do navegador engole sem avisar. Então o primeiro clique gera e o botão
 * vira um link de verdade, que o segundo clique abre.
 */
export function BotaoBoasVindas({ aluna }: Props) {
  const [gerando, setGerando] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  async function gerar() {
    setGerando(true);
    try {
      // Reaproveita uma anamnese que ainda não foi respondida, pra não encher a
      // ficha da aluna de links soltos a cada clique.
      // Com limite de tempo nas duas idas ao banco: sem ele, o botão fica
      // girando pra sempre quando o banco não responde — sem erro e sem saída.
      const { data: existente, error: e1 } = await comLimiteDeTempo(
        Promise.resolve(
          tabela("anamnese_respostas")
            .select("token")
            .eq("aluna_id", aluna.id)
            .eq("status", "pendente")
            .order("created_at", { ascending: false })
            .limit(1),
        ),
      );
      if (e1) throw e1;

      const jaTem = (existente ?? []) as unknown as { token: string }[];
      if (jaTem.length > 0) {
        setToken(jaTem[0].token);
        toast.success("Anamnese pronta. Agora é só mandar.");
        return;
      }

      const { data: nova, error: e2 } = await comLimiteDeTempo(
        Promise.resolve(
          tabela("anamnese_respostas")
            .insert({ aluna_id: aluna.id } as never)
            .select("token")
            .single(),
        ),
      );
      if (e2) throw e2;

      setToken((nova as unknown as { token: string }).token);
      toast.success("Anamnese gerada. Agora é só mandar.");
    } catch (e: unknown) {
      toast.error(textoDeErro(e, "Não consegui gerar a anamnese"));
    } finally {
      setGerando(false);
    }
  }

  if (!token) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-2 text-xs"
        onClick={gerar}
        disabled={gerando}
      >
        {gerando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
        Gerar anamnese
      </Button>
    );
  }

  const digitos = aluna.telefone?.replace(/\D/g, "") ?? "";
  const numero = digitos.startsWith("55") ? digitos : `55${digitos}`;
  const texto = encodeURIComponent(mensagemBoasVindas(linkAnamnese(token)));

  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-600">
        <Check className="h-3 w-3" />
        Anamnese gerada
      </span>
      {digitos ? (
        <a href={`https://wa.me/${numero}?text=${texto}`} target="_blank" rel="noopener noreferrer">
          <Button size="sm" className="gap-2 bg-[#25D366] text-xs text-white hover:bg-[#1fb855]">
            <MessageCircle className="h-3.5 w-3.5" />
            Mandar no WhatsApp
          </Button>
        </a>
      ) : (
        <span className="text-[11px] text-muted-foreground">Cadastra o WhatsApp dela pra mandar.</span>
      )}
    </div>
  );
}
