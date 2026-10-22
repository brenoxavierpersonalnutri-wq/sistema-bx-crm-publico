-- =============================================================
-- CRM /crm/conexoes: renomear o número (só o rótulo `apelido` de crm_numeros).
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente (pode rodar de novo).
--
-- O que faz:
--  1) crm_numero_normalizar_nome(text): trim + espaços internos colapsados (a mesma regra da tela).
--  2) Trigger BEFORE UPDATE em crm_numeros:
--     - quem chega pela API como usuário (roles authenticated/anon) NÃO muda chave, tipo, sessao_openwa
--       nem openwa_session_id: o nome da sessão do OpenWA é a ligação com a VPS e não se renomeia pela tela.
--       service_role (edge functions: whatsapp-qr grava telefone, openwa-webhook grava openwa_session_id) e o
--       SQL editor seguem livres.
--     - apelido que muda é normalizado e validado: 2 a 40 caracteres, único sem diferenciar maiúscula
--       (vale para a Central também, que já edita o apelido no painel do número).
--  3) RPC crm_numero_renomear(p_id uuid, p_nome text): SECURITY DEFINER, mesma regra de acesso da tela e da
--     RLS de UPDATE já existente (usuário aprovado: is_approved(auth.uid()); o CRM, fora do Banco de dados, é
--     livre para aprovado). Mexe SÓ no apelido. Devolve a linha atualizada (id, chave, apelido, sessao_openwa).
--
-- O QUE NÃO MUDA: as policies de crm_numeros (SELECT/INSERT/UPDATE para aprovado) continuam como estão.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.crm_numero_normalizar_nome(p_nome text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.crm_numeros_guardar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.chave IS DISTINCT FROM OLD.chave
       OR NEW.tipo IS DISTINCT FROM OLD.tipo
       OR NEW.sessao_openwa IS DISTINCT FROM OLD.sessao_openwa
       OR (to_jsonb(NEW) ->> 'openwa_session_id') IS DISTINCT FROM (to_jsonb(OLD) ->> 'openwa_session_id') THEN
      RAISE EXCEPTION 'A sessão do número não se renomeia pela tela: só o nome (apelido).'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.apelido IS DISTINCT FROM OLD.apelido THEN
    NEW.apelido := public.crm_numero_normalizar_nome(NEW.apelido);
    IF char_length(NEW.apelido) < 2 OR char_length(NEW.apelido) > 40 THEN
      RAISE EXCEPTION 'O nome do número precisa ter de 2 a 40 caracteres.'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.crm_numeros o
       WHERE o.id <> NEW.id AND lower(public.crm_numero_normalizar_nome(o.apelido)) = lower(NEW.apelido)
    ) THEN
      RAISE EXCEPTION 'Já existe um número com o nome "%".', NEW.apelido
        USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_numeros_guardar ON public.crm_numeros;
CREATE TRIGGER trg_crm_numeros_guardar BEFORE UPDATE ON public.crm_numeros
FOR EACH ROW EXECUTE FUNCTION public.crm_numeros_guardar();

CREATE OR REPLACE FUNCTION public.crm_numero_renomear(p_id uuid, p_nome text)
RETURNS TABLE (id uuid, chave text, apelido text, sessao_openwa text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome text := public.crm_numero_normalizar_nome(p_nome);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para renomear números.' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.crm_numeros n WHERE n.id = p_id) THEN
    RAISE EXCEPTION 'Número não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  -- a validação (2-40, único) mora no trigger; aqui só repete o tamanho pra dar o erro antes do UPDATE
  IF char_length(v_nome) < 2 OR char_length(v_nome) > 40 THEN
    RAISE EXCEPTION 'O nome do número precisa ter de 2 a 40 caracteres.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    UPDATE public.crm_numeros n SET apelido = v_nome WHERE n.id = p_id
    RETURNING n.id, n.chave, n.apelido, n.sessao_openwa;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_numero_renomear(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_numero_renomear(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.crm_numeros_guardar() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Conferir depois de rodar:
--   SELECT proname FROM pg_proc WHERE proname IN ('crm_numero_renomear', 'crm_numeros_guardar', 'crm_numero_normalizar_nome');
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_crm_numeros_guardar';
