// Cliente da API mobile-v1. Sem dependência de React Native — roda em qualquer
// runtime com fetch, então dá para testar no Node e usar no Expo igual.
//
// Autenticação: o login é feito pelo SDK do Supabase (@supabase/supabase-js,
// que funciona em React Native com AsyncStorage). Este cliente só recebe uma
// função que devolve o access_token atual e o manda no header.

import {
  ErroApi, type Bootstrap, type Dieta, type EnvioFeedback, type Evolucao,
  type Notificacao, type Plataforma, type RespostaFeedback, type CicloFeedback,
  type Treino,
} from "./tipos";

export interface OpcoesCliente {
  /** https://<projeto>.supabase.co */
  supabaseUrl: string;
  /** Chave publishable (anon). É pública por natureza — a RLS é quem protege. */
  anonKey: string;
  /** Devolve o access_token da sessão atual, ou null se deslogada. */
  obterToken: () => Promise<string | null>;
  /** Versão do app instalada, para a porta de atualização obrigatória. */
  appVersao: string;
  plataforma: Plataforma;
  /** Corta a requisição depois deste tempo. Padrão 15s. */
  timeoutMs?: number;
}

export class ClienteApi {
  private base: string;

  constructor(private opcoes: OpcoesCliente) {
    this.base = `${opcoes.supabaseUrl.replace(/\/$/, "")}/functions/v1/mobile-v1`;
  }

  private async requisicao<T>(
    metodo: "GET" | "POST" | "DELETE",
    caminho: string,
    corpo?: unknown,
  ): Promise<T> {
    const token = await this.opcoes.obterToken();
    if (!token) {
      throw new ErroApi("sem_token", "Faça login para continuar.", 401);
    }

    const controle = new AbortController();
    const limite = setTimeout(() => controle.abort(), this.opcoes.timeoutMs ?? 15_000);

    try {
      const resposta = await fetch(`${this.base}/${caminho}`, {
        method: metodo,
        signal: controle.signal,
        headers: {
          "Authorization": `Bearer ${token}`,
          "apikey": this.opcoes.anonKey,
          "Content-Type": "application/json",
          "x-app-versao": this.opcoes.appVersao,
          "x-app-plataforma": this.opcoes.plataforma,
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });

      const texto = await resposta.text();
      const dados = texto ? JSON.parse(texto) : {};

      if (!resposta.ok) {
        throw new ErroApi(
          dados?.erro?.codigo ?? "erro_interno",
          dados?.erro?.mensagem ?? "Algo deu errado. Tente de novo.",
          resposta.status,
        );
      }
      return dados as T;
    } catch (e) {
      if (e instanceof ErroApi) throw e;
      if ((e as Error)?.name === "AbortError") {
        throw new ErroApi("timeout", "A conexão demorou demais. Tente de novo.", 408);
      }
      throw new ErroApi("sem_rede", "Sem conexão. Verifique sua internet.", 0);
    } finally {
      clearTimeout(limite);
    }
  }

  // ------------------------------------------------------------- leituras

  /** Uma chamada só, com tudo que a home precisa. Use na abertura do app. */
  bootstrap() {
    return this.requisicao<Bootstrap>("GET", "bootstrap");
  }

  treino() {
    return this.requisicao<{ treino: Treino | null }>("GET", "treino");
  }

  dieta() {
    return this.requisicao<{ dieta: Dieta | null }>("GET", "dieta");
  }

  feedback() {
    return this.requisicao<{
      ciclo: CicloFeedback | null;
      ja_enviei_hoje: boolean;
      respostas: RespostaFeedback[];
    }>("GET", "feedback");
  }

  evolucao() {
    return this.requisicao<Evolucao>("GET", "evolucao");
  }

  notificacoes() {
    return this.requisicao<{ notificacoes: Notificacao[] }>("GET", "notificacoes");
  }

  // -------------------------------------------------------------- escritas

  concluirTreino(params: {
    dia_id: string;
    plano_fase_id?: string;
    data?: string;
    duracao_min?: number;
    intensidade?: number;
    observacao?: string;
  }) {
    return this.requisicao<{ concluido: true; data: string }>("POST", "treino/concluir", params);
  }

  desfazerTreino(params: { dia_id: string; data?: string }) {
    return this.requisicao<{ concluido: false }>("POST", "treino/desfazer", params);
  }

  enviarFeedback(dados: EnvioFeedback) {
    return this.requisicao<{ enviado: true; data: string }>("POST", "feedback", dados);
  }

  marcarNotificacaoLida(id?: string) {
    return this.requisicao<{ marcadas: true }>("POST", "notificacoes/lida", id ? { id } : {});
  }

  // ------------------------------------------------------------------ push

  /** Chame depois de obter a permissão e o token de push do Expo. */
  registrarDispositivo(params: {
    token: string;
    plataforma?: Plataforma;
    provedor?: "expo" | "fcm" | "apns";
    modelo?: string;
  }) {
    return this.requisicao<{ dispositivo_id: string }>("POST", "dispositivo", {
      ...params,
      app_versao: this.opcoes.appVersao,
    });
  }

  /** Chame no logout, senão o aparelho continua recebendo push da conta antiga. */
  removerDispositivo(token: string) {
    return this.requisicao<{ removido: true }>("DELETE", "dispositivo", { token });
  }

  // -------------------------------------------------------- conta e dados

  /** LGPD art. 18. Devolve o JSON com tudo que é dela. */
  exportarMeusDados() {
    return this.requisicao<Record<string, unknown>>("GET", "exportar");
  }

  /**
   * Exclusão de conta. Obrigatório existir dentro do app pela
   * App Store Review Guideline 5.1.1(v).
   *
   * É irreversível: apaga o login, os arquivos, os treinos registrados e os
   * feedbacks. Confirme com a aluna antes de chamar, e faça signOut depois —
   * o token dela deixa de valer na hora.
   */
  excluirMinhaConta(motivo?: string) {
    return this.requisicao<{ excluido: true; aluna_id: string; em: string }>(
      "DELETE", "conta", { motivo },
    );
  }
}
