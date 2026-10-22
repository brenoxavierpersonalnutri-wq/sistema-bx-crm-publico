-- =============================================================
-- Módulo GRUPOS do CRM (substitui o SendFlow).
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente (pode rodar de novo).
-- Não apaga nem altera dado existente: só cria tabelas/funções novas e acrescenta tag/lead.
--
-- O QUE FAZ
--  1. Campanha de grupos: lista de grupos (link de convite + id @g.us quando escolhido da sessão),
--     limite por grupo, link público /g/<slug> (e /r/<slug> para slugs que começam com "grupo-")
--     que manda cada pessoa para o PRIMEIRO grupo da ordem que ainda tem vaga.
--     Ocupação = participantes da última contagem + cliques desde a contagem (sem contagem: cliques).
--  2. Agenda de mensagens para os grupos da campanha (texto, imagem, vídeo, áudio, documento, link),
--     enviada grupo a grupo com intervalo aleatório (padrão 20-60 s) pela edge function
--     grupos-disparo-tick, chamada pelo pg_cron (1/min) com segredo interno.
--  3. Relatório: cliques por grupo (grupos_cliques), status por grupo de cada mensagem (grupos_envios).
--  4. Lead: clique com ?tel= vira linha em base_leads (origem grupo_whatsapp) e contato em
--     whatsapp_contacts com a tag da campanha (padrão "grupo-<slug>").
--
-- NÚMERO DE WHATSAPP: grupos_campanhas.numero_id -> public.crm_numeros (Central, migration 20261024100000).
--   Com crm_numeros já criada, a FK nasce aqui; senão, rode esta de novo depois (o bloco 2b cria a FK).
--   A edge function usa crm_numeros.sessao_openwa pelo contrato de _shared/numerosWa.ts (sessão padrão
--   não vai no corpo; outra só com WA_PROXY_MULTISESSAO=1). numero_id NULL = sessão padrão do proxy.
--
-- TUDO NASCE PARADO: nenhuma mensagem sai sem alguém agendar; o pg_cron só chama a função quando
-- existe mensagem vencida, envio pendente ou grupo precisando recontar participantes.
-- =============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- 0) Segredo e URL da função (gerados aqui; ninguém digita valor) ------------------------------
CREATE TABLE IF NOT EXISTS public.integracao_config (
  chave         text PRIMARY KEY,
  valor         text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.integracao_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.integracao_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.integracao_config TO service_role;

INSERT INTO public.integracao_config (chave, valor)
VALUES ('grupos_disparo_segredo', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
ON CONFLICT (chave) DO NOTHING;
INSERT INTO public.integracao_config (chave, valor)
VALUES ('grupos_disparo_fn_url', 'https://SEU_PROJECT_REF.supabase.co/functions/v1/grupos-disparo-tick')
ON CONFLICT (chave) DO NOTHING;

-- 1) Campanhas ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grupos_campanhas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome               text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 120),
  slug               text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  numero_id          uuid,
  limite_por_grupo   integer NOT NULL DEFAULT 900 CHECK (limite_por_grupo BETWEEN 1 AND 1024),
  tag                text NOT NULL DEFAULT '' CHECK (length(tag) <= 60),
  link_pausado       boolean NOT NULL DEFAULT false,
  disparos_pausados  boolean NOT NULL DEFAULT false,
  encerrada          boolean NOT NULL DEFAULT false,
  url_lotado         text CHECK (url_lotado IS NULL OR url_lotado ~ '^https://'),
  intervalo_min_s    integer NOT NULL DEFAULT 20 CHECK (intervalo_min_s BETWEEN 10 AND 600),
  intervalo_max_s    integer NOT NULL DEFAULT 60 CHECK (intervalo_max_s BETWEEN 10 AND 600),
  criado_por         uuid DEFAULT auth.uid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grupos_campanhas_intervalo_ok CHECK (intervalo_min_s <= intervalo_max_s)
);
ALTER TABLE public.grupos_campanhas ADD COLUMN IF NOT EXISTS numero_id uuid;
CREATE INDEX IF NOT EXISTS grupos_campanhas_numero_idx ON public.grupos_campanhas (numero_id);

-- 2) Grupos de cada campanha -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grupos_campanha_grupos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id          uuid NOT NULL REFERENCES public.grupos_campanhas(id) ON DELETE CASCADE,
  ordem                integer NOT NULL DEFAULT 0,
  nome                 text NOT NULL DEFAULT '' CHECK (length(nome) <= 120),
  link_convite         text NOT NULL CHECK (link_convite ~ '^https://chat\.whatsapp\.com/(invite/)?[A-Za-z0-9]{15,30}$'),
  chat_id              text CHECK (chat_id IS NULL OR chat_id ~ '^\d{5,25}(-\d{5,15})?@g\.us$'),
  ativo                boolean NOT NULL DEFAULT true,
  cheio                boolean NOT NULL DEFAULT false,
  cliques              integer NOT NULL DEFAULT 0,
  cliques_na_contagem  integer NOT NULL DEFAULT 0,
  participantes        integer,
  participantes_em     timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campanha_id, link_convite)
);
CREATE INDEX IF NOT EXISTS grupos_campanha_grupos_ordem_idx ON public.grupos_campanha_grupos (campanha_id, ordem, created_at);

-- 2b) FK para crm_numeros quando a tabela existir (Central por número) --------------------------
DO $$
BEGIN
  IF to_regclass('public.crm_numeros') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grupos_campanhas_numero_id_fkey') THEN
    ALTER TABLE public.grupos_campanhas
      ADD CONSTRAINT grupos_campanhas_numero_id_fkey FOREIGN KEY (numero_id)
      REFERENCES public.crm_numeros(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3) Cliques no link ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grupos_cliques (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campanha_id    uuid NOT NULL REFERENCES public.grupos_campanhas(id) ON DELETE CASCADE,
  grupo_id       uuid REFERENCES public.grupos_campanha_grupos(id) ON DELETE SET NULL,
  resultado      text NOT NULL DEFAULT 'grupo' CHECK (resultado IN ('grupo', 'lotado', 'pausado')),
  telefone_e164  text,
  utm            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grupos_cliques_campanha_idx ON public.grupos_cliques (campanha_id, created_at);

-- 4) Mensagens agendadas -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grupos_mensagens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id    uuid NOT NULL REFERENCES public.grupos_campanhas(id) ON DELETE CASCADE,
  agendado_para  timestamptz NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('texto', 'imagem', 'video', 'audio', 'documento')),
  texto          text CHECK (texto IS NULL OR length(texto) <= 4096),
  midia_path     text CHECK (midia_path IS NULL OR midia_path ~ '^[A-Za-z0-9/_.-]{3,300}$'),
  nome_arquivo   text CHECK (nome_arquivo IS NULL OR length(nome_arquivo) <= 255),
  link_preview   boolean NOT NULL DEFAULT true,
  status         text NOT NULL DEFAULT 'agendada'
                 CHECK (status IN ('agendada', 'enviando', 'concluida', 'cancelada', 'erro')),
  motivo         text,
  total_grupos   integer NOT NULL DEFAULT 0,
  enviados       integer NOT NULL DEFAULT 0,
  falhas         integer NOT NULL DEFAULT 0,
  iniciado_em    timestamptz,
  concluido_em   timestamptz,
  criado_por     uuid DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grupos_mensagens_conteudo_ok CHECK (
    (tipo = 'texto' AND midia_path IS NULL AND length(trim(coalesce(texto, ''))) > 0)
    OR (tipo IN ('imagem', 'video', 'documento') AND midia_path IS NOT NULL AND (texto IS NULL OR length(texto) <= 1024))
    OR (tipo = 'audio' AND midia_path IS NOT NULL AND texto IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS grupos_mensagens_status_idx ON public.grupos_mensagens (status, agendado_para);
CREATE INDEX IF NOT EXISTS grupos_mensagens_campanha_idx ON public.grupos_mensagens (campanha_id, agendado_para);

-- 5) Envio por grupo (uma linha por mensagem x grupo) -------------------------------------------
CREATE TABLE IF NOT EXISTS public.grupos_envios (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mensagem_id  uuid NOT NULL REFERENCES public.grupos_mensagens(id) ON DELETE CASCADE,
  grupo_id     uuid NOT NULL REFERENCES public.grupos_campanha_grupos(id) ON DELETE CASCADE,
  chat_id      text NOT NULL,
  ordem        integer NOT NULL DEFAULT 0,
  proximo_em   timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'pendente'
               CHECK (status IN ('pendente', 'enviando', 'enviado', 'falhou', 'cancelado')),
  tentativas   integer NOT NULL DEFAULT 0,
  erro         text,
  message_id   text,
  enviado_em   timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mensagem_id, grupo_id)
);
CREATE INDEX IF NOT EXISTS grupos_envios_fila_idx ON public.grupos_envios (status, proximo_em);

-- 6) Estado do disparador (trava contra duas execuções ao mesmo tempo) --------------------------
CREATE TABLE IF NOT EXISTS public.grupos_disparo_estado (
  id                integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  trava_ate         timestamptz,
  ultimo_tick       timestamptz,
  ultimo_resultado  jsonb
);
INSERT INTO public.grupos_disparo_estado (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 7) Bucket PRIVADO da mídia (a função gera link assinado na hora do envio) -----------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('grupos-midia', 'grupos-midia', false, 52428800, ARRAY[
  'image/jpeg', 'image/png', 'image/webp',
  'video/mp4', 'video/3gpp', 'video/quicktime',
  'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-m4a',
  'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "grupos_midia_aprovados_leem" ON storage.objects;
CREATE POLICY "grupos_midia_aprovados_leem" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'grupos-midia' AND public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "grupos_midia_aprovados_enviam" ON storage.objects;
CREATE POLICY "grupos_midia_aprovados_enviam" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'grupos-midia' AND public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "grupos_midia_aprovados_apagam" ON storage.objects;
CREATE POLICY "grupos_midia_aprovados_apagam" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'grupos-midia' AND public.is_approved(auth.uid()));

-- 8) RLS: só usuário aprovado; anon NÃO lê nada (o link público passa pela RPC abaixo) -----------
ALTER TABLE public.grupos_campanhas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grupos_campanha_grupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grupos_cliques         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grupos_mensagens       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grupos_envios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grupos_disparo_estado  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.grupos_campanhas, public.grupos_campanha_grupos, public.grupos_cliques,
  public.grupos_mensagens, public.grupos_envios, public.grupos_disparo_estado FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.grupos_campanhas, public.grupos_campanha_grupos,
  public.grupos_mensagens TO authenticated;
GRANT SELECT ON TABLE public.grupos_cliques, public.grupos_envios, public.grupos_disparo_estado TO authenticated;
GRANT ALL ON TABLE public.grupos_campanhas, public.grupos_campanha_grupos, public.grupos_cliques,
  public.grupos_mensagens, public.grupos_envios, public.grupos_disparo_estado TO service_role;

DROP POLICY IF EXISTS "Aprovados usam grupos_campanhas" ON public.grupos_campanhas;
CREATE POLICY "Aprovados usam grupos_campanhas" ON public.grupos_campanhas FOR ALL TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Aprovados usam grupos_campanha_grupos" ON public.grupos_campanha_grupos;
CREATE POLICY "Aprovados usam grupos_campanha_grupos" ON public.grupos_campanha_grupos FOR ALL TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Aprovados leem grupos_cliques" ON public.grupos_cliques;
CREATE POLICY "Aprovados leem grupos_cliques" ON public.grupos_cliques FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Aprovados leem grupos_envios" ON public.grupos_envios;
CREATE POLICY "Aprovados leem grupos_envios" ON public.grupos_envios FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Aprovados leem grupos_disparo_estado" ON public.grupos_disparo_estado;
CREATE POLICY "Aprovados leem grupos_disparo_estado" ON public.grupos_disparo_estado FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

-- Mensagem: cria e edita só enquanto "agendada"; cancelar é pela RPC (vale também no meio do envio).
DROP POLICY IF EXISTS "Aprovados leem grupos_mensagens" ON public.grupos_mensagens;
CREATE POLICY "Aprovados leem grupos_mensagens" ON public.grupos_mensagens FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Aprovados agendam grupos_mensagens" ON public.grupos_mensagens;
CREATE POLICY "Aprovados agendam grupos_mensagens" ON public.grupos_mensagens FOR INSERT TO authenticated
  WITH CHECK (public.is_approved(auth.uid()) AND status = 'agendada' AND iniciado_em IS NULL
              AND total_grupos = 0 AND enviados = 0 AND falhas = 0);
DROP POLICY IF EXISTS "Aprovados editam grupos_mensagens agendadas" ON public.grupos_mensagens;
CREATE POLICY "Aprovados editam grupos_mensagens agendadas" ON public.grupos_mensagens FOR UPDATE TO authenticated
  USING (public.is_approved(auth.uid()) AND status = 'agendada')
  WITH CHECK (public.is_approved(auth.uid()) AND status = 'agendada' AND iniciado_em IS NULL
              AND total_grupos = 0 AND enviados = 0 AND falhas = 0);
DROP POLICY IF EXISTS "Aprovados apagam grupos_mensagens" ON public.grupos_mensagens;
CREATE POLICY "Aprovados apagam grupos_mensagens" ON public.grupos_mensagens FOR DELETE TO authenticated
  USING (public.is_approved(auth.uid()) AND status IN ('agendada', 'cancelada', 'concluida', 'erro'));

-- 9) Cancelar mensagem (agendada ou no meio do envio: o que ainda não saiu não sai) --------------
CREATE OR REPLACE FUNCTION public.grupos_cancelar_mensagem(p_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.is_approved(auth.uid()) THEN RAISE EXCEPTION 'não autorizado'; END IF;
  SELECT status INTO v_status FROM public.grupos_mensagens WHERE id = p_id FOR UPDATE;
  IF v_status IS NULL THEN RETURN 'não encontrada'; END IF;
  IF v_status NOT IN ('agendada', 'enviando') THEN RETURN 'já ' || v_status; END IF;
  UPDATE public.grupos_envios SET status = 'cancelado', erro = 'mensagem cancelada', updated_at = now()
   WHERE mensagem_id = p_id AND status = 'pendente';
  UPDATE public.grupos_mensagens SET status = 'cancelada', motivo = 'cancelada na tela',
         concluido_em = now(), updated_at = now()
   WHERE id = p_id;
  RETURN 'cancelada';
END;
$$;
REVOKE ALL ON FUNCTION public.grupos_cancelar_mensagem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grupos_cancelar_mensagem(uuid) TO authenticated;

-- 10) Telefone BR -> E.164 (mesma regra de base_leads_tel_e164, sem depender dela) ---------------
CREATE OR REPLACE FUNCTION public.grupos_tel_e164(bruto text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  d text := regexp_replace(coalesce(bruto, ''), '[^0-9]', '', 'g');
  ddd int;
  loc text;
BEGIN
  d := regexp_replace(d, '^0+', '');
  IF d = '' THEN RETURN NULL; END IF;
  IF d LIKE '55%' AND length(d) IN (12, 13) THEN NULL;
  ELSIF length(d) IN (10, 11) THEN d := '55' || d;
  ELSE RETURN NULL;
  END IF;
  ddd := substr(d, 3, 2)::int;
  loc := substr(d, 5);
  IF ddd < 11 OR ddd > 99 THEN RETURN NULL; END IF;
  IF length(loc) = 9 AND left(loc, 1) <> '9' THEN RETURN NULL; END IF;
  IF length(loc) = 8 AND left(loc, 1) ~ '[6-9]' THEN loc := '9' || loc; END IF;
  RETURN '+55' || ddd::text || loc;
END $$;

-- 11) O LINK PÚBLICO: escolhe o grupo, conta o clique e registra o lead --------------------------
-- Chamada pela página /g/<slug> (anon). Trava a linha da campanha: dois cliques ao mesmo tempo
-- nunca passam do limite do grupo. Mesma regra de escolherGrupo() em _shared/grupos.ts.
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

  -- UTM: só chaves conhecidas, texto curto
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
    RETURN jsonb_build_object('erro', 'lotado', 'url', c.url_lotado);
  END IF;

  UPDATE public.grupos_campanha_grupos SET cliques = cliques + 1 WHERE id = g.id;
  INSERT INTO public.grupos_cliques (campanha_id, grupo_id, resultado, telefone_e164, utm)
  VALUES (c.id, g.id, 'grupo', v_tel, v_utm);

  -- Lead (best-effort: falha aqui nunca impede a pessoa de entrar no grupo).
  -- Teto anti-abuso: no máximo 300 leads por minuto por campanha.
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

      -- contato do CRM: casa pelo DDD + 8 últimos dígitos (o WhatsApp às vezes grava sem o 9)
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

-- 12) Tick do pg_cron: só chama a função quando há trabalho ----------------------------------------
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
                        AND (g.participantes_em IS NULL OR g.participantes_em < now() - interval '10 minutes')) THEN
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

-- 13) Agenda (fora da transação). Reagendar com o mesmo nome substitui. --------------------------
SELECT cron.schedule('grupos-disparo-tick', '* * * * *', 'SELECT public.grupos_disparo_tick()');

-- =============================================================
-- DEPOIS DE RODAR:
--  1) Publicar a edge function grupos-disparo-tick (verify_jwt = false; ela confere o segredo do
--     pg_cron ou o JWT de usuário aprovado).
--  2) Aplicar na VPS o proxy novo (infra/wa-proxy: rotas group-allowlist / send-group-text /
--     send-group-media). Sem isso a mensagem sai como "falhou: proxy 404" em cada grupo.
--  3) Número dedicado: cadastre na Central (crm_numeros, tipo openwa, sessao_openwa), liste a sessão em
--     OPENWA_SESSOES_EXTRAS no proxy.env da VPS e ligue o secret WA_PROXY_MULTISESSAO=1.
--  Parar tudo de uma vez: UPDATE public.grupos_campanhas SET disparos_pausados = true;
--                         SELECT cron.unschedule('grupos-disparo-tick');
-- =============================================================
