-- Áudio do agente "Avaliação fitness" (etapa do físico) passa de MP3 para Ogg/Opus (21/10/2026).
--
-- O arquivo novo é public/roteiros/sellflux/audio-fisicos.ogg (Opus, mono, 48 kHz, 12,8 s, 52 KB), convertido do
-- audio-fisicos.mp3 (MP3 estéreo 44,1 kHz, 206 KB). Ogg/Opus é o formato da nota de voz do WhatsApp.
--
-- ORDEM: rodar SÓ DEPOIS do Publish do front, quando
--   https://equipe.brenoxavier.com.br/roteiros/sellflux/audio-fisicos.ogg
-- responder 200. Antes disso o link novo dá 404 e o robô falharia no áudio. O .mp3 continua no ar (nada é apagado),
-- e o proxy da VPS já converte o .mp3 para nota de voz sozinho; esta troca só poupa a conversão.
--
-- O que muda: troca o link exato do .mp3 pelo do .ogg (e o nome do arquivo) nas colunas de texto/jsonb das tabelas
-- de CONFIGURAÇÃO (agentes, conhecimento, exemplos, passos de roteiro, automações, fluxos). Histórico
-- (whatsapp_messages, crm_ai_eventos, logs, filas) não é tocado. Idempotente: rodar de novo não muda nada.

DO $$
DECLARE
  antigo constant text := 'https://equipe.brenoxavier.com.br/roteiros/sellflux/audio-fisicos.mp3';
  novo   constant text := 'https://equipe.brenoxavier.com.br/roteiros/sellflux/audio-fisicos.ogg';
  c record;
  n bigint;
BEGIN
  FOR c IN
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('crm_ai_agents', 'crm_ai_conhecimento', 'crm_ai_exemplos', 'crm_roteiro_passos', 'crm_automacoes', 'crm_fluxos')
      AND data_type IN ('text', 'jsonb')
  LOOP
    IF c.data_type = 'text' THEN
      EXECUTE format('UPDATE public.%I SET %I = replace(%I, $1, $2) WHERE strpos(%I, $1) > 0',
                     c.table_name, c.column_name, c.column_name, c.column_name)
        USING antigo, novo;
    ELSE
      EXECUTE format('UPDATE public.%I SET %I = replace(%I::text, $1, $2)::jsonb WHERE strpos(%I::text, $1) > 0',
                     c.table_name, c.column_name, c.column_name, c.column_name)
        USING antigo, novo;
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE 'audio-fisicos.ogg: %.% -> % linha(s)', c.table_name, c.column_name, n;
    END IF;
  END LOOP;

  -- nome do arquivo nos passos de roteiro que apontam para o .ogg
  UPDATE public.crm_roteiro_passos SET file_name = 'audio-fisicos.ogg'
  WHERE file_name = 'audio-fisicos.mp3' AND media_url = novo;
END $$;

-- Conferir depois (deve voltar 0 linhas com .mp3 e N com .ogg):
-- SELECT slug, strpos(prompt, 'audio-fisicos.mp3') > 0 AS mp3, strpos(prompt, 'audio-fisicos.ogg') > 0 AS ogg FROM public.crm_ai_agents;
-- SELECT id, media_url, file_name FROM public.crm_roteiro_passos WHERE media_url LIKE '%audio-fisicos%';
