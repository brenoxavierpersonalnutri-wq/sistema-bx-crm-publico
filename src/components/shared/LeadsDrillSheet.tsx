import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, Copy, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { linkDeWhatsapp } from "@/lib/telefoneDaLead";

export interface DrillLead {
  id?: string;
  name: string;
  phone?: string | null;
  via?: string | null;
  status?: string | null;
  score?: number | null;
  level?: string | null;
  date?: string | null;
}

interface LeadsDrillSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  leads: DrillLead[];
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[";\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function normalizePhone(phone?: string | null): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

// A regra do DDI mora em lib/telefoneDaLead: estava repetida em cinco telas,
// e nas que divergiam o link saía com 55 duplicado.
const waLink = (phone?: string | null) => linkDeWhatsapp(phone);

export function LeadsDrillSheet({ open, onOpenChange, title, description, leads }: LeadsDrillSheetProps) {
  const { toast } = useToast();

  const handleExportCSV = () => {
    const headers = ["Nome", "Telefone", "Funil", "Status", "Nivel", "Score", "Data"];
    const rows = leads.map((l) =>
      [l.name, l.phone ?? "", l.via ?? "", l.status ?? "", l.level ?? "", l.score ?? "", l.date ?? ""]
        .map(csvEscape)
        .join(";"),
    );
    const csv = "\uFEFF" + [headers.join(";"), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeTitle = title.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    a.download = `leads_${safeTitle}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "CSV exportado", description: `${leads.length} lead(s) exportado(s).` });
  };

  const handleCopyPhones = async () => {
    const phones = leads.map((l) => normalizePhone(l.phone)).filter(Boolean);
    if (phones.length === 0) {
      toast({ title: "Sem telefones", variant: "destructive" });
      return;
    }
    await navigator.clipboard.writeText(phones.join("\n"));
    toast({ title: "Telefones copiados", description: `${phones.length} número(s) na área de transferência.` });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {description ?? `${leads.length} lead(s) encontrado(s)`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex gap-2 mt-4 mb-4 flex-wrap">
          <Button size="sm" variant="default" onClick={handleExportCSV} disabled={leads.length === 0} className="gap-2">
            <Download className="h-4 w-4" />
            Exportar CSV
          </Button>
          <Button size="sm" variant="outline" onClick={handleCopyPhones} disabled={leads.length === 0} className="gap-2">
            <Copy className="h-4 w-4" />
            Copiar telefones
          </Button>
        </div>

        {leads.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Nenhum lead nesse grupo.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Funil</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Nível</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l, idx) => {
                  const wa = waLink(l.phone);
                  return (
                    <TableRow key={l.id ?? `${l.name}-${idx}`}>
                      <TableCell>
                        <div className="flex flex-col">
                          {wa ? (
                            <a
                              href={wa}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline font-medium inline-flex items-center gap-1"
                            >
                              {l.name || "Sem nome"}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="font-medium">{l.name || "Sem nome"}</span>
                          )}
                          {l.phone && (
                            <span className="text-[11px] text-muted-foreground">{l.phone}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{l.via || "—"}</TableCell>
                      <TableCell>
                        {l.status ? <Badge variant="outline" className="text-[10px]">{l.status}</Badge> : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {l.level ? (
                          <Badge variant="secondary" className="text-[10px]">
                            {l.level}{l.score != null ? ` (${l.score})` : ""}
                          </Badge>
                        ) : l.score != null ? (
                          <span className="text-xs">{l.score}</span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{l.date || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
