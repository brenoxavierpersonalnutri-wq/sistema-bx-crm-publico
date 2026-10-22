-- =============================================================
-- FLUXO DE GRUPO (campanha de grupos no padrão SendFlow) — 19/10/2026
-- Rodar inteiro no SQL editor do Lovable Cloud DEPOIS da 20261024130000_grupos_whatsapp.sql.
-- Idempotente (pode rodar de novo). Não apaga dado: só acrescenta colunas, tabelas e funções.
--
-- O QUE ACRESCENTA
--  1. Criação automática de grupos: quando as vagas dos grupos da campanha ficam abaixo da folga,
--     o disparador (grupos-disparo-tick) cria o próximo grupo pelo número da campanha: nome
--     "<prefixo> <n>", descrição, foto, só-admins-enviam/editam, admins promovidos, link de convite
--     e o grupo entra no fim da fila do link /g/<slug>. Log em grupos_criacoes. Teto: max_grupos.
--  2. Data do evento + mensagens relativas (D-3, D-1, ao vivo): offset_min em minutos em relação à
--     data do evento; mudou a data, as mensagens ainda agendadas acompanham (gatilho).
--  3. Tipos novos na agenda: enquete, travar (só admins enviam) e destravar; áudio como nota de voz
--     (ptt); "mencionar todos" (o proxy pega os participantes e menciona sem @ no texto).
--  4. Entradas/saídas por grupo (eventos group.join/group.leave do OpenWA pelo openwa-webhook) e
--     mensagem de boas-vindas opcional, agrupada por grupo (no máximo 1 a cada N minutos).
--  5. Ritmo anti-ban por campanha: teto de grupos por minuto (soma ao intervalo aleatório).
--
-- TUDO NASCE DESLIGADO: auto_criar = false, boas_vindas_ligada = false; nenhuma mensagem nova sai sem
-- alguém agendar. A tela cria campanha nova com link e disparos pausados.
-- =============================================================

BEGIN;

-- 1) Campanha: criação automática, evento, ritmo, boas-vindas ------------------------------------
ALTER TABLE public.grupos_campanhas
  ADD COLUMN IF NOT EXISTS auto_criar             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prefixo_nome           text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS proximo_numero         integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS descricao_grupo        text,
  ADD COLUMN IF NOT EXISTS foto_path              text,
  ADD COLUMN IF NOT EXISTS admins_telefones       text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS so_admins_enviam       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS so_admins_editam       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS folga_vagas            integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS max_grupos             integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS data_evento            timestamptz,
  ADD COLUMN IF NOT EXISTS teto_por_minuto        integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS boas_vindas_ligada     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS boas_vindas_texto      text,
  ADD COLUMN IF NOT EXISTS boas_vindas_mencionar  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS boas_vindas_intervalo_min integer NOT NULL DEFAULT 10;

ALTER TABLE public.grupos_campanhas DROP CONSTRAINT IF EXISTS grupos_campanhas_fluxo_ok;
ALTER TABLE public.grupos_campanhas ADD CONSTRAINT grupos_campanhas_fluxo_ok CHECK (
  length(prefixo_nome) <= 80
  AND proximo_numero BETWEEN 1 AND 9999
  AND (descricao_grupo IS NULL OR length(descricao_grupo) <= 1024)
  AND (foto_path IS NULL OR foto_path ~ '^[A-Za-z0-9/_.-]{3,300}$')
  AND cardinality(admins_telefones) <= 10
  AND folga_vagas BETWEEN 1 AND 500
  AND max_grupos BETWEEN 1 AND 200
  AND teto_por_minuto BETWEEN 1 AND 6
  AND (boas_vindas_texto IS NULL OR length(boas_vindas_texto) <= 2000)
  AND boas_vindas_intervalo_min BETWEEN 2 AND 240
  -- criar sozinho exige prefixo e pelo menos 1 admin (o WhatsApp não cria grupo sem outro participante)
  AND (NOT auto_criar OR (length(trim(prefixo_nome)) > 0 AND cardinality(admins_telefones) >= 1))
  AND (NOT boas_vindas_ligada OR length(trim(coalesce(boas_vindas_texto, ''))) > 0)
);

-- telefones dos admins: só dígitos com DDI (5511999998888)
CREATE OR REPLACE FUNCTION public.grupos_telefones_ok(t text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(bool_and(x ~ '^\d{10,15}$'), true) FROM unnest(t) AS x
$$;
ALTER TABLE public.grupos_campanhas DROP CONSTRAINT IF EXISTS grupos_campanhas_admins_ok;
ALTER TABLE public.grupos_campanhas ADD CONSTRAINT grupos_campanhas_admins_ok CHECK (public.grupos_telefones_ok(admins_telefones));

-- 2) Grupo: origem, entradas/saídas, boas-vindas, travado --------------------------------------
ALTER TABLE public.grupos_campanha_grupos
  ADD COLUMN IF NOT EXISTS criado_pelo_crm boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entradas        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saidas          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS boas_vindas_em  timestamptz,
  ADD COLUMN IF NOT EXISTS travado         boolean;

-- 3) Mensagem: tipos novos, relativo ao evento, enquete, nota de voz, mencionar todos ------------
ALTER TABLE public.grupos_mensagens
  ADD COLUMN IF NOT EXISTS relativo_evento   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS offset_min        integer,
  ADD COLUMN IF NOT EXISTS enquete_opcoes    text[],
  ADD COLUMN IF NOT EXISTS enquete_multipla  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ptt               boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mencionar_todos   boolean NOT NULL DEFAULT false;

DO $$
DECLARE r record;
BEGIN
  -- o CHECK do tipo foi criado inline (nome gerado): acha e troca
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.grupos_mensagens'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%tipo%''texto''%''imagem''%'
              AND conname NOT IN ('grupos_mensagens_conteudo_ok', 'grupos_mensagens_tipo_ok', 'grupos_mensagens_extras_ok')
  LOOP
    EXECUTE format('ALTER TABLE public.grupos_mensagens DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.grupos_mensagens DROP CONSTRAINT IF EXISTS grupos_mensagens_tipo_ok;
ALTER TABLE public.grupos_mensagens ADD CONSTRAINT grupos_mensagens_tipo_ok
  CHECK (tipo IN ('texto', 'imagem', 'video', 'audio', 'documento', 'enquete', 'travar', 'destravar'));

ALTER TABLE public.grupos_mensagens DROP CONSTRAINT IF EXISTS grupos_mensagens_conteudo_ok;
ALTER TABLE public.grupos_mensagens ADD CONSTRAINT grupos_mensagens_conteudo_ok CHECK (
  (tipo = 'texto' AND midia_path IS NULL AND length(trim(coalesce(texto, ''))) > 0)
  OR (tipo IN ('imagem', 'video', 'documento') AND midia_path IS NOT NULL AND (texto IS NULL OR length(texto) <= 1024))
  OR (tipo = 'audio' AND midia_path IS NOT NULL AND texto IS NULL)
  OR (tipo = 'enquete' AND midia_path IS NULL AND length(trim(coalesce(texto, ''))) BETWEEN 1 AND 255
      AND cardinality(coalesce(enquete_opcoes, '{}')) BETWEEN 2 AND 12)
  OR (tipo IN ('travar', 'destravar') AND midia_path IS NULL AND texto IS NULL)
);
ALTER TABLE public.grupos_mensagens DROP CONSTRAINT IF EXISTS grupos_mensagens_extras_ok;
ALTER TABLE public.grupos_mensagens ADD CONSTRAINT grupos_mensagens_extras_ok CHECK (
  (NOT ptt OR tipo = 'audio')
  AND (NOT mencionar_todos OR tipo IN ('texto', 'imagem', 'video', 'documento', 'audio'))
  AND (NOT relativo_evento OR offset_min BETWEEN -43200 AND 43200)
);

-- mensagem relativa: agendado_para = data do evento + offset (a tela manda qualquer valor; o banco manda)
CREATE OR REPLACE FUNCTION public.grupos_mensagem_relativa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_evento timestamptz;
BEGIN
  IF NOT NEW.relativo_evento THEN RETURN NEW; END IF;
  IF NEW.offset_min IS NULL THEN RAISE EXCEPTION 'mensagem relativa sem offset_min'; END IF;
  SELECT data_evento INTO v_evento FROM public.grupos_campanhas WHERE id = NEW.campanha_id;
  IF v_evento IS NULL THEN RAISE EXCEPTION 'defina a data do evento da campanha antes de agendar relativo a ela'; END IF;
  IF TG_OP = 'INSERT' OR NEW.status = 'agendada' THEN
    NEW.agendado_para := v_evento + make_interval(mins => NEW.offset_min);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS grupos_mensagem_relativa ON public.grupos_mensagens;
CREATE TRIGGER grupos_mensagem_relativa BEFORE INSERT OR UPDATE OF relativo_evento, offset_min, agendado_para, campanha_id
  ON public.grupos_mensagens FOR EACH ROW EXECUTE FUNCTION public.grupos_mensagem_relativa();

-- mudou a data do evento: as relativas ainda agendadas acompanham
CREATE OR REPLACE FUNCTION public.grupos_evento_mudou()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.data_evento IS DISTINCT FROM OLD.data_evento AND NEW.data_evento IS NOT NULL THEN
    UPDATE public.grupos_mensagens
       SET agendado_para = NEW.data_evento + make_interval(mins => offset_min), updated_at = now()
     WHERE campanha_id = NEW.id AND relativo_evento AND status = 'agendada';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS grupos_evento_mudou ON public.grupos_campanhas;
CREATE TRIGGER grupos_evento_mudou AFTER UPDATE OF data_evento ON public.grupos_campanhas
  FOR EACH ROW EXECUTE FUNCTION public.grupos_evento_mudou();

-- 4) Log de criação de grupos ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grupos_criacoes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id  uuid NOT NULL REFERENCES public.grupos_campanhas(id) ON DELETE CASCADE,
  numero       integer NOT NULL,
  nome         text NOT NULL,
  chat_id      text CHECK (chat_id IS NULL OR chat_id ~ '^\d{5,25}(-\d{5,15})?@g\.us$'),
  etapa        text NOT NULL DEFAULT 'criar',
  status       text NOT NULL DEFAULT 'criando' CHECK (status IN ('criando', 'ok', 'erro', 'abandonada')),
  erro         text,
  avisos       text[] NOT NULL DEFAULT '{}',
  tentativas   integer NOT NULL DEFAULT 0,
  grupo_id     uuid REFERENCES public.grupos_campanha_grupos(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grupos_criacoes_campanha_idx ON public.grupos_criacoes (campanha_id, created_at DESC);

-- 5) Entradas e saídas (webhook group.join / group.leave) ---------------------------------------
-- participantes (ids do WhatsApp) só vivem aqui até a boas-vindas sair (ou 1 dia); a tela NÃO lê a coluna.
CREATE TABLE IF NOT EXISTS public.grupos_membros_eventos (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campanha_id           uuid NOT NULL REFERENCES public.grupos_campanhas(id) ON DELETE CASCADE,
  grupo_id              uuid NOT NULL REFERENCES public.grupos_campanha_grupos(id) ON DELETE CASCADE,
  tipo                  text NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  quantidade            integer NOT NULL CHECK (quantidade BETWEEN 1 AND 1024),
  participantes         text[] NOT NULL DEFAULT '{}',
  boas_vindas_pendente  boolean NOT NULL DEFAULT false,
  chave                 text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grupo_id, chave)
);
CREATE INDEX IF NOT EXISTS grupos_membros_eventos_grupo_idx ON public.grupos_membros_eventos (grupo_id, created_at);
CREATE INDEX IF NOT EXISTS grupos_membros_eventos_bv_idx ON public.grupos_membros_eventos (boas_vindas_pendente) WHERE boas_vindas_pendente;

-- 6) RLS e permissões -----------------------------------------------------------------------------
ALTER TABLE public.grupos_criacoes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grupos_membros_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.grupos_criacoes, public.grupos_membros_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.grupos_criacoes TO authenticated;
-- sem a coluna participantes
GRANT SELECT (id, campanha_id, grupo_id, tipo, quantidade, boas_vindas_pendente, created_at)
  ON TABLE public.grupos_membros_eventos TO authenticated;
GRANT ALL ON TABLE public.grupos_criacoes, public.grupos_membros_eventos TO service_role;

DROP POLICY IF EXISTS "Aprovados leem grupos_criacoes" ON public.grupos_criacoes;
CREATE POLICY "Aprovados leem grupos_criacoes" ON public.grupos_criacoes FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Aprovados leem grupos_membros_eventos" ON public.grupos_membros_eventos;
CREATE POLICY "Aprovados leem grupos_membros_eventos" ON public.grupos_membros_eventos FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

-- 7) Vagas da campanha (mesma regra de ocupacao() em _shared/grupos.ts) ---------------------------
CREATE OR REPLACE FUNCTION public.grupos_vagas(p_campanha uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(greatest(least(c.limite_por_grupo, 1024)
           - (coalesce(g.participantes, 0) + greatest(g.cliques - g.cliques_na_contagem, 0)), 0)), 0)::int
    FROM public.grupos_campanhas c
    JOIN public.grupos_campanha_grupos g ON g.campanha_id = c.id AND g.ativo AND NOT g.cheio
   WHERE c.id = p_campanha
$$;
REVOKE ALL ON FUNCTION public.grupos_vagas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grupos_vagas(uuid) TO authenticated, service_role;

-- 8) Evento de membros (chamada SÓ pelo openwa-webhook, service_role) -----------------------------
CREATE OR REPLACE FUNCTION public.grupos_registrar_evento_membros(
  p_chat_id text, p_tipo text, p_participantes text[], p_chave text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g     record;
  v_ids text[];
  v_qtd int;
  n     int := 0;
BEGIN
  IF p_chat_id !~ '^\d{5,25}(-\d{5,15})?@g\.us$' OR p_tipo NOT IN ('entrada', 'saida') THEN RETURN 0; END IF;
  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_ids
    FROM unnest(coalesce(p_participantes, '{}')) AS x WHERE x ~ '^(\d{8,15}@c\.us|\d{5,25}@lid)$';
  v_ids := v_ids[1:256];
  v_qtd := greatest(cardinality(v_ids), 1);
  FOR g IN SELECT gr.id, gr.campanha_id, c.boas_vindas_ligada
             FROM public.grupos_campanha_grupos gr JOIN public.grupos_campanhas c ON c.id = gr.campanha_id
            WHERE gr.chat_id = p_chat_id AND NOT c.encerrada
  LOOP
    INSERT INTO public.grupos_membros_eventos (campanha_id, grupo_id, tipo, quantidade, participantes, boas_vindas_pendente, chave)
    VALUES (g.campanha_id, g.id, p_tipo, v_qtd,
            CASE WHEN p_tipo = 'entrada' AND g.boas_vindas_ligada THEN v_ids ELSE '{}' END,
            p_tipo = 'entrada' AND g.boas_vindas_ligada AND cardinality(v_ids) > 0,
            md5(left(coalesce(p_chave, ''), 4000)))
    ON CONFLICT (grupo_id, chave) DO NOTHING;
    IF FOUND THEN
      UPDATE public.grupos_campanha_grupos
         SET entradas = entradas + CASE WHEN p_tipo = 'entrada' THEN v_qtd ELSE 0 END,
             saidas   = saidas   + CASE WHEN p_tipo = 'saida'   THEN v_qtd ELSE 0 END,
             -- pede recontagem logo (no máximo 1 a cada 2 min por grupo)
             participantes_em = CASE WHEN participantes_em < now() - interval '2 minutes' THEN NULL ELSE participantes_em END
       WHERE id = g.id;
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.grupos_registrar_evento_membros(text, text, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grupos_registrar_evento_membros(text, text, text[], text) TO service_role;

-- 9) Link público: com criação automática ligada, "lotado" avisa que o próximo grupo está nascendo --
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

  SELECT * INTO g FROM public.grupos_campanha_grupos
   WHERE campanha_id = c.id AND ativo AND NOT cheio
     AND coalesce(participantes, 0) + greatest(cliques - cliques_na_contagem, 0) < c.limite_por_grupo
   ORDER BY ordem, created_at, id
   LIMIT 1;
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
        ON CONFLICT (phone) DO NOTHING;
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

-- 10) Tick do pg_cron: acorda também para criar grupo e mandar boas-vindas ------------------------
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

-- =============================================================
-- DEPOIS DE RODAR (nada disso liga nada sozinho):
--  1) Publicar as edge functions grupos-disparo-tick e openwa-webhook.
--  2) Aplicar na VPS o proxy novo (infra/wa-proxy/APLICAR-FLUXO-GRUPO.md): rotas group-create,
--     group-settings, group-description, group-picture, group-promote, send-group-poll, menções e ptt.
--  3) Para entradas/saídas e boas-vindas: headturbo-openwa-webhook-crm --sessao <NOME> --com-eventos-grupo --executar.
--  Desligar a criação de todas: UPDATE public.grupos_campanhas SET auto_criar = false;
-- =============================================================
