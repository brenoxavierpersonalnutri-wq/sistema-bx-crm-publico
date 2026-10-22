-- =============================================================
-- NÚMERO DE GRUPOS (grupos-1) — 19/10/2026
-- Rodar no SQL editor do Lovable Cloud. Idempotente. Não apaga nem altera dado existente.
--
-- O número dedicado a grupos roda numa 2ª instância do OpenWA na VPS (motor Baileys, /opt/openwa-grupos),
-- separada da principal (whatsapp-web.js). O proxy da VPS manda a sessão grupos-1 para essa instância
-- (OPENWA_BASE_GRUPOS_1). Do lado do CRM é um número OpenWA como os outros: o cartão aparece em
-- /crm/conexoes e o Breno pareia por QR ou código.
-- Diferença que o CRM precisa saber: Baileys não tem histórico ao vivo. "Importar conversas" desse número
-- volta vazio (o proxy responde lista vazia em vez de erro); o que chega pelo webhook entra normal.
-- =============================================================
INSERT INTO public.crm_numeros (chave, apelido, telefone, tipo, sessao_openwa, ordem, observacao) VALUES
  ('grupos-1', 'Grupos 1', NULL, 'openwa', 'grupos-1', 60,
   'Número dedicado a grupos. OpenWA 2ª instância (Baileys): sem histórico ao vivo.')
ON CONFLICT (chave) DO NOTHING;

-- conferência
SELECT chave, apelido, tipo, sessao_openwa, telefone, ativo, ordem FROM public.crm_numeros ORDER BY ordem;
