// Registro de push notifications com Expo.
//
// Instale antes:
//   npx expo install expo-notifications expo-device expo-constants
//
// No app.json/app.config.js é preciso ter o `expo.extra.eas.projectId`,
// senão o getExpoPushTokenAsync falha em build de produção.

import type { ClienteApi } from "./cliente";

type ModuloNotificacoes = {
  getPermissionsAsync: () => Promise<{ status: string }>;
  requestPermissionsAsync: () => Promise<{ status: string }>;
  getExpoPushTokenAsync: (o: { projectId?: string }) => Promise<{ data: string }>;
  setNotificationChannelAsync?: (id: string, cfg: Record<string, unknown>) => Promise<unknown>;
};

export interface OpcoesPush {
  notificacoes: ModuloNotificacoes;
  cliente: ClienteApi;
  plataforma: "ios" | "android";
  /** expo.extra.eas.projectId */
  projectId?: string;
  modelo?: string;
  /** Simulador não recebe push; pule para não poluir o log com erro. */
  ehDispositivoFisico?: boolean;
}

/**
 * Pede a permissão, pega o token e manda para a API.
 * Devolve o token, ou null quando a aluna recusou ou está no simulador.
 * Nunca lança: push é um extra, não pode travar a abertura do app.
 */
export async function registrarPush(o: OpcoesPush): Promise<string | null> {
  try {
    if (o.ehDispositivoFisico === false) return null;

    // O Android precisa de um canal declarado, senão a notificação não aparece
    if (o.plataforma === "android" && o.notificacoes.setNotificationChannelAsync) {
      await o.notificacoes.setNotificationChannelAsync("default", {
        name: "Avisos da consultoria",
        importance: 4,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    let { status } = await o.notificacoes.getPermissionsAsync();
    if (status !== "granted") {
      ({ status } = await o.notificacoes.requestPermissionsAsync());
    }
    if (status !== "granted") return null;

    const { data: token } = await o.notificacoes.getExpoPushTokenAsync({
      projectId: o.projectId,
    });

    await o.cliente.registrarDispositivo({
      token,
      plataforma: o.plataforma,
      provedor: "expo",
      modelo: o.modelo,
    });

    return token;
  } catch (e) {
    console.warn("Não consegui registrar o push:", e);
    return null;
  }
}

/** Para onde navegar quando a aluna toca na notificação. */
export function rotaDaNotificacao(dados: Record<string, unknown> | undefined): string | null {
  const rota = dados?.rota;
  if (typeof rota !== "string") return null;
  return ["treino", "dieta", "feedback"].includes(rota) ? rota : null;
}
