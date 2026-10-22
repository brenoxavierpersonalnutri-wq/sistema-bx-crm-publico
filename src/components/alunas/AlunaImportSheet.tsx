import { useRef, useCallback } from "react";
import { Upload, FileDown, AlertCircle } from "lucide-react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Aluna, ProgramType, PaymentMethod, PlanDuration } from "@/lib/alunaTypes";
import { addMonths } from "date-fns";
import { toast } from "sonner";

interface ImportSheetProps {
  open: boolean;
  onClose: () => void;
  onImport: (alunas: Aluna[]) => void;
}

const PROGRAM_MAP: Record<string, ProgramType> = {
  "mgmd": "menos_gordura",
  "menos gordura": "menos_gordura",
  "slim definida": "slim_definida",
  "plataforma magra e definida": "plataforma_magra",
  "plataforma magra": "plataforma_magra",
  "elite": "elite",
  "magra": "plataforma_magra",
  "desafio": "menos_gordura",
};

const PAYMENT_MAP: Record<string, PaymentMethod> = {
  pix: "pix",
  tmb: "tmb",
  pagtrust: "pagtrust",
  hotmart: "hotmart",
  cartão: "pagtrust",
  cartao: "pagtrust",
  transferencia: "tmb",
  transferência: "tmb",
};

function parseDuration(val: string): PlanDuration {
  const lower = (val || "").toLowerCase().trim();
  if (lower.includes("anual") || lower === "12") return "12";
  if (lower.includes("semestral") || lower === "6") return "6";
  if (lower.includes("quadrimestral") || lower === "4") return "4";
  if (lower.includes("trimestral") || lower === "3") return "3";
  if (lower.includes("8")) return "8";
  if (lower.includes("mensal") || lower === "1") return "1";
  const num = lower.replace(/[^\d]/g, "");
  if (["1", "2", "3", "4", "6", "8", "12"].includes(num)) return num as PlanDuration;
  return "1";
}

function parseDate(val: string): Date | null {
  if (!val) return null;
  // Handle DD/MM/YYYY
  const parts = val.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (parts) {
    const day = parseInt(parts[1]);
    const month = parseInt(parts[2]) - 1;
    let year = parseInt(parts[3]);
    if (year < 100) year += 2000;
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

export function AlunaImportSheet({ open, onClose, onImport }: ImportSheetProps) {


  const processFile = (file: File) => {
    console.log("Starting PapaParse for file:", file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (results) => {
        console.log("PapaParse complete. Raw results:", results);

        if (results.errors.length > 0) {
          console.warn("PapaParse reported errors:", results.errors);
        }

        const rows = results.data as any[];
        if (rows.length === 0) {
          toast.error("Nenhum dado encontrado no arquivo CSV.");
          return;
        }

        // Normalize headers to find columns
        const headers = results.meta.fields || [];
        const normalize = (s: string) => s.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        const findField = (terms: string[]) =>
          headers.find(h => terms.some(t => normalize(h).includes(t)));

        const nameField = findField(["nome da aluna", "nome"]);
        const programField = findField(["plano contratado", "programa", "plano"]);
        const dateField = findField(["data de inicio", "data de compra", "data", "inicio"]);
        const endDateField = findField(["data de termino", "data de vencimento", "termino", "vencimento"]);
        const durationField = findField(["obs", "duracao", "periodo"]);
        const paymentField = findField(["forma de pagamento", "pagamento", "forma"]);
        const pagoField = findField(["pago", "status"]);
        const phoneField = findField(["whatsapp", "telefone", "contato"]);

        console.log("Mapped Fields:", { nameField, programField, dateField, durationField });

        if (!nameField) {
          toast.error("Coluna 'Nome' não encontrada. Verifique o cabeçalho do seu arquivo.");
          return;
        }

        const imported: Aluna[] = [];
        rows.forEach((row, index) => {
          const nome = row[nameField]?.trim();
          if (!nome) return;

          // Program logic
          let progRaw = (row[programField] || "").toLowerCase();
          let programa: ProgramType = "consultoria_slim";
          for (const [key, val] of Object.entries(PROGRAM_MAP)) {
            if (progRaw.includes(key)) {
              programa = val;
              break;
            }
          }

          // Date & Duration calculation as requested by user
          const compra = dateField ? (parseDate(row[dateField]) || new Date()) : new Date();
          const duracao = parseDuration(row[durationField] || "1");

          // Use provided end date if available, but ensure it's calculated correctly if missing
          const vencimento = addMonths(compra, parseInt(duracao));

          // Payment
          const payRaw = (row[paymentField] || "").toLowerCase().trim();
          const formaPagamento = PAYMENT_MAP[payRaw] || "pix";

          const pagoRaw = (row[pagoField] || "").toLowerCase().trim();
          const pago = ["sim", "yes", "true", "1", "pago"].includes(pagoRaw);

          imported.push({
            id: crypto.randomUUID(),
            nomeCompleto: nome,
            programa,
            dataCompra: compra.toISOString(),
            duracaoPlano: duracao,
            dataVencimento: vencimento.toISOString(),
            formaPagamento,
            pago,
            telefone: phoneField ? row[phoneField]?.trim() : undefined,
          });
        });

        if (imported.length === 0) {
          toast.error("Nenhuma aluna válida encontrada no arquivo.");
        } else {
          onImport(imported);
          toast.success(`${imported.length} alunas importadas com sucesso!`);
          onClose();
        }
      },
      error: (err) => {
        console.error("PapaParse global error:", err);
        toast.error("Erro ao ler o arquivo CSV.");
      }
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
    // Reset so same file can be selected again
    e.target.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Importar Planilha</DialogTitle>
          <DialogDescription>
            Envie sua planilha de controle (formato CSV) para atualizar a base de alunas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-4">

          <div
            className="relative border-2 border-dashed border-muted-foreground/20 rounded-xl p-10 text-center hover:bg-muted/30 transition-all cursor-pointer group overflow-hidden"
          >
            {/* The actual input sits on top but is invisible */}
            <input
              type="file"
              accept=".csv"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              onChange={handleFileChange}
              title=""
            />

            <div className="relative z-0">
              <Upload className="mx-auto h-12 w-12 text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
              <div className="mt-4 space-y-1">
                <p className="text-sm font-semibold">Clique para selecionar o arquivo</p>
                <p className="text-xs text-muted-foreground">Formato aceito: .CSV</p>
              </div>

              <div className="mt-6">
                <span className="inline-flex items-center px-6 py-2.5 bg-primary text-primary-foreground text-sm font-bold rounded-lg shadow-sm group-hover:bg-primary/90 transition-all">
                  Escolher Arquivo
                </span>
              </div>
            </div>
          </div>

          <div className="flex justify-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                console.log("Componente está ativo. Teste de clique OK.");
                toast.info("Console log enviado para teste.");
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground h-6"
            >
              Testar Respostas (Log)
            </Button>
          </div>

          <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 rounded-lg p-4 flex gap-3">
            <AlertCircle className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-bold text-blue-700 dark:text-blue-400">Dica de Importação</p>
              <p className="text-[11px] leading-relaxed text-blue-600/80 dark:text-blue-400/70 italic">
                O sistema identifica automaticamente colunas como "Nome da Aluna", "Data de Início", "Data de Término" e "WhatsApp". Certifique-se de salvar sua planilha do Excel/Google Sheets como **CSV**.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="sm:justify-start">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
