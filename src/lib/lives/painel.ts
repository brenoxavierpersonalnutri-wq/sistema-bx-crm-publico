// Regras puras do painel /lives: em que aba cada item cai, destinos disponíveis e avisos de backend.
import type { LiveDestino, LiveRoom, Webinar } from "@/lib/lives/api";

export type TipoCriacao = "live" | "gravacao" | "webinario";
export type AbaPainel = "proximas" | "anteriores" | "gravacoes";

/** Colunas opcionais de live_rooms: só existem depois da migração que adiciona agendamento/descrição. */
export interface LiveRoomExtra extends LiveRoom {
  descricao?: string | null;
  agendada_em?: string | null;
  cf_ultima_gravacao?: string | null;
  encerrada_em?: string | null;
  // agenda e vídeo da aula (migration 20261104100000)
  auto_iniciar?: boolean | null;
  aula_video_id?: string | null;
  aula_ingress_id?: string | null;
  aula_identity?: string | null;
  aula_tocando_video?: string | null;
  aula_tocando_desde?: string | null;
  aula_palco_auto?: boolean | null;
  aula_encerrar_ao_fim?: boolean | null;
  agenda_processada_em?: string | null;
  agenda_aviso_em?: string | null;
  agenda_erro?: string | null;
  // reprises (migration 20261110100000)
  reprise_de?: string | null;
  reprise_serie_id?: string | null;
  reprise_cancelada_em?: string | null;
}

export interface ItemPainel {
  key: string;
  tipo: "sala" | "webinar";
  id: string;
  titulo: string;
  data: string | null; // agendamento ou criação
  status: string;
  aoVivo: boolean;
  destinos: LiveDestino["tipo"][];
  salaId: string | null; // estúdio ligado
  temGravacao: boolean;
  sala?: LiveRoomExtra;
  webinar?: Webinar & { created_at?: string };
}

export function itensDoPainel(
  salas: LiveRoomExtra[],
  webinars: (Webinar & { created_at?: string })[],
  destinos: (LiveDestino & { room_id: string })[],
): ItemPainel[] {
  const porSala = new Map<string, LiveDestino["tipo"][]>();
  for (const d of destinos) {
    const l = porSala.get(d.room_id) ?? [];
    if (!l.includes(d.tipo)) l.push(d.tipo);
    porSala.set(d.room_id, l);
  }
  // sala ligada a um webinário vira uma linha só (a do webinário, com os destinos e o status da sala)
  const ligadas = new Set(webinars.map((w) => w.live_room_id).filter(Boolean) as string[]);
  const salaPorId = new Map(salas.map((s) => [s.id, s]));
  // reprise cancelada não aparece no painel (fica só na lista de reprises da live de origem)
  const itens: ItemPainel[] = salas.filter((s) => !ligadas.has(s.id) && !s.reprise_cancelada_em).map((s) => ({
    key: `sala:${s.id}`,
    tipo: "sala",
    id: s.id,
    titulo: s.titulo,
    data: s.agendada_em ?? s.iniciada_em ?? s.created_at,
    status: s.status,
    aoVivo: s.status === "ao_vivo",
    destinos: porSala.get(s.id) ?? [],
    salaId: s.id,
    temGravacao: !!s.cf_ultima_gravacao,
    sala: s,
  }));
  for (const w of webinars) {
    const sala = w.live_room_id ? salaPorId.get(w.live_room_id) : undefined;
    const tipos = sala ? (porSala.get(sala.id) ?? []).filter((t) => t !== "cloudflare") : [];
    itens.push({
      key: `webinar:${w.id}`,
      tipo: "webinar",
      id: w.id,
      titulo: w.titulo,
      data: w.created_at ?? null,
      status: sala?.status === "ao_vivo" ? "ao_vivo" : w.status,
      aoVivo: sala?.status === "ao_vivo",
      destinos: ["cloudflare", ...tipos],
      salaId: sala ? sala.id : null,
      temGravacao: !!sala?.cf_ultima_gravacao,
      sala,
      webinar: w,
    });
  }
  return itens.sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""));
}

export function abaDoItem(i: ItemPainel): AbaPainel {
  if (i.tipo === "webinar") return i.status === "arquivado" ? "anteriores" : "proximas";
  return i.status === "encerrada" ? "anteriores" : "proximas";
}

export function filtrarAba(itens: ItemPainel[], aba: AbaPainel): ItemPainel[] {
  if (aba === "gravacoes") return itens.filter((i) => i.temGravacao);
  return itens.filter((i) => abaDoItem(i) === aba);
}

/** Cartões de destino do modal de criação (o "webinário próprio" usa o Cloudflare Stream da sala). */
export const CARTOES_DESTINO: { key: LiveDestino["tipo"]; rotulo: string; ajuda: string }[] = [
  { key: "youtube", rotulo: "YouTube", ajuda: "Chave da transmissão do YouTube Studio" },
  { key: "facebook", rotulo: "Facebook", ajuda: "Página ou perfil, chave do software de streaming" },
  { key: "instagram", rotulo: "Instagram", ajuda: "Conta profissional; URL e chave mudam a cada live" },
  { key: "custom", rotulo: "RTMP personalizado", ajuda: "Qualquer servidor RTMP/RTMPS" },
  { key: "cloudflare", rotulo: "Webinário próprio", ajuda: "Página /w do sistema, com chat, ofertas e lembretes" },
];

/** Erro de edge function que não existe no projeto (404 / sem rede para a função). */
export function backendAusente(msg: string | undefined | null): boolean {
  if (!msg) return false;
  return /404|not found|failed to send a request|requested function was not found|edge function returned a non-2xx/i.test(msg);
}

export const AVISO_BACKEND =
  "O servidor de transmissão (funções live-token / live-control) ainda não está publicado. A tela funciona, mas esta ação só vai rodar depois da publicação.";

export function formatarDuracao(seg: number): string {
  const s = Math.max(0, Math.floor(seg));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
}
