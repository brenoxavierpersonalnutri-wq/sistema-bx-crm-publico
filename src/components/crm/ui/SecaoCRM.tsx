// Peças visuais comuns do CRM (tema escuro de painel, 21/10/2026): título de página, título de seção com
// contador e botão "+", cartão de seção, item de lista em cartão com seta e bolinha de status.
// Só apresentação: quem usa decide o comportamento (onClick, to, conteúdo).
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Cabeçalho de página do CRM: título grande, descrição curta opcional e ações à direita. */
export function TituloPaginaCRM({ titulo, descricao, contador, acoes, className }: {
  titulo: ReactNode;
  descricao?: ReactNode;
  contador?: ReactNode;
  acoes?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">
          {titulo}
          {contador != null && <span className="ml-2 text-base font-semibold text-muted-foreground tabular-nums">{contador}</span>}
        </h1>
        {descricao && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </div>
  );
}

/** Título de seção: "Contas 10/10" com o "+" amarelo em círculo à direita. */
export function TituloSecaoCRM({ titulo, contador, onAdicionar, rotuloAdicionar = "Adicionar", acoes, className }: {
  titulo: ReactNode;
  contador?: ReactNode;
  onAdicionar?: () => void;
  rotuloAdicionar?: string;
  acoes?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h2 className="text-lg font-bold tracking-tight">
        {titulo}
        {contador != null && <span className="ml-1.5 text-sm font-semibold text-muted-foreground tabular-nums">{contador}</span>}
      </h2>
      <div className="flex items-center gap-2">
        {acoes}
        {onAdicionar && <BotaoMaisCRM onClick={onAdicionar} rotulo={rotuloAdicionar} />}
      </div>
    </div>
  );
}

/** "+" amarelo em círculo (contorno), como no canto dos cartões de seção. */
export function BotaoMaisCRM({ onClick, rotulo = "Adicionar", className }: { onClick: () => void; rotulo?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      title={rotulo}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-primary text-primary transition-colors hover:bg-primary hover:text-primary-foreground",
        className,
      )}
    >
      <Plus className="h-4 w-4" strokeWidth={2.5} />
    </button>
  );
}

/** Cartão de seção: superfície chumbo, borda sutil, cantos de 12px e respiro. */
export function CartaoSecaoCRM({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-xl border bg-card p-4 md:p-5", className)}>{children}</section>;
}

/** Item de lista como cartão com seta "→" à direita. Vira link (to) ou botão (onClick). */
export function ItemCartaoCRM({ to, onClick, icone, titulo, subtitulo, extra, ativo, className }: {
  to?: string;
  onClick?: () => void;
  icone?: ReactNode;
  titulo: ReactNode;
  subtitulo?: ReactNode;
  extra?: ReactNode;
  ativo?: boolean;
  className?: string;
}) {
  const cls = cn(
    "group flex w-full items-center gap-3 rounded-xl border bg-secondary px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-accent",
    ativo && "border-primary/60",
    className,
  );
  const corpo = (
    <>
      {icone && <span className="shrink-0">{icone}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{titulo}</span>
        {subtitulo && <span className="mt-0.5 block text-sm text-muted-foreground">{subtitulo}</span>}
      </span>
      {extra}
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden />
    </>
  );
  if (to) return <Link to={to} className={cls}>{corpo}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{corpo}</button>;
}

/** Bolinha de status no canto do avatar (verde ligado, vermelho desligado, âmbar aguardando). */
export function BolinhaStatusCRM({ cor, rotulo, className }: { cor: string; rotulo?: string; className?: string }) {
  return (
    <span
      role={rotulo ? "img" : undefined}
      aria-label={rotulo}
      title={rotulo}
      className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-card", cor, className)}
    />
  );
}

/** Avatar redondo com iniciais (ou foto) e bolinha de status opcional. */
export function AvatarCRM({ nome, foto, corStatus, rotuloStatus, tamanho = "h-10 w-10" }: {
  nome: string;
  foto?: string | null;
  corStatus?: string;
  rotuloStatus?: string;
  tamanho?: string;
}) {
  const iniciais = nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
  return (
    <span className={cn("relative inline-flex shrink-0", tamanho)}>
      {foto ? (
        <img src={foto} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-accent text-xs font-semibold text-foreground">{iniciais}</span>
      )}
      {corStatus && <BolinhaStatusCRM cor={corStatus} rotulo={rotuloStatus} />}
    </span>
  );
}
