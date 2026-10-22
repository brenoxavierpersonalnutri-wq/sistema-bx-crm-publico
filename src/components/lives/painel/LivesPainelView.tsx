// Painel /lives sem dados próprios, no desenho de painel de estúdio de transmissão:
// barra lateral clara (Página inicial / Biblioteca / Destinos), área principal branca com "Criar" em três
// cartões, e a lista "Estúdios" com abas sublinhadas e colunas Título / Canais.
import { useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, CircleDot, Film, History, Home, Presentation, Share2, Video } from "lucide-react";
import { LinhaLive } from "@/components/lives/painel/LinhaLive";
import { DestinosLateral, type DestinoComSala } from "@/components/lives/painel/DestinosLateral";
import { Marca } from "@/components/lives/tema/Marca";
import { SeletorTema } from "@/components/lives/tema/SeletorTema";
import { useTemaLives } from "@/components/lives/estudio/temaEscuro";
import { filtrarAba, type AbaPainel, type ItemPainel, type LiveRoomExtra, type TipoCriacao } from "@/lib/lives/painel";
import { cn } from "@/lib/utils";

const VAZIO: Record<AbaPainel, string> = {
  proximas: "Nada agendado. Escolha uma opção em Criar para começar uma live, gravação ou webinário.",
  anteriores: "As lives encerradas aparecem aqui.",
  gravacoes: "Quando uma transmissão termina, a gravação aparece aqui.",
};

type Secao = "inicio" | "biblioteca" | "destinos";

const NAV: { key: Secao; rotulo: string; Icone: typeof Home }[] = [
  { key: "inicio", rotulo: "Página inicial", Icone: Home },
  { key: "biblioteca", rotulo: "Biblioteca", Icone: Film },
  { key: "destinos", rotulo: "Destinos", Icone: Share2 },
];

const CRIAR: { key: TipoCriacao; titulo: string; sub: string; Icone: typeof Video }[] = [
  { key: "live", titulo: "Transmissão ao vivo", sub: "Transmita para vários destinos", Icone: Video },
  { key: "gravacao", titulo: "Gravação", sub: "Grave sem transmitir ao vivo", Icone: CircleDot },
  { key: "webinario", titulo: "Webinário", sub: "Página com inscrição e chat", Icone: Presentation },
];

export interface LivesPainelViewProps {
  itens: ItemPainel[];
  salas: LiveRoomExtra[];
  destinos: DestinoComSala[];
  carregando?: boolean;
  onCriar: (t: TipoCriacao) => void;
  onEditar: (i: ItemPainel) => void;
  onDuplicar: (i: ItemPainel) => void;
  onExcluir: (i: ItemPainel) => void;
  recarregar: () => void;
}

function Abas({ valor, opcoes, onTrocar }: { valor: AbaPainel; opcoes: { key: AbaPainel; rotulo: string }[]; onTrocar: (a: AbaPainel) => void }) {
  return (
    <div role="tablist" className="flex gap-2 border-b">
      {opcoes.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={valor === o.key}
          onClick={() => onTrocar(o.key)}
          className={cn(
            "-mb-px border-b-2 px-6 py-3 text-[15px] transition-colors",
            valor === o.key ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

function Lista({ p, aba }: { p: LivesPainelViewProps; aba: AbaPainel }) {
  const lista = filtrarAba(p.itens, aba);
  if (p.carregando) return <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>;
  if (!lista.length) return <div className="mt-4 rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">{VAZIO[aba]}</div>;
  return (
    <>
      <div className="hidden grid-cols-[minmax(0,1fr)_120px_auto] gap-4 px-3 py-4 text-sm text-muted-foreground md:grid">
        <span>Título</span>
        <span>Canais</span>
        <span className="w-[200px]" />
      </div>
      <ul className="divide-y border-y md:border-t-0">
        {lista.map((i) => <LinhaLive key={i.key} item={i} onEditar={p.onEditar} onDuplicar={p.onDuplicar} onExcluir={p.onExcluir} />)}
      </ul>
    </>
  );
}

export function LivesPainelView(p: LivesPainelViewProps) {
  const { pref, trocar } = useTemaLives();
  const [secao, setSecao] = useState<Secao>("inicio");
  const [aba, setAba] = useState<AbaPainel>("proximas");
  const conta = (a: AbaPainel) => filtrarAba(p.itens, a).length;
  const noAr = p.destinos.filter((d) => d.ativo).length;

  return (
    <div className="flex min-h-dvh flex-col bg-[hsl(var(--sy-lateral))] text-foreground md:flex-row">
      {/* barra lateral (no celular vira uma faixa no topo com a navegação rolando de lado) */}
      <aside className="flex shrink-0 flex-col md:sticky md:top-0 md:h-dvh md:w-[260px]">
        <div className="flex h-16 items-center px-6">
          <Link to="/" aria-label="Início do sistema"><Marca /></Link>
        </div>
        <nav aria-label="Lives" className="flex gap-1 overflow-x-auto px-3 pb-2 md:mt-4 md:flex-col md:overflow-visible md:pb-0">
          {NAV.map(({ key, rotulo, Icone }) => (
            <button
              key={key}
              type="button"
              aria-current={secao === key ? "page" : undefined}
              onClick={() => setSecao(key)}
              className={cn(
                "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-base transition-colors",
                secao === key ? "font-medium text-primary" : "text-foreground/80 hover:bg-background/70 hover:text-foreground",
              )}
            >
              <Icone className="h-5 w-5" strokeWidth={1.75} />
              {rotulo}
            </button>
          ))}
        </nav>
        <div className="mt-auto hidden space-y-2 p-2 md:block">
          <div className="rounded-xl bg-background p-4">
            <div className="flex items-center justify-between text-sm">
              <span>Destinos ativos</span>
              <button type="button" className="text-primary hover:underline" onClick={() => setSecao("destinos")}>Gerenciar</button>
            </div>
            <div className="mt-2 h-1 rounded-full bg-secondary"><div className="h-1 rounded-full bg-primary" style={{ width: `${Math.min(100, (noAr / Math.max(1, p.destinos.length)) * 100)}%` }} /></div>
            <div className="mt-2 text-sm text-muted-foreground">{noAr} de {p.destinos.length} ligados</div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 pb-2 text-sm text-muted-foreground">
            <Link to="/webinar" className="inline-flex items-center gap-1 hover:text-foreground"><History className="h-3.5 w-3.5" />Webinar antigo</Link>
            <Link to="/webinar/analytics" className="inline-flex items-center gap-1 hover:text-foreground"><BarChart3 className="h-3.5 w-3.5" />Analytics</Link>
          </div>
        </div>
      </aside>

      {/* área principal: painel branco com o canto superior esquerdo arredondado */}
      <main className="min-w-0 flex-1 bg-background md:my-2 md:mr-2 md:rounded-2xl md:shadow-[0_0_0_1px_hsl(var(--border)/0.6)]">
        <div className="flex items-center justify-end gap-3 px-4 pt-4 sm:px-6">
          <div className="mr-auto flex gap-3 text-sm text-muted-foreground md:hidden">
            <Link to="/webinar" className="hover:text-foreground">Webinar antigo</Link>
            <Link to="/webinar/analytics" className="hover:text-foreground">Analytics</Link>
          </div>
          <SeletorTema pref={pref} onTrocar={trocar} />
        </div>

        <div className="mx-auto max-w-[1000px] px-4 pb-16 sm:px-8 lg:px-12">
          {secao === "inicio" && (
            <>
              <section className="mt-6">
                <h1 className="text-2xl font-normal tracking-tight">Criar</h1>
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  {CRIAR.map(({ key, titulo, sub, Icone }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => p.onCriar(key)}
                      className="group flex items-center gap-4 rounded-xl border bg-card p-2 pr-4 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
                    >
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--sy-icone-fundo))] text-primary">
                        <Icone className="h-6 w-6" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[15px] font-medium">{titulo}</span>
                        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="mt-14">
                <h2 className="text-[28px] font-normal tracking-tight">Estúdios</h2>
                <div className="mt-6">
                  <Abas
                    valor={aba === "gravacoes" ? "proximas" : aba}
                    onTrocar={setAba}
                    opcoes={[
                      { key: "proximas", rotulo: `Ativos (${conta("proximas")})` },
                      { key: "anteriores", rotulo: `Usados (${conta("anteriores")})` },
                    ]}
                  />
                  <Lista p={p} aba={aba === "gravacoes" ? "proximas" : aba} />
                </div>
              </section>
            </>
          )}

          {secao === "biblioteca" && (
            <section className="mt-6">
              <h1 className="text-2xl font-normal tracking-tight">Biblioteca</h1>
              <p className="mt-1 text-sm text-muted-foreground">Gravações das transmissões e dos webinários.</p>
              <div className="mt-6">
                <Abas valor="gravacoes" onTrocar={() => undefined} opcoes={[{ key: "gravacoes", rotulo: `Gravações (${conta("gravacoes")})` }]} />
                <Lista p={p} aba="gravacoes" />
              </div>
            </section>
          )}

          {secao === "destinos" && (
            <section className="mt-6">
              <h1 className="text-2xl font-normal tracking-tight">Destinos</h1>
              <p className="mb-6 mt-1 text-sm text-muted-foreground">Canais para onde cada live transmite. Ligue ou desligue sem apagar a chave.</p>
              <DestinosLateral destinos={p.destinos} salas={p.salas} recarregar={p.recarregar} />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
