// Painel lateral de edição de um passo do construtor. O número escolhido no "Enviar WhatsApp" decide o
// formulário: oficial = template do catálogo + variáveis; não oficial = texto, mídia/áudio ou roteiro.
// "Mensagem da IA (follow-up)": agente de follow-up + instrução da tentativa; o texto é escrito na hora do envio.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";
import {
  VARIAVEIS_TEMPLATE,
  problemasIAFollowup,
  problemasTransferirIA,
  problemasWhatsApp,
  variaveisDoTemplate,
  type CatalogoConstrutor,
  idDoAtendente,
  type Condicao,
  type PassoArvore,
  type PassoIAFollowup,
  type PassoWhatsApp,
} from "@/lib/crm/fluxosConstrutor";
import { Link } from "react-router-dom";
import { infoTipo } from "./CanvasFluxo";
import { SeletorTags } from "@/components/crm/SeletorTags";
import { useFluxos } from "./contexto";
import type { FonteTags } from "@/lib/crm/tags";
import { ItensEtapa } from "@/components/crm/etapas/ItensEtapa";

const PADRAO = "__padrao__";

export function passoNovo(tipo: PassoArvore["tipo"], numeroPadrao: string | null): PassoArvore {
  switch (tipo) {
    case "whatsapp": return { tipo: "whatsapp", numero_id: numeroPadrao };
    case "ia_followup": return { tipo: "ia_followup", agente_id: "", instrucao: null, tentativa: null, numero_id: numeroPadrao };
    case "esperar": return { tipo: "esperar", quantidade: 1, unidade: "dias" };
    case "se": return { tipo: "se", condicao: { tipo: "respondeu" }, sim: [], nao: [] };
    case "tag": return { tipo: "tag", acao: "por", tag: "" };
    case "etapa": return { tipo: "etapa", etapa: "contato" };
    case "atribuir": return { tipo: "atribuir", atendente: "" };
    case "agente_ia": return { tipo: "agente_ia", acao: "ligar", agente: "" };
    case "transferir_ia": return { tipo: "transferir_ia", agente: "", mesmo_com_humano: false };
    case "transferir_humano": return { tipo: "transferir_humano", despedida: "Vou chamar alguém do time pra te ajudar, um minutinho", sem_mensagem: false, para: null, tag: null, etapa: null, numero_id: numeroPadrao };
    case "webhook": return { tipo: "webhook", url: "https://" };
    case "ir_fluxo": return { tipo: "ir_fluxo", fluxo_id: "" };
    case "condicao": return { tipo: "condicao", condicao: { tipo: "respondeu" }, se_sim: "continuar", se_nao: "parar" };
    default: return { tipo: "parar" };
  }
}

interface Props {
  passo: PassoArvore | null;
  catalogo: CatalogoConstrutor | null;
  numeroPadrao: string | null;
  fluxoId: string;
  onFechar: () => void;
  onSalvar: (p: PassoArvore) => void;
  onRemover: () => void;
}

export function PainelPasso({ passo, catalogo, numeroPadrao, fluxoId, onFechar, onSalvar, onRemover }: Props) {
  const { fonte } = useFluxos();
  const fonteTags: FonteTags = { listar: fonte.tags, criar: fonte.criarTag };
  const [p, setP] = useState<PassoArvore | null>(passo);
  useEffect(() => setP(passo), [passo]);
  if (!p) return null;
  const info = infoTipo(p.tipo);
  const set = (patch: Partial<PassoArvore>) => setP({ ...p, ...patch } as PassoArvore);
  const problemas = p.tipo === "whatsapp" ? problemasWhatsApp(p, numeroPadrao, catalogo?.numeros ?? [], catalogo?.templates ?? [])
    : p.tipo === "ia_followup" ? [...(p.agente_id ? [] : ["escolha o agente de follow-up."]), ...problemasIAFollowup(p, numeroPadrao, catalogo?.numeros ?? [], catalogo?.agentes)]
    : p.tipo === "transferir_ia" ? [...(p.agente ? [] : ["escolha o agente de IA."]), ...problemasTransferirIA(p, catalogo?.agentes)]
    : [];

  return (
    <Sheet open={!!passo} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><info.icone className="h-4 w-4 text-primary" />{info.rotulo}</SheetTitle>
          <SheetDescription>As alterações entram no fluxo ao clicar em Salvar passo.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          {p.tipo === "whatsapp" && <FormWhatsApp p={p} set={(x) => setP({ ...p, ...x })} catalogo={catalogo} numeroPadrao={numeroPadrao} />}

          {p.tipo === "ia_followup" && <FormIAFollowup p={p} set={(x) => setP({ ...p, ...x })} catalogo={catalogo} />}

          {p.tipo === "esperar" && (
            <>
              <div className="flex gap-2">
                <div className="flex-1 space-y-1"><Label>Quanto</Label>
                  <Input type="number" min={1} value={p.quantidade} onChange={(e) => set({ quantidade: Number(e.target.value) })} /></div>
                <div className="flex-1 space-y-1"><Label>Unidade</Label>
                  <Select value={p.unidade} onValueChange={(v) => set({ unidade: v as "minutos" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="minutos">minutos</SelectItem><SelectItem value="horas">horas</SelectItem><SelectItem value="dias">dias</SelectItem></SelectContent>
                  </Select></div>
              </div>
              <label className="flex items-center justify-between gap-2 rounded-md border p-2.5 text-sm">
                <span>Ou até a lead responder<span className="block text-xs text-muted-foreground">Se ela responder antes, segue na hora.</span></span>
                <Switch checked={!!p.ate_responder} onCheckedChange={(v) => set({ ate_responder: v })} />
              </label>
            </>
          )}

          {(p.tipo === "se" || p.tipo === "condicao") && <FormCondicao fonteTags={fonteTags} c={p.condicao} set={(condicao) => set({ condicao })} />}
          {p.tipo === "se" && <p className="text-xs text-muted-foreground">O ramo Sim e o ramo Senão aparecem no canvas; use o "+" dentro de cada um.</p>}

          {p.tipo === "tag" && (
            <>
              <div className="space-y-1"><Label>Ação</Label>
                <Select value={p.acao} onValueChange={(v) => set({ acao: v as "por" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="por">Adicionar tag</SelectItem><SelectItem value="tirar">Remover tag</SelectItem></SelectContent>
                </Select></div>
              <div className="space-y-1"><Label>Tag</Label><SeletorTags valor={p.tag ? [p.tag] : []} onMudar={(t) => set({ tag: t[0] ?? "" })} fonte={fonteTags} /></div>
            </>
          )}

          {p.tipo === "etapa" && (
            <div className="space-y-1"><Label>Etapa do funil</Label>
              <Select value={p.etapa} onValueChange={(v) => set({ etapa: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><ItensEtapa incluir={p.etapa} /></SelectContent>
              </Select></div>
          )}

          {p.tipo === "atribuir" && (
            <div className="space-y-1"><Label>Atendente</Label>
              <Input list="atendentes-fluxo" value={p.atendente} onChange={(e) => set({ atendente: e.target.value, atendente_id: idDoAtendente(catalogo, e.target.value) })} placeholder="Nome de quem assume a conversa" />
              <datalist id="atendentes-fluxo">{catalogo?.atendentes.map((a) => <option key={a} value={a} />)}</datalist>
              {p.atendente.trim() && catalogo?.atendentesIds && (
                <p className="text-xs text-muted-foreground">{p.atendente_id ? "Vinculado ao usuário: segue com ele mesmo se o nome mudar." : "Nome fora da lista: só atribui se casar com um único usuário aprovado."}</p>
              )}</div>
          )}

          {p.tipo === "agente_ia" && (
            <>
              <div className="space-y-1"><Label>Ação</Label>
                <Select value={p.acao} onValueChange={(v) => set({ acao: v as "ligar" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ligar">Ligar agente de IA</SelectItem><SelectItem value="pausar">Pausar agente de IA</SelectItem></SelectContent>
                </Select></div>
              {p.acao === "ligar" && (
                <div className="space-y-1"><Label>Agente</Label>
                  <Select value={p.agente ?? ""} onValueChange={(v) => set({ agente: v })}>
                    <SelectTrigger><SelectValue placeholder="Escolha o agente" /></SelectTrigger>
                    <SelectContent>{catalogo?.agentes.filter((a) => a.tipo !== "followup").map((a) => <SelectItem key={a.slug} value={a.slug}>{a.nome}</SelectItem>)}</SelectContent>
                  </Select></div>
              )}
            </>
          )}

          {p.tipo === "transferir_ia" && (
            <>
              <p className="text-xs text-muted-foreground">
                A conversa do contato no número do agente passa para a IA (mesmo efeito do botão "Transferir para IA" do chat) e fica registrado no histórico.
                Se a lead já estiver esperando resposta, a IA responde no tempo de resposta do agente; senão, responde quando ela escrever. Nunca em grupo.
              </p>
              <div className="space-y-1"><Label>Agente de IA</Label>
                <Select value={p.agente || undefined} onValueChange={(v) => set({ agente: v })}>
                  <SelectTrigger aria-label="Agente de IA"><SelectValue placeholder="Escolha o agente" /></SelectTrigger>
                  <SelectContent>{catalogo?.agentes.filter((a) => a.tipo !== "followup").map((a) => <SelectItem key={a.slug} value={a.slug}>{a.nome}</SelectItem>)}</SelectContent>
                </Select></div>
              <label className="flex items-center justify-between gap-2 rounded-md border p-2.5 text-sm">
                <span>Transferir mesmo com humano atendendo<span className="block text-xs text-muted-foreground">Desligado (padrão): se a conversa tem atendente, espera humano ou teve mensagem manual da equipe nas últimas horas do agente, o passo pula e registra o motivo.</span></span>
                <Switch checked={Boolean(p.mesmo_com_humano)} onCheckedChange={(v) => set({ mesmo_com_humano: v })} aria-label="Transferir mesmo com humano atendendo" />
              </label>
            </>
          )}

          {p.tipo === "transferir_humano" && (
            <>
              <p className="text-xs text-muted-foreground">Mesmo efeito da transferência da IA: pausa a IA desta conversa, marca "Precisa de humano" e registra o motivo.</p>
              <div className="space-y-1"><Label>Mensagem de despedida</Label>
                <Textarea value={p.despedida ?? ""} disabled={Boolean(p.sem_mensagem)} maxLength={1000} onChange={(e) => set({ despedida: e.target.value })} placeholder="Vou chamar a Gabi pra te ajudar, um minutinho" />
                <label className="flex items-center gap-2 text-xs"><Switch checked={Boolean(p.sem_mensagem)} onCheckedChange={(v) => set({ sem_mensagem: v })} /> Não mandar nada</label></div>
              <div className="space-y-1"><Label>Para quem transferir</Label>
                <Input list="atendentes-transferir" value={p.para ?? ""} onChange={(e) => set({ para: e.target.value || null })} placeholder="Vazio = fila geral" />
                <datalist id="atendentes-transferir">{catalogo?.atendentes.map((a) => <option key={a} value={a} />)}</datalist></div>
              <SeletorTags valor={p.tag ? [p.tag] : []} onMudar={(t) => set({ tag: t[0] ?? null })} fonte={fonteTags} rotulo="Ao transferir: aplicar a tag (opcional)" />
              <div className="space-y-1"><Label>Ao transferir: mover para a etapa (opcional)</Label>
                <Select value={p.etapa ?? "__nenhuma__"} onValueChange={(v) => set({ etapa: v === "__nenhuma__" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="__nenhuma__">Não mover</SelectItem><ItensEtapa incluir={p.etapa ?? undefined} /></SelectContent>
                </Select></div>
            </>
          )}

          {p.tipo === "webhook" && (
            <div className="space-y-1"><Label>URL (https)</Label>
              <Input value={p.url} onChange={(e) => set({ url: e.target.value })} />
              <p className="text-xs text-muted-foreground">POST com o fluxo, o contato (telefone, nome, etapa, tags) e os dados do evento. Teto de 10 s.</p></div>
          )}

          {p.tipo === "ir_fluxo" && (
            <div className="space-y-1"><Label>Fluxo de destino</Label>
              <Select value={p.fluxo_id} onValueChange={(v) => set({ fluxo_id: v })}>
                <SelectTrigger><SelectValue placeholder="Escolha o fluxo" /></SelectTrigger>
                <SelectContent>{catalogo?.fluxos.filter((f) => f.id !== fluxoId).map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">O contato sai deste fluxo e entra no outro (que precisa estar publicado para andar).</p></div>
          )}

          {p.tipo === "parar" && <p className="text-sm text-muted-foreground">O contato sai do fluxo aqui.</p>}

          {problemas.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
              {problemas.map((x) => <p key={x} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{x}</p>)}
            </div>
          )}
        </div>

        <SheetFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" className="text-destructive" onClick={onRemover}>Excluir passo</Button>
          <Button onClick={() => onSalvar(p)}>Salvar passo</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FormCondicao({ c, set, fonteTags }: { c: Condicao; set: (c: Condicao) => void; fonteTags: FonteTags }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1"><Label>Se</Label>
        <Select value={c.tipo} onValueChange={(v) => set(v === "respondeu" ? { tipo: "respondeu" } : v === "ia_transferiu" ? { tipo: "ia_transferiu" } : v === "tem_tag" ? { tipo: "tem_tag", valor: "" } : v === "etapa" ? { tipo: "etapa", valor: "contato" } : { tipo: "campo", campo: "dados.produto", operador: "contem", valor: "" })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="respondeu">A lead respondeu</SelectItem>
            <SelectItem value="ia_transferiu">A IA transferiu para humano</SelectItem>
            <SelectItem value="tem_tag">Tem a tag</SelectItem>
            <SelectItem value="etapa">Está na etapa</SelectItem>
            <SelectItem value="campo">Campo</SelectItem>
          </SelectContent>
        </Select></div>
      {c.tipo === "tem_tag" && <SeletorTags valor={c.valor ? [c.valor] : []} onMudar={(t) => set({ ...c, valor: t[0] ?? "" })} fonte={fonteTags} rotulo="Tag da condição" />}
      {c.tipo === "etapa" && (
        <Select value={c.valor} onValueChange={(v) => set({ ...c, valor: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><ItensEtapa incluir={c.valor} /></SelectContent>
        </Select>
      )}
      {c.tipo === "campo" && (
        <div className="grid grid-cols-3 gap-2">
          <Input list="campos-fluxo" value={c.campo} onChange={(e) => set({ ...c, campo: e.target.value })} aria-label="Campo" />
          <datalist id="campos-fluxo">{["nome", "etapa", "origem", "telefone", "dados.email", "dados.produto"].map((x) => <option key={x} value={x} />)}</datalist>
          <Select value={c.operador} onValueChange={(v) => set({ ...c, operador: v as "igual" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="igual">é igual a</SelectItem><SelectItem value="contem">contém</SelectItem><SelectItem value="existe">está preenchido</SelectItem></SelectContent>
          </Select>
          {c.operador !== "existe" && <Input value={c.valor ?? ""} onChange={(e) => set({ ...c, valor: e.target.value })} aria-label="Valor" />}
        </div>
      )}
    </div>
  );
}

function FormWhatsApp({ p, set, catalogo, numeroPadrao }: { p: PassoWhatsApp; set: (x: Partial<PassoWhatsApp>) => void; catalogo: CatalogoConstrutor | null; numeroPadrao: string | null }) {
  const numId = p.numero_id ?? numeroPadrao;
  const num = catalogo?.numeros.find((n) => n.id === numId);
  const oficial = num?.tipo === "oficial";
  const tpl = catalogo?.templates.find((t) => t.nome === p.template);
  const [modo, setModo] = useState<"texto" | "midia" | "roteiro">(p.roteiro_id || p.passo_id ? "roteiro" : p.midia_url ? "midia" : "texto");
  const trocarNumero = (v: string) => {
    const novo = v === PADRAO ? null : v;
    const n = catalogo?.numeros.find((x) => x.id === (novo ?? numeroPadrao));
    // trocar oficial <-> não oficial limpa o que o outro tipo não aceita
    if (n?.tipo === "oficial") set({ numero_id: novo, roteiro_id: null, passo_id: null, texto: null, midia_url: null, midia_tipo: null });
    else set({ numero_id: novo, template: null, variaveis: {} });
  };
  return (
    <div className="space-y-4">
      <div className="space-y-1"><Label>Número</Label>
        <Select value={p.numero_id ?? PADRAO} onValueChange={trocarNumero}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={PADRAO}>Número padrão do fluxo</SelectItem>
            {catalogo?.numeros.map((n) => (
              <SelectItem key={n.id} value={n.id} disabled={n.ativo === false}>{n.apelido} · {n.tipo === "oficial" ? "oficial" : "não oficial"}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {num && <Badge variant={oficial ? "default" : "secondary"} className="mt-1">{oficial ? "API oficial: só template aprovado" : "Não oficial: texto, mídia, áudio ou roteiro"}</Badge>}
      </div>

      {oficial ? (
        <>
          <div className="space-y-1"><Label>Template</Label>
            <Select value={p.template ?? ""} onValueChange={(v) => {
              const t = catalogo?.templates.find((x) => x.nome === v);
              const vars: Record<string, string> = {};
              for (const k of variaveisDoTemplate(t?.corpo ?? "")) {
                const rot = t?.rotulos_variaveis?.[String(k)];
                vars[String(k)] = p.variaveis?.[String(k)] ?? (rot === "nome" ? "{primeiro_nome}" : rot === "email" ? "{dados.email}" : rot === "produto" ? "{dados.produto}" : "");
              }
              set({ template: v, variaveis: vars });
            }}>
              <SelectTrigger><SelectValue placeholder="Escolha do catálogo" /></SelectTrigger>
              <SelectContent>{catalogo?.templates.map((t) => <SelectItem key={t.nome} value={t.nome}>{t.nome} {t.status !== "APPROVED" ? `(${t.status})` : ""}</SelectItem>)}</SelectContent>
            </Select></div>
          {tpl && (
            <>
              <pre className="whitespace-pre-wrap rounded-md bg-muted p-2.5 text-xs">{tpl.corpo}</pre>
              {variaveisDoTemplate(tpl.corpo).map((k) => (
                <div key={k} className="space-y-1">
                  <Label>{`{{${k}}}`} {tpl.rotulos_variaveis?.[String(k)] ? <span className="text-muted-foreground">({tpl.rotulos_variaveis[String(k)]})</span> : null}</Label>
                  <Input list="vars-template" value={p.variaveis?.[String(k)] ?? ""} onChange={(e) => set({ variaveis: { ...(p.variaveis ?? {}), [String(k)]: e.target.value } })} />
                </div>
              ))}
              <datalist id="vars-template">{VARIAVEIS_TEMPLATE.map((v) => <option key={v} value={v} />)}</datalist>
            </>
          )}
        </>
      ) : (
        <>
          <div className="flex gap-1 rounded-md bg-muted p-1 text-sm" role="tablist">
            {(["texto", "midia", "roteiro"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={modo === m} onClick={() => {
                setModo(m);
                if (m === "roteiro") set({ texto: null, midia_url: null, midia_tipo: null });
                else set({ roteiro_id: null, passo_id: null, ...(m === "texto" ? { midia_url: null, midia_tipo: null } : {}) });
              }}
                className={`flex-1 rounded px-2 py-1 ${modo === m ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
                {m === "texto" ? "Texto" : m === "midia" ? "Mídia / áudio" : "Roteiro"}
              </button>
            ))}
          </div>
          {modo !== "roteiro" && (
            <div className="space-y-1"><Label>{modo === "midia" ? "Legenda (opcional)" : "Mensagem"}</Label>
              <Textarea rows={5} value={p.texto ?? ""} onChange={(e) => set({ texto: e.target.value })} placeholder="Oi {primeiro_nome}, ..." />
              <p className="text-xs text-muted-foreground">Variáveis: {"{primeiro_nome}"}, {"{nome}"}, {"{telefone}"}.</p></div>
          )}
          {modo === "midia" && (
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1"><Label>Link do arquivo (https)</Label>
                <Input value={p.midia_url ?? ""} onChange={(e) => set({ midia_url: e.target.value })} placeholder="https://..." /></div>
              <div className="space-y-1"><Label>Tipo</Label>
                <Select value={p.midia_tipo ?? ""} onValueChange={(v) => set({ midia_tipo: v as "image" })}>
                  <SelectTrigger><SelectValue placeholder="tipo" /></SelectTrigger>
                  <SelectContent><SelectItem value="image">Imagem</SelectItem><SelectItem value="audio">Áudio</SelectItem><SelectItem value="document">Documento</SelectItem></SelectContent>
                </Select></div>
            </div>
          )}
          {modo === "roteiro" && (
            <div className="space-y-1"><Label>Roteiro</Label>
              <Select value={p.roteiro_id ?? ""} onValueChange={(v) => set({ roteiro_id: v, passo_id: null })}>
                <SelectTrigger><SelectValue placeholder="Escolha o roteiro" /></SelectTrigger>
                <SelectContent>{catalogo?.roteiros.map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Sai em ordem até o primeiro passo que espera resposta, com os limites do número.</p></div>
          )}
        </>
      )}
    </div>
  );
}

function FormIAFollowup({ p, set, catalogo }: { p: PassoIAFollowup; set: (x: Partial<PassoIAFollowup>) => void; catalogo: CatalogoConstrutor | null }) {
  const agentes = (catalogo?.agentes ?? []).filter((a) => a.tipo === "followup" && a.id);
  return (
    <div className="space-y-4">
      <div className="space-y-1"><Label>Agente de follow-up</Label>
        <Select value={p.agente_id || ""} onValueChange={(v) => set({ agente_id: v })}>
          <SelectTrigger aria-label="Agente de follow-up"><SelectValue placeholder="Escolha o agente" /></SelectTrigger>
          <SelectContent>{agentes.map((a) => <SelectItem key={a.id} value={a.id!}>{a.nome}</SelectItem>)}</SelectContent>
        </Select>
        {!agentes.length && (
          <p className="text-xs text-muted-foreground">Nenhum agente de follow-up ainda. Crie em <Link className="underline" to="/crm/agente-ia">Agente IA</Link> (botão "Criar agente de follow-up").</p>
        )}
      </div>
      <div className="space-y-1"><Label>Número</Label>
        <Select value={p.numero_id ?? PADRAO} onValueChange={(v) => set({ numero_id: v === PADRAO ? null : v })}>
          <SelectTrigger aria-label="Número da mensagem da IA"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={PADRAO}>Número padrão do fluxo</SelectItem>
            {catalogo?.numeros.map((n) => (
              <SelectItem key={n.id} value={n.id} disabled={n.ativo === false || n.tipo === "oficial"}>
                {n.apelido} · {n.tipo === "oficial" ? "oficial (só template)" : "não oficial"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Texto livre sai só por número não oficial, com os limites anti-ban e a janela de horário do fluxo.</p>
      </div>
      <div className="grid grid-cols-[110px_1fr] gap-2 items-start">
        <div className="space-y-1"><Label>Tentativa</Label>
          <Input type="number" min={1} max={8} value={p.tentativa ?? ""} placeholder="1" aria-label="Número da tentativa"
            onChange={(e) => set({ tentativa: e.target.value ? Math.max(1, Math.min(8, Number(e.target.value))) : null })} /></div>
        <div className="space-y-1"><Label>Instrução da tentativa (opcional)</Label>
          <Textarea rows={3} maxLength={500} value={p.instrucao ?? ""} onChange={(e) => set({ instrucao: e.target.value || null })}
            placeholder="2ª tentativa: lembrar do benefício X" aria-label="Instrução da tentativa" /></div>
      </div>
      <p className="text-xs text-muted-foreground">
        A mensagem é escrita pelo Claude na hora do envio, com o histórico desta conversa. Se a IA falhar, nada é enviado e o motivo aparece nos Logs de execução.
        Se a lead tiver respondido ou pedido para parar, também não sai.
      </p>
    </div>
  );
}
