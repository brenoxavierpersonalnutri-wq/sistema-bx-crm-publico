// Sessões duplicadas da mesma pessoa na sala do LiveKit.
//
// O live-token dá a cada entrada uma identity nova no formato `<tipo>_<8 do id>_<aleatório>`
// (prod_<usuário>, conv_<convite>). Quem abre o estúdio em duas abas (ou deixa uma aba esquecida aberta)
// vira DUAS pessoas na sala: aparece duas vezes nos bastidores, o microfone da aba esquecida continua
// tocando quando a pessoa muta a aba que está usando, e o palco mostra a câmera errada.
//
// Regra: por pessoa (mesmo prefixo) fica UMA sessão, a que entrou por último (joinedAt do servidor, empate
// pela identity — a mesma decisão em todas as abas). A aba local nunca se remove: se ela é a mais antiga,
// a aba nova é quem tira esta (assim duas abas com este código não se derrubam uma à outra).

export interface SessaoSala {
  identity: string;
  joinedAt?: Date | number | null;
  local?: boolean;
}

/** `prod_2bf4323d_jYI7` -> `prod_2bf4323d`. Identity fora do formato (render, egress) não tem dono: null. */
export function donoDaSessao(identity: string): string | null {
  const m = /^((?:prod|conv)_[A-Za-z0-9-]{4,})_[A-Za-z0-9_-]+$/.exec(identity);
  return m ? m[1] : null;
}

const tempo = (s: SessaoSala) => (s.joinedAt instanceof Date ? s.joinedAt.getTime() : typeof s.joinedAt === "number" ? s.joinedAt : 0);

/** Identities que esta aba deve tirar da sala (sessões mais antigas da mesma pessoa). Nunca a local. */
export function sessoesDuplicadas(sessoes: SessaoSala[]): string[] {
  const porDono = new Map<string, SessaoSala[]>();
  for (const s of sessoes) {
    const dono = donoDaSessao(s.identity);
    if (!dono) continue;
    porDono.set(dono, [...(porDono.get(dono) ?? []), s]);
  }
  const sobra: string[] = [];
  for (const grupo of porDono.values()) {
    if (grupo.length < 2) continue;
    const fica = grupo.slice().sort((a, b) => tempo(b) - tempo(a) || (a.identity < b.identity ? 1 : a.identity > b.identity ? -1 : 0))[0];
    const local = grupo.find((s) => s.local);
    // a aba local é mais antiga que outra da mesma pessoa: não é ela quem decide
    if (local && fica !== local) continue;
    for (const s of grupo) if (s !== fica) sobra.push(s.identity);
  }
  return sobra;
}

/** Texto do "Último erro" da sala: o erro do Cloudflare Stream não é erro do palco nem da transmissão RTMP. */
export function textoUltimoErro(erro: string | null | undefined): string | null {
  if (!erro) return null;
  if (/CF_ACCOUNT_ID|CF_STREAM_TOKEN|CF_STREAM_CUSTOMER_CODE|Cloudflare Stream não está configurado/i.test(erro)) {
    return "Webinário próprio indisponível: configure o Cloudflare Stream no servidor. Palco, banners, gravação e transmissão por YouTube, Facebook ou RTMP funcionam normalmente.";
  }
  return erro;
}
