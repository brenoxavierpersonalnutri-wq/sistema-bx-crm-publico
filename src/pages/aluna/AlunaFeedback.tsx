import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, MessageSquareHeart, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { AlunaShell } from "@/components/aluna/AlunaShell";
import { useAlunaAuth } from "@/hooks/useAlunaAuth";
import { fetchCiclo, fetchFeedbacks, enviarFeedback } from "@/lib/appAluna/store";
import { PERIODICIDADE_LABELS } from "@/lib/appAluna/types";

const hoje = () => new Date().toISOString().slice(0, 10);

const formatarData = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

export default function AlunaFeedback() {
  const { perfil } = useAlunaAuth();
  const qc = useQueryClient();

  const [peso, setPeso] = useState("");
  const [adesaoDieta, setAdesaoDieta] = useState(8);
  const [adesaoTreino, setAdesaoTreino] = useState(8);
  const [energia, setEnergia] = useState(7);
  const [sono, setSono] = useState(7);
  const [intestino, setIntestino] = useState("");
  const [dificuldades, setDificuldades] = useState("");
  const [observacao, setObservacao] = useState("");

  const { data: ciclo } = useQuery({
    queryKey: ["meu-ciclo", perfil?.alunaId],
    queryFn: () => (perfil ? fetchCiclo(perfil.alunaId) : Promise.resolve(null)),
    enabled: !!perfil,
  });

  const { data: historico = [], isLoading } = useQuery({
    queryKey: ["meus-feedbacks", perfil?.alunaId],
    queryFn: () => (perfil ? fetchFeedbacks(perfil.alunaId) : Promise.resolve([])),
    enabled: !!perfil,
  });

  const jaEnviouHoje = historico.some((f) => f.dataReferencia === hoje());

  const enviar = useMutation({
    mutationFn: () => {
      if (!perfil) throw new Error("Sessão expirada");
      return enviarFeedback({
        alunaId: perfil.alunaId,
        dataReferencia: hoje(),
        peso: peso ? Number(peso.replace(",", ".")) : null,
        adesaoDieta, adesaoTreino, energia, sono,
        intestino: intestino || null,
        dificuldades: dificuldades || null,
        observacao: observacao || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meus-feedbacks"] });
      setDificuldades("");
      setObservacao("");
      toast.success("Feedback enviado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AlunaShell titulo="Feedback">
      <div className="space-y-6">
        {ciclo?.ativo && (
          <div className="flex items-center gap-3 rounded-2xl border border-accent/20 bg-accent/[0.06] p-4">
            <CalendarClock className="h-5 w-5 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                Feedback {PERIODICIDADE_LABELS[ciclo.periodicidade].toLowerCase()}
              </p>
              <p className="text-xs text-muted-foreground">
                Próximo em {formatarData(ciclo.proximaData)}
              </p>
            </div>
          </div>
        )}

        {jaEnviouHoje ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
            <MessageSquareHeart className="mx-auto mb-2 h-7 w-7 text-emerald-400" />
            <p className="font-semibold">Feedback de hoje enviado</p>
            <p className="mt-1 text-sm text-muted-foreground">
              O Breno responde por aqui mesmo. Você recebe a resposta abaixo.
            </p>
          </div>
        ) : (
          <section className="space-y-5 rounded-2xl border border-white/5 bg-card/60 p-5">
            <h2 className="font-display text-lg font-semibold">Como foi seu período?</h2>

            <div className="space-y-2">
              <Label htmlFor="fb-peso">Peso de hoje (kg)</Label>
              <Input
                id="fb-peso" inputMode="decimal"
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
                placeholder="62,4"
              />
            </div>

            <NotaSlider rotulo="Segui a dieta" valor={adesaoDieta} onChange={setAdesaoDieta} />
            <NotaSlider rotulo="Fiz os treinos" valor={adesaoTreino} onChange={setAdesaoTreino} />
            <NotaSlider rotulo="Energia no dia a dia" valor={energia} onChange={setEnergia} />
            <NotaSlider rotulo="Qualidade do sono" valor={sono} onChange={setSono} />

            <div className="space-y-2">
              <Label htmlFor="fb-int">Intestino</Label>
              <Input
                id="fb-int"
                value={intestino}
                onChange={(e) => setIntestino(e.target.value)}
                placeholder="Regular, preso, solto…"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fb-dif">O que travou</Label>
              <Textarea
                id="fb-dif" rows={3}
                value={dificuldades}
                onChange={(e) => setDificuldades(e.target.value)}
                placeholder="Refeição que não deu certo, treino que faltou…"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fb-obs">Mais alguma coisa</Label>
              <Textarea
                id="fb-obs" rows={3}
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
              />
            </div>

            <Button
              className="w-full gap-2"
              disabled={enviar.isPending}
              onClick={() => enviar.mutate()}
            >
              <Send className="h-4 w-4" />
              {enviar.isPending ? "Enviando…" : "Enviar feedback"}
            </Button>
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Histórico</h2>

          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : historico.length === 0 ? (
            <p className="rounded-2xl border border-white/5 bg-card/40 p-6 text-center text-sm text-muted-foreground">
              Nenhum feedback enviado ainda.
            </p>
          ) : (
            historico.map((f) => (
              <article key={f.id} className="space-y-3 rounded-2xl border border-white/5 bg-card/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{formatarData(f.dataReferencia)}</p>
                  {f.peso != null && (
                    <Badge variant="outline" className="tabular-nums">{f.peso} kg</Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                  {[
                    { l: "Dieta", v: f.adesaoDieta },
                    { l: "Treino", v: f.adesaoTreino },
                    { l: "Energia", v: f.energia },
                    { l: "Sono", v: f.sono },
                  ].filter((m) => m.v != null).map((m) => (
                    <div key={m.l}>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.l}</p>
                      <p className="text-sm font-semibold tabular-nums">{m.v}/10</p>
                    </div>
                  ))}
                </div>

                {f.respostaTime && (
                  <div className="rounded-xl border-l-2 border-accent bg-accent/[0.06] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-accent">Resposta do Breno</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm">{f.respostaTime}</p>
                  </div>
                )}
              </article>
            ))
          )}
        </section>
      </div>
    </AlunaShell>
  );
}

function NotaSlider({
  rotulo, valor, onChange,
}: {
  rotulo: string;
  valor: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{rotulo}</Label>
        <span className="text-sm font-semibold tabular-nums text-accent">{valor}/10</span>
      </div>
      <Slider
        value={[valor]}
        onValueChange={([v]) => onChange(v)}
        min={0} max={10} step={1}
        aria-label={rotulo}
      />
    </div>
  );
}
