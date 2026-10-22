import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { comLimiteDeTempo, textoDeErro } from "@/lib/chamadaAoBanco";
import { apagarAlunaTeste, criarAlunaTeste, podeGerirAlunaTeste } from "@/lib/alunaTeste";
import { atualizarTelasDepoisDeApagarAluna } from "@/lib/telasDaAluna";
import { cn } from "@/lib/utils";

/** Selo que marca a aluna de teste em toda lista e na ficha. */
export function SeloTeste({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 gap-1 border-amber-500 bg-amber-100 px-1.5 py-0 text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
        className,
      )}
      title="Aluna de teste do treinamento do time. Não entra nas contagens."
    >
      <FlaskConical className="h-3 w-3" />
      Teste
    </Badge>
  );
}

/** Cria a aluna de teste e abre a ficha dela. */
export function BotaoCriarAlunaTeste({ onCriada }: { onCriada?: () => void }) {
  const { isAdmin, allowedModules } = useAuth();
  const navigate = useNavigate();
  const [criando, setCriando] = useState(false);

  if (!podeGerirAlunaTeste(isAdmin, allowedModules)) return null;

  const criar = async () => {
    setCriando(true);
    try {
      const nova = await comLimiteDeTempo(criarAlunaTeste());
      toast.success(`${nova.nome} criada`, {
        description: `Telefone de teste: ${nova.telefone}. Quando terminar o treino, apague pela ficha dela.`,
        duration: 10000,
      });
      onCriada?.();
      window.dispatchEvent(new Event("alunas-updated"));
      navigate(`/alunas/ficha/${nova.id}`);
    } catch (e) {
      toast.error(textoDeErro(e, "Não consegui criar a aluna de teste"));
    } finally {
      setCriando(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-2 border-amber-500/60 text-amber-700 hover:bg-amber-50 dark:text-amber-300"
      onClick={criar}
      disabled={criando}
      title="Cria uma aluna de mentira para o time treinar (anamnese, feedback, agenda). Não entra nas contagens."
    >
      {criando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
      Criar aluna de teste
    </Button>
  );
}

interface ApagarProps {
  aluna: { id: string; nomeCompleto: string; isTeste?: boolean };
  onApagada?: () => void;
  /** Só o item de menu/botão; o diálogo é o mesmo. */
  variante?: "botao" | "link";
}

/**
 * "Apagar aluna de teste": só existe para aluna de teste. O banco confere de
 * novo e recusa aluna real.
 */
export function BotaoApagarAlunaTeste({ aluna, onApagada, variante = "botao" }: ApagarProps) {
  const { isAdmin, allowedModules } = useAuth();
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [apagando, setApagando] = useState(false);

  if (aluna.isTeste !== true || !podeGerirAlunaTeste(isAdmin, allowedModules)) return null;

  const apagar = async () => {
    setApagando(true);
    try {
      const r = await comLimiteDeTempo(apagarAlunaTeste(aluna.id));
      toast.success("Aluna de teste apagada", {
        description:
          `Saíram também ${r.anamneses} anamnese(s), ${r.feedbacks} feedback(s) e ${r.tarefas} item(ns) da agenda.` +
          (r.arquivosPendentes ? ` ${r.arquivosPendentes} arquivo(s) não saíram do storage.` : ""),
      });
      setAberto(false);
      // Agenda, check-in e listas soltam o que era dela (sem esperar a busca nova).
      void atualizarTelasDepoisDeApagarAluna(queryClient);
      window.dispatchEvent(new Event("alunas-updated"));
      onApagada?.();
    } catch (e) {
      toast.error(textoDeErro(e, "Não consegui apagar a aluna de teste"));
    } finally {
      setApagando(false);
    }
  };

  return (
    <>
      {variante === "botao" ? (
        <Button variant="destructive" size="sm" className="gap-2" onClick={() => setAberto(true)}>
          <Trash2 className="h-4 w-4" />
          Apagar aluna de teste
        </Button>
      ) : (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="inline-flex items-center gap-1 text-xs font-medium text-destructive hover:underline"
        >
          <Trash2 className="h-3 w-3" />
          Apagar aluna de teste
        </button>
      )}

      <AlertDialog open={aberto} onOpenChange={(v) => !apagando && setAberto(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar {aluna.nomeCompleto}?</AlertDialogTitle>
            <AlertDialogDescription>
              Sai tudo que foi gerado para ela no treino: anamneses, respostas, feedbacks, avisos e tarefas na agenda,
              treino e dieta do app. Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={apagando}>Cancelar</AlertDialogCancel>
            <Button variant="destructive" onClick={apagar} disabled={apagando} className="gap-2">
              {apagando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Apagar de vez
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
