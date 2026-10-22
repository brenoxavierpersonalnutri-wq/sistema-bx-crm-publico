// Abas de leitura do detalhe da campanha: Diagnóstico (o que o número pode em cada grupo), Atividades
// (entradas/saídas) e Cliques (histórico do link com UTM). Só leitura.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { db, type CampanhaGrupos, type GrupoLinha, type NumeroWhatsApp } from "@/lib/grupos";
import { baixarCsv, diagnosticoNumero, paraCsv, type Periodo } from "@/lib/painelGrupos";
import { nomeDoNumero } from "@/lib/disparoGrupos";
import { GraficoDiario } from "./GraficoDiario";
import { Cartao, seletor } from "./ui";

const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function DiagnosticoCampanha({ campanha, grupos, numeros }: { campanha: CampanhaGrupos; grupos: GrupoLinha[]; numeros: NumeroWhatsApp[] }) {
  const dela = grupos.filter((g) => g.campanha_id === campanha.id);
  const d = diagnosticoNumero(dela);
  const ultima = dela.map((g) => g.permissao_em).filter(Boolean).sort().pop();
  return (
    <Cartao className="space-y-3 max-w-3xl">
      <div>
        <p className="font-semibold">Compatibilidade do número</p>
        <p className="text-xs text-muted-foreground">{nomeDoNumero(numeros, campanha.numero_id)} · última leitura {ultima ? dataHora(ultima) : "nunca (use “Ler permissões” na aba Configuração dos grupos)"}</p>
      </div>
      <div className="text-3xl font-bold text-amber-400">{d.pctCompat}%<span className="ml-2 text-sm font-normal text-muted-foreground">de compatibilidade (dispara em {d.admin + d.soEnvio} de {d.total - d.naoVerificado} grupos lidos)</span></div>
      <ul className="text-sm space-y-1">
        <li>É <b>admin</b> de {d.admin}/{d.total} grupos (dispara e configura)</li>
        <li>Só envio (não é admin, grupo aberto): {d.soEnvio}</li>
        <li className={d.semPermissao ? "text-red-400" : ""}>Sem permissão (só admins enviam): {d.semPermissao}</li>
        <li className="text-muted-foreground">Ainda não lidos: {d.naoVerificado}</li>
        {d.semId > 0 && <li className="text-muted-foreground">Grupos só com link (sem id, não recebem disparo): {d.semId}</li>}
      </ul>
    </Cartao>
  );
}

interface Evento { id: number; grupo_id: string; tipo: "entrada" | "saida"; quantidade: number; created_at: string }

export function AtividadesCampanha({ campanha, grupos, periodo }: { campanha: CampanhaGrupos; grupos: GrupoLinha[]; periodo: Periodo }) {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [tipo, setTipo] = useState("");
  const [grupo, setGrupo] = useState("");
  const nomes = useMemo(() => Object.fromEntries(grupos.map((g) => [g.id, g.nome || g.chat_id || "grupo"])), [grupos]);
  const dela = grupos.filter((g) => g.campanha_id === campanha.id);

  const carregar = useCallback(async () => {
    // sem a coluna participantes (a tela não lê quem entrou)
    let q = db.from("grupos_membros_eventos").select("id, grupo_id, tipo, quantidade, created_at")
      .eq("campanha_id", campanha.id).order("created_at", { ascending: false }).limit(500);
    if (tipo) q = q.eq("tipo", tipo);
    if (grupo) q = q.eq("grupo_id", grupo);
    const { data } = await q;
    setEventos((data ?? []) as Evento[]);
  }, [campanha.id, tipo, grupo]);
  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="space-y-3">
      <GraficoDiario campanhaId={campanha.id} periodo={periodo} mostrar={["entradas", "saidas"]} titulo="Entradas e saídas por dia" />
      <Cartao className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium flex-1">Histórico de atividades</p>
          <select className={seletor} value={grupo} onChange={(e) => setGrupo(e.target.value)} aria-label="Grupo">
            <option value="">Todos os grupos</option>
            {dela.map((g) => <option key={g.id} value={g.id}>{g.nome || g.chat_id}</option>)}
          </select>
          <select className={seletor} value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Evento">
            <option value="">Todos os eventos</option><option value="entrada">Entraram</option><option value="saida">Saíram</option>
          </select>
          <Button size="icon" variant="ghost" onClick={carregar} title="Atualizar"><RefreshCw className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" disabled={!eventos.length}
            onClick={() => baixarCsv(`atividades-${campanha.slug}.csv`, paraCsv(["Data", "Grupo", "Evento", "Quantidade"], eventos.map((e) => [dataHora(e.created_at), nomes[e.grupo_id], e.tipo === "entrada" ? "Entraram" : "Saíram", e.quantidade])))}>
            <Download className="h-4 w-4 mr-1" /> Exportar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Vem dos eventos do WhatsApp (webhook do OpenWA). Os números de quem entrou não ficam guardados aqui.</p>
        {!eventos.length && <p className="text-sm text-muted-foreground">Nenhum evento.</p>}
        <div className="max-h-96 overflow-y-auto divide-y divide-border text-sm">
          {eventos.map((e) => (
            <div key={e.id} className="flex flex-wrap gap-3 py-1.5">
              <span className="w-32 text-xs text-muted-foreground">{dataHora(e.created_at)}</span>
              <span className={e.tipo === "entrada" ? "text-green-500 w-24" : "text-red-400 w-24"}>{e.tipo === "entrada" ? `+${e.quantidade} entrou` : `-${e.quantidade} saiu`}</span>
              <span className="truncate flex-1">{nomes[e.grupo_id]}</span>
            </div>
          ))}
        </div>
      </Cartao>
    </div>
  );
}

interface Clique { id: number; grupo_id: string | null; resultado: "grupo" | "lotado" | "pausado"; telefone_e164: string | null; utm: Record<string, string> | null; created_at: string }
const ROTULO_RES: Record<Clique["resultado"], string> = { grupo: "foi pro grupo", lotado: "sem vaga", pausado: "link pausado" };

export function CliquesCampanha({ campanha, grupos, periodo }: { campanha: CampanhaGrupos; grupos: GrupoLinha[]; periodo: Periodo }) {
  const [cliques, setCliques] = useState<Clique[]>([]);
  const nomes = useMemo(() => Object.fromEntries(grupos.map((g) => [g.id, g.nome || g.chat_id || "grupo"])), [grupos]);
  const carregar = useCallback(async () => {
    const { data } = await db.from("grupos_cliques").select("id, grupo_id, resultado, telefone_e164, utm, created_at")
      .eq("campanha_id", campanha.id).order("created_at", { ascending: false }).limit(500);
    setCliques((data ?? []) as Clique[]);
  }, [campanha.id]);
  useEffect(() => { carregar(); }, [carregar]);
  const utmTexto = (u: Clique["utm"]) => Object.entries(u ?? {}).map(([k, v]) => `${k.replace(/^utm_/, "")}=${v}`).join(" · ");

  return (
    <div className="space-y-3">
      <GraficoDiario campanhaId={campanha.id} periodo={periodo} mostrar={["cliques"]} titulo="Cliques por dia" />
      <Cartao className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="font-medium flex-1">Histórico de cliques (últimos 500)</p>
          <Button size="icon" variant="ghost" onClick={carregar} title="Atualizar"><RefreshCw className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" disabled={!cliques.length}
            onClick={() => baixarCsv(`cliques-${campanha.slug}.csv`, paraCsv(["Data", "Grupo", "Resultado", "Telefone", "UTM"], cliques.map((c) => [dataHora(c.created_at), c.grupo_id ? nomes[c.grupo_id] : "", ROTULO_RES[c.resultado], c.telefone_e164, utmTexto(c.utm)])))}>
            <Download className="h-4 w-4 mr-1" /> Exportar
          </Button>
        </div>
        {!cliques.length && <p className="text-sm text-muted-foreground">Nenhum clique ainda.</p>}
        <div className="max-h-96 overflow-y-auto divide-y divide-border text-sm">
          {cliques.map((c) => (
            <div key={c.id} className="flex flex-wrap gap-3 py-1.5">
              <span className="w-32 text-xs text-muted-foreground">{dataHora(c.created_at)}</span>
              <span className={c.resultado === "grupo" ? "w-28 text-green-500" : "w-28 text-amber-400"}>{ROTULO_RES[c.resultado]}</span>
              <span className="truncate w-48">{c.grupo_id ? nomes[c.grupo_id] : "—"}</span>
              <span className="truncate flex-1 text-xs text-muted-foreground">{utmTexto(c.utm) || "sem UTM"}</span>
            </div>
          ))}
        </div>
      </Cartao>
    </div>
  );
}
