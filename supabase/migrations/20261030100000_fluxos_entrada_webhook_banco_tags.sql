-- =============================================================
-- CRM > Fluxos: gatilho "Webhook / API (entrada)", gatilho "Novo lead no banco de dados", lista de eventos
-- para o gatilho "Formulário / evento" e catálogo de tags (seletor com "+ Criar tag").
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente. NÃO apaga dado. NÃO envia mensagem.
--
-- 1) crm_fluxo_entradas: uma URL de entrada por fluxo (edge function fluxo-entrada, verify_jwt = false).
--    id_publico + token gerados AQUI (ninguém digita). Só ADMIN lê/edita (o token é o segredo da URL).
--    Rate limit por janela de 1 minuto (crm_fluxo_entrada_bater, só service_role). Assinatura HMAC opcional.
-- 2) Eventos do banco: trigger AFTER INSERT em lead_form_responses, consultations, sales_events (PagTrust),
--    base_leads e whatsapp_contacts grava em crm_contato_eventos o evento banco_<fonte> SÓ quando existe
--    fluxo LIGADO ouvindo (crm_evento_tem_ouvinte). Base antiga nunca entra: o evento nasce no INSERT e o
--    motor só lê evento posterior a max(ligado_em, criado_em do gatilho). Trigger nunca derruba a gravação.
--    Formulário de site de cliente (base_leads_form_de_cliente) NÃO gera evento (mesmo isolamento da base).
--    O formulário também produz lead_qualificado (nível ≠ DQ), que estava sem produtor.
-- 3) crm_eventos_disponiveis(): eventos já vistos (inclui os wh_* vindos de webhook) para a tela escolher.
-- 4) crm_tags + crm_tags_existentes() + crm_tag_criar(): tags que já existem no sistema, com contagem de uso.
--
-- DEPOIS DE RODAR: publicar as edge functions fluxo-entrada (nova) e crm-automacoes (motor com os gatilhos novos).
-- Desligar a entrada de um fluxo: UPDATE public.crm_fluxo_entradas SET ativo = false WHERE fluxo_id = '...';
-- =============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1) Entrada por webhook -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_fluxo_entradas (
  fluxo_id            uuid PRIMARY KEY REFERENCES public.crm_fluxos(id) ON DELETE CASCADE,
  id_publico          text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(9), 'hex'),
  token               text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  segredo_assinatura  text,                                    -- null = sem assinatura
  ativo               boolean NOT NULL DEFAULT true,
  mapeamento          jsonb NOT NULL DEFAULT '{}'::jsonb,       -- {"telefone":"buyer.phone","nome":"...",...}
  tags                text[] NOT NULL DEFAULT '{}',             -- tags aplicadas em todo lead desta entrada
  origem              text NOT NULL DEFAULT 'webhook:fluxo',    -- base_leads.origem (fixo na criação)
  limite_minuto       integer NOT NULL DEFAULT 60 CHECK (limite_minuto BETWEEN 1 AND 600),
  janela_inicio       timestamptz,
  janela_qtd          integer NOT NULL DEFAULT 0,
  total               integer NOT NULL DEFAULT 0,
  ultima_amostra      jsonb,                                    -- corpo da última requisição (cortado)
  ultima_em           timestamptz,
  ultimo_status       text,                                     -- ok | erro | recusado | limite | rascunho
  ultimo_erro         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_fluxo_entradas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_fluxo_entradas FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.crm_fluxo_entradas TO authenticated;
GRANT ALL ON TABLE public.crm_fluxo_entradas TO service_role;
DROP POLICY IF EXISTS "Admin gerencia crm_fluxo_entradas" ON public.crm_fluxo_entradas;
CREATE POLICY "Admin gerencia crm_fluxo_entradas" ON public.crm_fluxo_entradas FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- token e assinatura: só pelo servidor (o admin não escolhe o valor)
CREATE OR REPLACE FUNCTION public.crm_fluxo_entrada_novo_token(p_fluxo uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v text := encode(extensions.gen_random_bytes(24), 'hex');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'só admin'; END IF;
  UPDATE public.crm_fluxo_entradas SET token = v, updated_at = now() WHERE fluxo_id = p_fluxo;
  IF NOT FOUND THEN RAISE EXCEPTION 'entrada não existe'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.crm_fluxo_entrada_novo_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_fluxo_entrada_novo_token(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_fluxo_entrada_assinatura(p_fluxo uuid, p_ligar boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v text := CASE WHEN p_ligar THEN encode(extensions.gen_random_bytes(24), 'hex') END;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'só admin'; END IF;
  UPDATE public.crm_fluxo_entradas SET segredo_assinatura = v, updated_at = now() WHERE fluxo_id = p_fluxo;
  IF NOT FOUND THEN RAISE EXCEPTION 'entrada não existe'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.crm_fluxo_entrada_assinatura(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_fluxo_entrada_assinatura(uuid, boolean) TO authenticated;

-- rate limit atômico (janela fixa de 1 min); true = pode processar
CREATE OR REPLACE FUNCTION public.crm_fluxo_entrada_bater(p_id_publico text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
  UPDATE public.crm_fluxo_entradas
     SET janela_inicio = CASE WHEN janela_inicio IS NULL OR janela_inicio < now() - interval '1 minute' THEN now() ELSE janela_inicio END,
         janela_qtd    = CASE WHEN janela_inicio IS NULL OR janela_inicio < now() - interval '1 minute' THEN 1 ELSE janela_qtd + 1 END
   WHERE id_publico = p_id_publico
  RETURNING janela_qtd <= limite_minuto INTO ok;
  RETURN coalesce(ok, false);
END $$;
REVOKE ALL ON FUNCTION public.crm_fluxo_entrada_bater(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_fluxo_entrada_bater(text) TO service_role;

-- 2) Eventos do banco ----------------------------------------------------------------------------------
-- Existe fluxo LIGADO ouvindo este evento (gatilho banco da fonte, ou gatilho evento com este nome)?
CREATE OR REPLACE FUNCTION public.crm_evento_tem_ouvinte(p_evento text, p_fonte text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_fluxos f
     WHERE f.ativo AND f.excluido_em IS NULL
       AND (
         (p_fonte IS NOT NULL AND f.gatilhos @> jsonb_build_array(jsonb_build_object('tipo', 'banco', 'fonte', p_fonte)))
         OR f.gatilhos @> jsonb_build_array(jsonb_build_object('tipo', 'evento', 'valor', p_evento))
         OR (f.gatilhos = '[]'::jsonb AND f.gatilho_tipo = 'evento' AND f.gatilho_valor = p_evento)
       )
  )
$$;
REVOKE ALL ON FUNCTION public.crm_evento_tem_ouvinte(text, text) FROM PUBLIC, anon, authenticated;

-- grava o evento (telefone já em dígitos com DDI); não cria contato (o motor cria só de quem entrar)
CREATE OR REPLACE FUNCTION public.crm_evento_banco(p_phone text, p_evento text, p_fonte text, p_dados jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
BEGIN
  IF length(v) < 10 OR length(v) > 15 THEN RETURN; END IF;
  IF NOT public.crm_evento_tem_ouvinte(p_evento, p_fonte) THEN RETURN; END IF;
  INSERT INTO public.crm_contato_eventos (contact_phone, tipo, valor, dados)
  VALUES (v, 'evento', p_evento, jsonb_strip_nulls(coalesce(p_dados, '{}'::jsonb)));
END $$;
REVOKE ALL ON FUNCTION public.crm_evento_banco(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_evt_formulario()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fone text;
  v_dados jsonb;
BEGIN
  IF public.base_leads_form_de_cliente(NEW) THEN RETURN NEW; END IF; -- lead de site de cliente não é do Breno
  v_fone := public.base_leads_tel_e164(NEW.telefone);
  IF v_fone IS NULL THEN RETURN NEW; END IF;
  v_dados := jsonb_build_object(
    'nivel', NEW.nivel, 'origem', CASE WHEN NEW.origem = 'individual' THEN 'individual' ELSE 'avaliacao' END,
    'nome', nullif(btrim(NEW.nome), ''), 'email', public.base_leads_email(NEW.email), 'score', NEW.score,
    'formulario_id', NEW.id, 'utm_source', NEW.utm_source, 'utm_campaign', NEW.utm_campaign);
  PERFORM public.crm_evento_banco(v_fone, 'banco_formulario', 'formulario', v_dados);
  IF coalesce(NEW.nivel, 'DQ') <> 'DQ' THEN
    PERFORM public.crm_evento_banco(v_fone, 'lead_qualificado', NULL, v_dados);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'crm_evt_formulario: %', SQLERRM;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_crm_evt_formulario ON public.lead_form_responses;
CREATE TRIGGER trg_crm_evt_formulario AFTER INSERT ON public.lead_form_responses
FOR EACH ROW EXECUTE FUNCTION public.crm_evt_formulario();

CREATE OR REPLACE FUNCTION public.crm_evt_agendamento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fone text := public.base_leads_tel_e164(NEW.client_phone);
BEGIN
  IF v_fone IS NULL THEN RETURN NEW; END IF;
  PERFORM public.crm_evento_banco(v_fone, 'banco_agendamento', 'agendamento', jsonb_build_object(
    'origem', lower(coalesce(NEW.via, '')), 'nome', nullif(btrim(NEW.client_name), ''),
    'email', public.base_leads_email(NEW.client_email), 'data', NEW.date, 'horario', NEW.start_time,
    'status', NEW.status, 'tipo', NEW.event_type_name, 'agendamento_id', NEW.id));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'crm_evt_agendamento: %', SQLERRM;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_crm_evt_agendamento ON public.consultations;
CREATE TRIGGER trg_crm_evt_agendamento AFTER INSERT ON public.consultations
FOR EACH ROW EXECUTE FUNCTION public.crm_evt_agendamento();

-- compra aprovada do PagTrust: o webhook já existente grava sales_events (valor > 0 = venda; < 0 = estorno)
CREATE OR REPLACE FUNCTION public.crm_evt_compra()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fone text := public.base_leads_tel_e164(NEW.customer_phone);
BEGIN
  IF v_fone IS NULL OR coalesce(NEW.value, 0) <= 0 OR coalesce(NEW.source, '') NOT ILIKE 'PAGTRUST%' THEN RETURN NEW; END IF;
  PERFORM public.crm_evento_banco(v_fone, 'banco_compra', 'compra', jsonb_build_object(
    'origem', lower(NEW.source), 'valor', NEW.value, 'email', public.base_leads_email(NEW.customer_email)));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'crm_evt_compra: %', SQLERRM;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_crm_evt_compra ON public.sales_events;
CREATE TRIGGER trg_crm_evt_compra AFTER INSERT ON public.sales_events
FOR EACH ROW EXECUTE FUNCTION public.crm_evt_compra();

CREATE OR REPLACE FUNCTION public.crm_evt_base_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fone text := public.base_leads_tel_e164(NEW.telefone_e164);
BEGIN
  IF v_fone IS NULL THEN RETURN NEW; END IF;
  PERFORM public.crm_evento_banco(v_fone, 'banco_base_leads', 'base_leads', jsonb_build_object(
    'origem', lower(NEW.origem), 'nivel', NEW.nivel, 'nome', nullif(btrim(NEW.nome), ''),
    'email', public.base_leads_email(NEW.email), 'produto', NEW.produto, 'tags', array_to_string(NEW.tags, ',')));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'crm_evt_base_lead: %', SQLERRM;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_crm_evt_base_lead ON public.base_leads;
CREATE TRIGGER trg_crm_evt_base_lead AFTER INSERT ON public.base_leads
FOR EACH ROW EXECUTE FUNCTION public.crm_evt_base_lead();

CREATE OR REPLACE FUNCTION public.crm_evt_contato_whatsapp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(NEW.is_group, false) OR NEW.phone LIKE '%@%' THEN RETURN NEW; END IF;
  PERFORM public.crm_evento_banco(NEW.phone, 'banco_contato_whatsapp', 'contato_whatsapp', jsonb_build_object(
    'origem', lower(coalesce(NEW.source, '')), 'nome', nullif(btrim(NEW.name), ''), 'numero_id', NEW.numero_id));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'crm_evt_contato_whatsapp: %', SQLERRM;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_crm_evt_contato_whatsapp ON public.whatsapp_contacts;
CREATE TRIGGER trg_crm_evt_contato_whatsapp AFTER INSERT ON public.whatsapp_contacts
FOR EACH ROW EXECUTE FUNCTION public.crm_evt_contato_whatsapp();

REVOKE ALL ON FUNCTION public.crm_evt_formulario(), public.crm_evt_agendamento(), public.crm_evt_compra(),
  public.crm_evt_base_lead(), public.crm_evt_contato_whatsapp() FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS crm_contato_eventos_valor_idx ON public.crm_contato_eventos (tipo, valor, created_at);

-- 3) Eventos disponíveis para o gatilho "Formulário / evento" -----------------------------------------
CREATE OR REPLACE FUNCTION public.crm_eventos_disponiveis()
RETURNS TABLE (valor text, total bigint, ultimo timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.valor, count(*), max(e.created_at)
    FROM public.crm_contato_eventos e
   WHERE public.is_approved(auth.uid())
     AND e.tipo = 'evento'
     AND e.created_at > now() - interval '180 days'
     AND e.valor !~ '^webhook_[0-9a-f]{32}$'   -- evento interno da URL de cada fluxo
   GROUP BY e.valor
   ORDER BY max(e.created_at) DESC
   LIMIT 200
$$;
REVOKE ALL ON FUNCTION public.crm_eventos_disponiveis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_eventos_disponiveis() TO authenticated;

-- 4) Tags ----------------------------------------------------------------------------------------------
-- mesma regra de src normalizarTag: minúsculas, sem acento, [a-z0-9_-], hífen no lugar do resto, até 40
CREATE OR REPLACE FUNCTION public.crm_tag_normalizar(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT left(regexp_replace(regexp_replace(
    lower(translate(btrim(coalesce(p, '')), 'ÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝáàâãäåéèêëíìîïóòôõöúùûüçñý',
                                            'AAAAAAEEEEIIIIOOOOOUUUUCNYaaaaaaeeeeiiiiooooouuuucny')),
    '[^a-z0-9_-]+', '-', 'g'), '^-+|-+$', '', 'g'), 40)
$$;

CREATE TABLE IF NOT EXISTS public.crm_tags (
  nome        text PRIMARY KEY CHECK (nome ~ '^[a-z0-9_-]{1,40}$'),
  criado_por  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_tags FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.crm_tags TO authenticated;
DROP POLICY IF EXISTS "Aprovados leem crm_tags" ON public.crm_tags;
CREATE POLICY "Aprovados leem crm_tags" ON public.crm_tags FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Aprovados criam crm_tags" ON public.crm_tags;
CREATE POLICY "Aprovados criam crm_tags" ON public.crm_tags FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));

CREATE OR REPLACE FUNCTION public.crm_tag_criar(p_nome text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v text := public.crm_tag_normalizar(p_nome);
BEGIN
  IF NOT public.is_approved(auth.uid()) THEN RAISE EXCEPTION 'sem acesso'; END IF;
  IF v = '' THEN RAISE EXCEPTION 'tag vazia'; END IF;
  INSERT INTO public.crm_tags (nome) VALUES (v) ON CONFLICT (nome) DO NOTHING;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.crm_tag_criar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_tag_criar(text) TO authenticated;

-- tags que já existem: contatos do WhatsApp, base de leads, fluxos (gatilho/passo/condição), segmentos
-- e o catálogo; uso = em quantos contatos/leads aparece (fluxo/segmento/catálogo contam 0);
-- variantes = as grafias gravadas de fato ("Comprou", "comprou"): filtro exato do Banco usa todas
DROP FUNCTION IF EXISTS public.crm_tags_existentes();
CREATE OR REPLACE FUNCTION public.crm_tags_existentes()
RETURNS TABLE (tag text, uso bigint, variantes text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH todas AS (
    SELECT unnest(c.tags) AS t, 1 AS n FROM public.whatsapp_contacts c WHERE coalesce(c.is_group, false) = false
    UNION ALL SELECT unnest(b.tags), 1 FROM public.base_leads b
    UNION ALL SELECT jsonb_path_query(f.gatilhos, '$[*] ? (@.tipo == "tag").valor') #>> '{}', 0 FROM public.crm_fluxos f WHERE f.excluido_em IS NULL
    UNION ALL SELECT jsonb_path_query(f.gatilhos, '$[*] ? (@.tipo == "data").tag') #>> '{}', 0 FROM public.crm_fluxos f WHERE f.excluido_em IS NULL
    UNION ALL SELECT jsonb_path_query(f.passos, '$[*] ? (@.tipo == "tag").tag') #>> '{}', 0 FROM public.crm_fluxos f WHERE f.excluido_em IS NULL
    UNION ALL SELECT jsonb_path_query(f.passos, '$[*].condicao ? (@.tipo == "tem_tag").valor') #>> '{}', 0 FROM public.crm_fluxos f WHERE f.excluido_em IS NULL
    UNION ALL SELECT jsonb_path_query(s.filtro, '$.tags[*]') #>> '{}', 0 FROM public.crm_segmentos s
    UNION ALL SELECT x.nome, 0 FROM public.crm_tags x
  )
  SELECT public.crm_tag_normalizar(t) AS tag, sum(n)::bigint AS uso, array_agg(DISTINCT t ORDER BY t) AS variantes
    FROM todas
   WHERE public.is_approved(auth.uid()) AND public.crm_tag_normalizar(t) <> ''
   GROUP BY 1
   ORDER BY 2 DESC, 1
   LIMIT 2000
$$;
REVOKE ALL ON FUNCTION public.crm_tags_existentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_tags_existentes() TO authenticated;

-- 5) Filtro de tag do Banco (crm_segmento_listar, migration 20261029110000): aceita também as grafias
--    gravadas da tag escolhida no seletor (p_filtros.tagVariantes), porque o filtro é exato ("nivel-A").
--    Troca só a linha do filtro; idempotente; sem a função (migration anterior pendente) não faz nada.
DO $$
DECLARE
  r record;
  def text;
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'crm_segmento_listar'
       AND p.prosrc LIKE '%m.tags && ARRAY[v_tag])%' AND p.prosrc NOT LIKE '%tagVariantes%'
  LOOP
    def := pg_get_functiondef(r.oid);
    def := replace(def, 'm.tags && ARRAY[v_tag])',
      'm.tags && (ARRAY[v_tag] || ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(t->''tagVariantes'') = ''array'' THEN t->''tagVariantes'' ELSE ''[]'' END))))');
    EXECUTE def;
  END LOOP;
END $$;

COMMIT;

-- Conferir depois de rodar:
--   SELECT * FROM public.crm_tags_existentes() LIMIT 20;
--   SELECT * FROM public.crm_eventos_disponiveis();
--   SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_crm_evt_%';   -- 5 linhas
