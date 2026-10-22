-- =============================================================
-- LOTOU, CRIA GRUPO (Disparo em grupo) — 21/10/2026
-- Rodar inteiro no SQL editor do Lovable Cloud DEPOIS de 20261024130000, 20261106100000, 20261108110000 e
-- 20261109110000. Idempotente (pode rodar de novo). Não apaga dado: acrescenta colunas/índices, troca funções
-- e liga a criação nas campanhas que existem.
--
-- Pedido do Breno: "esse plano B tem que ser sempre criar um grupo, não tem sentido".
--  1. Criação SEMPRE ligada: toda campanha (menos a "Avulsos") cria o próximo grupo quando as vagas ficam
--     abaixo da folga. auto_criar passa a nascer true, as existentes viram true, e o CHECK que exigia prefixo +
--     admin para ligar sai (sem prefixo o grupo usa o nome da campanha; sem admin o disparador não cria e o
--     painel "O que precisa de atenção" acusa).
--  2. Link /g/ lotado NÃO usa mais url_lotado: o clique fica 'aguardando' (com UTM e telefone) e a página espera o
--     grupo novo ("Preparando seu grupo…", consulta a cada 3 s com o token de espera). Quando o grupo nasce, o
--     MESMO clique vira 'grupo' (esperou = true): nada de clique duplicado por consulta.
--     url_lotado continua existindo, mas só vale para link PAUSADO.
--  3. Travas anti-ban: 1 criação em andamento por campanha (índice único abaixo). A pausa de 2 min e o teto de
--     10 grupos/dia por número ficam na edge (grupos-disparo-tick, _shared/grupoCriacao.ts) e usam o índice de data.
--  4. Estado da criação na campanha para o painel: bloqueio legível (teto diário, sem admin, número que não cria,
--     máximo da campanha), quando retomar, falhas seguidas e o último erro.
-- =============================================================

BEGIN;

-- 1) Campanha: criação sempre ligada + estado para o painel ----------------------------------------
ALTER TABLE public.grupos_campanhas
  ADD COLUMN IF NOT EXISTS criacao_bloqueio         text,
  ADD COLUMN IF NOT EXISTS criacao_bloqueio_em      timestamptz,
  ADD COLUMN IF NOT EXISTS criacao_retomar_em       timestamptz,
  ADD COLUMN IF NOT EXISTS criacao_falhas_seguidas  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS criacao_ultimo_erro      text;

ALTER TABLE public.grupos_campanhas DROP CONSTRAINT IF EXISTS grupos_campanhas_criacao_estado_ok;
ALTER TABLE public.grupos_campanhas ADD CONSTRAINT grupos_campanhas_criacao_estado_ok CHECK (
  (criacao_bloqueio IS NULL OR length(criacao_bloqueio) <= 500)
  AND (criacao_ultimo_erro IS NULL OR length(criacao_ultimo_erro) <= 500)
  AND criacao_falhas_seguidas >= 0
);

-- mesmo CHECK de 20261106100000, SEM a exigência de prefixo + admin para auto_criar
ALTER TABLE public.grupos_campanhas DROP CONSTRAINT IF EXISTS grupos_campanhas_fluxo_ok;
ALTER TABLE public.grupos_campanhas ADD CONSTRAINT grupos_campanhas_fluxo_ok CHECK (
  length(prefixo_nome) <= 80
  AND proximo_numero BETWEEN 1 AND 9999
  AND (descricao_grupo IS NULL OR length(descricao_grupo) <= 1024)
  AND (foto_path IS NULL OR (foto_path ~ '^[A-Za-z0-9/_.-]+$' AND length(foto_path) BETWEEN 3 AND 300))
  AND cardinality(admins_telefones) <= 10
  AND folga_vagas BETWEEN 1 AND 500
  AND max_grupos BETWEEN 1 AND 200
  AND teto_por_minuto BETWEEN 1 AND 6
  AND (boas_vindas_texto IS NULL OR length(boas_vindas_texto) <= 2000)
  AND boas_vindas_intervalo_min BETWEEN 2 AND 240
  AND (NOT boas_vindas_ligada OR length(trim(coalesce(boas_vindas_texto, ''))) > 0)
);

ALTER TABLE public.grupos_campanhas ALTER COLUMN auto_criar SET DEFAULT true;
-- campanhas existentes (a Avulsos fica de fora: não tem link, só guarda grupos importados)
UPDATE public.grupos_campanhas SET auto_criar = true WHERE NOT avulsa AND NOT auto_criar;

-- 2) Criações: no máximo 1 em andamento por campanha ------------------------------------------------
-- pendências repetidas de antes (se houver): fica a mais nova, as outras viram 'abandonada'
UPDATE public.grupos_criacoes x
   SET status = 'abandonada', updated_at = now(),
       erro = left(coalesce(x.erro || ' · ', '') || 'abandonada: outra criação da campanha em andamento (20261122100000)', 500)
 WHERE x.status IN ('criando', 'erro')
   AND EXISTS (SELECT 1 FROM public.grupos_criacoes y
                WHERE y.campanha_id = x.campanha_id AND y.status IN ('criando', 'erro')
                  AND (y.created_at, y.id) > (x.created_at, x.id));
CREATE UNIQUE INDEX IF NOT EXISTS grupos_criacoes_uma_em_andamento
  ON public.grupos_criacoes (campanha_id) WHERE status IN ('criando', 'erro');
-- teto diário / pausa por número: criações recentes
CREATE INDEX IF NOT EXISTS grupos_criacoes_data_idx ON public.grupos_criacoes (created_at DESC);

-- 3) Cliques: 'aguardando' + token de espera ---------------------------------------------------------
ALTER TABLE public.grupos_cliques
  ADD COLUMN IF NOT EXISTS esperou       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS espera_token  uuid;

DO $$
DECLARE r record;
BEGIN
  -- o CHECK do resultado foi criado inline (nome gerado): acha e troca
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.grupos_cliques'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%resultado%'
              AND conname <> 'grupos_cliques_resultado_ok'
  LOOP
    EXECUTE format('ALTER TABLE public.grupos_cliques DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.grupos_cliques DROP CONSTRAINT IF EXISTS grupos_cliques_resultado_ok;
ALTER TABLE public.grupos_cliques ADD CONSTRAINT grupos_cliques_resultado_ok
  CHECK (resultado IN ('grupo', 'lotado', 'pausado', 'aguardando'));
CREATE UNIQUE INDEX IF NOT EXISTS grupos_cliques_espera_uq ON public.grupos_cliques (espera_token) WHERE espera_token IS NOT NULL;

-- 4) Lead do link (o mesmo bloco de 20261108110000, separado para valer também para quem espera) ------
CREATE OR REPLACE FUNCTION public.grupos_link_lead(p_campanha uuid, p_tel text, p_nome text, p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c        public.grupos_campanhas%ROWTYPE;
  v_wa     text;
  v_tag    text;
  v_nome   text := nullif(left(trim(coalesce(p_nome, '')), 120), '');
  v_email  text;
  v_existe text;
BEGIN
  IF p_tel IS NULL THEN RETURN; END IF;
  SELECT * INTO c FROM public.grupos_campanhas WHERE id = p_campanha;
  IF NOT FOUND THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.grupos_cliques
       WHERE campanha_id = c.id AND telefone_e164 IS NOT NULL AND created_at > now() - interval '1 minute') > 300 THEN
    RETURN;
  END IF;
  BEGIN
    v_tag := coalesce(nullif(trim(c.tag), ''), 'grupo-' || c.slug);
    v_email := CASE WHEN position('@' IN coalesce(p_email, '')) > 1 AND length(p_email) <= 200 THEN lower(trim(p_email)) END;

    INSERT INTO public.base_leads (origem, origem_id, nome, telefone_e164, email, tags, produto, status, criado_origem)
    VALUES ('grupo_whatsapp', c.slug || ':' || p_tel, v_nome, p_tel, v_email,
            ARRAY[v_tag, 'grupo-whatsapp'], c.nome, 'clicou_link_grupo', now())
    ON CONFLICT (origem, origem_id) DO UPDATE SET
      nome  = coalesce(EXCLUDED.nome, public.base_leads.nome),
      email = coalesce(EXCLUDED.email, public.base_leads.email);

    v_wa := substr(p_tel, 2);
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
    RAISE WARNING 'grupos_link_lead: %', SQLERRM;
  END;
END $$;
REVOKE ALL ON FUNCTION public.grupos_link_lead(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grupos_link_lead(uuid, text, text, text) TO service_role;

-- 5) Link público: lotado espera o grupo novo (sem url_lotado) -----------------------------------------
-- Assinatura nova (p_espera): a de 5 parâmetros sai, senão o PostgREST acharia duas. Quem chama com 5 nomes
-- (front antigo) cai nesta, com p_espera nulo.
-- Resposta de lotado: {erro:'lotado', aguardando:true, criando:true, espera:<token>, url:null}. 'erro'/'criando'
-- ficam para o front antigo continuar tentando; o novo usa 'espera' e consulta a cada 3 s SEM criar clique novo.
DROP FUNCTION IF EXISTS public.grupos_resolver_link(text, text, text, text, jsonb);
CREATE OR REPLACE FUNCTION public.grupos_resolver_link(
  p_slug   text,
  p_tel    text DEFAULT NULL,
  p_nome   text DEFAULT NULL,
  p_email  text DEFAULT NULL,
  p_utm    jsonb DEFAULT '{}'::jsonb,
  p_espera uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c        public.grupos_campanhas%ROWTYPE;
  g        public.grupos_campanha_grupos%ROWTYPE;
  v_clique public.grupos_cliques%ROWTYPE;
  v_tel    text;
  v_utm    jsonb := '{}'::jsonb;
  v_teto   int;
  v_espera boolean := false;
  v_token  uuid;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$' THEN
    RETURN jsonb_build_object('erro', 'nao_encontrada');
  END IF;
  SELECT * INTO c FROM public.grupos_campanhas WHERE slug = p_slug AND NOT encerrada FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('erro', 'nao_encontrada'); END IF;

  -- consulta de quem já está esperando: o clique é o mesmo (UTM e telefone vêm dele)
  IF p_espera IS NOT NULL THEN
    SELECT * INTO v_clique FROM public.grupos_cliques
     WHERE espera_token = p_espera AND campanha_id = c.id AND created_at > now() - interval '30 minutes'
     FOR UPDATE;
    IF FOUND THEN
      IF v_clique.resultado = 'grupo' THEN
        -- já resolvido (consulta repetida): devolve o mesmo grupo, sem contar de novo
        SELECT * INTO g FROM public.grupos_campanha_grupos WHERE id = v_clique.grupo_id;
        IF FOUND AND g.link_convite IS NOT NULL THEN
          RETURN jsonb_build_object('url', g.link_convite, 'grupo', nullif(g.nome, ''));
        END IF;
      END IF;
      v_espera := v_clique.resultado = 'aguardando';
      v_tel := v_clique.telefone_e164;
      v_utm := v_clique.utm;
    END IF;
  END IF;

  IF NOT v_espera THEN
    IF jsonb_typeof(p_utm) = 'object' AND length(p_utm::text) <= 2000 THEN
      SELECT coalesce(jsonb_object_agg(e.k, left(e.v, 200)), '{}'::jsonb) INTO v_utm
        FROM jsonb_each_text(p_utm) AS e(k, v)
       WHERE e.k IN ('utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'origem');
    END IF;
    v_tel := public.grupos_tel_e164(p_tel);
  END IF;

  IF c.link_pausado THEN
    IF v_espera THEN
      UPDATE public.grupos_cliques SET resultado = 'pausado' WHERE id = v_clique.id;
    ELSE
      INSERT INTO public.grupos_cliques (campanha_id, resultado, telefone_e164, utm) VALUES (c.id, 'pausado', v_tel, v_utm);
    END IF;
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
    -- lotado: espera o grupo novo (o disparador cria; nunca manda para url_lotado)
    IF v_espera THEN
      v_token := p_espera;
    ELSE
      v_token := gen_random_uuid();
      INSERT INTO public.grupos_cliques (campanha_id, resultado, telefone_e164, utm, esperou, espera_token)
      VALUES (c.id, 'aguardando', v_tel, v_utm, true, v_token);
      PERFORM public.grupos_link_lead(c.id, v_tel, p_nome, p_email);
    END IF;
    RETURN jsonb_build_object('erro', 'lotado', 'aguardando', true, 'criando', true, 'espera', v_token, 'url', NULL);
  END IF;

  UPDATE public.grupos_campanha_grupos SET cliques = cliques + 1 WHERE id = g.id;
  IF v_espera THEN
    UPDATE public.grupos_cliques SET resultado = 'grupo', grupo_id = g.id WHERE id = v_clique.id;
  ELSE
    INSERT INTO public.grupos_cliques (campanha_id, grupo_id, resultado, telefone_e164, utm)
    VALUES (c.id, g.id, 'grupo', v_tel, v_utm);
    PERFORM public.grupos_link_lead(c.id, v_tel, p_nome, p_email);
  END IF;

  RETURN jsonb_build_object('url', g.link_convite, 'grupo', nullif(g.nome, ''));
END;
$$;
REVOKE ALL ON FUNCTION public.grupos_resolver_link(text, text, text, text, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grupos_resolver_link(text, text, text, text, jsonb, uuid) TO anon, authenticated;

-- 6) Tick do pg_cron: acorda para criar em TODA campanha (não só auto_criar) --------------------------
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
                      WHERE NOT c.avulsa AND NOT c.encerrada AND NOT c.link_pausado
                        -- só número que cria grupo (sessão grupos-N, igual numeroCriaGrupo) e com admin
                        AND EXISTS (SELECT 1 FROM public.crm_numeros n
                                     WHERE n.id = c.numero_id AND n.sessao_openwa ~ '^grupos-\d{1,3}$')
                        AND cardinality(c.admins_telefones) >= 1
                        -- trava com hora marcada (teto diário, pausa): não acorda antes
                        AND (c.criacao_retomar_em IS NULL OR c.criacao_retomar_em <= now())
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
SELECT count(*) FILTER (WHERE auto_criar) AS campanhas_criando, count(*) FILTER (WHERE NOT auto_criar) AS sem_criar
  FROM public.grupos_campanhas WHERE NOT avulsa;
SELECT pg_get_function_identity_arguments('public.grupos_resolver_link'::regproc) AS assinatura_link;

-- =============================================================
-- DEPOIS DE RODAR: publicar a edge function grupos-disparo-tick (cria em toda campanha, travas por número,
-- estado para o painel). Ordem: migration primeiro, edge depois.
-- =============================================================
