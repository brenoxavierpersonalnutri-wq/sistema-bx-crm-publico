-- Volume parecido com o de produção para o EXPLAIN: 10 mil conversas em 5 números e 300 mil mensagens.
-- (a lista de conversas lê até 10 mil contatos; a janela de recentes lê 2 mil mensagens)
INSERT INTO public.whatsapp_contacts (numero_id, phone, name, updated_at)
SELECT n.id, '55' || lpad((31000000000 + g)::text, 11, '0'), 'Lead ' || g, now() - (g || ' minutes')::interval
  FROM generate_series(1, 10000) g
  JOIN LATERAL (SELECT id FROM public.crm_numeros ORDER BY ordem OFFSET (g % 5) LIMIT 1) n ON true;
INSERT INTO public.whatsapp_messages (numero_id, contact_phone, body, direction, created_at, message_id)
SELECT c.numero_id, c.phone, 'mensagem ' || g, CASE WHEN g % 2 = 0 THEN 'outbound' ELSE 'inbound' END,
       c.updated_at - (g || ' minutes')::interval, 'vol-' || c.phone || '-' || g
  FROM public.whatsapp_contacts c, generate_series(1, 30) g
 WHERE c.name LIKE 'Lead %';
ANALYZE;
