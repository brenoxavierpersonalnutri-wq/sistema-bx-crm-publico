-- =============================================================
-- DISPARO EM GRUPO (seção /crm/disparo-grupos) — 20/10/2026
-- Rodar inteiro no SQL editor do Lovable Cloud DEPOIS de 20261024130000_grupos_whatsapp.sql e
-- 20261106100000_grupos_fluxo_campanha.sql. Idempotente (pode rodar de novo). Não apaga dado.
--
-- O QUE ACRESCENTA
--  1. Disparo para grupos escolhidos: grupos_mensagens.grupos_alvo (null = todos da campanha, como antes)
--     e disparo_id (junta as mensagens de um mesmo disparo feito em várias campanhas).
--  2. Grupos que JÁ EXISTEM no WhatsApp do número: link_convite passa a ser opcional (grupo importado
--     sem convite recebe disparo e configuração, mas fica fora do link /g/<slug>), e o CRM guarda o que
--     o número pode fazer no grupo (sou_admin, anuncio = só admins enviam), lido do proxy.
--  3. Campanha "Avulsos" por número (avulsa = true): onde caem os grupos importados sem campanha.
--     Nasce com link pausado e sem criação automática.
--  4. Modo de distribuição do link: 'encher' (um por vez, como antes) ou 'split' (reparte as entradas
--     entre os grupos com vaga, pelo menor ocupação/peso). peso por grupo (1-100).
--  5. Criação de grupo agendada: grupos_campanhas.criacao_agendada_para (o disparador cria o próximo
--     grupo nessa hora, uma vez) e o tick do pg_cron acorda para isso.
--
-- NADA LIGA SOZINHO: modo padrão continua 'encher', grupos_alvo nulo = comportamento antigo.
-- =============================================================

BEGIN;

-- 1) Campanha -----------------------------------------------------------------------------------
ALTER TABLE public.grupos_campanhas
  ADD COLUMN IF NOT EXISTS avulsa                 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS modo_distribuicao      text    NOT NULL DEFAULT 'encher',
  ADD COLUMN IF NOT EXISTS criacao_agendada_para  timestamptz;

ALTER TABLE public.grupos_campanhas DROP CONSTRAINT IF EXISTS grupos_campanhas_modo_ok;
ALTER TABLE public.grupos_campanhas ADD CONSTRAINT grupos_campanhas_modo_ok
  CHECK (modo_distribuicao IN ('encher', 'split'));

-- uma campanha Avulsos por número (numero_id NULL = sessão padrão)
CREATE UNIQUE INDEX IF NOT EXISTS grupos_campanhas_avulsa_numero_uq
  ON public.grupos_campanhas ((coalesce(numero_id::text, 'padrao'))) WHERE avulsa;
CREATE INDEX IF NOT EXISTS grupos_campanhas_criacao_agendada_idx
  ON public.grupos_campanhas (criacao_agendada_para) WHERE criacao_agendada_para IS NOT NULL;

-- 2) Grupo --------------------------------------------------------------------------------------
ALTER TABLE public.grupos_campanha_grupos ALTER COLUMN link_convite DROP NOT NULL;
ALTER TABLE public.grupos_campanha_grupos
  ADD COLUMN IF NOT EXISTS peso           integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS importado      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sou_admin      boolean,
  ADD COLUMN IF NOT EXISTS anuncio        boolean,
  ADD COLUMN IF NOT EXISTS permissao_em   timestamptz;
ALTER TABLE public.grupos_campanha_grupos DROP CONSTRAINT IF EXISTS grupos_campanha_grupos_peso_ok;
ALTER TABLE public.grupos_campanha_grupos ADD CONSTRAINT grupos_campanha_grupos_peso_ok CHECK (peso BETWEEN 1 AND 100);
-- grupo sem convite precisa do id (senão não serve pra nada)
ALTER TABLE public.grupos_campanha_grupos DROP CONSTRAINT IF EXISTS grupos_campanha_grupos_link_ou_id;
ALTER TABLE public.grupos_campanha_grupos ADD CONSTRAINT grupos_campanha_grupos_link_ou_id
  CHECK (link_convite IS NOT NULL OR chat_id IS NOT NULL);
-- o mesmo grupo (id) uma vez por campanha
CREATE UNIQUE INDEX IF NOT EXISTS grupos_campanha_grupos_chat_uq
  ON public.grupos_campanha_grupos (campanha_id, chat_id) WHERE chat_id IS NOT NULL;

-- 3) Mensagem: grupos escolhidos e disparo ------------------------------------------------------
ALTER TABLE public.grupos_mensagens
  ADD COLUMN IF NOT EXISTS grupos_alvo  uuid[],
  ADD COLUMN IF NOT EXISTS disparo_id   uuid;
ALTER TABLE public.grupos_mensagens DROP CONSTRAINT IF EXISTS grupos_mensagens_alvo_ok;
ALTER TABLE public.grupos_mensagens ADD CONSTRAINT grupos_mensagens_alvo_ok
  CHECK (grupos_alvo IS NULL OR cardinality(grupos_alvo) BETWEEN 1 AND 200);
CREATE INDEX IF NOT EXISTS grupos_mensagens_disparo_idx ON public.grupos_mensagens (disparo_id) WHERE disparo_id IS NOT NULL;

-- 4) Campanha Avulsos do número (cria na primeira vez; RLS de aprovados vale, é SECURITY INVOKER) --
CREATE OR REPLACE FUNCTION public.grupos_campanha_avulsa(p_numero uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id   uuid;
  v_slug text := 'avulsos-' || coalesce(left(replace(p_numero::text, '-', ''), 12), 'padrao');
BEGIN
  SELECT id INTO v_id FROM public.grupos_campanhas
   WHERE avulsa AND coalesce(numero_id::text, 'padrao') = coalesce(p_numero::text, 'padrao') LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  BEGIN
    INSERT INTO public.grupos_campanhas (nome, slug, numero_id, avulsa, link_pausado, disparos_pausados, auto_criar)
    VALUES ('Avulsos', v_slug, p_numero, true, true, false, false)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.grupos_campanhas
     WHERE avulsa AND coalesce(numero_id::text, 'padrao') = coalesce(p_numero::text, 'padrao') LIMIT 1;
  END;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.grupos_campanha_avulsa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grupos_campanha_avulsa(uuid) TO authenticated, service_role;

-- 5) Link público com modo de distribuição -----------------------------------------------------
-- igual à versão de 20261106100000 (com o ON CONFLICT de whatsapp_contacts sem alvo), mais: grupo sem link fica de fora; modo 'split' escolhe o de menor
-- ocupação/peso (empate: ordem). Mesma regra de escolherGrupoSplit() em _shared/grupos.ts.
CREATE OR REPLACE FUNCTION public.grupos_resolver_link(
  p_slug  text,
  p_tel   text DEFAULT NULL,
  p_nome  text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_utm   jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c        public.grupos_campanhas%ROWTYPE;
  g        public.grupos_campanha_grupos%ROWTYPE;
  v_tel    text;
  v_wa     text;
  v_tag    text;
  v_utm    jsonb := '{}'::jsonb;
  v_nome   text := nullif(left(trim(coalesce(p_nome, '')), 120), '');
  v_email  text;
  v_existe text;
  v_teto   int;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$' THEN
    RETURN jsonb_build_object('erro', 'nao_encontrada');
  END IF;
  SELECT * INTO c FROM public.grupos_campanhas WHERE slug = p_slug AND NOT encerrada FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('erro', 'nao_encontrada'); END IF;

  IF jsonb_typeof(p_utm) = 'object' AND length(p_utm::text) <= 2000 THEN
    SELECT coalesce(jsonb_object_agg(k, left(v, 200)), '{}'::jsonb) INTO v_utm
      FROM jsonb_each_text(p_utm) AS e(k, v)
     WHERE k IN ('utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'origem');
  END IF;
  v_tel := public.grupos_tel_e164(p_tel);

  IF c.link_pausado THEN
    INSERT INTO public.grupos_cliques (campanha_id, resultado, telefone_e164, utm) VALUES (c.id, 'pausado', v_tel, v_utm);
    RETURN jsonb_build_object('erro', 'pausado', 'url', c.url_lotado);
  END IF;

  v_teto := least(greatest(c.limite_por_grupo, 1), 1024);
  IF c.modo_distribuicao = 'split' THEN
    SELECT * INTO g FROM public.grupos_campanha_grupos
     WHERE campanha_id = c.id AND ativo AND NOT cheio AND link_convite IS NOT NULL
       AND coalesce(participantes, 0) + greatest(cliques - cliques_na_contagem, 0) < v_teto
     ORDER BY (coalesce(participantes, 0) + greatest(cliques - cliques_na_contagem, 0))::numeric
              / least(greatest(peso, 1), 100),
              ordem, created_at, id
     LIMIT 1;
  ELSE
    SELECT * INTO g FROM public.grupos_campanha_grupos
     WHERE campanha_id = c.id AND ativo AND NOT cheio AND link_convite IS NOT NULL
       AND coalesce(participantes, 0) + greatest(cliques - cliques_na_contagem, 0) < v_teto
     ORDER BY ordem, created_at, id
     LIMIT 1;
  END IF;
  IF NOT FOUND THEN
    INSERT INTO public.grupos_cliques (campanha_id, resultado, telefone_e164, utm) VALUES (c.id, 'lotado', v_tel, v_utm);
    RETURN jsonb_build_object('erro', 'lotado', 'url', c.url_lotado,
      'criando', c.auto_criar AND (SELECT count(*) FROM public.grupos_campanha_grupos WHERE campanha_id = c.id) < c.max_grupos);
  END IF;

  UPDATE public.grupos_campanha_grupos SET cliques = cliques + 1 WHERE id = g.id;
  INSERT INTO public.grupos_cliques (campanha_id, grupo_id, resultado, telefone_e164, utm)
  VALUES (c.id, g.id, 'grupo', v_tel, v_utm);

  IF v_tel IS NOT NULL AND (
       SELECT count(*) FROM public.grupos_cliques
        WHERE campanha_id = c.id AND telefone_e164 IS NOT NULL AND created_at > now() - interval '1 minute'
     ) <= 300 THEN
    BEGIN
      v_tag := coalesce(nullif(trim(c.tag), ''), 'grupo-' || c.slug);
      v_email := CASE WHEN position('@' IN coalesce(p_email, '')) > 1 AND length(p_email) <= 200 THEN lower(trim(p_email)) END;

      INSERT INTO public.base_leads (origem, origem_id, nome, telefone_e164, email, tags, produto, status, criado_origem)
      VALUES ('grupo_whatsapp', c.slug || ':' || v_tel, v_nome, v_tel, v_email,
              ARRAY[v_tag, 'grupo-whatsapp'], c.nome, 'clicou_link_grupo', now())
      ON CONFLICT (origem, origem_id) DO UPDATE SET
        nome  = coalesce(EXCLUDED.nome, public.base_leads.nome),
        email = coalesce(EXCLUDED.email, public.base_leads.email);

      v_wa := substr(v_tel, 2);
      SELECT phone INTO v_existe FROM public.whatsapp_contacts
       WHERE phone ~ '^55\d{10,11}$' AND substr(phone, 3, 2) = substr(v_wa, 3, 2) AND right(phone, 8) = right(v_wa, 8)
       ORDER BY (phone = v_wa) DESC LIMIT 1;
      IF v_existe IS NOT NULL THEN
        UPDATE public.whatsapp_contacts
           SET tags = (SELECT array_agg(DISTINCT t) FROM unnest(coalesce(tags, '{}') || ARRAY[v_tag]) AS t),
               name = CASE WHEN coalesce(name, '') = '' AND v_nome IS NOT NULL THEN v_nome ELSE name END,
               updated_at = now()
         WHERE phone = v_existe AND NOT (coalesce(tags, '{}') @> ARRAY[v_tag]);
      ELSE
        INSERT INTO public.whatsapp_contacts (phone, name, source, tags)
        VALUES (v_wa, coalesce(v_nome, ''), 'grupo_whatsapp', ARRAY[v_tag])
        -- sem alvo: vale com UNIQUE (phone) antigo ou (numero_id, phone) de 20261028100000
        ON CONFLICT DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'grupos_resolver_link lead: %', SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object('url', g.link_convite, 'grupo', nullif(g.nome, ''));
END;
$$;
REVOKE ALL ON FUNCTION public.grupos_resolver_link(text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grupos_resolver_link(text, text, text, text, jsonb) TO anon, authenticated;

-- 6) Tick do pg_cron: acorda também para a criação agendada ------------------------------------
CREATE OR REPLACE FUNCTION public.grupos_disparo_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url     text;
  v_segredo text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.grupos_mensagens m JOIN public.grupos_campanhas c ON c.id = m.campanha_id
                  WHERE m.status = 'agendada' AND m.agendado_para <= now() + interval '1 minute'
                    AND NOT c.disparos_pausados AND NOT c.encerrada)
     AND NOT EXISTS (SELECT 1 FROM public.grupos_envios WHERE status = 'pendente')
     AND NOT EXISTS (SELECT 1 FROM public.grupos_campanha_grupos g JOIN public.grupos_campanhas c ON c.id = g.campanha_id
                      WHERE NOT c.encerrada AND NOT c.link_pausado AND g.ativo AND g.chat_id IS NOT NULL
                        AND (g.participantes_em IS NULL OR g.participantes_em < now() - interval '10 minutes'))
     AND NOT EXISTS (SELECT 1 FROM public.grupos_campanhas c
                      WHERE c.auto_criar AND NOT c.encerrada AND NOT c.link_pausado
                        AND public.grupos_vagas(c.id) < c.folga_vagas
                        AND (SELECT count(*) FROM public.grupos_campanha_grupos g WHERE g.campanha_id = c.id) < c.max_grupos)
     AND NOT EXISTS (SELECT 1 FROM public.grupos_campanhas c
                      WHERE c.criacao_agendada_para IS NOT NULL AND c.criacao_agendada_para <= now() AND NOT c.encerrada)
     AND NOT EXISTS (SELECT 1 FROM public.grupos_membros_eventos e
                      WHERE e.boas_vindas_pendente AND e.created_at > now() - interval '6 hours') THEN
    RETURN 'nada a fazer';
  END IF;

  SELECT valor INTO v_url FROM public.integracao_config WHERE chave = 'grupos_disparo_fn_url';
  SELECT valor INTO v_segredo FROM public.integracao_config WHERE chave = 'grupos_disparo_segredo';
  IF v_url IS NULL OR v_url !~ '^https://' OR v_segredo IS NULL THEN
    RETURN 'sem url/segredo';
  END IF;

  PERFORM net.http_post(
    url                  := v_url,
    body                 := jsonb_build_object('modo', 'tick'),
    headers              := jsonb_build_object('Content-Type', 'application/json', 'x-grupos-segredo', v_segredo),
    timeout_milliseconds := 150000
  );
  RETURN 'chamado';
END;
$$;
REVOKE ALL ON FUNCTION public.grupos_disparo_tick() FROM PUBLIC, anon, authenticated;

COMMIT;

-- conferência (só leitura)
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name IN ('grupos_campanhas', 'grupos_campanha_grupos', 'grupos_mensagens')
   AND column_name IN ('avulsa', 'modo_distribuicao', 'criacao_agendada_para', 'peso', 'importado', 'sou_admin',
                       'anuncio', 'permissao_em', 'grupos_alvo', 'disparo_id')
 ORDER BY column_name;

-- =============================================================
-- DEPOIS DE RODAR: publicar a edge function grupos-disparo-tick (lê grupos_alvo, criação agendada,
-- configurar grupo e permissões). Sem a edge nova, disparo com grupos escolhidos iria para TODOS os
-- grupos da campanha: por isso a tela só oferece "Disparo em grupo" quando a edge responde à versão nova.
-- =============================================================
