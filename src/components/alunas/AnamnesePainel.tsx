import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, Copy, Loader2, Plus, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ANSIEDADE, BEBIDA_ALCOOLICA, DEFINE_ALIMENTACAO, DESCONTA_ESTRESSE,
  DIAS_DISPONIVEIS, ESFORCO_DIARIO, FUMA, HORAS_SONO, HORAS_TRABALHO,
  INGESTAO_DOCES, INTESTINO_ANAMNESE, QUALIDADE_SONO, SIM_NAO, TEMPO_SESSAO,
  TREINA_MUSCULACAO, TREINA_ONDE, rotuloAnamnese, rotulosAnamnese,
} from "@/types/anamnese";
import type { AnamneseResposta } from "@/types/anamnese";
import { linkPublico } from "@/lib/linkPublico";
import { comLimiteDeTempo, textoDeErro } from "@/lib/chamadaAoBanco";

interface Props {
  alunaId: string | null;
  alunaNome: string;
  alunaTelefone?: string;
}

type Linha = AnamneseResposta & { id: string; token: string; created_at: string; status?: string; respondida_em?: string | null };

/**
 * Qual anamnese a ficha mostra. As linhas vêm da mais nova pra mais velha.
 *
 * A resposta é a última RESPONDIDA, mesmo que exista uma pendente mais nova:
 * um "Gerar nova anamnese" (ou o botão de boas-vindas) depois que ela
 * respondeu cria uma linha pendente por cima, e a ficha não pode esconder as
 * respostas atrás de um "Aguardando resposta".
 *
 * A pendente só conta se for mais nova que a respondida (é o link novo que o
 * time gerou); pendente velha, de antes da resposta, é link morto.
 */
export function escolherAnamnese<T extends { status?: string; created_at: string }>(
  linhas: T[],
): { respondida: T | undefined; pendente: T | undefined } {
  const respondida = linhas.find((l) => l.status === "respondida");
  const pendente = linhas.find(
    (l) => l.status !== "respondida" && (!respondida || l.created_at > respondida.created_at),
  );
  return { respondida, pendente };
}

const tabela = (nome: string) => supabase.from(nome as never);

function Campo({ label, valor }: { label: string; valor?: string | number | null }) {
  if (valor === null || valor === undefined || valor === "") return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="whitespace-pre-line text-sm">{valor}</p>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">{titulo}</p>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

/**
 * A anamnese da aluna: o link dela enquanto está pendente, e as respostas
 * inteiras depois que ela preenche.
 */
export function AnamnesePainel({ alunaId, alunaNome, alunaTelefone }: Props) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function carregar(id: string) {
    setCarregando(true);
    try {
      // Com limite de tempo: sem ele, uma consulta que o banco não responde
      // deixa o painel girando pra sempre, sem erro e sem saída.
      const { data, error } = await comLimiteDeTempo(
        Promise.resolve(
          tabela("anamnese_respostas")
            .select("*")
            .eq("aluna_id", id)
            .order("created_at", { ascending: false }),
        ),
      );
      if (error) throw error;
      setLinhas((data ?? []) as unknown as Linha[]);
    } catch (e: unknown) {
      toast.error(textoDeErro(e, "Não consegui carregar a anamnese"));
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    if (alunaId) void carregar(alunaId);
    else setLinhas([]);
  }, [alunaId]);

  const { respondida, pendente } = useMemo(() => escolherAnamnese(linhas), [linhas]);
  // `atual` é o que tem resposta pra mostrar; sem resposta, é a pendente.
  const atual = respondida ?? pendente;
  const link = useMemo(
    () => (pendente ? linkPublico(`/anamnese/${pendente.token}`) : ""),
    [pendente],
  );

  async function gerar() {
    if (!alunaId) return;
    setGerando(true);
    try {
      const { error } = await comLimiteDeTempo(
        Promise.resolve(tabela("anamnese_respostas").insert({ aluna_id: alunaId } as never)),
      );
      if (error) throw error;
      toast.success("Anamnese gerada. Manda o link pra aluna.");
      await carregar(alunaId);
    } catch (e: unknown) {
      toast.error(textoDeErro(e, "Não consegui gerar a anamnese"));
    } finally {
      setGerando(false);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não consegui copiar. Seleciona o link e copia na mão.");
    }
  }

  const zap = alunaTelefone?.replace(/\D/g, "");
  const linkZap = zap
    ? `https://wa.me/${zap.startsWith("55") ? zap : `55${zap}`}?text=${encodeURIComponent(
        `Oi ${alunaNome.split(" ")[0]}! Preenche tua anamnese inicial por aqui, é de onde sai teu treino e tua dieta: ${link}`,
      )}`
    : null;

  if (carregando) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!atual) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-muted-foreground">
          Essa aluna ainda não tem anamnese. Gera aqui e manda o link pra ela.
        </p>
        <Button onClick={gerar} disabled={gerando} className="mt-4 gap-2">
          {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Gerar anamnese
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={atual.status === "respondida" ? "default" : "outline"}>
          {atual.status === "respondida" ? "Respondida" : "Aguardando resposta"}
        </Badge>
        {atual.respondida_em && (
          <span className="text-xs text-muted-foreground">
            {format(parseISO(atual.respondida_em), "dd 'de' MMMM", { locale: ptBR })}
          </span>
        )}
      </div>

      {pendente && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          {respondida && (
            <p className="text-xs font-medium">
              Tem uma anamnese nova aguardando resposta. As respostas abaixo são da última que ela enviou.
            </p>
          )}
          <p className="text-xs text-muted-foreground">Link só dela:</p>
          <p className="break-all rounded bg-muted px-2 py-1 text-xs">{link}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={copiar} className="gap-2">
              {copiado ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copiado ? "Copiado" : "Copiar link"}
            </Button>
            {linkZap && (
              <a href={linkZap} target="_blank" rel="noopener noreferrer">
                <Button size="sm" className="gap-2">
                  <ExternalLink className="h-3 w-3" />
                  Mandar no WhatsApp
                </Button>
              </a>
            )}
          </div>
        </div>
      )}

      {respondida && (
        <>
          <Bloco titulo="Quem é ela">
            <Campo label="Nome" valor={atual.nome_completo} />
            <Campo label="Instagram" valor={atual.instagram} />
            <Campo label="Nascimento" valor={atual.data_nascimento} />
            <Campo label="Profissão" valor={atual.profissao} />
            <Campo label="Peso e altura" valor={atual.peso_altura} />
            <Campo label="Treina onde" valor={rotuloAnamnese(TREINA_ONDE, atual.treina_onde)} />
            <Campo label="Restrição médica" valor={atual.restricao_medica} />
            <Campo label="Ansiedade" valor={rotuloAnamnese(ANSIEDADE, atual.ansiedade)} />
            <Campo label="Horas de trabalho" valor={rotuloAnamnese(HORAS_TRABALHO, atual.horas_trabalho)} />
            <Campo label="Esforço diário" valor={rotuloAnamnese(ESFORCO_DIARIO, atual.esforco_diario)} />
            <Campo label="Horas de sono" valor={rotuloAnamnese(HORAS_SONO, atual.horas_sono)} />
            <Campo label="Qualidade do sono" valor={rotuloAnamnese(QUALIDADE_SONO, atual.qualidade_sono)} />
            <Campo label="Intestino" valor={rotuloAnamnese(INTESTINO_ANAMNESE, atual.intestino)} />
          </Bloco>

          <Bloco titulo="O que ela quer">
            <Campo label="Já atingiu o objetivo" valor={atual.objetivo_atingido} />
            <Campo label="3 coisas que mais incomodam" valor={atual.tres_incomodos} />
            <Campo label="Modelo de corpo" valor={atual.modelo_corpo} />
            <Campo label="Histórico do corpo" valor={atual.historico_corpo} />
          </Bloco>

          <Bloco titulo="Treino">
            <Campo label="Dores" valor={atual.dores} />
            <Campo
              label="Musculação"
              valor={
                atual.treina_musculacao === "outro"
                  ? atual.treina_musculacao_outro || "Outro"
                  : rotuloAnamnese(TREINA_MUSCULACAO, atual.treina_musculacao)
              }
            />
            <Campo label="Dias disponíveis" valor={rotulosAnamnese(DIAS_DISPONIVEIS, atual.dias_disponiveis)} />
            <Campo label="Tempo por sessão" valor={rotuloAnamnese(TEMPO_SESSAO, atual.tempo_sessao)} />
            <Campo label="Outro exercício" valor={atual.outro_exercicio} />
            <Campo label="Comentário" valor={atual.comentario_treino} />
          </Bloco>

          <Bloco titulo="Alimentação">
            <Campo label="Acompanhamento nutricional" valor={atual.acompanhamento_nutricional} />
            <Campo label="Restrição alimentar" valor={atual.restricao_alimentar} />
            <Campo label="Define a alimentação" valor={rotuloAnamnese(DEFINE_ALIMENTACAO, atual.define_alimentacao)} />
            <Campo label="Bebida alcoólica" valor={rotuloAnamnese(BEBIDA_ALCOOLICA, atual.bebida_alcoolica)} />
            <Campo label="Fuma" valor={rotuloAnamnese(FUMA, atual.fuma)} />
            <Campo label="Doces" valor={rotuloAnamnese(INGESTAO_DOCES, atual.ingestao_doces)} />
            <Campo label="O que atrapalha" valor={atual.dificuldade_alimentacao} />
            <Campo label="Leva refeição pro trabalho" valor={rotuloAnamnese(SIM_NAO, atual.leva_refeicoes)} />
            <Campo label="Histórico cardiovascular na família" valor={rotuloAnamnese(SIM_NAO, atual.historico_cardiovascular)} />
            <Campo label="Refeições por dia" valor={atual.refeicoes_dia} />
            <Campo label="Suplemento" valor={atual.suplemento} />
            <Campo label="Medicação" valor={atual.medicacao} />
            <Campo label="Desconta estresse na comida" valor={rotuloAnamnese(DESCONTA_ESTRESSE, atual.desconta_estresse)} />
          </Bloco>

          <Bloco titulo="Prontidão">
            <Campo label="Pronta pra mudar" valor={atual.pronta_mudanca != null ? `${atual.pronta_mudanca}/10` : null} />
            <Campo label="Capaz de mudar" valor={atual.capaz_mudanca != null ? `${atual.capaz_mudanca}/10` : null} />
            <Campo label="Suporte ao redor" valor={atual.suporte_ambiente != null ? `${atual.suporte_ambiente}/10` : null} />
          </Bloco>

          <div className="space-y-2 rounded-lg border border-border p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Rotina alimentar
            </p>
            <p className="whitespace-pre-line text-sm">{atual.rotina_alimentar}</p>
          </div>
        </>
      )}

      <Button variant="outline" size="sm" onClick={gerar} disabled={gerando} className="gap-2">
        {gerando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        Gerar nova anamnese
      </Button>
    </div>
  );
}
