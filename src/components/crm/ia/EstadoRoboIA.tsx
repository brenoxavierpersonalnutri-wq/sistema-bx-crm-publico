// Estado real do robô de IA (tela Agente IA, 18/10/2026): chave "Robô de IA ligado" por número (padrão desligado),
// conversas com a IA, conversas que precisam de humano e respostas nas últimas 24 h. Substitui o aviso antigo
// "o robô ainda não está plugado no OpenWA".
import { useCallback, useEffect, useState } from "react";
import { Bot, Hand, Loader2, Power } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { estadoRobo, ligarRoboDoNumero, type EstadoRobo } from "@/lib/crm/roboIA";

export function EstadoRoboIA({ versao = 0 }: { versao?: number }) {
  const { toast } = useToast();
  const [estado, setEstado] = useState<EstadoRobo | null>(null);
  const [mudando, setMudando] = useState<string | null>(null);
  // Confirmação dentro da página (19/10/2026). Era window.confirm: quando o Chrome suprime o diálogo nativo
  // ("impedir esta página de criar diálogos", aba controlada por extensão/automação, iframe do preview) o
  // confirm devolve false na hora, sem abrir nada — o switch não mudava, sem requisição e sem erro.
  const [confirmar, setConfirmar] = useState<{ id: string; apelido: string } | null>(null);

  const carregar = useCallback(async () => {
    try {
      setEstado(await estadoRobo());
    } catch {
      setEstado({ migracao: false, numeros: [], conversasIA: 0, precisaHumano: 0, respostas24h: 0, ultimoEvento: null });
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar, versao]);

  const aplicar = async (id: string, apelido: string, ligado: boolean) => {
    setMudando(id);
    try {
      await ligarRoboDoNumero(id, ligado);
      toast({ title: ligado ? `Robô ligado no ${apelido}` : `Robô desligado no ${apelido}`, description: ligado ? "A IA responde as conversas dela neste número." : "Nenhuma mensagem da IA sai por este número." });
      await carregar();
    } catch (e) {
      toast({ title: "Não mudou", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setMudando(null);
    }
  };

  // Ligar pede confirmação; desligar é imediato (desligar é sempre o lado seguro).
  const alternar = (id: string, apelido: string, ligado: boolean) => {
    if (ligado) setConfirmar({ id, apelido });
    else void aplicar(id, apelido, false);
  };

  if (!estado) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lendo o estado do robô...</div>;

  if (!estado.migracao) {
    return (
      <p className="text-sm text-muted-foreground max-w-3xl" data-testid="estado-robo">
        O robô de atendimento ainda não está instalado neste banco (falta a migration 20261103100000_crm_robo_atendimento_ia.sql e publicar as functions). Até lá, nenhum número responde sozinho; aqui você deixa cada agente pronto e testa no simulador.
      </p>
    );
  }

  const ligados = estado.numeros.filter((n) => n.robo_ia_ligado);
  const elegiveis = estado.numeros.filter((n) => n.tipo !== "oficial");
  return (
    <section className="rounded-xl border bg-card p-4 md:p-5 space-y-4" aria-label="Robô de IA" data-testid="estado-robo">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <Power className={`h-5 w-5 ${ligados.length ? "text-success" : "text-muted-foreground"}`} />
            {ligados.length
              ? `Robô de IA ligado em ${ligados.map((n) => n.apelido).join(", ")}`
              : "Robô de IA desligado em todos os números: nenhuma mensagem da IA sai"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            No chat, "Transferir para IA" passa a conversa para um agente do mesmo número; ela devolve para humano quando o prompt de transferência mandar.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-lg bg-secondary px-3 py-2 min-w-[92px]">
            <div className="flex items-center gap-1.5 text-lg font-bold tabular-nums"><Bot className="h-4 w-4 text-primary" /> {estado.conversasIA}</div>
            <div className="text-xs text-muted-foreground">com a IA</div>
          </div>
          <div className={`rounded-lg px-3 py-2 min-w-[92px] ${estado.precisaHumano ? "bg-amber-500/15 text-amber-300" : "bg-secondary"}`} data-testid="contador-precisa-humano">
            <div className="flex items-center gap-1.5 text-lg font-bold tabular-nums"><Hand className="h-4 w-4" /> {estado.precisaHumano}</div>
            <div className={`text-xs ${estado.precisaHumano ? "" : "text-muted-foreground"}`}>precisam de humano</div>
          </div>
          <div className="rounded-lg bg-secondary px-3 py-2 min-w-[92px]">
            <div className="text-lg font-bold tabular-nums">{estado.respostas24h}</div>
            <div className="text-xs text-muted-foreground">respostas em 24 h</div>
          </div>
        </div>
      </div>
      {elegiveis.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {elegiveis.map((n) => (
            <label key={n.id} className={`flex items-center gap-2.5 rounded-xl border bg-secondary px-3 py-2 text-sm ${n.ativo === false ? "opacity-60" : "cursor-pointer"}`}>
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${n.ativo === false ? "bg-zinc-500" : n.robo_ia_ligado ? "bg-success" : "bg-red-500"}`} />
              <span className="font-medium">{n.apelido}</span>
              <span className="text-xs text-muted-foreground">{n.ativo === false ? "número inativo" : n.robo_ia_ligado ? "ligado" : "desligado"}</span>
              <Switch
                checked={Boolean(n.robo_ia_ligado)}
                disabled={mudando === n.id || n.ativo === false}
                onCheckedChange={(v) => alternar(n.id, n.apelido, v)}
                aria-label={`Robô de IA ligado no ${n.apelido}`}
              />
            </label>
          ))}
        </div>
      )}
      {estado.ultimoEvento && <p className="text-xs text-muted-foreground">Última atividade {new Date(estado.ultimoEvento).toLocaleString("pt-BR")}</p>}
      <AlertDialog open={confirmar !== null} onOpenChange={(aberto) => { if (!aberto) setConfirmar(null); }}>
        <AlertDialogContent data-testid="confirmar-ligar-robo">
          <AlertDialogHeader>
            <AlertDialogTitle>Ligar o robô de IA no número {confirmar?.apelido}?</AlertDialogTitle>
            <AlertDialogDescription>
              A IA passa a responder sozinha as conversas transferidas para ela neste número (e as novas, se algum agente estiver "Ligado").
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const alvo = confirmar;
                setConfirmar(null);
                if (alvo) void aplicar(alvo.id, alvo.apelido, true);
              }}
            >
              Ligar robô
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
