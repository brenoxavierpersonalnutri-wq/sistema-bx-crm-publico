DO $$
DECLARE
  v_rotator_id uuid;
BEGIN
  -- Busca rotator existente ou cria novo
  SELECT id INTO v_rotator_id
  FROM public.rotator_links
  WHERE slug = 'implementacao'
  LIMIT 1;

  IF v_rotator_id IS NULL THEN
    INSERT INTO public.rotator_links (slug, name)
    VALUES ('implementacao', 'Implementação')
    RETURNING id INTO v_rotator_id;
  ELSE
    -- Limpa destinos antigos para não duplicar
    DELETE FROM public.rotator_destinations
    WHERE rotator_id = v_rotator_id;
  END IF;

  -- Insere os 5 destinos
  INSERT INTO public.rotator_destinations (rotator_id, label, url, weight)
  VALUES
    (v_rotator_id, 'v1', 'https://bgimplementacao.brenoxavier.com.br/implementacao/v1', 20),
    (v_rotator_id, 'v2', 'https://bgimplementacao.brenoxavier.com.br/implementacao/v2', 20),
    (v_rotator_id, 'v3', 'https://bgimplementacao.brenoxavier.com.br/implementacao/v3', 20),
    (v_rotator_id, 'v4', 'https://bgimplementacao.brenoxavier.com.br/implementacao/v4', 20),
    (v_rotator_id, 'v5', 'https://bgimplementacao.brenoxavier.com.br/implementacao/v5', 20);
END $$;