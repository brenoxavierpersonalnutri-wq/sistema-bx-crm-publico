-- =============================================================
-- Desafio Magra e Definida: v6 (dobra da página oficial) no rotador
-- "desafio" e os 6 destinos com peso igual. Idempotente.
--
-- rotator_destinations.weight é integer: 10 para cada um (o sorteio usa o
-- peso relativo, então 6 x 10 = 1/6 para cada variação).
-- Nunca apaga destino (apagar destino apaga os cliques dele em cascata):
-- cria o que falta e acerta url/peso dos que existem.
-- =============================================================
DO $$
DECLARE
  v_rotator_id uuid;
  v_label text;
  v_url text;
BEGIN
  SELECT id INTO v_rotator_id FROM public.rotator_links WHERE slug = 'desafio' LIMIT 1;

  IF v_rotator_id IS NULL THEN
    INSERT INTO public.rotator_links (slug, name)
    VALUES ('desafio', 'Desafio Magra e Definida (promessas)')
    RETURNING id INTO v_rotator_id;
  END IF;

  FOREACH v_label IN ARRAY ARRAY['v1', 'v2', 'v3', 'v4', 'v5', 'v6'] LOOP
    v_url := 'https://equipe.brenoxavier.com.br/desafio/' || v_label;
    IF EXISTS (SELECT 1 FROM public.rotator_destinations WHERE rotator_id = v_rotator_id AND label = v_label) THEN
      UPDATE public.rotator_destinations
         SET url = v_url, weight = 10
       WHERE rotator_id = v_rotator_id AND label = v_label;
    ELSE
      INSERT INTO public.rotator_destinations (rotator_id, label, url, weight)
      VALUES (v_rotator_id, v_label, v_url, 10);
    END IF;
  END LOOP;
END $$;

-- Conferência (rode depois e olhe o resultado: 6 linhas, peso 10 cada):
-- SELECT d.label, d.url, d.weight,
--        (SELECT count(*) FROM public.rotator_clicks c WHERE c.destination_id = d.id) AS cliques
--   FROM public.rotator_links l JOIN public.rotator_destinations d ON d.rotator_id = l.id
--  WHERE l.slug = 'desafio' ORDER BY d.label;
