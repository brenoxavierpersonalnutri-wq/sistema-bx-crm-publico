// Painel "Roteiros" à direita do chat (igual ao bloco de roteiros do SellFlux):
// lista com busca → clique abre a prévia (texto já com o nome da lead + foto/áudio/documento)
// → "Usar" joga texto e mídia na caixa de mensagem; o atendente revisa e aperta Enter.
// Roteiro com vários passos: "Usar" por passo, com o próximo destacado.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, FileText, Loader2, Mic, Pencil, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useEtapas } from "@/hooks/useEtapas";
import { RoteirosEditorModal } from "@/components/crm/RoteirosEditorModal";
import { aplicarVariaveis, db, FUNIS, type PassoRoteiro, type Roteiro } from "@/lib/crmRoteiros";
import {
  filtrarRoteiros, midiasDoPasso, montarInsercao, ordenarRoteiros, passoParaPreencher, usaLinkAgendamento, type InsercaoRoteiro,
} from "@/lib/crm/roteirosChat";
import { linkAgendamentoDoContato } from "@/lib/crm/treinarIA";
import "@/components/crm/roteiros-dark.css";

interface Props {
  contato: { phone: string; name: string | null; stage: string };
  onUsar: (insercao: InsercaoRoteiro) => void;
  onFechar?: () => void;
  /** Muda quando um passo é enviado: recarrega os ✓ de "já enviado". */
  versaoEnvios?: number;
}


export function PainelRoteiros({ contato, onUsar, onFechar, versaoEnvios = 0 }: Props) {
  const { slugs: ordemEtapas, nomeEtapa } = useEtapas();
  const [roteiros, setRoteiros] = useState<Roteiro[]>([]);
  const [passos, setPassos] = useState<PassoRoteiro[]>([]);
  const [enviados, setEnviados] = useState<Set<string>>(new Set());
  const [usados, setUsados] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editorAberto, setEditorAberto] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const { data: rs, error } = await db.from("crm_roteiros").select("*").eq("ativo", true).order("ordem");
    if (error) {
      setErro(error.message || "Não carregou os roteiros.");
      setCarregando(false);
      return;
    }
    const lista = (rs ?? []) as Roteiro[];
    setRoteiros(lista);
    if (lista.length) {
      const { data: ps } = await db.from("crm_roteiro_passos").select("*").in("roteiro_id", lista.map((r) => r.id)).order("ordem");
      setPassos((ps ?? []) as PassoRoteiro[]);
    } else setPassos([]);
    setCarregando(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    let vivo = true;
    db.from("crm_roteiro_envios").select("passo_id").eq("contact_phone", contato.phone)
      .then(({ data }: { data: { passo_id: string }[] | null }) => {
        if (vivo) setEnviados(new Set((data ?? []).map((e) => e.passo_id)));
      });
    return () => {
      vivo = false;
    };
  }, [contato.phone, versaoEnvios]);

  // conversa trocada: volta para a lista e zera os "usados"
  useEffect(() => {
    setUsados(new Set());
    setAbertoId(null);
  }, [contato.phone]);

  const visiveis = useMemo(
    () => ordenarRoteiros(filtrarRoteiros(roteiros, passos, busca), contato.stage, ordemEtapas),
    [roteiros, passos, busca, contato.stage, ordemEtapas],
  );
  const passosPorRoteiro = useMemo(() => {
    const m = new Map<string, PassoRoteiro[]>();
    for (const p of passos) m.set(p.roteiro_id, [...(m.get(p.roteiro_id) ?? []), p]);
    for (const l of m.values()) l.sort((a, b) => a.ordem - b.ordem);
    return m;
  }, [passos]);

  const aberto = roteiros.find((r) => r.id === abertoId) ?? null;
  const passosAbertos = aberto ? passosPorRoteiro.get(aberto.id) ?? [] : [];
  const proximo = passosAbertos.find((p) => !usados.has(p.id) && !enviados.has(p.id) && !passoParaPreencher(p));

  const usar = async (ps: PassoRoteiro[]) => {
    const validos = ps.filter((p) => !passoParaPreencher(p));
    if (!validos.length) return;
    // [LINK_AGENDAMENTO] vira o link da IA com o código opaco deste contato (utm_content = funil do roteiro)
    const extras: Record<string, string> = {};
    if (usaLinkAgendamento(validos)) {
      const funil = roteiros.find((r) => r.id === validos[0].roteiro_id)?.funil || "geral";
      extras.link_agendamento = await linkAgendamentoDoContato(contato.phone, funil);
    }
    onUsar(montarInsercao(validos, contato, extras));
    setUsados((u) => {
      const n = new Set(u);
      validos.forEach((p) => n.add(p.id));
      return n;
    });
  };

  return (
    <div className="rot-dark h-full flex flex-col min-h-0 border-l border-border" data-testid="painel-roteiros">
      <div className="h-16 shrink-0 flex items-center gap-2 px-3 border-b border-border crm-chat-barra">
        {aberto ? (
          <Button variant="ghost" size="icon" className="rounded-full shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setAbertoId(null)} aria-label="Voltar para os roteiros">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        ) : null}
        <h3 className="flex-1 truncate text-sm font-semibold tracking-tight">
          {aberto ? aberto.nome : <>Roteiros <span className="font-normal text-muted-foreground">({roteiros.length})</span></>}
        </h3>
        <Button variant="ghost" size="icon" className="rounded-full shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setEditorAberto(true)} aria-label="Criar e editar roteiros" title="Criar e editar roteiros">
          <Pencil className="h-4 w-4" />
        </Button>
        {onFechar && (
          <Button variant="ghost" size="icon" className="rounded-full shrink-0 text-muted-foreground hover:text-foreground" onClick={onFechar} aria-label="Fechar roteiros">
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      {!aberto && (
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar roteiro" className="pl-8 h-9" aria-label="Buscar roteiro" />
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {carregando ? (
          <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : erro ? (
          <p className="p-4 text-sm text-destructive">{erro}</p>
        ) : aberto ? (
          <div className="p-3 space-y-3">
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Badge variant="outline" className="border-primary/40 bg-primary/10 font-medium text-primary">{nomeEtapa(aberto.stage)}</Badge>
              <Badge variant="outline" className="border-border font-medium text-muted-foreground">{FUNIS.find((f) => f.id === aberto.funil)?.nome ?? aberto.funil}</Badge>
            </div>
            {aberto.descricao && <p className="text-xs text-muted-foreground whitespace-pre-line">{aberto.descricao}</p>}
            {passosAbertos.length > 1 && proximo && (
              <Button size="sm" className="w-full" onClick={() => usar([proximo])}>
                Usar próximo: {proximo.rotulo || `passo ${passosAbertos.indexOf(proximo) + 1}`}
              </Button>
            )}
            {passosAbertos.length === 0 && <p className="text-sm text-muted-foreground">Roteiro sem passos. Clique no lápis para montar.</p>}
            <ol className="space-y-2">
              {passosAbertos.map((p, i) => (
                <PassoPrevia
                  key={p.id}
                  passo={p}
                  indice={i}
                  total={passosAbertos.length}
                  contato={contato}
                  enviado={enviados.has(p.id)}
                  usado={usados.has(p.id)}
                  proximo={proximo?.id === p.id}
                  onUsar={() => usar([p])}
                />
              ))}
            </ol>
          </div>
        ) : visiveis.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {roteiros.length ? "Nenhum roteiro com essa busca." : "Nenhum roteiro ativo. Clique no lápis para criar ou ativar um rascunho."}
          </p>
        ) : (
          <ul>
            {visiveis.map((r, i) => {
              const ps = passosPorRoteiro.get(r.id) ?? [];
              const daEtapa = r.stage === contato.stage;
              const cabecalho = i === 0 || (visiveis[i - 1].stage === contato.stage) !== daEtapa;
              const feitos = ps.filter((p) => enviados.has(p.id)).length;
              return (
                <li key={r.id}>
                  {cabecalho && (
                    <div className="px-3 pt-4 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {daEtapa ? `Etapa ${nomeEtapa(contato.stage)}` : "Outras etapas"}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setAbertoId(r.id)}
                    className="group w-full text-left px-3 py-2.5 hover:bg-card focus-visible:outline-none focus-visible:bg-card focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring flex items-center gap-2 border-b border-border/60 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{r.nome}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {ps.length} passo{ps.length === 1 ? "" : "s"}
                        {daEtapa ? "" : ` · ${nomeEtapa(r.stage)}`}
                        {feitos > 0 ? ` · ${feitos} enviado${feitos === 1 ? "" : "s"}` : ""}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <RoteirosEditorModal
        isOpen={editorAberto}
        onClose={() => {
          setEditorAberto(false);
          carregar();
        }}
      />
    </div>
  );
}

function PassoPrevia({
  passo, indice, total, contato, enviado, usado, proximo, onUsar,
}: {
  passo: PassoRoteiro;
  indice: number;
  total: number;
  contato: { phone: string; name: string | null };
  enviado: boolean;
  usado: boolean;
  proximo: boolean;
  onUsar: () => void;
}) {
  const { texto, midias } = midiasDoPasso(passo);
  const preencher = passoParaPreencher(passo);
  const final = texto ? aplicarVariaveis(texto, contato) : "";
  return (
    <li className={`rounded-lg border bg-card p-3 space-y-2.5 ${proximo ? "border-primary/60 ring-1 ring-primary/25" : "border-border"}`} data-testid="passo-previa">
      <div className="flex items-center gap-2 text-xs">
        {total > 1 && (
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums ${proximo ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>{indice + 1}</span>
        )}
        <span className="font-medium truncate flex-1">{passo.rotulo || "Mensagem"}</span>
        {enviado && <span className="flex items-center gap-0.5 text-primary"><Check className="h-3.5 w-3.5" />enviado</span>}
        {!enviado && usado && <span className="text-muted-foreground">na caixa</span>}
      </div>
      {preencher ? (
        <p className="text-xs rounded-md border border-amber-400/25 bg-amber-400/10 text-amber-300 px-2 py-1.5">
          Preencher: este passo ainda não tem texto nem mídia. Clique no lápis lá em cima para escrever.
        </p>
      ) : (
        <div className="crm-chat-fundo rounded-md border border-border p-2 space-y-1.5">
          {midias.map((m, i) =>
            m.tipo === "image" ? (
              <img key={i} src={m.url} alt={m.nome} loading="lazy" className="rounded border border-border bg-black max-h-48 w-full object-contain" />
            ) : m.tipo === "audio" ? (
              <audio key={i} controls preload="none" src={m.url} className="w-full h-9" aria-label={`Áudio ${m.nome}`} />
            ) : m.tipo === "video" ? (
              <video key={i} controls preload="metadata" src={m.url} className="rounded w-full max-h-48 bg-black" />
            ) : (
              <a key={i} href={m.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs underline crm-chat-texto">
                <FileText className="h-4 w-4 shrink-0" /> {m.nome}
              </a>
            ),
          )}
          {final && (
            <div className="crm-bolha crm-bolha-out rounded-md px-2 py-1.5 text-[13px] whitespace-pre-wrap break-words">{final}</div>
          )}
          {!final && midias.some((m) => m.tipo === "audio") && (
            <p className="text-[11px] crm-chat-meta flex items-center gap-1"><Mic className="h-3 w-3" />áudio vai como mensagem de voz/arquivo</p>
          )}
        </div>
      )}
      <Button size="sm" variant={proximo ? "default" : "outline"} className="w-full h-8" disabled={preencher} onClick={onUsar}>
        Usar
      </Button>
    </li>
  );
}
