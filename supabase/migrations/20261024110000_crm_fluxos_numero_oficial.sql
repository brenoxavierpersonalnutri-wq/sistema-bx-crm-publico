-- Espelhos do Full Funnel (crm_fluxos com origem_ff_workflow_id) e o catálogo crm_wa_templates apontam para o
-- número OFICIAL (31) 7000-0102 da Central (crm_numeros, migration 20261024100000).
-- Roda depois da 20261023120000 e da 20261024100000. Idempotente; sem crm_numeros/crm_fluxos, não faz nada.
DO $$
DECLARE
  v_oficial uuid;
BEGIN
  IF to_regclass('public.crm_numeros') IS NULL OR to_regclass('public.crm_fluxos') IS NULL THEN
    RAISE NOTICE 'crm_numeros ou crm_fluxos ausente: nada a fazer';
    RETURN;
  END IF;
  EXECUTE $q$SELECT id FROM public.crm_numeros
             WHERE regexp_replace(coalesce(telefone, ''), '\D', '', 'g') LIKE '%3170000102'
             ORDER BY (tipo = 'oficial') DESC LIMIT 1$q$ INTO v_oficial;
  IF v_oficial IS NULL THEN
    RAISE NOTICE 'número oficial (31) 7000-0102 não cadastrado em crm_numeros';
    RETURN;
  END IF;
  UPDATE public.crm_fluxos SET numero_id = v_oficial WHERE origem_ff_workflow_id IS NOT NULL AND numero_id IS NULL;
  IF to_regclass('public.crm_wa_templates') IS NOT NULL THEN
    UPDATE public.crm_wa_templates SET numero_id = v_oficial WHERE origem = 'fullfunnel' AND numero_id IS NULL;
  END IF;
END $$;
