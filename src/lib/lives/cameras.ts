// Escolha de câmera: iPhone (Continuity Camera), última usada e dica quando só há a câmera do Mac.
const CHAVE = "lives:camera";

export const ehIphone = (d: { label: string }) => /iphone|ipad/i.test(d.label);

export function lerCameraSalva(): string | null {
  try {
    return localStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

export function salvarCamera(id: string) {
  try {
    localStorage.setItem(CHAVE, id);
  } catch {
    /* modo privado / storage bloqueado */
  }
}

/** Câmera a usar quando nada foi escolhido: a salva, se ainda existir; senão nada (o navegador usa a padrão). */
export function escolherCameraInicial(cameras: { deviceId: string }[], salva: string | null): string | null {
  return salva && cameras.some((c) => c.deviceId === salva) ? salva : null;
}

export const cameraSugeridaIphone = <T extends { label: string }>(cameras: T[]): T | undefined => cameras.find(ehIphone);

/** Só a(s) câmera(s) do próprio Mac, com rótulo visível (sem permissão os rótulos vêm vazios: não opina). */
export const soCameraDoMac = (cameras: { label: string }[]) => cameras.length > 0 && cameras.every((c) => c.label) && !cameras.some(ehIphone);
