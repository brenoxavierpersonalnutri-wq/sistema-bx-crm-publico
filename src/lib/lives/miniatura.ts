// Miniatura do YouTube (thumbnails.set aceita JPEG/PNG até 2 MB). JPG/PNG dentro do limite vão como estão; o resto
// que o navegador consegue abrir (WebP, AVIF, GIF, PNG/JPG grandes) vira JPEG de no máximo 1280x720.
export const MAX_MINIATURA = 2 * 1024 * 1024;
export const TIPOS_DIRETOS = ["image/jpeg", "image/png"];

export type ResultadoMiniatura = { ok: true; arquivo: File; convertida: boolean } | { ok: false; motivo: string };

/** Medidas que cabem em 1280x720 mantendo a proporção. */
export function caberEm(l: number, a: number, maxL = 1280, maxA = 720): { l: number; a: number } {
  const f = Math.min(1, maxL / l, maxA / a);
  return { l: Math.max(1, Math.round(l * f)), a: Math.max(1, Math.round(a * f)) };
}

type Decodificar = (f: File) => Promise<{ width: number; height: number; desenhar: (ctx: CanvasRenderingContext2D, l: number, a: number) => void }>;

const decodificarPadrao: Decodificar = async (f) => {
  const bmp = await createImageBitmap(f);
  return { width: bmp.width, height: bmp.height, desenhar: (ctx, l, a) => ctx.drawImage(bmp, 0, 0, l, a) };
};

async function paraJpeg(f: File, decodificar: Decodificar): Promise<File | null> {
  const img = await decodificar(f);
  const { l, a } = caberEm(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = l;
  canvas.height = a;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, l, a);
  img.desenhar(ctx, l, a);
  for (const q of [0.9, 0.8, 0.7]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= MAX_MINIATURA) return new File([blob], f.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  }
  return null;
}

export async function prepararMiniatura(f: File, decodificar: Decodificar = decodificarPadrao): Promise<ResultadoMiniatura> {
  if (TIPOS_DIRETOS.includes(f.type) && f.size > 0 && f.size <= MAX_MINIATURA) return { ok: true, arquivo: f, convertida: false };
  if (f.type && !f.type.startsWith("image/")) return { ok: false, motivo: "Escolha uma imagem (JPG ou PNG)." };
  try {
    const j = await paraJpeg(f, decodificar);
    if (j) return { ok: true, arquivo: j, convertida: true };
    return { ok: false, motivo: "Não consegui deixar a imagem abaixo de 2 MB. Use um JPG ou PNG menor (1280x720)." };
  } catch {
    const heic = /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);
    return {
      ok: false,
      motivo: heic
        ? "Foto HEIC do iPhone: o navegador não abre esse formato. Exporte como JPG (no Mac: abrir no Pré-visualização > Exportar > JPEG)."
        : "Formato de imagem não suportado. Use JPG ou PNG até 2 MB.",
    };
  }
}

export function formatarTamanho(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
