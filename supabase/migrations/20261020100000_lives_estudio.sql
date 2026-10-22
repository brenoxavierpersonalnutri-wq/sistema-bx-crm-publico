-- =============================================================
-- LIVES (Fase 1): estúdio no navegador (LiveKit self-host na VPS) + Egress para RTMP.
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente.
--
-- Acesso: admin, ou usuário aprovado com o módulo "lives" liberado (user_modules).
-- Segredos NUNCA passam pelo front:
--   live_destinations.chave_cifrada: AES-256-GCM feita na edge function live-control com
--     LIVE_CHAVES_SEGREDO (env da função). O authenticated não tem SELECT nessa coluna.
--   live_invites.token_hash: sha256 do token do convite; o token puro só aparece uma vez,
--     na resposta de live-control (criar-convite).
-- Escrita de status/egress/destinos/convites: só a edge function (service_role).
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.pode_lives(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'admin')
      OR (public.is_approved(_uid) AND public.has_module(_uid, 'lives'))
$$;
REVOKE ALL ON FUNCTION public.pode_lives(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pode_lives(uuid) TO authenticated, service_role;

-- 1) Salas ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.live_rooms (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           uuid NOT NULL DEFAULT auth.uid(),
  titulo             text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 160),
  livekit_room       text UNIQUE,
  layout             text NOT NULL DEFAULT 'grade' CHECK (layout IN ('solo', 'lado-a-lado', 'grade', 'tela-pip')),
  cor                text CHECK (cor IS NULL OR cor ~ '^#[0-9a-fA-F]{6}$'),
  status             text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'ao_vivo', 'encerrada')),
  egress_id          text,
  gravacao_egress_id text,
  cf_live_input_uid  text,
  cf_hls_url         text,
  cf_conectado       boolean NOT NULL DEFAULT false,
  cf_ultima_gravacao text,
  ultimo_erro        text,
  iniciada_em        timestamptz,
  encerrada_em       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_rooms_cf_input_idx ON public.live_rooms (cf_live_input_uid);

-- nome da sala no LiveKit = live_<id>, fixado no insert
CREATE OR REPLACE FUNCTION public.live_rooms_antes()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.livekit_room := 'live_' || replace(NEW.id::text, '-', '');
  ELSE
    NEW.livekit_room := OLD.livekit_room;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS live_rooms_antes ON public.live_rooms;
CREATE TRIGGER live_rooms_antes BEFORE INSERT OR UPDATE ON public.live_rooms
  FOR EACH ROW EXECUTE FUNCTION public.live_rooms_antes();

-- 2) Destinos RTMP --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.live_destinations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       uuid NOT NULL REFERENCES public.live_rooms(id) ON DELETE CASCADE,
  tipo          text NOT NULL CHECK (tipo IN ('youtube', 'facebook', 'instagram', 'cloudflare', 'custom')),
  nome          text NOT NULL CHECK (length(nome) BETWEEN 1 AND 80),
  rtmp_url      text NOT NULL CHECK (rtmp_url ~* '^rtmps?://'),
  chave_cifrada text NOT NULL CHECK (chave_cifrada LIKE 'v1.%'),
  chave_final   text NOT NULL DEFAULT '••••',
  ativo         boolean NOT NULL DEFAULT true,
  no_ar         boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_destinations_room_idx ON public.live_destinations (room_id);

-- 3) Convites (link para convidado entrar no estúdio) ----------------------------------------
CREATE TABLE IF NOT EXISTS public.live_invites (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id        uuid NOT NULL REFERENCES public.live_rooms(id) ON DELETE CASCADE,
  token_hash     text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  nome_convidado text NOT NULL CHECK (length(nome_convidado) BETWEEN 1 AND 80),
  expira_em      timestamptz NOT NULL,
  usado_em       timestamptz,
  revogado       boolean NOT NULL DEFAULT false,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_invites_room_idx ON public.live_invites (room_id);

-- 4) Overlays (logo, lower third, banner) -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.live_overlays (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    uuid NOT NULL REFERENCES public.live_rooms(id) ON DELETE CASCADE,
  tipo       text NOT NULL CHECK (tipo IN ('logo', 'lower_third', 'banner')),
  conteudo   jsonb NOT NULL DEFAULT '{}'::jsonb,
  visivel    boolean NOT NULL DEFAULT false,
  ordem      int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_overlays_room_idx ON public.live_overlays (room_id);

-- 5) RLS e grants ------------------------------------------------------------------------------
ALTER TABLE public.live_rooms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_invites      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_overlays     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.live_rooms, public.live_destinations, public.live_invites, public.live_overlays
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.live_rooms, public.live_destinations, public.live_invites, public.live_overlays
  TO service_role;

-- salas: lê tudo; cria/edita só título, layout e cor; status/egress são da função
GRANT SELECT, DELETE ON public.live_rooms TO authenticated;
GRANT INSERT (titulo, layout, cor) ON public.live_rooms TO authenticated;
GRANT UPDATE (titulo, layout, cor) ON public.live_rooms TO authenticated;
DROP POLICY IF EXISTS "Lives le salas" ON public.live_rooms;
CREATE POLICY "Lives le salas" ON public.live_rooms FOR SELECT TO authenticated USING (public.pode_lives(auth.uid()));
DROP POLICY IF EXISTS "Lives cria salas" ON public.live_rooms;
CREATE POLICY "Lives cria salas" ON public.live_rooms FOR INSERT TO authenticated
  WITH CHECK (public.pode_lives(auth.uid()) AND owner_id = auth.uid());
DROP POLICY IF EXISTS "Lives edita salas" ON public.live_rooms;
CREATE POLICY "Lives edita salas" ON public.live_rooms FOR UPDATE TO authenticated
  USING (public.pode_lives(auth.uid())) WITH CHECK (public.pode_lives(auth.uid()));
DROP POLICY IF EXISTS "Lives apaga salas" ON public.live_rooms;
CREATE POLICY "Lives apaga salas" ON public.live_rooms FOR DELETE TO authenticated
  USING (public.pode_lives(auth.uid()) AND status <> 'ao_vivo');

-- destinos: front lê sem a coluna cifrada e pode apagar; criar/ligar/desligar = live-control
GRANT SELECT (id, room_id, tipo, nome, rtmp_url, chave_final, ativo, no_ar, created_at, updated_at)
  ON public.live_destinations TO authenticated;
GRANT DELETE ON public.live_destinations TO authenticated;
DROP POLICY IF EXISTS "Lives le destinos" ON public.live_destinations;
CREATE POLICY "Lives le destinos" ON public.live_destinations FOR SELECT TO authenticated
  USING (public.pode_lives(auth.uid()));
DROP POLICY IF EXISTS "Lives apaga destinos" ON public.live_destinations;
CREATE POLICY "Lives apaga destinos" ON public.live_destinations FOR DELETE TO authenticated
  USING (public.pode_lives(auth.uid()) AND NOT no_ar);

-- convites: front lê sem o hash e pode revogar
GRANT SELECT (id, room_id, nome_convidado, expira_em, usado_em, revogado, created_at)
  ON public.live_invites TO authenticated;
GRANT UPDATE (revogado) ON public.live_invites TO authenticated;
DROP POLICY IF EXISTS "Lives le convites" ON public.live_invites;
CREATE POLICY "Lives le convites" ON public.live_invites FOR SELECT TO authenticated
  USING (public.pode_lives(auth.uid()));
DROP POLICY IF EXISTS "Lives revoga convites" ON public.live_invites;
CREATE POLICY "Lives revoga convites" ON public.live_invites FOR UPDATE TO authenticated
  USING (public.pode_lives(auth.uid())) WITH CHECK (public.pode_lives(auth.uid()));

-- overlays: CRUD do produtor (live-control só espelha na metadata da sala)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_overlays TO authenticated;
DROP POLICY IF EXISTS "Lives overlays" ON public.live_overlays;
CREATE POLICY "Lives overlays" ON public.live_overlays FOR ALL TO authenticated
  USING (public.pode_lives(auth.uid())) WITH CHECK (public.pode_lives(auth.uid()));

COMMIT;

-- =============================================================
-- DEPOIS DE RODAR:
--  1) Liberar o módulo "lives" para quem opera (Usuários > módulos) — admin já entra.
--  2) Secrets das edge functions (Lovable > Cloud > Secrets):
--       LIVEKIT_URL=https://livekit.brenoxavier.com.br   LIVEKIT_API_KEY=...   LIVEKIT_API_SECRET=...
--       LIVE_CHAVES_SEGREDO=<64+ caracteres aleatórios; trocar depois invalida as chaves salvas>
--       LIVE_SITE_URL=https://equipe.brenoxavier.com.br
--       CF_ACCOUNT_ID, CF_STREAM_TOKEN, CF_STREAM_CUSTOMER_CODE (customer-xxxx), CF_STREAM_WEBHOOK_SECRET
--  3) Publicar live-token, live-control, livekit-webhook, cf-stream-webhook.
-- =============================================================
