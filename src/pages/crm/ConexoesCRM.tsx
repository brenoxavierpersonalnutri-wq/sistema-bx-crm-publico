// /crm/conexoes — Conexão dos números de WhatsApp (um cartão por número de crm_numeros) e espaço do Instagram.
// Status ao vivo pelo whatsapp-qr (?action=status&sessao=X); "Conectar" abre o QR em tela grande e relê a
// cada 4 s até a sessão ficar "ready". Sessão que a ponte da VPS ainda não atende mostra aviso, sem quebrar.
// O modal tem duas abas: "QR code" e "Número de telefone" (código de 8 caracteres, PainelCodigo); o ciclo de
// status roda nas duas e fecha o pareamento quando conecta. Na aba do código ele só lê o status (sem buscar
// a imagem do QR): o código mostrado fica travado até a pessoa gerar outro.
// "Desconectar" (21/10/2026; admin ou liberação Comercial, só número OpenWA conectado): confirma com nome e número,
// pede logout + reinício da sessão à whatsapp-qr e o cartão volta para "desconectado / aguardando QR" com Conectar.
import { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, CheckCircle2, Download, Loader2, PlugZap, QrCode, RefreshCw, Smartphone, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { buscarComLimite } from "@/lib/fetchComLimite";
import { db } from "@/lib/crmAutomacoes";
import { COR_ESTADO_NUMERO } from "@/components/crm/layout/corEstado";
import { CanalInstagram } from "@/components/crm/central/CanalInstagram";
import {
  NUMEROS_PADRAO, SESSAO_PADRAO, formatarTelefone, interpretarStatusNumero, type NumeroCRM, type StatusNumero,
} from "@/lib/crm/central";
import { fonteSupabase, trazerConversasAoConectar, trazerConversasRecentes } from "@/lib/crm/fonteConversas";
import { HistoricoCompleto } from "@/components/crm/conexoes/HistoricoCompleto";
import { CampoNomeNumero, NomeEditavel } from "@/components/crm/conexoes/NomeNumero";
import { PainelCodigo } from "@/components/crm/conexoes/PainelCodigo";
import { avisarNumerosAlterados, renomearNumero, validarNomeNumero } from "@/lib/crm/renomearNumero";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { desconectarNumero, podeVerDesconectar, statusDepoisDeDesconectar } from "@/lib/crm/desconectarNumero";

// Ritmo do modal Conectar (20/10/2026): 4 s com dois modais abertos estourou o throttler do OpenWA (1000/h no
// GET de status, bloqueio de 1 h). O QR do WhatsApp troca a cada ~20 s: 6 s basta. Na aba do código só o status
// importa (detectar "conectou"): 10 s. Aba do navegador escondida não consulta.
const INTERVALO_QR_MS = 6000;
const INTERVALO_STATUS_CODIGO_MS = 10000;
const INTERVALO_STATUS_MS = 20000;

type Resposta = Record<string, unknown> & { qr?: string | null; aviso?: string; error?: string };

async function chamarQr(sessao: string, action: "status" | "qr"): Promise<{ ok: boolean; status: number; corpo: Resposta }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, status: 401, corpo: { error: "Sessão expirada: entre de novo" } };
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectId}.supabase.co/functions/v1/whatsapp-qr?action=${action}&sessao=${encodeURIComponent(sessao)}`;
  const res = await buscarComLimite(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
  const corpo = (await res.json().catch(() => ({}))) as Resposta;
  return { ok: res.ok, status: res.status, corpo };
}

const SEM_LEITURA: StatusNumero = { estado: "desconhecido", rotulo: "sem leitura", telefone: null, aviso: "Não consegui ler o status agora" };

async function lerStatus(n: NumeroCRM): Promise<StatusNumero> {
  if (n.tipo === "oficial") return interpretarStatusNumero(n, null);
  try {
    const r = await chamarQr(n.sessao_openwa ?? SESSAO_PADRAO, "status");
    return interpretarStatusNumero(n, r.corpo);
  } catch {
    return SEM_LEITURA;
  }
}

export default function ConexoesCRM() {
  const { toast } = useToast();
  const [numeros, setNumeros] = useState<NumeroCRM[] | null>(null);
  const [status, setStatus] = useState<Map<string, StatusNumero>>(new Map());
  const [lendo, setLendo] = useState(false);
  const [pareando, setPareando] = useState<NumeroCRM | null>(null);
  const [desconectar, setDesconectar] = useState<NumeroCRM | null>(null);
  const [desconectando, setDesconectando] = useState(false);
  const queryClient = useQueryClient();
  const { isAdmin, allowedModules } = useAuth();
  const acesso = { isAdmin, modulos: allowedModules ?? [] };

  // Renomeia (só o apelido), atualiza os cartões na hora e avisa Conversas/caches.
  const renomear = useCallback(async (n: NumeroCRM, nome: string) => {
    const gravado = await renomearNumero(n.id, nome);
    setNumeros((lista) => lista?.map((x) => (x.id === n.id ? { ...x, apelido: gravado } : x)) ?? lista);
    avisarNumerosAlterados();
    void queryClient.invalidateQueries({
      predicate: (q) => JSON.stringify(q.queryKey).toLowerCase().includes("numero"),
    });
    toast({ title: "Nome salvo", description: `Agora este número aparece como "${gravado}" em todo o CRM.` });
  }, [queryClient, toast]);
  const validar = useCallback(
    (id: string) => (nome: string) => validarNomeNumero(nome, numeros ?? [], id),
    [numeros],
  );

  const atualizar = useCallback(async (lista: NumeroCRM[]) => {
    setLendo(true);
    const lidos = await Promise.all(lista.filter((n) => n.ativo).map(async (n) => [n.id, await lerStatus(n)] as const));
    setStatus(new Map(lidos));
    setLendo(false);
  }, []);

  useEffect(() => {
    (async () => {
      let lista = NUMEROS_PADRAO;
      try {
        const { data, error } = await db.from("crm_numeros").select("*").order("ordem");
        if (!error && data?.length) lista = data as NumeroCRM[];
      } catch { /* seed embutido */ }
      setNumeros(lista);
      atualizar(lista);
    })();
  }, [atualizar]);

  // status ao vivo: relê sozinho enquanto a tela está aberta (fora do pareamento, que tem o próprio ritmo)
  useEffect(() => {
    if (!numeros || pareando) return;
    const id = window.setInterval(() => atualizar(numeros), INTERVALO_STATUS_MS);
    return () => window.clearInterval(id);
  }, [numeros, pareando, atualizar]);

  // lista primeiro: assim que o número conecta, as conversas recentes (texto e horário reais) entram sozinhas
  const trazerAoConectar = async (n: NumeroCRM) => {
    try {
      // recém-conectado o WhatsApp ainda sincroniza: erro transitório espera 1 minuto e tenta de novo, uma vez
      const r = await trazerConversasAoConectar(n.id, {
        aoEsperar: (e) => toast({ title: `Conversas de ${n.apelido}`, description: `${e.message} Tento de novo sozinho em 1 minuto.` }),
      });
      toast({
        title: `Conversas de ${n.apelido}`,
        description: `${r.chats} conversa(s), ${r.imported} mensagem(ns) nova(s)${r.aviso ? `. ${r.aviso}` : ""}.`,
      });
    } catch (e) {
      toast({ title: "Não trouxe as conversas agora", description: e instanceof Error ? e.message : "Use \"Trazer conversas\" no cartão.", variant: "destructive" });
    }
  };

  // Desconectar: logout no OpenWA (desvincula o aparelho) e a sessão volta a pedir QR. Não apaga nada do CRM.
  // O diálogo fica aberto com "Desconectando..." até a resposta (logout + reinício podem levar até ~2 min).
  const confirmarDesconexao = async () => {
    const n = desconectar;
    if (!n?.sessao_openwa || desconectando) return;
    setDesconectando(true);
    try {
      const r = await desconectarNumero(n.sessao_openwa);
      if (!("erro" in r)) {
        const telefone = numeros?.find((x) => x.id === n.id)?.telefone ?? n.telefone ?? null;
        setStatus((m) => new Map(m).set(n.id, statusDepoisDeDesconectar(r, telefone)));
        toast({
          title: `${n.apelido} desconectado`,
          description: r.aviso ?? "Para usar de novo, clique em Conectar e leia o QR Code (ou use o código pelo número).",
        });
      } else {
        toast({ title: `Não desconectou ${n.apelido}`, description: r.erro, variant: "destructive" });
        if (numeros) atualizar(numeros);
      }
    } finally {
      setDesconectando(false);
      setDesconectar(null);
    }
  };

  return (
    <div className="px-4 py-5 md:px-8 md:py-7 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Conexões{numeros && <span className="ml-2 text-base font-semibold text-muted-foreground tabular-nums">{numeros.length}</span>}</h2>
          <p className="text-sm text-muted-foreground">Cada número de WhatsApp do CRM e o canal do Instagram.</p>
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={() => numeros && atualizar(numeros)} disabled={lendo || !numeros}>
          {lendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-1.5">Atualizar</span>
        </Button>
      </div>

      {!numeros ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
      ) : (
        <section aria-label="Números de WhatsApp" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {numeros.map((n) => (
            <CartaoConexao
              key={n.id}
              numero={n}
              status={status.get(n.id)}
              onConectar={() => setPareando(n)}
              podeDesconectar={podeVerDesconectar(n, status.get(n.id)?.estado === "conectado", acesso)}
              onDesconectar={() => setDesconectar(n)}
              validarNome={validar(n.id)}
              onRenomear={(nome) => renomear(n, nome)}
            />
          ))}
        </section>
      )}

      {/* Instagram Direct: o canal real (OAuth) feito na Central; aqui fica o mesmo cartão. */}
      <CanalInstagram />

      <PareamentoQr
        numero={pareando}
        nomeAtual={numeros?.find((x) => x.id === pareando?.id)?.apelido ?? pareando?.apelido ?? ""}
        validarNome={validar(pareando?.id ?? "")}
        onRenomear={(nome) => (pareando ? renomear(pareando, nome) : Promise.resolve())}
        onFechar={() => { setPareando(null); if (numeros) atualizar(numeros); }}
        onConectado={(n) => { void trazerAoConectar(numeros?.find((x) => x.id === n.id) ?? n); }}
      />

      <AlertDialog open={!!desconectar} onOpenChange={(o) => { if (!o && !desconectando) setDesconectar(null); }}>
        <AlertDialogContent data-testid="confirmar-desconexao">
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar {desconectar?.apelido}?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const fone = formatarTelefone(desconectar?.telefone ?? (desconectar ? status.get(desconectar.id)?.telefone : null));
                return fone ? <span className="block font-medium text-foreground mb-1">{fone}</span> : null;
              })()}
              O WhatsApp desse número para de receber e enviar pelo CRM até conectar de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={desconectando}>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => { void confirmarDesconexao(); }}
              disabled={desconectando}
            >
              {desconectando ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Desconectando...</> : "Desconectar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CartaoConexao({ numero, status, onConectar, podeDesconectar, onDesconectar, validarNome, onRenomear }: {
  numero: NumeroCRM;
  status: StatusNumero | undefined;
  onConectar: () => void;
  /** admin ou liberação Comercial, número OpenWA conectado (o oficial nunca tem desconectar) */
  podeDesconectar: boolean;
  onDesconectar: () => void;
  validarNome: (nome: string) => string | null;
  onRenomear: (nome: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [importando, setImportando] = useState(false);
  const telefone = formatarTelefone(numero.telefone ?? status?.telefone);
  const estado = status?.estado ?? "desconhecido";
  const conectado = estado === "conectado";
  const semPonte = estado === "sem_ponte";

  const importar = async () => {
    setImportando(true);
    try {
      const r = await trazerConversasRecentes(numero.id);
      toast({
        title: "Conversas atualizadas",
        description: `${r.chats} conversa(s), ${r.imported} mensagem(ns) nova(s)${r.aviso ? `. ${r.aviso}` : ""}.`,
      });
    } catch (e) {
      toast({ title: "Erro ao importar", description: e instanceof Error ? e.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setImportando(false);
    }
  };

  return (
    <article data-testid="cartao-conexao" data-estado={estado} className={`rounded-xl border bg-card p-4 md:p-5 flex flex-col gap-3 transition-colors hover:border-[#3f444e] ${numero.ativo ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary">
          {numero.tipo === "oficial" ? <BadgeCheck className="h-5 w-5 text-sky-400" /> : <Smartphone className="h-5 w-5 text-muted-foreground" />}
          <span aria-hidden className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-card ${numero.ativo ? COR_ESTADO_NUMERO[estado] : "bg-zinc-500"}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold flex items-center gap-1.5 min-w-0">
            {/* número do seed embutido (tabela ainda não criada) não existe no banco: sem lápis */}
            <NomeEditavel nome={numero.apelido} podeEditar={!numero.id.startsWith("seed-")} validar={validarNome} onSalvar={onRenomear} />
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {telefone || "número não informado"}
            {numero.sessao_openwa ? ` · sessão ${numero.sessao_openwa}` : ""}
          </div>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">{numero.tipo === "oficial" ? "oficial" : "QR Code"}</Badge>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className={`h-2.5 w-2.5 rounded-full ${COR_ESTADO_NUMERO[estado]}`} aria-hidden />
        <span className="font-medium">{numero.ativo ? status?.rotulo ?? "lendo..." : "desativado"}</span>
      </div>

      {semPonte && (
        <p className="text-xs rounded-md bg-muted px-2.5 py-2 text-muted-foreground">
          Sessão ainda não liberada na ponte. O QR Code deste número aparece aqui quando a VPS passar a atender a sessão "{numero.sessao_openwa}".
        </p>
      )}
      {!semPonte && status?.aviso && numero.tipo !== "oficial" && <p className="text-xs text-muted-foreground">{status.aviso}</p>}
      {numero.tipo === "oficial" && (
        <p className="text-xs text-muted-foreground">API oficial: não usa QR Code. Envia por template aprovado.</p>
      )}

      {numero.tipo === "openwa" && conectado && fonteSupabase.backfill && (
        <HistoricoCompleto numeroId={numero.id} apelido={numero.apelido} api={fonteSupabase.backfill} />
      )}

      <div className="mt-auto flex flex-wrap gap-2">
        {numero.tipo === "openwa" && numero.ativo && !conectado && (
          <Button size="sm" onClick={onConectar} disabled={semPonte}>
            <QrCode className="h-4 w-4 mr-1.5" /> Conectar
          </Button>
        )}
        {numero.tipo === "openwa" && conectado && (
          <>
            <Badge className="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 border-0"><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Conectado</Badge>
            <Button size="sm" variant="outline" onClick={importar} disabled={importando}>
              <Download className="h-4 w-4 mr-1.5" />{importando ? "Trazendo..." : "Trazer conversas"}
            </Button>
            {podeDesconectar && (
              <Button size="sm" variant="outline" onClick={onDesconectar} className="text-destructive">
                <Unplug className="h-4 w-4 mr-1.5" /> Desconectar
              </Button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

/** QR em tela grande; relê sozinho até conectar (o QR do WhatsApp gira a cada ~20 s). */
function PareamentoQr({ numero, nomeAtual, validarNome, onRenomear, onFechar, onConectado }: {
  numero: NumeroCRM | null;
  /** Nome atual (muda quando salvo aqui sem trocar `numero`, que reiniciaria o ciclo do QR). */
  nomeAtual: string;
  validarNome: (nome: string) => string | null;
  onRenomear: (nome: string) => Promise<void>;
  onFechar: () => void;
  onConectado?: (n: NumeroCRM) => void;
}) {
  const { toast } = useToast();
  // nome digitado e não salvo: grava sozinho quando o número conecta
  const nomePendente = useRef<(() => Promise<boolean>) | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [conectado, setConectado] = useState(false);
  const [aba, setAba] = useState<"qr" | "codigo">("qr");
  const vivo = useRef(false);
  // código por número só em sessão explícita: a padrão (closer) a função recusa (sem sessão o proxy cairia nela)
  const codigoPermitido = !!numero?.sessao_openwa && numero.sessao_openwa !== SESSAO_PADRAO;
  // aba em ref: o ciclo lê a aba atual sem reiniciar (reiniciar apagaria o QR e o estado do pareamento)
  const abaRef = useRef(aba);
  abaRef.current = aba;
  // callback em ref: trocar a função a cada render do pai não pode reiniciar o ciclo do QR
  const onConectadoRef = useRef(onConectado);
  onConectadoRef.current = onConectado;

  useEffect(() => {
    if (!numero?.sessao_openwa) return;
    const sessao = numero.sessao_openwa;
    vivo.current = true;
    setQr(null);
    setAviso(null);
    setConectado(false);
    setAba("qr");
    let timer: number | undefined;
    const proximo = () => {
      if (vivo.current) timer = window.setTimeout(ciclo, abaRef.current === "codigo" ? INTERVALO_STATUS_CODIGO_MS : INTERVALO_QR_MS);
    };
    const ciclo = async () => {
      if (typeof document !== "undefined" && document.hidden) return proximo();
      try {
        const r = await chamarQr(sessao, abaRef.current === "codigo" ? "status" : "qr");
        if (!vivo.current) return;
        const st = interpretarStatusNumero(numero, r.corpo);
        if (st.estado === "conectado") {
          setConectado(true);
          setQr(null);
          void nomePendente.current?.();
          toast({ title: "WhatsApp conectado", description: "Trazendo as conversas recentes…" });
          onConectadoRef.current?.(numero);
          return; // para de reler
        }
        if (st.estado === "sem_ponte") {
          setAviso("Sessão ainda não liberada na ponte da VPS. Tente de novo quando ela estiver ligada.");
          return;
        }
        if (abaRef.current === "codigo") {
          // só status: não mexe no QR já mostrado nem no aviso da outra aba
          return proximo();
        }
        if (typeof r.corpo.qr === "string" && r.corpo.qr.startsWith("data:image/")) setQr(r.corpo.qr);
        setAviso(typeof r.corpo.aviso === "string" ? r.corpo.aviso : typeof r.corpo.error === "string" ? r.corpo.error : null);
      } catch (e) {
        if (vivo.current) setAviso(e instanceof Error ? e.message : "Falha ao falar com o servidor");
      }
      proximo();
    };
    ciclo();
    return () => {
      vivo.current = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [numero, toast]);

  return (
    <Dialog open={!!numero} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PlugZap className="h-5 w-5 text-emerald-600" /> Conectar {nomeAtual}</DialogTitle>
          <DialogDescription>
            {aba === "qr"
              ? "No celular deste número: WhatsApp, Aparelhos conectados, Conectar aparelho, e aponte para o código."
              : "No celular deste número: WhatsApp, Aparelhos conectados, Conectar aparelho, Conectar com número de telefone."}
          </DialogDescription>
        </DialogHeader>
        {numero && (
          <CampoNomeNumero
            nome={nomeAtual}
            validar={validarNome}
            onSalvar={onRenomear}
            pendenteRef={nomePendente}
          />
        )}
        {!conectado && codigoPermitido && (
          <div role="tablist" aria-label="Como conectar" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
            {([["qr", "QR code", QrCode], ["codigo", "Número de telefone", Smartphone]] as const).map(([valor, rotulo, Icone]) => (
              <button
                key={valor}
                type="button"
                role="tab"
                aria-selected={aba === valor}
                onClick={() => setAba(valor)}
                className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${aba === valor ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Icone className="h-4 w-4" /> {rotulo}
              </button>
            ))}
          </div>
        )}
        {/* as duas abas ficam montadas: trocar de aba não apaga o número digitado nem o código gerado */}
        {numero?.sessao_openwa && codigoPermitido && !conectado && (
          <div role="tabpanel" aria-hidden={aba !== "codigo"} className={`${aba === "codigo" ? "flex" : "hidden"} flex-col items-center justify-center gap-4 py-4 min-h-[22rem]`}>
            <PainelCodigo sessao={numero.sessao_openwa} telefoneSugerido={numero.telefone} />
          </div>
        )}
        <div role="tabpanel" aria-hidden={aba !== "qr" && !conectado} className={`${aba === "qr" || conectado ? "flex" : "hidden"} flex-col items-center justify-center gap-4 py-4 min-h-[22rem] text-center`}>
          {conectado ? (
            <>
              <CheckCircle2 className="h-20 w-20 text-emerald-600" />
              <p className="text-lg font-semibold">Conectado</p>
              <Button onClick={onFechar}>Fechar</Button>
            </>
          ) : qr ? (
            <>
              <div className="bg-white p-4 rounded-xl border shadow-sm">
                <img src={qr} alt="QR Code do WhatsApp" className="h-72 w-72 sm:h-80 sm:w-80 object-contain" data-testid="qr-grande" />
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Atualiza sozinho até conectar</p>
            </>
          ) : (
            <>
              {aviso ? <QrCode className="h-14 w-14 text-muted-foreground" /> : <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />}
              <p className="text-sm text-muted-foreground max-w-sm">{aviso ?? "Pedindo o QR Code à sessão..."}</p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
