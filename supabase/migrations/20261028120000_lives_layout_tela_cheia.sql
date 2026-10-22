-- Estúdio de lives: libera o 5º layout "tela-cheia" (só a tela compartilhada) em live_rooms.layout.
-- Idempotente: derruba qualquer CHECK de layout existente (o nome padrão é live_rooms_layout_check)
-- e recria com os 5 valores. Não toca em dado: os 4 valores antigos continuam válidos.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'live_rooms' AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%layout%'
  LOOP
    EXECUTE format('ALTER TABLE public.live_rooms DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.live_rooms
  ADD CONSTRAINT live_rooms_layout_check
  CHECK (layout IN ('solo', 'lado-a-lado', 'grade', 'tela-pip', 'tela-cheia'));
