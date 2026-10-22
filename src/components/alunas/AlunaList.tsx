import { useState } from "react";
import { format, differenceInDays, isToday, isBefore, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Search, Plus, Pencil, Trash2, MoreVertical, Upload, BellRing, Camera, Dumbbell, Image } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Aluna, PROGRAM_LABELS, PAYMENT_LABELS, DURATION_LABELS } from "@/lib/alunaTypes";
import { SignalReminders } from "./SignalReminders";
import { SignalReminderUnified } from "@/components/shared/SignalReminderUnified";
import { ExpiringReminders } from "./ExpiringReminders";
import { BotaoApagarAlunaTeste, SeloTeste } from "./AlunaTeste";
import { ehAlunaTeste, semAlunasTeste } from "@/lib/alunaTeste";

interface AlunaListProps {
  alunas: Aluna[];
  onEdit: (aluna: Aluna) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  onImport: () => void;
  onToggleResiduo?: (aluna: Aluna) => void;
  /** Abre já com todas na tela, em vez de esperar buscar ou clicar em mostrar. */
  listarTudo?: boolean;
  /** Esconde os avisos do topo. A tela focada de um recorte é só a lista. */
  semAvisos?: boolean;
  /** Depois de apagar uma aluna de teste (recarregar a lista). */
  onApagadaTeste?: () => void;
}

function getStatusBadge(aluna: Aluna) {
  const hoje = new Date();
  const venc = new Date(aluna.dataVencimento);
  const diasRestantes = differenceInDays(venc, hoje);

  if (diasRestantes < 0) return <Badge variant="destructive">Vencido</Badge>;
  if (!aluna.pago) return <Badge className="bg-warning text-warning-foreground border-none">Pendente</Badge>;
  if (diasRestantes <= 7) return <Badge className="bg-accent text-accent-foreground border-none">Vence em {diasRestantes}d</Badge>;
  return <Badge className="bg-success text-success-foreground border-none">Em dia</Badge>;
}

function DeliverableIcon({ done, label, icon: Icon }: { done?: boolean; label: string; icon: React.ElementType }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={`flex h-6 w-6 items-center justify-center rounded-full ${done ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}: {done ? "✓ Enviado" : "Pendente"}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function AlunaList({
  alunas, onEdit, onDelete, onAdd, onImport, onToggleResiduo, listarTudo, semAvisos, onApagadaTeste,
}: AlunaListProps) {
  const [busca, setBusca] = useState("");
  const [mostrarTodas, setMostrarTodas] = useState(!!listarTudo);

  const filtradas = busca.trim()
    ? alunas.filter((a) => a.nomeCompleto.toLowerCase().includes(busca.toLowerCase()))
    : mostrarTodas ? alunas : [];

  return (
    <div className="space-y-4">
      {!semAvisos && (
        <>
          {/* Avisos são cobrança de verdade: aluna de teste fica fora. */}
          <ExpiringReminders alunas={semAlunasTeste(alunas)} />
          <SignalReminderUnified />
          <SignalReminders alunas={semAlunasTeste(alunas)} onToggleResiduo={onToggleResiduo} />
        </>
      )}

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar aluna..." value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-10" />
        </div>
        <Button variant="outline" onClick={onImport} className="gap-2">
          <Upload className="h-4 w-4" />
          Importar
        </Button>
        <Button onClick={onAdd} className="gap-2">
          <Plus className="h-4 w-4" />
          Nova Aluna
        </Button>
      </div>

      {filtradas.length === 0 && !busca.trim() && !mostrarTodas ? (
        <Card className="flex flex-col items-center justify-center border-dashed p-12 gap-3">
          {alunas.length === 0 ? (
            <>
              <p className="text-lg font-medium text-muted-foreground">Nenhuma aluna cadastrada</p>
              <Button variant="outline" className="gap-2" onClick={onAdd}>
                <Plus className="h-4 w-4" />
                Cadastrar primeira aluna
              </Button>
            </>
          ) : (
            <>
              <p className="text-lg font-medium text-muted-foreground">Pesquise pelo nome ou exiba todas</p>
              <Button variant="outline" onClick={() => setMostrarTodas(true)} className="gap-2">
                Mostrar todas ({alunas.length})
              </Button>
            </>
          )}
        </Card>
      ) : filtradas.length === 0 ? (
        <Card className="flex flex-col items-center justify-center border-dashed p-12">
          <p className="text-lg font-medium text-muted-foreground">Nenhuma aluna encontrada</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtradas.map((aluna) => {
            const venc = new Date(aluna.dataVencimento);
            return (
              <Card key={aluna.id} className="flex items-center justify-between p-4 border-none shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm shrink-0">
                    {aluna.nomeCompleto.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link
                        to={`/alunas/personal-nutri?aluna=${encodeURIComponent(aluna.nomeCompleto)}`}
                        className="block truncate font-medium hover:text-primary hover:underline"
                        title="Abrir no painel Personal/Nutri"
                      >
                        {aluna.nomeCompleto}
                      </Link>
                      {ehAlunaTeste(aluna) && <SeloTeste />}
                    </div>
                    {ehAlunaTeste(aluna) && (
                      <BotaoApagarAlunaTeste aluna={aluna} variante="link" onApagada={onApagadaTeste} />
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span>{PROGRAM_LABELS[aluna.programa]}</span>
                      <span>·</span>
                      <span>{DURATION_LABELS[aluna.duracaoPlano]}</span>
                      <span>·</span>
                      <span>{PAYMENT_LABELS[aluna.formaPagamento]}</span>
                      <span>·</span>
                      <span>Vence {format(venc, "dd/MM/yyyy", { locale: ptBR })}</span>
                      {aluna.deuSinal && (
                        <>
                          <span>·</span>
                          <span className="text-accent font-medium">Sinal R$ {aluna.valorSinal?.toFixed(2)}</span>
                          {aluna.dataCobrancaSinal && (
                            <>
                              <span>·</span>
                              <span className="text-orange-600 font-medium bg-orange-50 px-1.5 py-0.5 rounded-md border border-orange-100 flex items-center gap-1 inline-flex">
                                <BellRing className="h-3 w-3" />
                                Cobrar {format(parseISO(aluna.dataCobrancaSinal), "dd/MM")}
                              </span>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex items-center gap-1">
                    <DeliverableIcon done={aluna.fotosAnamnese} label="Fotos/Anamnese" icon={Camera} />
                    <DeliverableIcon done={aluna.liberouTreinoDieta} label="Treino/Dieta" icon={Dumbbell} />
                    <DeliverableIcon done={aluna.liberouFotos} label="Fotos liberadas" icon={Image} />
                  </div>
                  {getStatusBadge(aluna)}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(aluna)}>
                        <Pencil className="mr-2 h-4 w-4" />Editar
                      </DropdownMenuItem>
                      {/* Aluna de teste sai pelo "Apagar aluna de teste", que leva junto o que foi gerado para ela. */}
                      {!ehAlunaTeste(aluna) && (
                        <DropdownMenuItem onClick={() => onDelete(aluna.id)} className="text-destructive">
                          <Trash2 className="mr-2 h-4 w-4" />Excluir
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
