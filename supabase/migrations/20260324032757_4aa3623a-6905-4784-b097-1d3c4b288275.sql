-- Update "site" and NULL via values to "trafego" (Tráfego Direto)
UPDATE consultations SET via = 'trafego' WHERE via = 'site' OR via IS NULL;