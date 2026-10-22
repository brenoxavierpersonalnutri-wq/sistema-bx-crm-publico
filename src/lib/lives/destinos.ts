// Destinos da live (vários ao mesmo tempo, cada um com seu interruptor): textos e regras que a tela
// decide sozinha. O servidor monta UM Egress com as URLs de todos os destinos ligados.
import type { LiveDestino } from "@/lib/lives/api";

export const ROTULO_INTERRUPTOR = "Transmitir para este destino nesta live";

export const INSTAGRAM_PASSOS = [
  "Use uma conta profissional (criador ou empresa).",
  "No computador, abra instagram.com > Criar > Ao vivo > Transmitir via RTMP/software.",
  "Copie a URL do servidor (rtmps://...:443/rtmp/) e a chave e cole aqui.",
  "Depois de Ir ao vivo aqui, volte ao Instagram e clique em Ir ao vivo quando a prévia aparecer.",
] as const;

export const INSTAGRAM_AVISO_CHAVE = "A chave muda a cada live: cole uma nova antes de ir ao vivo.";
export const INSTAGRAM_AVISO_FORMATO = "Aparece com faixas no Instagram: a imagem sai em 16:9 e o Instagram é vertical.";
export const INSTAGRAM_AVISO_LIMITE = "O Instagram encerra a live por RTMP em cerca de 1 hora.";

/** Erro guardado da saída (coluna yt_erro, que vale pra qualquer destino). */
export function erroDoDestino(d: Pick<LiveDestino, "yt_erro">): string | null {
  const e = (d.yt_erro ?? "").trim();
  return e || null;
}

/** Linha de estado do destino nesta live, ou null quando não há nada a dizer. */
export function estadoNestaLive(d: Pick<LiveDestino, "ativo" | "no_ar" | "yt_erro">, salaAoVivo: boolean): string | null {
  const erro = erroDoDestino(d);
  if (salaAoVivo) {
    if (d.no_ar) return null; // o selo "no ar" já diz
    if (d.ativo && erro) return `caiu: ${erro}. Desligue e ligue de novo para tentar outra vez.`;
    if (d.ativo) return "ligado, mas fora do ar";
    return null;
  }
  if (d.ativo && erro) return `na última tentativa: ${erro}`;
  return null;
}

/** Servidor do Instagram: só rtmps, sem espaço e sem a chave grudada (o usuário costuma colar os dois juntos). */
export function validarServidorInstagram(servidor: string): string | null {
  const s = servidor.trim();
  if (!s) return "Cole a URL do servidor";
  if (!/^rtmps:\/\/\S+$/i.test(s)) return "A URL do servidor do Instagram começa com rtmps://";
  return null;
}

/** O destino Instagram da sala (um só: trocar a chave edita o mesmo). */
export const destinoInstagram = (destinos: LiveDestino[]) => destinos.find((d) => d.tipo === "instagram") ?? null;

/** Quantos destinos ligados e quais nomes, para o resumo antes do Ir ao vivo. */
export function resumoLigados(destinos: Pick<LiveDestino, "ativo" | "nome">[]): string {
  const lig = destinos.filter((d) => d.ativo).map((d) => d.nome);
  if (!lig.length) return "Nenhum destino ligado.";
  return `Vai ao ar em: ${lig.join(", ")}.`;
}

/** Destinos que estavam no ar na leitura anterior e agora caíram com erro (para avisar uma vez só). */
export function quedasNovas(noArAntes: ReadonlySet<string>, destinos: Pick<LiveDestino, "id" | "nome" | "no_ar" | "yt_erro">[]): { nome: string; erro: string }[] {
  return destinos
    .filter((d) => noArAntes.has(d.id) && !d.no_ar && erroDoDestino(d))
    .map((d) => ({ nome: d.nome, erro: erroDoDestino(d) as string }));
}
