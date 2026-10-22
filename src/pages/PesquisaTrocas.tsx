import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { C } from "@/components/feedback/FeedbackUI";

interface Resposta {
  id: string;
  criado_em: string;
  nota: number;
  nao_achou: string | null;
  sugestao: string | null;
  modo: "alimento" | "refeicao" | null;
  alimentos: string[] | null;
  trocas: string[] | null;
}

async function busca(): Promise<Resposta[]> {
  const { data, error } = await supabase
    .from("feedback_substituicoes" as never)
    .select("*")
    .order("criado_em", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as unknown as Resposta[];
}

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Cor da nota: o que o Breno olha primeiro é onde está vermelho. */
function corDaNota(n: number) {
  if (n >= 9) return C.green;
  if (n >= 7) return C.yellow;
  return C.red;
}

function Caixa({ children, titulo }: { children: React.ReactNode; titulo?: string }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: C.card, border: `1px solid ${C.border}` }}
    >
      {titulo && (
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: C.textDim }}>
          {titulo}
        </h2>
      )}
      {children}
    </div>
  );
}

/**
 * O que as alunas acharam da tela de trocas. A conta que importa não é a média:
 * é a lista do que elas procuraram e não acharam, que diz o que falta na base.
 */
export default function PesquisaTrocas() {
  const { data: tudo = [], isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["feedback-substituicoes"],
    queryFn: busca,
  });
  const [dias, setDias] = useState<number | null>(30);
  const [filtro, setFiltro] = useState("");

  const respostas = useMemo(() => {
    const limite = dias ? Date.now() - dias * 24 * 60 * 60 * 1000 : 0;
    const q = filtro.trim().toLowerCase();
    return tudo.filter((r) => {
      if (limite && new Date(r.criado_em).getTime() < limite) return false;
      if (!q) return true;
      const texto = [r.nao_achou, r.sugestao, ...(r.alimentos ?? []), ...(r.trocas ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return texto.includes(q);
    });
  }, [tudo, dias, filtro]);

  const media = respostas.length
    ? Math.round((respostas.reduce((s, r) => s + r.nota, 0) / respostas.length) * 10) / 10
    : null;
  const promotoras = respostas.filter((r) => r.nota >= 9).length;
  const detratoras = respostas.filter((r) => r.nota <= 6).length;
  const nps = respostas.length
    ? Math.round(((promotoras - detratoras) / respostas.length) * 100)
    : null;

  /** O que mais falta na base: o texto do "não achei", agrupado. */
  const faltando = useMemo(() => {
    const conta = new Map<string, number>();
    respostas.forEach((r) => {
      const t = (r.nao_achou ?? "").trim().toLowerCase();
      if (!t) return;
      conta.set(t, (conta.get(t) ?? 0) + 1);
    });
    return [...conta.entries()].sort((a, b) => b[1] - a[1]);
  }, [respostas]);

  /** O que elas mais trocam: diz onde a tela está sendo usada de verdade. */
  const maisTrocado = useMemo(() => {
    const conta = new Map<string, number>();
    respostas.forEach((r) =>
      (r.alimentos ?? []).forEach((a) => {
        const nome = a.replace(/\s+\d+[\d,.]*\s*(g|ml|unidades?|un)$/i, "").trim();
        if (nome) conta.set(nome, (conta.get(nome) ?? 0) + 1);
      }),
    );
    return [...conta.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [respostas]);

  const distribuicao = useMemo(() => {
    const barras = Array.from({ length: 11 }, (_, n) => respostas.filter((r) => r.nota === n).length);
    const maior = Math.max(1, ...barras);
    return { barras, maior };
  }, [respostas]);

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh" }}>
      <header style={{ borderBottom: `1px solid ${C.border}`, background: C.card }} className="sticky top-0 z-10">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <Link to="/alunas" style={{ color: C.textDim }} aria-label="Voltar">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="font-semibold" style={{ fontSize: 18 }}>
                Pesquisa da tela de trocas
              </h1>
              <p className="text-xs" style={{ color: C.textDim }}>
                O que a aluna respondeu depois de trocar um alimento
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-lg p-2"
            style={{ border: `1px solid ${C.border}`, color: C.textDim }}
            aria-label="Atualizar"
          >
            <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { r: "30 dias", d: 30 },
            { r: "90 dias", d: 90 },
            { r: "tudo", d: null },
          ].map(({ r, d }) => (
            <button
              key={r}
              type="button"
              onClick={() => setDias(d)}
              className="rounded-lg px-3 py-1.5 text-sm"
              style={{
                border: `1px solid ${dias === d ? C.brand : C.border}`,
                color: dias === d ? C.brand : C.textDim,
              }}
            >
              {r}
            </button>
          ))}
          <span
            className="ml-auto flex items-center gap-2 rounded-lg px-3 py-1.5"
            style={{ border: `1px solid ${C.border}` }}
          >
            <Search className="h-4 w-4" style={{ color: C.textDim }} />
            <input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Procurar no texto ou no alimento"
              className="bg-transparent text-sm outline-none"
              style={{ color: C.text, width: 220 }}
            />
          </span>
        </div>

        {error && (
          <Caixa>
            <p style={{ color: C.red }}>
              Não consegui ler as respostas. Se a tabela ainda não existe, roda a migração
              <code className="mx-1">feedback_substituicoes</code>no SQL editor.
            </p>
          </Caixa>
        )}

        <div className="grid gap-3 sm:grid-cols-4">
          <Caixa titulo="Respostas">
            <p className="text-3xl font-semibold">{isLoading ? "—" : respostas.length}</p>
          </Caixa>
          <Caixa titulo="Nota média">
            <p className="text-3xl font-semibold" style={{ color: media === null ? C.text : corDaNota(media) }}>
              {media === null ? "—" : media.toString().replace(".", ",")}
            </p>
          </Caixa>
          <Caixa titulo="NPS">
            <p className="text-3xl font-semibold" style={{ color: nps === null ? C.text : nps >= 50 ? C.green : nps >= 0 ? C.yellow : C.red }}>
              {nps === null ? "—" : nps}
            </p>
            <p className="text-xs" style={{ color: C.textDim }}>
              {promotoras} promotoras · {detratoras} detratoras
            </p>
          </Caixa>
          <Caixa titulo="Faltou alimento">
            <p className="text-3xl font-semibold" style={{ color: faltando.length ? C.brand : C.text }}>
              {faltando.reduce((s, [, n]) => s + n, 0)}
            </p>
            <p className="text-xs" style={{ color: C.textDim }}>
              respostas com pedido
            </p>
          </Caixa>
        </div>

        <Caixa titulo="Notas">
          <div className="flex items-end gap-1" style={{ height: 90 }}>
            {distribuicao.barras.map((qtd, n) => (
              <div key={n} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px]" style={{ color: C.textDim }}>
                  {qtd || ""}
                </span>
                <div
                  style={{
                    width: "100%",
                    height: `${(qtd / distribuicao.maior) * 64}px`,
                    minHeight: qtd ? 3 : 0,
                    background: corDaNota(n),
                    borderRadius: 3,
                  }}
                />
                <span className="text-[10px]" style={{ color: C.textDim }}>
                  {n}
                </span>
              </div>
            ))}
          </div>
        </Caixa>

        <div className="grid gap-3 md:grid-cols-2">
          <Caixa titulo="O que ela procurou e não achou">
            {faltando.length === 0 ? (
              <p className="text-sm" style={{ color: C.textDim }}>
                Ninguém reclamou de alimento faltando nesse período.
              </p>
            ) : (
              <ul className="space-y-2">
                {faltando.map(([texto, n]) => (
                  <li key={texto} className="flex items-start justify-between gap-3 text-sm">
                    <span>{texto}</span>
                    {n > 1 && (
                      <span className="shrink-0 rounded px-1.5 text-xs" style={{ background: C.border, color: C.brand }}>
                        {n}×
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Caixa>

          <Caixa titulo="Alimentos mais trocados">
            {maisTrocado.length === 0 ? (
              <p className="text-sm" style={{ color: C.textDim }}>
                Sem troca registrada ainda.
              </p>
            ) : (
              <ul className="space-y-2">
                {maisTrocado.map(([nome, n]) => (
                  <li key={nome} className="flex items-center justify-between gap-3 text-sm">
                    <span>{nome}</span>
                    <span className="shrink-0 text-xs" style={{ color: C.textDim }}>
                      {n}×
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Caixa>
        </div>

        <Caixa titulo={`Respostas (${respostas.length})`}>
          {isLoading ? (
            <p className="text-sm" style={{ color: C.textDim }}>
              Carregando...
            </p>
          ) : respostas.length === 0 ? (
            <p className="text-sm" style={{ color: C.textDim }}>
              Nenhuma resposta ainda. A pergunta aparece pra aluna quatro segundos depois que a troca sai na tela.
            </p>
          ) : (
            <ul className="space-y-3">
              {respostas.map((r) => (
                <li key={r.id} className="rounded-lg p-3" style={{ border: `1px solid ${C.border}` }}>
                  <div className="flex items-center gap-3">
                    <span
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg font-semibold"
                      style={{ background: C.border, color: corDaNota(r.nota) }}
                    >
                      {r.nota}
                    </span>
                    <span className="text-xs" style={{ color: C.textDim }}>
                      {quando(r.criado_em)} · {r.modo === "refeicao" ? "refeição completa" : "um alimento"}
                    </span>
                  </div>
                  {r.nao_achou && (
                    <p className="mt-2 text-sm">
                      <span style={{ color: C.brand }}>Não achou:</span> {r.nao_achou}
                    </p>
                  )}
                  {r.sugestao && (
                    <p className="mt-1 text-sm">
                      <span style={{ color: C.brand }}>Sugestão:</span> {r.sugestao}
                    </p>
                  )}
                  {(r.alimentos?.length ?? 0) > 0 && (
                    <p className="mt-2 text-xs" style={{ color: C.textDim }}>
                      Trocou {r.alimentos!.join(" + ")}
                      {(r.trocas?.length ?? 0) > 0 && <> → {r.trocas!.join(" + ")}</>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Caixa>
      </main>
    </div>
  );
}
