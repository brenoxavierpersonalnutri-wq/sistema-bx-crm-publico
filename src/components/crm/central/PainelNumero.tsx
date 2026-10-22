// Painel de UM número na Central: abas Fluxos, Automações, Disparos, Grupos, Roteiros e Limites.
// As telas de edição continuam as que já existem (Automações / Roteiros); aqui se vê o que é de cada
// número, se move de número (numero_id) e se ajustam os limites do número (crm_numeros).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Loader2, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/crmAutomacoes";
import {
  ABAS_CENTRAL,
  linkModulo,
  numeroPadrao,
  pertenceAo,
  validarLimites,
  type ModuloCentral,
  type NumeroCRM,
} from "@/lib/crm/central";
import type { DadosCentral, RegistroNumerado } from "@/hooks/useCentralAutomacao";
import { LinksConviteGrupos } from "@/components/crm/grupos/LinksConviteGrupos";

const PADRAO = "__padrao__";

function ListaRegistros({
  tabela,
  registros,
  numero,
  numeros,
  provisorio,
  podeMover,
  rotuloEstado,
  vazio,
  onMudou,
}: {
  tabela: "crm_fluxos" | "crm_automacoes" | "crm_campanhas";
  registros: RegistroNumerado[];
  numero: NumeroCRM;
  numeros: NumeroCRM[];
  provisorio: boolean;
  podeMover: (r: RegistroNumerado) => boolean;
  rotuloEstado: (r: RegistroNumerado) => { texto: string; ligado: boolean };
  vazio: string;
  onMudou: () => void;
}) {
  const { toast } = useToast();
  const [salvando, setSalvando] = useState<string | null>(null);
  const padrao = numeroPadrao(numeros);
  const meus = registros.filter((r) => pertenceAo(r, numero.id, numeros));
  const outros = registros.filter((r) => !pertenceAo(r, numero.id, numeros) && podeMover(r));

  const mover = async (r: RegistroNumerado, destino: string) => {
    setSalvando(r.id);
    // o padrão é gravado como NULL (é o que o motor já entende como "número padrão")
    const numero_id = destino === PADRAO || destino === padrao?.id ? null : destino;
    const { error } = await db.from(tabela).update({ numero_id }).eq("id", r.id);
    setSalvando(null);
    if (error) toast({ title: "Não consegui mover", description: error.message, variant: "destructive" });
    else onMudou();
  };

  return (
    <div className="space-y-3">
      {meus.length === 0 ? (
        <p className="text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {meus.map((r) => {
            const est = rotuloEstado(r);
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.nome}</div>
                  {r.gatilho_tipo && <div className="text-xs text-muted-foreground">gatilho: {r.gatilho_tipo}{r.gatilho_valor ? ` · ${r.gatilho_valor}` : ""}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={est.ligado ? "default" : "secondary"}>{est.texto}</Badge>
                  <Select
                    value={r.numero_id && r.numero_id !== padrao?.id ? r.numero_id : PADRAO}
                    onValueChange={(v) => mover(r, v)}
                    disabled={provisorio || !podeMover(r) || salvando === r.id}
                  >
                    <SelectTrigger className="h-8 w-[190px]" aria-label={`Número de ${r.nome}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PADRAO}>{padrao ? `${padrao.apelido} (padrão)` : "Número padrão"}</SelectItem>
                      {numeros.filter((n) => n.id !== padrao?.id).map((n) => (
                        <SelectItem key={n.id} value={n.id}>{n.apelido}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!provisorio && outros.length > 0 && (
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground shrink-0">Trazer para este número:</Label>
          <Select value="" onValueChange={(id) => { const r = outros.find((x) => x.id === id); if (r) mover(r, numero.id); }}>
            <SelectTrigger className="h-8 w-[260px]"><SelectValue placeholder="escolher..." /></SelectTrigger>
            <SelectContent>
              {outros.map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

function LimitesNumero({ numero, provisorio, envioConfig, onMudou }: {
  numero: NumeroCRM;
  provisorio: boolean;
  envioConfig: DadosCentral["envioConfig"];
  onMudou: () => void;
}) {
  const { toast } = useToast();
  const [v, setV] = useState(numero);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setV(numero), [numero]);
  const erro = validarLimites(v);
  const telefoneOk = !v.telefone || /^\d{10,15}$/.test(v.telefone);

  const salvar = async () => {
    setSalvando(true);
    const { error } = await db.from("crm_numeros").update({
      apelido: v.apelido.trim() || numero.apelido,
      telefone: v.telefone ? v.telefone.replace(/\D/g, "") : null,
      ativo: v.ativo,
      max_hora: v.max_hora,
      max_dia: v.max_dia,
      hora_inicio: v.hora_inicio,
      hora_fim: v.hora_fim,
    }).eq("id", numero.id);
    setSalvando(false);
    if (error) toast({ title: "Não salvou", description: error.message, variant: "destructive" });
    else { toast({ title: "Limites salvos" }); onMudou(); }
  };

  const campo = (k: "max_hora" | "max_dia" | "hora_inicio" | "hora_fim", rotulo: string) => (
    <div className="space-y-1">
      <Label htmlFor={`lim-${k}`} className="text-xs">{rotulo}</Label>
      <Input id={`lim-${k}`} type="number" value={v[k]} disabled={provisorio}
        onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} className="h-8" />
    </div>
  );

  return (
    <div className="space-y-4 max-w-2xl">
      {provisorio && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          A tabela de números ainda não existe no banco (migration 20261024100000). Os números acima são o cadastro
          inicial, só para leitura.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="lim-apelido" className="text-xs">Apelido</Label>
          <Input id="lim-apelido" value={v.apelido} disabled={provisorio} onChange={(e) => setV({ ...v, apelido: e.target.value })} className="h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lim-tel" className="text-xs">Telefone (só dígitos, com 55)</Label>
          <Input id="lim-tel" value={v.telefone ?? ""} disabled={provisorio} placeholder="5531..." onChange={(e) => setV({ ...v, telefone: e.target.value.replace(/\D/g, "") || null })} className="h-8" />
        </div>
        {campo("max_hora", "Máx. mensagens por hora")}
        {campo("max_dia", "Máx. mensagens por dia")}
        {campo("hora_inicio", "Começa às (h, Brasília)")}
        {campo("hora_fim", "Para às (h, Brasília)")}
      </div>
      <div className="flex items-center gap-2">
        <Switch id="lim-ativo" checked={v.ativo} disabled={provisorio} onCheckedChange={(ativo) => setV({ ...v, ativo })} />
        <Label htmlFor="lim-ativo">Número ativo (desativado = nada envia por ele)</Label>
      </div>
      {(erro || !telefoneOk) && <p className="text-sm text-red-600">{erro ?? "telefone com 10 a 15 dígitos"}</p>}
      <Button size="sm" onClick={salvar} disabled={provisorio || !!erro || !telefoneOk || salvando}>
        {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}<span className="ml-1.5">Salvar</span>
      </Button>
      {numero.tipo === "openwa" && (
        <p className="text-xs text-muted-foreground">
          Hoje o motor de envio ainda aplica um limite único para o envio não oficial
          {envioConfig ? ` (${envioConfig.max_hora}/h, ${envioConfig.max_dia}/dia, em Automações > Limites)` : ""}, por cima
          deste. O limite por número fica gravado aqui e passa a valer quando o motor ficar multi-número.
        </p>
      )}
    </div>
  );
}

export function PainelNumero({
  numero,
  dados,
  aba,
  onAba,
  onAbrirAutomacoes,
  onAbrirRoteiros,
  onMudou,
}: {
  numero: NumeroCRM;
  dados: DadosCentral;
  aba: ModuloCentral;
  onAba: (a: ModuloCentral) => void;
  onAbrirAutomacoes: () => void;
  onAbrirRoteiros: () => void;
  onMudou: () => void;
}) {
  const comum = { numero, numeros: dados.numeros, provisorio: dados.numerosProvisorios, onMudou };
  const ligado = (r: RegistroNumerado) => ({ texto: r.ativo ? "ligado" : "desligado", ligado: !!r.ativo });
  const botaoEditor = (
    <Button variant="outline" size="sm" onClick={onAbrirAutomacoes}>
      <ExternalLink className="h-4 w-4" /><span className="ml-1.5">Abrir editor completo</span>
    </Button>
  );

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">{numero.apelido}</h3>
        {numero.observacao && <span className="text-xs text-muted-foreground">{numero.observacao}</span>}
      </div>
      <Tabs value={aba} onValueChange={(v) => onAba(v as ModuloCentral)}>
        <TabsList className="flex-wrap h-auto">
          {ABAS_CENTRAL.map((a) => <TabsTrigger key={a.id} value={a.id}>{a.rotulo}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="fluxos" className="space-y-3">
          {!dados.fluxosDisponiveis
            ? <p className="text-sm text-muted-foreground">Fluxos ainda não instalados no banco (migration 20261023120000).</p>
            : <ListaRegistros {...comum} tabela="crm_fluxos" registros={dados.fluxos} podeMover={() => true} rotuloEstado={ligado}
                vazio="Nenhum fluxo neste número." />}
          {botaoEditor}
        </TabsContent>

        <TabsContent value="automacoes" className="space-y-3">
          <ListaRegistros {...comum} tabela="crm_automacoes" registros={dados.automacoes} podeMover={() => true} rotuloEstado={ligado}
            vazio="Nenhuma regra gatilho → ação neste número." />
          {botaoEditor}
        </TabsContent>

        <TabsContent value="disparos" className="space-y-3">
          {numero.tipo === "oficial" && (
            <p className="text-sm text-muted-foreground">Disparo pelo número oficial usa template aprovado (Full Funnel), fora dos limites do OpenWA.</p>
          )}
          <ListaRegistros {...comum} tabela="crm_campanhas" registros={dados.campanhas}
            podeMover={(r) => r.status === "rascunho"}
            rotuloEstado={(r) => ({ texto: `${r.status ?? "?"}${r.total ? ` · ${r.total}` : ""}`, ligado: r.status === "ativa" })}
            vazio="Nenhuma campanha neste número. Só rascunho muda de número." />
          {botaoEditor}
        </TabsContent>

        <TabsContent value="grupos" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Campanhas de grupo (link distribuidor e agenda de mensagens) ficam no módulo Grupos, filtrado por este número.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link to={linkModulo("/crm/grupos", numero.id)}><ExternalLink className="h-4 w-4" /><span className="ml-1.5">Abrir Grupos deste número</span></Link>
          </Button>
          <LinksConviteGrupos />
        </TabsContent>

        <TabsContent value="roteiros" className="space-y-3">
          <p className="text-sm text-muted-foreground">Roteiros são compartilhados entre os números; o envio sai pelo número da conversa.</p>
          {dados.roteiros.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum roteiro.</p> : (
            <ul className="divide-y rounded-lg border">
              {dados.roteiros.map((r) => (
                <li key={r.id} className="flex items-center justify-between p-2.5">
                  <span className="truncate">{r.nome}</span>
                  <span className="text-xs text-muted-foreground">{r.stage}{r.ativo ? "" : " · inativo"}</span>
                </li>
              ))}
            </ul>
          )}
          <Button variant="outline" size="sm" onClick={onAbrirRoteiros}>
            <ExternalLink className="h-4 w-4" /><span className="ml-1.5">Editar roteiros</span>
          </Button>
        </TabsContent>

        <TabsContent value="limites">
          <LimitesNumero numero={numero} provisorio={dados.numerosProvisorios} envioConfig={dados.envioConfig} onMudou={onMudou} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
