import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

interface LeadFormResponsesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientName: string;
  clientPhone?: string | null;
}

interface FormResponse {
  id: string;
  created_at: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  score: number;
  nivel: string;
  p1_objetivo: string | null;
  p2_situacao: string | null;
  p3_profissao: string | null;
  p4_altura: number | null;
  p4_peso: number | null;
  p4_idade: number | null;
  p5_estrategias: string | null;
  p6_caneta: string | null;
  p7_acompanhamento: string | null;
  p8_investimento: string | null;
  p9_prioridade: string | null;
  renda_mensal: string | null;
  instagram: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
}

const QUESTION_LABELS: Record<string, { label: string; options?: Record<string, string> }> = {
  p1_objetivo: {
    label: "1. Qual seu principal objetivo?",
    options: {
      emagrecer: "Emagrecer",
      perder_gordura_definir: "Perder gordura e definir",
      definido_slim: "Ficar definido / slim",
      volume_muscular: "Ganhar volume muscular",
    },
  },
  p2_situacao: { label: "2. Situação atual" },
  p3_profissao: { label: "3. Profissão" },
  p5_estrategias: {
    label: "5. Sobre estratégias anteriores",
    options: {
      nao_entregam: "Não entregam o que prometem",
      demoro_muito: "Demoro muito para ver resultado",
      consigo_resultado: "Consigo resultado sozinho(a)",
    },
  },
  p6_caneta: {
    label: "6. Uso de caneta emagrecedora",
    options: {
      uso_atual: "Uso atualmente",
      ja_usei: "Já usei",
      nunca_usei: "Nunca usei",
    },
  },
  p7_acompanhamento: {
    label: "7. Já teve acompanhamento profissional?",
    options: {
      nutricional: "Nutricional",
      treino: "Treino",
      ambos: "Ambos",
      nunca: "Nunca tive",
    },
  },
  p8_investimento: {
    label: "8. Quanto já investiu por mês",
    options: {
      abaixo_100: "Abaixo de R$ 100",
      "100_250": "R$ 100 - 250",
      "250_400": "R$ 250 - 400",
      "400_600": "R$ 400 - 600",
      "600_1000": "R$ 600 - 1000",
      acima_1000: "Acima de R$ 1000",
    },
  },
  p9_prioridade: {
    label: "9. Prioridade para começar",
    options: {
      imediato: "Quero começar imediatamente",
      futuramente: "Futuramente",
      pensar: "Ainda preciso pensar",
    },
  },
  renda_mensal: {
    label: "10. Renda mensal",
    options: {
      ate_2k: "Até R$2.000",
      "2k_4k": "De R$2.000 a R$4.000",
      "5k_8k": "De R$5.000 a R$8.000",
      "9k_15k": "De R$9.000 a R$15.000",
      acima_15k: "Acima de R$15.000",
    },
  },
};

function formatAnswer(key: string, value: string | null): string {
  if (!value) return "—";
  const config = QUESTION_LABELS[key];
  if (config?.options?.[value]) return config.options[value];
  return value;
}

function nivelColor(nivel: string): string {
  switch (nivel) {
    case "A": return "bg-emerald-500 text-white";
    case "B": return "bg-blue-500 text-white";
    case "C": return "bg-yellow-500 text-black";
    case "D": return "bg-orange-500 text-white";
    default: return "bg-red-500 text-white";
  }
}

function normalizePhone(phone?: string | null): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

export function LeadFormResponsesDialog({ open, onOpenChange, clientName, clientPhone }: LeadFormResponsesDialogProps) {
  const [loading, setLoading] = useState(false);
  const [responses, setResponses] = useState<FormResponse[]>([]);

  useEffect(() => {
    if (!open) return;
    const fetchResponses = async () => {
      setLoading(true);
      try {
        const phoneDigits = normalizePhone(clientPhone);
        let query = supabase
          .from("lead_form_responses")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(10);

        if (phoneDigits) {
          // Match by phone (last 8-11 digits to be tolerant)
          const tail = phoneDigits.slice(-9);
          query = query.ilike("telefone", `%${tail}%`);
        } else if (clientName) {
          query = query.ilike("nome", `%${clientName}%`);
        }

        const { data, error } = await query;
        if (error) throw error;
        setResponses((data ?? []) as unknown as FormResponse[]);
      } catch (err) {
        console.error("Erro ao buscar respostas:", err);
        setResponses([]);
      } finally {
        setLoading(false);
      }
    };
    fetchResponses();
  }, [open, clientName, clientPhone]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Respostas do formulário — {clientName}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-col gap-0.5 text-sm text-muted-foreground">
              {clientPhone && <span>Telefone: {clientPhone}</span>}
              {responses[0]?.instagram && (
                <a
                  href={`https://instagram.com/${responses[0].instagram.replace(/^@/, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  @{responses[0].instagram.replace(/^@/, "")}
                </a>
              )}
              {!clientPhone && !responses[0]?.instagram && "Buscando por nome"}
            </div>
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : responses.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma resposta de formulário encontrada para este lead.
          </div>
        ) : (
          <div className="space-y-6">
            {responses.map((r) => (
              <div key={r.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Badge className={nivelColor(r.nivel)}>{r.nivel}</Badge>
                    <span className="text-sm font-semibold">{r.score}/80 pts</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {format(parseISO(r.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">{QUESTION_LABELS.p1_objetivo.label}</p>
                    <p className="font-medium">{formatAnswer("p1_objetivo", r.p1_objetivo)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{QUESTION_LABELS.p2_situacao.label}</p>
                    <p className="font-medium">{formatAnswer("p2_situacao", r.p2_situacao)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{QUESTION_LABELS.p3_profissao.label}</p>
                    <p className="font-medium">{formatAnswer("p3_profissao", r.p3_profissao)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">4. Dados físicos</p>
                    <p className="font-medium">
                      {r.p4_altura ?? "—"} cm · {r.p4_peso ?? "—"} kg · {r.p4_idade ?? "—"} anos
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{QUESTION_LABELS.p5_estrategias.label}</p>
                    <p className="font-medium">{formatAnswer("p5_estrategias", r.p5_estrategias)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{QUESTION_LABELS.p6_caneta.label}</p>
                    <p className="font-medium">{formatAnswer("p6_caneta", r.p6_caneta)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{QUESTION_LABELS.p7_acompanhamento.label}</p>
                    <p className="font-medium">{formatAnswer("p7_acompanhamento", r.p7_acompanhamento)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{QUESTION_LABELS.p8_investimento.label}</p>
                    <p className="font-medium">{formatAnswer("p8_investimento", r.p8_investimento)}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs text-muted-foreground">{QUESTION_LABELS.p9_prioridade.label}</p>
                    <p className="font-medium">{formatAnswer("p9_prioridade", r.p9_prioridade)}</p>
                  </div>
                  {r.renda_mensal && (
                    <div className="sm:col-span-2">
                      <p className="text-xs text-muted-foreground">{QUESTION_LABELS.renda_mensal.label}</p>
                      <p className="font-medium">{formatAnswer("renda_mensal", r.renda_mensal)}</p>
                    </div>
                  )}
                </div>

                {(r.utm_source || r.utm_campaign) && (
                  <div className="pt-2 border-t flex gap-2 flex-wrap text-[10px]">
                    {r.utm_source && <Badge variant="outline">src: {r.utm_source}</Badge>}
                    {r.utm_campaign && <Badge variant="outline">camp: {r.utm_campaign}</Badge>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
