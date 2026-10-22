// Envio manual a grupo pela tela Conversas (18/10/2026). Grupo = phone …@g.us (o próprio JID).
// As funções whatsapp-send / whatsapp-send-media só aceitam grupo com `manual: true` (atendente logado);
// automação, fluxo e IA nunca mandam essa flag.
/** `{ manual: true }` quando o destino é grupo; `{}` para telefone (corpo igual ao de antes). */
export const envioManual = (phone: string): { manual?: true } => (grupoEnviavel(phone) ? { manual: true } : {});

/** Grupo com o JID completo (…@g.us): o único formato que o proxy aceita para envio. */
export const grupoEnviavel = (phone: string): boolean => /^\d{5,25}(-\d{5,15})?@g\.us$/.test(phone);

/** Pasta do anexo no bucket: o telefone, ou o JID do grupo sem o "@" (só letras, dígitos e hífen). */
export const pastaDoContato = (phone: string): string => phone.replace(/[^0-9A-Za-z-]/g, "_");
