import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft, Camera, CheckCircle2, ClipboardList, Circle, Dumbbell,
  Image as ImageIcon, Loader2, MessageSquare, Phone,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchAluna } from "@/lib/alunaStore";
import { Aluna, DURATION_LABELS, PAYMENT_LABELS, PROGRAM_LABELS } from "@/lib/alunaTypes";
import { AnamnesePainel } from "@/components/alunas/AnamnesePainel";
import { FeedbacksPainel } from "@/components/alunas/FeedbacksPainel";
import { BotaoApagarAlunaTeste, SeloTeste } from "@/components/alunas/AlunaTeste";
import { EMAIL_ALUNA_TESTE, ehAlunaTeste } from "@/lib/alunaTeste";

const dia = (iso?: string) => {
  if (!iso) return null;
  try {
    return format(parseISO(iso), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return null;
  }
};

function Etapa({
  titulo, feito, quando, icone: Icone,
}: {
  titulo: string;
  feito?: boolean;
  quando?: string | null;
  icone: React.ElementType;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-3">
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          feito ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
        }`}
      >
        <Icone className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium">{titulo}</p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {feito ? <CheckCircle2 className="h-3 w-3 text-success" /> : <Circle className="h-3 w-3" />}
          {quando ? quando : feito ? "Feito" : "Pendente"}
        </p>
      </div>
    </div>
  );
}

/**
 * Tudo sobre uma aluna numa tela só: em que pé está a entrega dela, os
 * feedbacks que ela já mandou e a anamnese preenchida.
 */
export default function AlunaFicha() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [aluna, setAluna] = useState<Aluna | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!id) return;
    setCarregando(true);
    try {
      setAluna(await fetchAluna(id));
      setErro(null);
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar essa aluna");
    } finally {
      setCarregando(false);
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (carregando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!aluna) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <p className="text-muted-foreground">{erro ?? "Aluna não encontrada."}</p>
        <Link to="/alunas/personal-nutri">
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Voltar pro painel
          </Button>
        </Link>
      </div>
    );
  }

  // A reavaliação é 35 dias depois das fotos. Se ainda não tem data marcada na
  // mão, mostra a conta.
  const reavaliacao =
    aluna.dataAvaliacao ??
    (aluna.dataFotosAnamnese
      ? format(addDays(parseISO(aluna.dataFotosAnamnese), 35), "yyyy-MM-dd")
      : undefined);

  // O telefone da aluna de teste é fictício (DDD 00): sem botão de WhatsApp.
  const zap = ehAlunaTeste(aluna) ? undefined : aluna.telefone?.replace(/\D/g, "");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-card/80 backdrop-blur-sm">
        <div className="container mx-auto flex max-w-5xl items-center gap-3 px-4 py-4">
          <Link to="/alunas/personal-nutri">
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">
            {aluna.nomeCompleto.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate font-display text-xl font-bold tracking-tight">
                {aluna.nomeCompleto}
              </h1>
              {ehAlunaTeste(aluna) && <SeloTeste />}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {PROGRAM_LABELS[aluna.programa] ?? aluna.programa} · {DURATION_LABELS[aluna.duracaoPlano]} ·{" "}
              {PAYMENT_LABELS[aluna.formaPagamento]}
            </p>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl space-y-6 px-4 py-6">
        {ehAlunaTeste(aluna) && (
          <Card className="flex flex-col gap-3 border-amber-500/60 bg-amber-50 p-5 dark:bg-amber-950/20 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-amber-900 dark:text-amber-200">Aluna de teste, para treinar o time</p>
              <p className="text-amber-900/80 dark:text-amber-200/80">
                Não entra nas contagens. Nos formulários (feedback, anamnese), use o telefone{" "}
                <strong>{aluna.telefone ?? "—"}</strong>
                {" "}e, se pedirem e-mail, <strong>{EMAIL_ALUNA_TESTE}</strong>. Terminou o treino? Apague para não confundir.
              </p>
            </div>
            <BotaoApagarAlunaTeste aluna={aluna} onApagada={() => navigate("/alunas")} />
          </Card>
        )}

        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={aluna.pago ? "default" : "outline"}>
              {aluna.pago ? "Pago" : "Pagamento pendente"}
            </Badge>
            {aluna.status === "inativa" && <Badge variant="destructive">Inativa</Badge>}
            <span className="text-xs text-muted-foreground">
              Comprou {dia(aluna.dataCompra) ?? "—"} · Vence {dia(aluna.dataVencimento) ?? "—"}
            </span>
            {zap && (
              <a
                href={`https://wa.me/${zap.startsWith("55") ? zap : `55${zap}`}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto"
              >
                <Button variant="outline" size="sm" className="gap-2">
                  <Phone className="h-3.5 w-3.5" />
                  {aluna.telefone}
                </Button>
              </a>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Etapa
              titulo="Anamnese e MFIT"
              feito={aluna.anamneseMfit}
              icone={ClipboardList}
            />
            <Etapa
              titulo="Enviou as fotos"
              feito={aluna.fotosAnamnese || !!aluna.dataFotosAnamnese}
              quando={dia(aluna.dataFotosAnamnese)}
              icone={Camera}
            />
            <Etapa
              titulo="Treino e dieta liberados"
              feito={aluna.liberouTreinoDieta}
              icone={Dumbbell}
            />
            <Etapa titulo="Fotos liberadas" feito={aluna.liberouFotos} icone={ImageIcon} />
            <Etapa
              titulo="Reavaliação (35 dias)"
              feito={!!aluna.dataAvaliacao}
              quando={dia(reavaliacao)}
              icone={Camera}
            />
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <MessageSquare className="h-4 w-4 text-primary" />
            Feedbacks dela
          </h2>
          <FeedbacksPainel alunaId={aluna.id} alunaTelefone={aluna.telefone} />
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <ClipboardList className="h-4 w-4 text-primary" />
            Anamnese dela
          </h2>
          <AnamnesePainel
            alunaId={aluna.id}
            alunaNome={aluna.nomeCompleto}
            alunaTelefone={aluna.telefone}
          />
        </Card>
      </main>
    </div>
  );
}
