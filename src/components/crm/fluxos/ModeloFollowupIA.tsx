// Modelo pronto "Follow-up IA" (lista de fluxos): escolhe o agente de follow-up, o gatilho, o número e a cadência
// e cria o fluxo já montado (Mensagem da IA → Esperar → Respondeu? → ...). Nasce como RASCUNHO: nada sai até publicar.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { SeletorTags } from "@/components/crm/SeletorTags";
import { ItensEtapa } from "@/components/crm/etapas/ItensEtapa";
import {
  CADENCIA_PADRAO,
  diasDasTentativas,
  modeloFollowupIA,
  validarCadencia,
  type CatalogoConstrutor,
  type GatilhoFluxo,
} from "@/lib/crm/fluxosConstrutor";
import { INSTRUCOES_TENTATIVA_PADRAO } from "../../../../supabase/functions/_shared/agenteFollowup.ts";
import { useFluxos } from "./contexto";

type TipoGatilho = "sem_resposta" | "etapa" | "tag";

/** "1, 2, 4, 7" → [1, 2, 4, 7] (o que não for número vira NaN e a validação acusa). */
export const lerCadencia = (t: string): number[] => t.split(/[,;\s]+/).filter(Boolean).map((x) => Number(x));

/** Texto dos dias de cada mensagem: [1,2,4,7] → "no gatilho, D+1, D+3, D+7, D+14". */
export const textoDias = (cad: number[]): string => diasDasTentativas(cad).map((d) => (d === 0 ? "no gatilho" : `D+${d}`)).join(", ");

export function ModeloFollowupIA({ aberto, onFechar, pasta }: { aberto: boolean; onFechar: () => void; pasta: string | null }) {
  const { fonte, base } = useFluxos();
  const navegar = useNavigate();
  const { toast } = useToast();
  const [catalogo, setCatalogo] = useState<CatalogoConstrutor | null>(null);
  const [nome, setNome] = useState("Follow-up IA");
  const [agente, setAgente] = useState("");
  const [tipo, setTipo] = useState<TipoGatilho>("sem_resposta");
  const [horas, setHoras] = useState(24);
  const [etapa, setEtapa] = useState("contato");
  const [tag, setTag] = useState("");
  const [numero, setNumero] = useState<string>("");
  const [cadTexto, setCadTexto] = useState(CADENCIA_PADRAO.join(", "));
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    fonte.catalogo().then((c) => {
      setCatalogo(c);
      const ag = c.agentes.find((a) => a.tipo === "followup" && a.id);
      if (ag?.id) setAgente((x) => x || ag.id!);
      const num = c.numeros.find((n) => n.tipo !== "oficial" && n.ativo !== false);
      if (num) setNumero((x) => x || num.id);
    }).catch(() => setCatalogo(null));
  }, [aberto, fonte]);

  const agentes = (catalogo?.agentes ?? []).filter((a) => a.tipo === "followup" && a.id);
  const cadencia = useMemo(() => lerCadencia(cadTexto), [cadTexto]);
  const errosCad = validarCadencia(cadencia);
  const gatilho: GatilhoFluxo = tipo === "sem_resposta" ? { tipo, horas } : tipo === "etapa" ? { tipo, valor: etapa } : { tipo: "tag", valor: tag };
  const faltando = [
    !agente ? "o agente de follow-up" : "",
    !numero ? "o número (não oficial)" : "",
    tipo === "tag" && !tag ? "a tag do gatilho" : "",
    tipo === "sem_resposta" && !(horas >= 1 && horas <= 1440) ? "as horas sem resposta (1 a 1440)" : "",
  ].filter(Boolean);

  const criar = async () => {
    if (faltando.length || errosCad.length) return;
    setOcupado(true);
    try {
      const m = modeloFollowupIA({ agenteId: agente, gatilho, cadencia, numeroId: numero, instrucoes: INSTRUCOES_TENTATIVA_PADRAO, nome });
      const id = await fonte.criar(m.nome, pasta, m);
      onFechar();
      navegar(`${base}/fluxos/${id}`);
      toast({ title: "Fluxo criado como rascunho", description: "Revise as mensagens e publique quando quiser. Nada é enviado antes disso." });
    } catch (e) {
      toast({ title: "Não deu certo", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setOcupado(false); }
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modelo: Follow-up IA</DialogTitle>
          <DialogDescription>
            A IA escreve cada mensagem na hora, com o histórico da conversa. Para quando a lead responde. Nasce como rascunho.
          </DialogDescription>
        </DialogHeader>
        {!catalogo ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1"><Label htmlFor="nome-modelo">Nome do fluxo</Label>
              <Input id="nome-modelo" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} /></div>

            <div className="space-y-1"><Label>Agente de follow-up</Label>
              <Select value={agente} onValueChange={setAgente}>
                <SelectTrigger aria-label="Agente de follow-up"><SelectValue placeholder="Escolha o agente" /></SelectTrigger>
                <SelectContent>{agentes.map((a) => <SelectItem key={a.id} value={a.id!}>{a.nome}</SelectItem>)}</SelectContent>
              </Select>
              {!agentes.length && <p className="text-xs text-muted-foreground">Crie antes em <Link className="underline" to="/crm/agente-ia">Agente IA</Link> → "Criar agente de follow-up".</p>}
            </div>

            <div className="space-y-1"><Label>Quando começa</Label>
              <div className="grid grid-cols-2 gap-2">
                <Select value={tipo} onValueChange={(v) => setTipo(v as TipoGatilho)}>
                  <SelectTrigger aria-label="Gatilho"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sem_resposta">Sem resposta há</SelectItem>
                    <SelectItem value="etapa">Entrou na etapa</SelectItem>
                    <SelectItem value="tag">Recebeu a tag</SelectItem>
                  </SelectContent>
                </Select>
                {tipo === "sem_resposta" && (
                  <div className="flex items-center gap-1.5"><Input type="number" min={1} max={1440} value={horas} onChange={(e) => setHoras(Number(e.target.value))} aria-label="Horas sem resposta" /><span className="text-sm">horas</span></div>
                )}
                {tipo === "etapa" && (
                  <Select value={etapa} onValueChange={setEtapa}>
                    <SelectTrigger aria-label="Etapa do gatilho"><SelectValue /></SelectTrigger>
                    <SelectContent><ItensEtapa incluir={etapa} /></SelectContent>
                  </Select>
                )}
              </div>
              {tipo === "tag" && <SeletorTags valor={tag ? [tag] : []} onMudar={(t) => setTag(t[0] ?? "")} fonte={{ listar: fonte.tags, criar: fonte.criarTag }} rotulo="Tag do gatilho" />}
            </div>

            <div className="space-y-1"><Label>Número</Label>
              <Select value={numero} onValueChange={setNumero}>
                <SelectTrigger aria-label="Número do fluxo"><SelectValue placeholder="Escolha o número" /></SelectTrigger>
                <SelectContent>
                  {catalogo.numeros.map((n) => (
                    <SelectItem key={n.id} value={n.id} disabled={n.ativo === false || n.tipo === "oficial"}>
                      {n.apelido} · {n.tipo === "oficial" ? "oficial (só template, não serve para IA)" : "não oficial"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1"><Label htmlFor="cadencia">Cadência (esperas entre as tentativas, em dias)</Label>
              <Input id="cadencia" value={cadTexto} onChange={(e) => setCadTexto(e.target.value)} placeholder="1, 2, 4, 7" />
              {errosCad.length
                ? <p className="text-xs text-destructive">{errosCad.join(" ")}</p>
                : <p className="text-xs text-muted-foreground" data-testid="dias-cadencia">{cadencia.length + 1} mensagens: {textoDias(cadencia)}. Janela 8h às 20h; dá para editar tudo no construtor.</p>}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={criar} disabled={ocupado || !catalogo || faltando.length > 0 || errosCad.length > 0} title={faltando.length ? `Falta: ${faltando.join(", ")}` : ""}>
            {ocupado && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Criar rascunho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
