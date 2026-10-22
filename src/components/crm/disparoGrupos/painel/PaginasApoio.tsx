// Páginas de apoio do "Disparo em grupo": Leads (quem clicou no link com telefone), Deep links, Histórico
// (disparos e criações de grupo) e Segurança (anti-spam/blacklist do SendFlow, em breve).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Download, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { db, linkPublico, type CampanhaGrupos, type CriacaoGrupo } from "@/lib/grupos";
import { baixarCsv, nomeCampanha, paraCsv } from "@/lib/painelGrupos";
import { refazerAdmins } from "@/lib/disparoGrupos";
import { LinksConviteGrupos } from "@/components/crm/grupos/LinksConviteGrupos";
import { HistoricoDisparos } from "../HistoricoDisparos";
import { Cartao, EmBreve, seletor } from "./ui";

const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

interface LeadClique { id: number; campanha_id: string; grupo_id: string | null; resultado: string; telefone_e164: string; utm: Record<string, string> | null; created_at: string }

export function LeadsGrupos({ campanhas }: { campanhas: CampanhaGrupos[] }) {
  const [leads, setLeads] = useState<LeadClique[]>([]);
  const [campanha, setCampanha] = useState("");
  const [busca, setBusca] = useState("");
  const nomeDe = useMemo(() => Object.fromEntries(campanhas.map((c) => [c.id, nomeCampanha(c)])), [campanhas]);
  const carregar = useCallback(async () => {
    let q = db.from("grupos_cliques").select("id, campanha_id, grupo_id, resultado, telefone_e164, utm, created_at")
      .not("telefone_e164", "is", null).order("created_at", { ascending: false }).limit(1000);
    if (campanha) q = q.eq("campanha_id", campanha);
    const { data } = await q;
    setLeads((data ?? []) as LeadClique[]);
  }, [campanha]);
  useEffect(() => { carregar(); }, [carregar]);
  const visiveis = leads.filter((l) => !busca.trim() || l.telefone_e164.includes(busca.replace(/\D/g, "")));
  const utm = (u: LeadClique["utm"], k: string) => (u ?? {})[k] ?? (u ?? {})[`utm_${k}`] ?? "";

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-xl font-semibold">Leads de grupo</h3>
        <p className="text-sm text-muted-foreground">Quem chegou pelo link /g/ com telefone (vira lead na Base com a tag da campanha). Últimos 1.000.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <select className={seletor} value={campanha} onChange={(e) => setCampanha(e.target.value)} aria-label="Campanha">
          <option value="">Todas as campanhas</option>
          {campanhas.filter((c) => !c.avulsa).map((c) => <option key={c.id} value={c.id}>{nomeCampanha(c)}</option>)}
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Button size="icon" variant="ghost" onClick={carregar} title="Atualizar"><RefreshCw className="h-4 w-4" /></Button>
        <Button variant="outline" disabled={!visiveis.length}
          onClick={() => baixarCsv("leads-grupos.csv", paraCsv(["Data", "Telefone", "Campanha", "Resultado", "utm_source", "utm_medium", "utm_campaign", "utm_content"],
            visiveis.map((l) => [dataHora(l.created_at), l.telefone_e164, nomeDe[l.campanha_id], l.resultado, utm(l.utm, "source"), utm(l.utm, "medium"), utm(l.utm, "campaign"), utm(l.utm, "content")])))}>
          <Download className="h-4 w-4 mr-1" /> Exportar
        </Button>
      </div>
      <Cartao className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr className="border-b border-border">
            <th className="p-2 text-left">Data</th><th className="p-2 text-left">Telefone</th><th className="p-2 text-left">Campanha</th><th className="p-2 text-left">Resultado</th><th className="p-2 text-left">Origem (UTM)</th>
          </tr></thead>
          <tbody>
            {visiveis.map((l) => (
              <tr key={l.id} className="border-b border-border/60">
                <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">{dataHora(l.created_at)}</td>
                <td className="p-2 font-mono text-xs">{l.telefone_e164}</td>
                <td className="p-2 truncate max-w-[220px]">{nomeDe[l.campanha_id] ?? "—"}</td>
                <td className="p-2">{l.resultado === "grupo" ? "foi pro grupo" : l.resultado === "lotado" ? "sem vaga" : "link pausado"}</td>
                <td className="p-2 text-xs text-muted-foreground">{[utm(l.utm, "source"), utm(l.utm, "campaign")].filter(Boolean).join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visiveis.length && <p className="p-3 text-sm text-muted-foreground">Nenhum lead com telefone ainda (o telefone vem quando a página de captura passa ?tel= no link).</p>}
      </Cartao>
    </div>
  );
}

export function DeepLinksGrupos({ campanhas }: { campanhas: CampanhaGrupos[] }) {
  const { toast } = useToast();
  const comLink = campanhas.filter((c) => !c.avulsa);
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-semibold">Deep links</h3>
        <p className="text-sm text-muted-foreground">Links das campanhas (/g/, distribuem entre os grupos) e links curtos fixos para um grupo.</p>
      </div>
      <Cartao className="space-y-1">
        <p className="font-medium text-sm">Links das campanhas</p>
        {comLink.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2 py-1 text-sm">
            <span className="flex-1 min-w-[160px] truncate">{nomeCampanha(c)}{c.encerrada ? " (encerrada)" : c.link_pausado ? " (pausado)" : ""}</span>
            <code className="truncate rounded bg-muted px-2 py-0.5 text-xs">{linkPublico(c.slug)}</code>
            <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(linkPublico(c.slug)); toast({ title: "Link copiado" }); }}><Copy className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
        {!comLink.length && <p className="text-sm text-muted-foreground">Nenhuma campanha com link.</p>}
      </Cartao>
      <LinksConviteGrupos />
      <EmBreve titulo="Pixel Meta/TikTok, anti-bot e tradução na página do link"><p>No SendFlow o deep link pode disparar evento de conversão e pedir um desafio anti-bot antes de mandar pro grupo.</p></EmBreve>
    </div>
  );
}

export function HistoricoGrupos({ campanhas }: { campanhas: CampanhaGrupos[] }) {
  const [criacoes, setCriacoes] = useState<(CriacaoGrupo & { campanha_id: string })[]>([]);
  const [refazendo, setRefazendo] = useState<string | null>(null);
  const { toast } = useToast();
  const carregar = useCallback(() => {
    db.from("grupos_criacoes").select("*").order("created_at", { ascending: false }).limit(100)
      .then(({ data }: { data: (CriacaoGrupo & { campanha_id: string })[] | null }) => setCriacoes(data ?? []));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const refazer = async (c: CriacaoGrupo) => {
    if (!window.confirm(`Refazer os admins de "${c.nome}"? O número de grupos vai ADICIONAR os admins da campanha que não estão no grupo e promovê-los.`)) return;
    setRefazendo(c.id);
    try {
      const r = await refazerAdmins(c.id);
      toast({ title: r.ok ? "Admins aplicados" : "Admins com problema", description: r.texto, variant: r.ok ? "default" : "destructive" });
    } catch (e) {
      toast({ title: "Não deu para refazer os admins", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setRefazendo(null);
      carregar();
    }
  };
  const nomeDe = Object.fromEntries(campanhas.map((c) => [c.id, nomeCampanha(c)]));
  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold">Histórico</h3>
      <Cartao className="space-y-2">
        <p className="font-medium">Disparos</p>
        <HistoricoDisparos campanhas={campanhas} recarregar={0} />
      </Cartao>
      <Cartao className="space-y-1">
        <p className="font-medium">Criação de grupos (últimas 100)</p>
        {!criacoes.length && <p className="text-sm text-muted-foreground">Nenhum grupo criado pelo CRM ainda.</p>}
        {criacoes.map((c) => (
          <div key={c.id} className="flex flex-wrap gap-3 py-1 text-sm border-b border-border/60">
            <span className="w-32 text-xs text-muted-foreground">{dataHora(c.created_at)}</span>
            <span className="flex-1 truncate">{c.nome} <span className="text-muted-foreground">· {nomeDe[c.campanha_id] ?? "campanha"}</span></span>
            <span className={c.status === "ok" ? "text-green-500" : c.status === "erro" ? "text-red-400" : "text-muted-foreground"}>{c.status === "ok" ? "criado" : c.status}{c.status !== "ok" ? ` (${c.etapa})` : ""}</span>
            {c.chat_id && (c.status === "ok" || c.status === "erro") && (
              <Button size="sm" variant="outline" className="h-7" disabled={refazendo !== null} onClick={() => refazer(c)}>
                {refazendo === c.id ? "Refazendo…" : "Refazer admins"}
              </Button>
            )}
            {c.erro && <span className="w-full text-xs text-red-400">{c.erro}</span>}
            {c.avisos?.length > 0 && <span className="w-full text-xs text-amber-600">{c.avisos.join(" · ")}</span>}
          </div>
        ))}
      </Cartao>
    </div>
  );
}

export function SegurancaGrupos() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-semibold">Segurança</h3>
        <p className="text-sm text-muted-foreground">O que já protege o número hoje, e o que o SendFlow tem a mais.</p>
      </div>
      <Cartao className="text-sm space-y-1">
        <p className="font-medium">Ativo agora</p>
        <p>• Allowlist: o proxy só envia para grupos cadastrados aqui (campanhas não encerradas).</p>
        <p>• Ritmo: até 6 mensagens/min, 200 grupos/dia, 8 s entre envios, por número.</p>
        <p>• Criação de grupo só pelo número Grupos 1, no máximo 1/min e 10/dia.</p>
        <p>• Configurar grupo (nome, foto, descrição, admins) só onde o número é admin.</p>
      </Cartao>
      <div className="grid gap-3 md:grid-cols-2">
        <EmBreve titulo="Anti-spam (números bloqueados e administrativos)"><p>Lista de números que são removidos/recusados nos grupos e lista de números da equipe que nunca são removidos.</p></EmBreve>
        <EmBreve titulo="Blacklists"><p>Listas nomeadas de golpistas, aplicadas na entrada dos grupos.</p></EmBreve>
        <EmBreve titulo="Anti-hacker"><p>Com o grupo fechado, apaga mensagem de quem não é admin e remove o autor.</p></EmBreve>
        <EmBreve titulo="Alertas de banimento"><p>Relatório de número banido e grupo suspenso, por número e data.</p></EmBreve>
      </div>
    </div>
  );
}
