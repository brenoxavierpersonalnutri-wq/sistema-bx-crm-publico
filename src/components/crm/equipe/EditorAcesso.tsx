// Editor do acesso de UM usuário (ou do padrão do usuário novo): perfis prontos, áreas (sem acesso/ver/editar)
// com as ações de cada área, números e departamentos visíveis, "só as conversas dele". Controlado: quem grava é
// a página (Gestão de equipe). A proteção de verdade é o banco; isto só monta a linha de crm_acessos.
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  ACOES_CRM, AREAS_CRM, PERFIS_PRONTOS, acaoLigada, aplicarPerfil, nivelDe,
  type AcessoCrm, type AplicacaoPerfil, type AreaCrm, type DepartamentoRef, type NivelArea, type NumeroRef,
} from "@/lib/crm/acesso";

interface Props {
  valor: AcessoCrm;
  onChange: (v: AcessoCrm) => void;
  numeros: NumeroRef[];
  departamentos: (DepartamentoRef & { cor?: string })[];
  /** departamentos de que o usuário é membro (null = editor do padrão: sem membros) */
  membroDe: string[] | null;
  onMembroDe?: (ids: string[]) => void;
  /** perfil pronto aplicado (a página grava também membros e módulos) */
  onAplicarPerfil?: (a: AplicacaoPerfil) => void;
  rotuloPerfil?: string | null;
}

const NIVEIS: { v: NivelArea; rotulo: string }[] = [
  { v: "nenhum", rotulo: "Sem acesso" },
  { v: "ver", rotulo: "Ver" },
  { v: "editar", rotulo: "Editar" },
];

export function EditorAcesso({ valor, onChange, numeros, departamentos, membroDe, onMembroDe, onAplicarPerfil, rotuloPerfil }: Props) {
  const manuais = departamentos.filter((d) => (d.regra ?? "manual") === "manual");
  const mudarNivel = (area: AreaCrm, n: NivelArea) => onChange({ ...valor, areas: { ...valor.areas, [area]: n } });
  const alternarNumero = (id: string, ligado: boolean) =>
    onChange({ ...valor, numeros: ligado ? [...new Set([...valor.numeros, id])] : valor.numeros.filter((x) => x !== id) });

  return (
    <div className="space-y-6" data-testid="editor-acesso">
      {onAplicarPerfil && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Perfil pronto {rotuloPerfil ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium" data-testid="rotulo-perfil">{rotuloPerfil}</span> : null}</h3>
          <div className="flex flex-wrap gap-2">
            {PERFIS_PRONTOS.map((p) => (
              <Button
                key={p.slug}
                type="button"
                size="sm"
                variant={valor.perfil === p.slug ? "default" : "outline"}
                title={p.descricao}
                data-testid={`perfil-${p.slug}`}
                onClick={() => onAplicarPerfil(aplicarPerfil(p, numeros, manuais))}
              >
                {valor.perfil === p.slug && <Check className="h-3.5 w-3.5 mr-1" />}{p.nome}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Aplica com um clique; depois dá para ajustar tudo abaixo.</p>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Áreas do CRM</h3>
        <div className="rounded-lg border divide-y">
          {AREAS_CRM.map((a) => {
            const nivel = nivelDe(valor, a.key);
            const acoes = ACOES_CRM.filter((x) => x.area === a.key);
            return (
              <div key={a.key} className="px-3 py-2.5 space-y-2" data-testid={`area-${a.key}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">{a.rotulo}</span>
                  <div className="inline-flex rounded-md border p-0.5" role="radiogroup" aria-label={`Acesso a ${a.rotulo}`}>
                    {NIVEIS.map((n) => (
                      <button
                        key={n.v}
                        type="button"
                        role="radio"
                        aria-checked={nivel === n.v}
                        aria-label={`${a.rotulo}: ${n.rotulo}`}
                        onClick={() => mudarNivel(a.key, n.v)}
                        className={`h-7 px-2.5 rounded text-xs ${nivel === n.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                      >
                        {n.rotulo}
                      </button>
                    ))}
                  </div>
                </div>
                {acoes.length > 0 && nivel === "editar" && (
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5 pl-1">
                    {acoes.map((x) => (
                      <label key={x.key} className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox
                          checked={acaoLigada(valor, x.key)}
                          aria-label={x.rotulo}
                          onCheckedChange={(c) => onChange({ ...valor, acoes: { ...valor.acoes, [x.key]: c === true } })}
                        />
                        {x.rotulo}
                      </label>
                    ))}
                  </div>
                )}
                {a.key === "conversas" && nivel !== "nenhum" && (
                  <label className="flex items-center justify-between gap-3 pl-1 text-xs text-muted-foreground">
                    <span>Só as conversas dele (em que é o atendente) e as sem atendente</span>
                    <Switch
                      checked={valor.so_minhas}
                      aria-label="Só as conversas dele"
                      onCheckedChange={(c) => onChange({ ...valor, so_minhas: c })}
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Números que ele vê</h3>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={valor.todos_numeros}
            aria-label="Todos os números"
            onCheckedChange={(c) => onChange({ ...valor, todos_numeros: c === true })}
          />
          Todos os números (inclusive os que forem criados depois)
        </label>
        {!valor.todos_numeros && (
          <div className="grid gap-1.5 sm:grid-cols-2 pl-1">
            {numeros.map((n) => (
              <label key={n.id} className="flex items-center gap-2 text-sm" data-testid="numero-opcao">
                <Checkbox
                  checked={valor.numeros.includes(n.id)}
                  aria-label={n.apelido}
                  onCheckedChange={(c) => alternarNumero(n.id, c === true)}
                />
                {n.apelido} <span className="text-xs text-muted-foreground">{n.chave}</span>
              </label>
            ))}
            {valor.numeros.length === 0 && <p className="text-xs text-amber-600 sm:col-span-2">Nenhum número: ele não vê conversa nenhuma.</p>}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Departamentos</h3>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Só as conversas dos departamentos dele (e as sem departamento)</span>
          <Switch
            checked={valor.so_departamentos}
            aria-label="Só as conversas dos departamentos dele"
            onCheckedChange={(c) => onChange({ ...valor, so_departamentos: c })}
          />
        </label>
        {membroDe && onMembroDe && (
          <div className="grid gap-1.5 sm:grid-cols-2 pl-1">
            {manuais.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm" data-testid="departamento-opcao">
                <Checkbox
                  checked={membroDe.includes(d.id)}
                  aria-label={`Membro de ${d.nome}`}
                  onCheckedChange={(c) => onMembroDe(c === true ? [...new Set([...membroDe, d.id])] : membroDe.filter((x) => x !== d.id))}
                />
                {d.cor && <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.cor }} />}{d.nome}
              </label>
            ))}
            {manuais.length === 0 && <p className="text-xs text-muted-foreground">Nenhum departamento criado ainda.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
