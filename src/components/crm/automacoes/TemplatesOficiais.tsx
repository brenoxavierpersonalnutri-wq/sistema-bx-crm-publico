// Catálogo dos templates oficiais de WhatsApp (espelho do Full Funnel, tabela crm_wa_templates).
// Só leitura: o template é criado e aprovado na Meta pelo Full Funnel; aqui ele aparece para ser escolhido no fluxo.
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { db, variaveisDoTemplate, type TemplateOficial } from "@/lib/crmFluxos";

export function useTemplatesOficiais() {
  const [lista, setLista] = useState<TemplateOficial[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data, error } = await db.from("crm_wa_templates").select("*").order("nome");
      if (error) setErro("Catálogo não encontrado: rode a migration 20261023120000.");
      setLista((data ?? []) as TemplateOficial[]);
    })();
  }, []);
  return { templates: lista, erro };
}

const COR_STATUS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  APPROVED: "default",
  PENDING: "secondary",
  REJECTED: "destructive",
};

export function TemplatesOficiais() {
  const { templates, erro } = useTemplatesOficiais();
  return (
    <div className="space-y-3 pt-2">
      <p className="text-xs text-muted-foreground">
        Espelho dos templates aprovados no Full Funnel (número oficial). Criar ou editar template é lá; aqui você escolhe
        o template num passo de fluxo. O envio sai pelo workflow receptor do Full Funnel (If/Else pelo nome).
      </p>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {templates.map((t) => {
          const vars = variaveisDoTemplate(t.corpo);
          return (
            <div key={t.nome} className="rounded-lg border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium">{t.nome}</span>
                <Badge variant={COR_STATUS[t.status] ?? "outline"}>{t.status === "APPROVED" ? "aprovado" : t.status.toLowerCase()}</Badge>
                <Badge variant="outline">{t.categoria === "MARKETING" ? "marketing" : t.categoria === "UTILITY" ? "utilidade" : "autenticação"}</Badge>
                <span className="text-xs text-muted-foreground">{t.idioma}</span>
              </div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed">{t.corpo}</p>
              {vars.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Variáveis: {vars.map((n) => `{{${n}}} ${t.rotulos_variaveis?.[String(n)] ?? ""}`.trim()).join(" · ")}
                </p>
              )}
              {t.botoes?.length > 0 && (
                <p className="text-xs text-muted-foreground">Botões: {t.botoes.map((b) => `${b.text}${b.url ? ` → ${b.url}` : ""}`).join(" · ")}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
