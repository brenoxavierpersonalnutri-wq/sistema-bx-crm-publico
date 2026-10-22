-- =============================================================
-- CRM > Automação > Fluxos: construtor visual (pegada do Builder do Full Funnel).
-- Rodar inteiro no SQL editor DEPOIS da 20261023120000 (fluxos), 20261024100000 (números) e
-- 20261026120000 (segmentos). Idempotente (pode rodar 2x). NÃO liga nada e NÃO envia mensagem.
--
-- O que muda:
--  1) crm_fluxos ganha: gatilhos (vários, com "Ou"), arvore (desenho do construtor), canvas (zoom/posição),
--     config (horário permitido, limite por dia), pasta_id, excluido_em (aba Excluídos). A lista linear
--     `passos` continua sendo o que o motor lê (o construtor compila a árvore para ela ao salvar).
--  2) gatilho_tipo aceita segmento | sem_resposta | data; até 80 passos (o Se/Senão vira condição + salto).
--  3) crm_fluxo_pastas (pastas da lista de fluxos).
--  4) crm_fluxo_base_vistos: "foto" da base do gatilho por segmento no modo "só os novos".
--  5) whatsapp_contacts.atendente (passo "Atribuir atendente").
--  6) crm_fluxos_resumo(): total de inscritos, ativos, enviados, respondidos e falhas por fluxo (lista).
--
-- DEPOIS DE RODAR: publicar de novo a edge function crm-automacoes (motor com os gatilhos e passos novos).
-- =============================================================
BEGIN;

-- 1) Colunas novas do fluxo -------------------------------------------------------------------------
ALTER TABLE public.crm_fluxos ADD COLUMN IF NOT EXISTS gatilhos    jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.crm_fluxos ADD COLUMN IF NOT EXISTS arvore      jsonb;
ALTER TABLE public.crm_fluxos ADD COLUMN IF NOT EXISTS canvas      jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.crm_fluxos ADD COLUMN IF NOT EXISTS config      jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.crm_fluxos ADD COLUMN IF NOT EXISTS excluido_em timestamptz;

ALTER TABLE public.crm_fluxos DROP CONSTRAINT IF EXISTS crm_fluxos_gatilhos_check;
ALTER TABLE public.crm_fluxos ADD CONSTRAINT crm_fluxos_gatilhos_check
  CHECK (jsonb_typeof(gatilhos) = 'array' AND jsonb_array_length(gatilhos) <= 10);

ALTER TABLE public.crm_fluxos DROP CONSTRAINT IF EXISTS crm_fluxos_gatilho_tipo_check;
ALTER TABLE public.crm_fluxos ADD CONSTRAINT crm_fluxos_gatilho_tipo_check
  CHECK (gatilho_tipo IN ('tag', 'etapa', 'evento', 'segmento', 'sem_resposta', 'data'));

ALTER TABLE public.crm_fluxos DROP CONSTRAINT IF EXISTS crm_fluxos_passos_check;
ALTER TABLE public.crm_fluxos ADD CONSTRAINT crm_fluxos_passos_check
  CHECK (jsonb_typeof(passos) = 'array' AND jsonb_array_length(passos) <= 80);

-- fluxo excluído nunca fica ligado
CREATE OR REPLACE FUNCTION public.crm_fluxos_excluido_desliga()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.excluido_em IS NOT NULL THEN NEW.ativo := false; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_fluxos_excluido ON public.crm_fluxos;
CREATE TRIGGER trg_crm_fluxos_excluido BEFORE INSERT OR UPDATE ON public.crm_fluxos
FOR EACH ROW EXECUTE FUNCTION public.crm_fluxos_excluido_desliga();

-- gatilho antigo (único) vira o primeiro da lista nova; não mexe em quem já tem lista
UPDATE public.crm_fluxos
   SET gatilhos = jsonb_build_array(jsonb_build_object('tipo', gatilho_tipo, 'valor', coalesce(gatilho_valor, '')))
 WHERE gatilhos = '[]'::jsonb AND gatilho_tipo IN ('tag', 'etapa', 'evento');

-- 2) Pastas -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_fluxo_pastas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 60),
  ordem      integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_fluxos ADD COLUMN IF NOT EXISTS pasta_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_fluxos_pasta_id_fkey') THEN
    ALTER TABLE public.crm_fluxos ADD CONSTRAINT crm_fluxos_pasta_id_fkey
      FOREIGN KEY (pasta_id) REFERENCES public.crm_fluxo_pastas(id) ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE public.crm_fluxo_pastas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_fluxo_pastas FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crm_fluxo_pastas TO authenticated;
DROP POLICY IF EXISTS "Approved manage crm_fluxo_pastas" ON public.crm_fluxo_pastas;
CREATE POLICY "Approved manage crm_fluxo_pastas" ON public.crm_fluxo_pastas FOR ALL TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));

-- 3) Foto da base (gatilho por segmento, modo "só os novos") -----------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_fluxo_base_vistos (
  fluxo_id      uuid NOT NULL REFERENCES public.crm_fluxos(id) ON DELETE CASCADE,
  chave         text NOT NULL,          -- seg:<segmento> | seg:lista:<origem> | data:...
  contact_phone text NOT NULL,          -- '__base__' = a foto já foi tirada
  visto_em      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fluxo_id, chave, contact_phone)
);
ALTER TABLE public.crm_fluxo_base_vistos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_fluxo_base_vistos FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.crm_fluxo_base_vistos TO authenticated;
DROP POLICY IF EXISTS "Approved read crm_fluxo_base_vistos" ON public.crm_fluxo_base_vistos;
CREATE POLICY "Approved read crm_fluxo_base_vistos" ON public.crm_fluxo_base_vistos FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

-- 4) Atendente do contato -----------------------------------------------------------------------------
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS atendente text;

-- 5) Índices de leitura da tela (histórico e logs por fluxo) -----------------------------------------
CREATE INDEX IF NOT EXISTS crm_log_fluxo_idx ON public.crm_automacao_log (fluxo_id, created_at DESC) WHERE fluxo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_fluxo_exec_iniciado_idx ON public.crm_fluxo_execucoes (fluxo_id, iniciado_em DESC);

-- 6) Resumo por fluxo (colunas da lista). SECURITY INVOKER: respeita o RLS de quem chama. ---------------
CREATE OR REPLACE FUNCTION public.crm_fluxos_resumo()
RETURNS TABLE (
  fluxo_id         uuid,
  total_inscritos  bigint,
  inscritos_ativos bigint,
  enviados         bigint,
  respondidos      bigint,
  falhas           bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT f.id,
         (SELECT count(*) FROM public.crm_fluxo_execucoes e WHERE e.fluxo_id = f.id),
         (SELECT count(*) FROM public.crm_fluxo_execucoes e WHERE e.fluxo_id = f.id AND e.status = 'ativo'),
         (SELECT count(*) FROM public.crm_automacao_log l WHERE l.fluxo_id = f.id AND l.status = 'ok' AND l.canal IN ('whatsapp', 'oficial')),
         (SELECT count(*) FROM public.crm_fluxo_execucoes e
           WHERE e.fluxo_id = f.id
             AND EXISTS (SELECT 1 FROM public.whatsapp_messages m
                          WHERE m.contact_phone = e.contact_phone AND m.direction = 'inbound' AND m.created_at > e.iniciado_em)),
         (SELECT count(*) FROM public.crm_automacao_log l WHERE l.fluxo_id = f.id AND l.status = 'erro')
    FROM public.crm_fluxos f;
$$;
REVOKE ALL ON FUNCTION public.crm_fluxos_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_fluxos_resumo() TO authenticated;

COMMIT;

-- =============================================================
-- Conferir:
--   SELECT nome, gatilho_tipo, jsonb_array_length(gatilhos) AS gatilhos, ativo, excluido_em FROM public.crm_fluxos;
--   SELECT * FROM public.crm_fluxos_resumo();
-- Desfazer só a parte visual não é preciso: as colunas novas são opcionais e o motor antigo as ignora.
-- =============================================================
