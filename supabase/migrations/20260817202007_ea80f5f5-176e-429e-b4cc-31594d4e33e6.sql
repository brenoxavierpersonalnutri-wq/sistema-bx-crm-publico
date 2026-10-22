CREATE POLICY "Authenticated can upload whatsapp media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'whatsapp-media');

CREATE POLICY "Authenticated can read whatsapp media"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'whatsapp-media');

CREATE POLICY "Authenticated can update whatsapp media"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'whatsapp-media');