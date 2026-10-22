-- Testes da migration de etapas. Cada bloco dá NOTICE "ok: ..." ou levanta "FALHOU: ...".
\set ON_ERROR_STOP 1
DO $$ BEGIN
  IF (SELECT count(*) FROM public.crm_etapas WHERE sistema) <> 5 THEN RAISE EXCEPTION 'FALHOU: 5 etapas sistema'; END IF;
  IF (SELECT string_agg(slug, ',' ORDER BY ordem) FROM public.crm_etapas WHERE sistema) <> 'leads,contato,agendado,compareceu,fechou' THEN
    RAISE EXCEPTION 'FALHOU: ordem/slugs do seed'; END IF;
  RAISE NOTICE 'ok: seed com os 5 slugs reais na ordem';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.crm_etapas WHERE slug = 'pos_venda' AND NOT sistema AND ativo AND ordem = 6) THEN
    RAISE EXCEPTION 'FALHOU: stage extra existente virou etapa'; END IF;
  IF EXISTS (SELECT 1 FROM public.crm_etapas WHERE slug ILIKE '%lixo%') THEN RAISE EXCEPTION 'FALHOU: stage fora do formato não entra'; END IF;
  IF (SELECT count(*) FROM public.whatsapp_contacts) <> 7 OR NOT EXISTS (SELECT 1 FROM public.whatsapp_contacts WHERE stage = 'Lixo Antigo') THEN
    RAISE EXCEPTION 'FALHOU: dado de contato preservado'; END IF;
  RAISE NOTICE 'ok: stage extra vira etapa, dado antigo intacto';
END $$;

DO $$ BEGIN
  IF (SELECT convalidated FROM pg_constraint WHERE conname = 'whatsapp_contacts_stage_fkey') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FALHOU: FK de whatsapp_contacts NOT VALID (tem stage fora do formato)'; END IF;
  IF (SELECT convalidated FROM pg_constraint WHERE conname = 'ig_contatos_stage_fkey') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FALHOU: FK de ig_contatos validada'; END IF;
  IF (SELECT convalidated FROM pg_constraint WHERE conname = 'crm_roteiros_stage_fkey') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FALHOU: FK de crm_roteiros validada'; END IF;
  RAISE NOTICE 'ok: FKs criadas (whatsapp NOT VALID por causa do dado antigo)';
END $$;

-- escrita nova com stage inexistente é barrada; linha antiga fora do formato continua editável (nome)
DO $$ BEGIN
  BEGIN
    INSERT INTO public.whatsapp_contacts (phone, stage) VALUES ('99', 'nao_existe');
    RAISE EXCEPTION 'FALHOU: stage inexistente aceito';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  UPDATE public.whatsapp_contacts SET name = 'ok' WHERE phone = '7';
  INSERT INTO public.whatsapp_contacts (phone, stage) VALUES ('98', 'pos_venda');
  DELETE FROM public.whatsapp_contacts WHERE phone = '98';
  IF NOT public.crm_etapa_valida('pos_venda') OR public.crm_etapa_valida('nao_existe') THEN RAISE EXCEPTION 'FALHOU: crm_etapa_valida'; END IF;
  RAISE NOTICE 'ok: FK barra stage inexistente, aceita etapa nova, crm_etapa_valida responde';
END $$;

-- guarda: sistema não arquiva/apaga, slug imutável, renomear/reordenar pode
DO $$ BEGIN
  BEGIN UPDATE public.crm_etapas SET ativo = false WHERE slug = 'leads'; RAISE EXCEPTION 'FALHOU: arquivou sistema';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN DELETE FROM public.crm_etapas WHERE slug = 'fechou'; RAISE EXCEPTION 'FALHOU: apagou sistema';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.crm_etapas SET slug = 'novo' WHERE slug = 'contato'; RAISE EXCEPTION 'FALHOU: mudou slug';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.crm_etapas SET sistema = false WHERE slug = 'contato'; RAISE EXCEPTION 'FALHOU: tirou sistema';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.crm_etapas SET nome = '  Conversando  ', ordem = 9 WHERE slug = 'contato';
  IF (SELECT nome FROM public.crm_etapas WHERE slug = 'contato') <> 'Conversando' THEN RAISE EXCEPTION 'FALHOU: renomear'; END IF;
  RAISE NOTICE 'ok: sistema renomeia/reordena, não arquiva/apaga/muda slug';
END $$;

-- arquivar não-sistema: com contato não; sem contato sim; apagar etapa em uso: FK barra
DO $$ BEGIN
  BEGIN UPDATE public.crm_etapas SET ativo = false WHERE slug = 'pos_venda'; RAISE EXCEPTION 'FALHOU: arquivou com contato';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN DELETE FROM public.crm_etapas WHERE slug = 'pos_venda'; RAISE EXCEPTION 'FALHOU: apagou etapa em uso';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  INSERT INTO public.crm_etapas (slug, nome, ordem) VALUES ('vazia', 'Vazia', 20);
  UPDATE public.crm_etapas SET ativo = false WHERE slug = 'vazia';
  IF (SELECT ativo FROM public.crm_etapas WHERE slug = 'vazia') THEN RAISE EXCEPTION 'FALHOU: arquivar vazia'; END IF;
  -- contato do Instagram também conta
  UPDATE public.whatsapp_contacts SET stage = 'leads' WHERE stage = 'pos_venda';
  BEGIN UPDATE public.crm_etapas SET ativo = false WHERE slug = 'pos_venda'; RAISE EXCEPTION 'FALHOU: ignorou ig_contatos';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE 'ok: arquivar só sem contato (WhatsApp e Instagram); FK barra apagar em uso';
END $$;

-- RLS: aprovado lê, não edita; admin edita; usuário logado não cria etapa sistema
SELECT set_config('teste.u', gen_random_uuid()::text, false);
UPDATE auth.sessao SET uid = current_setting('teste.u')::uuid, admin = false;
SET ROLE authenticated;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.crm_etapas;
  IF n < 6 THEN RAISE EXCEPTION 'FALHOU: aprovado lê (viu %)', n; END IF;
  UPDATE public.crm_etapas SET nome = 'Hack' WHERE slug = 'leads';
  IF (SELECT nome FROM public.crm_etapas WHERE slug = 'leads') = 'Hack' THEN RAISE EXCEPTION 'FALHOU: não-admin editou'; END IF;
  BEGIN INSERT INTO public.crm_etapas (slug, nome) VALUES ('x1', 'X1'); RAISE EXCEPTION 'FALHOU: não-admin criou';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'ok: aprovado lê e não edita';
END $$;
RESET ROLE;
UPDATE auth.sessao SET admin = true;
SET ROLE authenticated;
DO $$ BEGIN
  UPDATE public.crm_etapas SET nome = 'Novos' WHERE slug = 'leads';
  IF (SELECT nome FROM public.crm_etapas WHERE slug = 'leads') <> 'Novos' THEN RAISE EXCEPTION 'FALHOU: admin renomeia'; END IF;
  INSERT INTO public.crm_etapas (slug, nome, cor, ordem, sistema) VALUES ('proposta', 'Proposta', '#ff0000', 30, true);
  IF (SELECT sistema FROM public.crm_etapas WHERE slug = 'proposta') THEN RAISE EXCEPTION 'FALHOU: usuário criou etapa sistema'; END IF;
  RAISE NOTICE 'ok: admin cria/renomeia; sistema=true do usuário é ignorado';
END $$;
RESET ROLE;
UPDATE auth.sessao SET uid = NULL, admin = false;
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.crm_etapas; RAISE EXCEPTION 'FALHOU: anon leu';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'ok: anon sem acesso';
END $$;
RESET ROLE;

-- idempotência: reaplicar não muda nome renomeado nem duplica
\i :mig
DO $$ BEGIN
  IF (SELECT nome FROM public.crm_etapas WHERE slug = 'leads') <> 'Novos' THEN RAISE EXCEPTION 'FALHOU: reaplicar sobrescreveu nome'; END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conname LIKE '%_stage_fkey') <> 3 THEN RAISE EXCEPTION 'FALHOU: FK duplicada'; END IF;
  RAISE NOTICE 'ok: reaplicar preserva edição e não duplica FK';
END $$;
