-- =============================================================
-- CRM: Central de Automação (/crm/central) — números de WhatsApp.
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente (pode rodar de novo).
--
-- O que faz:
--  1) crm_numeros: um registro por número (sessão do OpenWA ou número oficial), com limites
--     por hora/dia e janela de horário. Seed com os 5 números da operação (por `chave`).
--  2) numero_id (nullable, FK ON DELETE SET NULL) nas tabelas de automação que existem na main:
--     crm_automacoes, crm_campanhas, crm_automacao_fila, crm_automacao_log, crm_envio_config.
--     Se as tabelas dos fluxos (crm_fluxos, crm_wa_templates) ou dos grupos já existirem, liga a FK nelas também.
--  3) Triggers que herdam o número: item da fila herda da automação/campanha/fluxo; linha do log herda do item.
--     Assim nenhum produtor precisa mudar para o número chegar até o envio.
--
-- O QUE NÃO MUDA: nada liga envio. Limites por número ficam gravados aqui; o motor (crm-automacoes)
-- ainda aplica os de crm_envio_config 'principal' a todos os envios até ficar multi-número (README).
-- numero_id NULL = número padrão (sessão closer), que é o único que envia hoje.
-- =============================================================

BEGIN;

-- 1) Números ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_numeros (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave         text NOT NULL UNIQUE CHECK (chave ~ '^[a-z0-9][a-z0-9-]{0,40}$'),
  apelido       text NOT NULL CHECK (length(apelido) BETWEEN 1 AND 60),
  telefone      text CHECK (telefone IS NULL OR telefone ~ '^\d{10,15}$'),
  tipo          text NOT NULL CHECK (tipo IN ('openwa', 'oficial')),
  sessao_openwa text CHECK (sessao_openwa IS NULL OR sessao_openwa ~ '^[a-z0-9][a-z0-9-]{0,40}$'),
  ativo         boolean NOT NULL DEFAULT true,
  max_hora      integer NOT NULL DEFAULT 30  CHECK (max_hora BETWEEN 1 AND 60),
  max_dia       integer NOT NULL DEFAULT 200 CHECK (max_dia BETWEEN 1 AND 1000),
  hora_inicio   integer NOT NULL DEFAULT 8   CHECK (hora_inicio BETWEEN 0 AND 23),
  hora_fim      integer NOT NULL DEFAULT 20  CHECK (hora_fim BETWEEN 1 AND 24),
  ordem         integer NOT NULL DEFAULT 0,
  observacao    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_numeros_janela CHECK (hora_inicio < hora_fim),
  -- número do OpenWA precisa da sessão; o oficial não tem sessão
  CONSTRAINT crm_numeros_sessao_tipo CHECK (
    (tipo = 'openwa' AND sessao_openwa IS NOT NULL) OR (tipo = 'oficial' AND sessao_openwa IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_numeros_sessao_key ON public.crm_numeros (sessao_openwa) WHERE sessao_openwa IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_numeros_tocar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_numeros_tocar ON public.crm_numeros;
CREATE TRIGGER trg_crm_numeros_tocar BEFORE UPDATE ON public.crm_numeros
FOR EACH ROW EXECUTE FUNCTION public.crm_numeros_tocar();

-- Seed: idempotente por `chave`; não sobrescreve o que foi editado na tela.
INSERT INTO public.crm_numeros (chave, apelido, telefone, tipo, sessao_openwa, ordem, observacao) VALUES
  ('closer',                     'Closer',                    NULL,           'openwa',  'closer',                     10, 'Sessão padrão: a única com chave de envio na ponte da VPS hoje.'),
  ('comercial-fit-2',            'Comercial Fit 2',           NULL,           'openwa',  'comercial-fit-2',            20, NULL),
  ('suporte-consultoria-1',      'Suporte Consultoria',       NULL,           'openwa',  'suporte-consultoria-1',      30, NULL),
  ('comercial-implementacao-1',  'Comercial Implementação',   NULL,           'openwa',  'comercial-implementacao-1',  40, NULL),
  ('oficial-full-funnel',        'Oficial (Full Funnel)',     '553170000102', 'oficial', NULL,                         50, 'API oficial via Full Funnel; futuro Cloud API.')
ON CONFLICT (chave) DO NOTHING;

ALTER TABLE public.crm_numeros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Approved read crm_numeros" ON public.crm_numeros;
CREATE POLICY "Approved read crm_numeros" ON public.crm_numeros FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Approved insert crm_numeros" ON public.crm_numeros;
CREATE POLICY "Approved insert crm_numeros" ON public.crm_numeros FOR INSERT TO authenticated
  WITH CHECK (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Approved update crm_numeros" ON public.crm_numeros;
CREATE POLICY "Approved update crm_numeros" ON public.crm_numeros FOR UPDATE TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
-- sem DELETE pela tela: número sai de uso com ativo = false (o histórico continua apontando pra ele)

-- 2) numero_id nas tabelas de automação ------------------------------------------------------
-- Tabela que não existir é pulada (a migration dos fluxos/grupos pode vir depois; rode esta de novo).
DO $$
DECLARE
  t text;
  fk text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'crm_automacoes', 'crm_campanhas', 'crm_automacao_fila', 'crm_automacao_log', 'crm_envio_config',
    'crm_fluxos', 'crm_wa_templates', 'crm_fluxo_execucoes',
    'crm_grupos', 'crm_grupo_campanhas', 'crm_grupos_campanhas', 'crm_grupo_mensagens', 'crm_grupo_links'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'crm_central: % não existe, pulando', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS numero_id uuid', t);
    fk := t || '_numero_id_fkey';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (numero_id) REFERENCES public.crm_numeros(id) ON DELETE SET NULL',
        t, fk);
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (numero_id)', t || '_numero_idx', t);
  END LOOP;
END $$;

-- a configuração de envio que existe hoje ('principal') é a do número padrão
UPDATE public.crm_envio_config
   SET numero_id = (SELECT id FROM public.crm_numeros WHERE chave = 'closer')
 WHERE numero = 'principal' AND numero_id IS NULL;

-- 3) Herança do número -----------------------------------------------------------------------
-- Item da fila sem número herda da automação / campanha / fluxo que o criou.
CREATE OR REPLACE FUNCTION public.crm_fila_herdar_numero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fluxo text;
BEGIN
  IF NEW.numero_id IS NULL AND NEW.automacao_id IS NOT NULL THEN
    SELECT numero_id INTO NEW.numero_id FROM public.crm_automacoes WHERE id = NEW.automacao_id;
  END IF;
  IF NEW.numero_id IS NULL AND NEW.campanha_id IS NOT NULL THEN
    SELECT numero_id INTO NEW.numero_id FROM public.crm_campanhas WHERE id = NEW.campanha_id;
  END IF;
  -- fluxo_id só existe depois da migration dos fluxos: lido pelo JSON da linha, consulta dinâmica
  v_fluxo := to_jsonb(NEW) ->> 'fluxo_id';
  IF NEW.numero_id IS NULL AND v_fluxo IS NOT NULL AND to_regclass('public.crm_fluxos') IS NOT NULL THEN
    EXECUTE 'SELECT numero_id FROM public.crm_fluxos WHERE id = $1::uuid' INTO NEW.numero_id USING v_fluxo;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'crm_fila_herdar_numero: %', SQLERRM; -- nunca derruba o enfileiramento
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_fila_herdar_numero ON public.crm_automacao_fila;
CREATE TRIGGER trg_crm_fila_herdar_numero BEFORE INSERT ON public.crm_automacao_fila
FOR EACH ROW EXECUTE FUNCTION public.crm_fila_herdar_numero();

-- Linha do log herda do item da fila (o log é o que a Central conta por número).
CREATE OR REPLACE FUNCTION public.crm_log_herdar_numero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.numero_id IS NULL AND NEW.fila_id IS NOT NULL THEN
    SELECT numero_id INTO NEW.numero_id FROM public.crm_automacao_fila WHERE id = NEW.fila_id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'crm_log_herdar_numero: %', SQLERRM;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_log_herdar_numero ON public.crm_automacao_log;
CREATE TRIGGER trg_crm_log_herdar_numero BEFORE INSERT ON public.crm_automacao_log
FOR EACH ROW EXECUTE FUNCTION public.crm_log_herdar_numero();

REVOKE ALL ON FUNCTION public.crm_fila_herdar_numero() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_log_herdar_numero() FROM PUBLIC, anon, authenticated;

-- 4) A tela da Central atribui número a automação/fluxo (as policies "manage" já cobrem) e a campanha
--    em rascunho (policy de update de crm_campanhas já limita a rascunho). Nada novo de permissão aqui.

COMMIT;

-- =============================================================
-- DEPOIS DE RODAR:
--  1) Se a migration dos fluxos (20261023120000) já rodou ANTES desta, rode-a de novo: o bloco 8 dela
--     liga os espelhos do Full Funnel ao número oficial (agora que crm_numeros existe).
--  2) Telefone das sessões do OpenWA: preencher na Central (Limites e horários) ou
--     UPDATE public.crm_numeros SET telefone = '55319...' WHERE chave = 'comercial-fit-2';
--  Conferir: SELECT chave, tipo, sessao_openwa, ativo FROM public.crm_numeros ORDER BY ordem;
-- =============================================================
