// SÓ EM DESENVOLVIMENTO (rota atrás de import.meta.env.DEV, fora do bundle de produção):
// a página /crm inteira com uma fonte FICTÍCIA (nenhum dado real, nenhuma chamada ao banco
// para as conversas). Enviar uma mensagem aqui só mexe na memória e simula o "Realtime".
// /dev/crm-conversas[?abrir=<telefone>][&simular=1]
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import CRM from "@/pages/CRM";
import type { ContatoCRM, MensagemCRM, NumeroConversa } from "@/lib/crm/conversas";
import type { EventosFonte, FonteConversas } from "@/lib/crm/fonteConversas";

const AGORA = new Date();
const em = (diasAtras: number, h: number, m: number) => {
  const d = new Date(AGORA);
  d.setDate(d.getDate() - diasAtras);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

function imagemFicticia(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#93c5fd"/><stop offset="1" stop-color="#a7f3d0"/></linearGradient></defs><rect width="640" height="420" fill="url(#g)"/><text x="320" y="220" font-family="sans-serif" font-size="34" text-anchor="middle" fill="#1e3a8a">imagem fictícia</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function audioFicticio(segundos = 7): string {
  const taxa = 8000;
  const n = taxa * segundos;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const txt = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  txt(0, "RIFF"); v.setUint32(4, 36 + n, true); txt(8, "WAVE"); txt(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, taxa, true); v.setUint32(28, taxa, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  txt(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128 + Math.round(20 * Math.sin((2 * Math.PI * 440 * i) / taxa)));
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

// dois números do WhatsApp (closer + time): a Fernanda fala com os DOIS = duas conversas
const NUMEROS: NumeroConversa[] = [
  { id: "00000000-0000-4000-8000-000000000001", chave: "closer", apelido: "Closer", telefone: "5531990000001", tipo: "openwa", ativo: true },
  { id: "00000000-0000-4000-8000-000000000002", chave: "comercial-fit-2", apelido: "Comercial Fit 2", telefone: "5531990000002", tipo: "openwa", ativo: true },
];
const [CLOSER, FIT2] = NUMEROS.map((n) => n.id);

const C = (id: string, name: string, phone: string, stage: string, tags: string[] = [], extra: Partial<ContatoCRM> = {}): ContatoCRM => ({
  id, name, phone, stage, tags, updated_at: em(30, 9, 0), numero_id: CLOSER, ...extra,
});

function dados() {
  const contatos: ContatoCRM[] = [
    C("c1", "Mariana Alves", "5511987654321", "contato", ["avaliacao"], { ai_agent_slug: "sdr-avaliacao", ai_pausado: false }),
    C("c2", "Carlos Eduardo", "5521998877665", "agendado", ["individual"]),
    C("c3", "Fernanda Lima", "5531991122334", "leads", ["avaliacao"]),
    C("c4", "Rafael Souza", "5541993344556", "compareceu"),
    C("c5", "Juliana Costa", "5551994455667", "fechou", ["aluna"]),
    C("c6", "", "5561995566778", "leads"),
    C("c7", "Patrícia Gomes", "5571996677889", "contato", ["individual"]),
    C("c8", "Grupo Turma Outubro", "120363025555555555@g.us", "leads"),
    C("c9", "Bruno Martins", "5581997788990", "leads", [], { updated_at: em(40, 10, 0) }),
    C("c10", "Fernanda Lima", "5531991122334", "contato", [], { numero_id: FIT2 }),
  ];
  let seq = 0;
  const M = (phone: string, direcao: "in" | "out", quando: string, body: string, extra: Partial<MensagemCRM> = {}): MensagemCRM => ({
    id: `m${++seq}`,
    contact_phone: phone,
    body,
    created_at: quando,
    direction: direcao === "in" ? "inbound" : "outbound",
    sender_type: direcao === "in" ? "lead" : "human",
    status: direcao === "out" ? "read" : null,
    numero_id: CLOSER,
    ...extra,
  });
  const p1 = "5511987654321";
  const msgs: MensagemCRM[] = [
    M(p1, "in", em(5, 9, 12), "Oi! Vi o anúncio da avaliação gratuita, ainda tem vaga?"),
    M(p1, "out", em(5, 9, 20), "Oi, Mariana! Tem sim. Posso te mandar os horários?"),
    M(p1, "in", em(5, 9, 21), "Pode sim"),
    M(p1, "in", em(5, 9, 21), "Prefiro de manhã"),
    M(p1, "out", em(5, 9, 30), "", { media_url: "#doc", media_type: "document", file_name: "horarios-outubro.pdf", mime_type: "application/pdf" }),
    M(p1, "in", em(1, 18, 2), "Olha o meu treino de hoje", { media_url: imagemFicticia(), media_type: "image", caption: "Olha o meu treino de hoje" }),
    M(p1, "out", em(1, 18, 10), "Que demais! Ficou ótimo 👏"),
    M(p1, "in", em(1, 18, 11), "[áudio]", { media_url: audioFicticio(), media_type: "audio", mime_type: "audio/wav" }),
    M(p1, "out", em(0, 8, 40), "Bom dia! Confirmando sua avaliação amanhã às 9h, tudo certo?", { status: "read" }),
    M(p1, "in", em(0, 14, 30), "Bom dia! Tudo certo sim"),
    M(p1, "in", em(0, 14, 32), "Posso levar minha irmã junto?\nEla também quer fazer."),
    M("5521998877665", "out", em(0, 13, 5), "Combinado, Carlos. Te espero quinta às 19h.", { status: "delivered" }),
    M("5531991122334", "in", em(0, 11, 47), "Quanto custa o acompanhamento?"),
    M("5531991122334", "in", em(0, 11, 48), "E é online?"),
    M("5531991122334", "in", em(0, 12, 5), "Oi, aqui é a Fernanda de novo, pelo número do Fit", { numero_id: FIT2 }),
    M("5541993344556", "out", em(1, 20, 15), "Obrigado por ter vindo hoje! Segue o resumo.", { status: "sent" }),
    M("5551994455667", "in", em(1, 9, 3), "", { media_url: imagemFicticia(), media_type: "image" }),
    M("5561995566778", "in", em(3, 16, 20), "Oi, quero saber mais"),
    M("5571996677889", "out", em(9, 10, 0), "Oi Patrícia, conseguiu ver a proposta?", { status: "failed" }),
  ];
  // histórico longo pra testar "carregar antigas" ao subir
  for (let i = 0; i < 60; i++) {
    msgs.push(M(p1, i % 3 ? "in" : "out", em(12 + Math.floor(i / 6), 8 + (i % 6), 5), `Mensagem antiga ${60 - i} do histórico importado.`));
  }
  return { contatos, msgs };
}

function criarFonte(simular: boolean): FonteConversas {
  const { contatos, msgs } = dados();
  // leituras fictícias: tudo depois de anteontem conta como não lido, menos o que a Mariana já viu
  try {
    window.localStorage.setItem("crm:conversas:lidas:demo", JSON.stringify({
      base: em(2, 0, 0),
      leituras: { "5511987654321": em(0, 14, 30) },
    }));
  } catch { /* sem localStorage: sem não lidas na demo */ }
  const ouvintes = new Set<EventosFonte>();
  const emitir = (m: MensagemCRM) => ouvintes.forEach((o) => o.onMensagem(m, "INSERT"));
  let seq = 1000;
  const espera = (ms = 150) => new Promise((r) => setTimeout(r, ms));

  if (simular) {
    setTimeout(() => {
      const m: MensagemCRM = {
        id: `m${++seq}`, contact_phone: "5541993344556", numero_id: CLOSER, body: "Oi! Chegou agora pelo Realtime fictício.",
        created_at: new Date().toISOString(), direction: "inbound", sender_type: "lead", status: null,
      };
      msgs.push(m);
      emitir(m);
    }, 4000);
  }

  return {
    async usuarioId() { return "demo"; },
    async listarNumeros() { return NUMEROS; },
    async listarContatos() { await espera(); return contatos.map((c) => ({ ...c })); },
    async mensagensRecentes() { await espera(); return [...msgs].sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    async mensagensDoContato(phone, limite, antesDe, numeroId) {
      await espera(antesDe ? 500 : 150);
      return msgs
        .filter((m) => m.contact_phone === phone && (!numeroId || m.numero_id === numeroId) && (!antesDe || m.created_at < antesDe))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limite);
    },
    assinar(ev) { ouvintes.add(ev); return () => { ouvintes.delete(ev); }; },
    async enviarTexto(phone, texto, numeroId) {
      await espera(300);
      const m: MensagemCRM = {
        id: `m${++seq}`, contact_phone: phone, numero_id: numeroId ?? CLOSER, body: texto, created_at: new Date().toISOString(),
        direction: "outbound", sender_type: "human", status: "sent",
      };
      msgs.push(m);
      emitir(m);
      setTimeout(() => {
        const lida = { ...m, status: "read" };
        Object.assign(m, lida);
        ouvintes.forEach((o) => o.onMensagem(lida, "UPDATE"));
      }, 1500);
    },
    async enviarMidia() { await espera(300); throw new Error("Rota de desenvolvimento: anexo não é enviado."); },
    async importarHistorico() { await espera(300); return 0; },
    async atualizarContato(id, patch) {
      const c = contatos.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
    },
    async tamanhoArquivo() { return 248_000; },
  };
}

export default function CrmConversasDemo() {
  const [params] = useSearchParams();
  const simular = params.get("simular") === "1";
  const fonte = useMemo(() => criarFonte(simular), [simular]);
  return <div className="h-[100dvh]"><CRM fonte={fonte} abrirInicial={params.get("abrir")} resolverGrupos={false} /></div>;
}
