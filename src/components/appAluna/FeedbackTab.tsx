import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { fetchCiclo, salvarCiclo, fetchFeedbacks, responderFeedback } from "@/lib/appAluna/store";
import {
  PERIODICIDADE_DIAS, PERIODICIDADE_LABELS, type Periodicidade,
} from "@/lib/appAluna/types";

const hoje = () => new Date().toISOString().slice(0, 10);

const formatarData = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

export function FeedbackTab({ alunaId }: { alunaId: string }) {
  const qc = useQueryClient();

  const { data: ciclo } = useQuery({
    queryKey: ["feedback-ciclo", alunaId],
    queryFn: () => fetchCiclo(alunaId),
  });

  const { data: respostas = [], isLoading } = useQuery({
    queryKey: ["feedbacks", alunaId],
    queryFn: () => fetchFeedbacks(alunaId),
  });

  const [periodicidade, setPeriodicidade] = useState<Periodicidade>("quinzenal");
  const [proximaData, setProximaData] = useState(hoje());
  const [tocado, setTocado] = useState(false);

  // Enquanto o time não mexeu nos campos, eles espelham o que está salvo
  const periodicidadeAtual = tocado ? periodicidade : (ciclo?.periodicidade ?? "quinzenal");
  const proximaAtual = tocado ? proximaData : (ciclo?.proximaData ?? hoje());

  const salvar = useMutation({
    mutationFn: () => salvarCiclo({
      alunaId,
      periodicidade: periodicidadeAtual,
      proximaData: proximaAtual,
      ativo: true,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feedback-ciclo", alunaId] });
      setTocado(false);
      toast.success("Periodicidade salva");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold">Ritmo do feedback</h3>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Periodicidade</Label>
              <Select
                value={periodicidadeAtual}
                onValueChange={(v) => { setTocado(true); setPeriodicidade(v as Periodicidade); }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PERIODICIDADE_LABELS) as Periodicidade[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PERIODICIDADE_LABELS[p]} ({PERIODICIDADE_DIAS[p]} dias)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fb-prox">Próximo envio</Label>
              <Input
                id="fb-prox" type="date"
                value={proximaAtual}
                onChange={(e) => { setTocado(true); setProximaData(e.target.value); }}
              />
            </div>
            <div className="flex items-end">
              <Button className="w-full" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
                {salvar.isPending ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h3 className="font-semibold">Feedbacks recebidos</h3>

        {isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : respostas.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <MessageSquare className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Nenhum feedback enviado ainda.
              </p>
            </CardContent>
          </Card>
        ) : (
          respostas.map((r) => <FeedbackCard key={r.id} resposta={r} alunaId={alunaId} />)
        )}
      </div>
    </div>
  );
}

function FeedbackCard({
  resposta, alunaId,
}: {
  resposta: import("@/lib/appAluna/types").FeedbackResposta;
  alunaId: string;
}) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");

  const responder = useMutation({
    mutationFn: () => responderFeedback(resposta.id, texto.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feedbacks", alunaId] });
      setTexto("");
      toast.success("Resposta enviada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const metricas = [
    { label: "Peso", valor: resposta.peso != null ? `${resposta.peso} kg` : null },
    { label: "Dieta", valor: resposta.adesaoDieta != null ? `${resposta.adesaoDieta}/10` : null },
    { label: "Treino", valor: resposta.adesaoTreino != null ? `${resposta.adesaoTreino}/10` : null },
    { label: "Energia", valor: resposta.energia != null ? `${resposta.energia}/10` : null },
    { label: "Sono", valor: resposta.sono != null ? `${resposta.sono}/10` : null },
  ].filter((m) => m.valor);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">{formatarData(resposta.dataReferencia)}</p>
          {resposta.respondidoEm
            ? <Badge variant="secondary" className="text-[10px]">Respondido</Badge>
            : <Badge className="text-[10px]">Aguardando resposta</Badge>}
        </div>

        {metricas.length > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {metricas.map((m) => (
              <div key={m.label}>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.label}</p>
                <p className="text-sm font-semibold tabular-nums">{m.valor}</p>
              </div>
            ))}
          </div>
        )}

        {resposta.dificuldades && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Dificuldades</p>
            <p className="text-sm">{resposta.dificuldades}</p>
          </div>
        )}
        {resposta.observacao && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Observações</p>
            <p className="text-sm">{resposta.observacao}</p>
          </div>
        )}

        {resposta.respostaTime ? (
          <div className="rounded-lg border-l-2 border-primary bg-muted/50 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Resposta enviada</p>
            <p className="whitespace-pre-wrap text-sm">{resposta.respostaTime}</p>
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            <Textarea
              rows={3}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Ajuste direto e curto. Ela lê isso no app."
            />
            <Button
              size="sm" className="gap-2"
              disabled={!texto.trim() || responder.isPending}
              onClick={() => responder.mutate()}
            >
              <Send className="h-3.5 w-3.5" />
              {responder.isPending ? "Enviando…" : "Responder"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
