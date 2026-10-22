# Proxy: permissão do número no grupo e nome do grupo — 20/10/2026

Para a seção **Disparo em grupo** do CRM (`/crm/disparo-grupos`).

| Rota | O que muda | OpenWA |
|---|---|---|
| `group-info` | passa a devolver também `souAdmin` (o número da sessão é admin?), `announce` (só admins enviam) e `locked` (só admins editam). Continua sem a lista de participantes. | `GET /sessions/:id` (telefone da sessão, cache 10 min) + `GET .../groups/:g` |
| `group-subject` (nova, admin) | `{ chatId, subject (1-100) }` muda o nome do grupo. Só grupo da allowlist; limite de escrita de admin (20/min, 300/dia por sessão). | `PUT .../groups/:g/subject` |

Sem o proxy novo o CRM funciona: a permissão aparece como "não lida" e trocar o nome volta erro do proxy (o resto
da configuração — descrição, foto, ajustes, admins — já existia).

Testes: `src/test/disparoGrupos.test.ts` (unidade) e `src/test/waProxyPermissaoGrupo.test.ts` (sobe o `server.mjs`
contra um OpenWA falso).

## Aplicar (root, na VPS)

```bash
B=/opt/headturbo-wa-proxy/backup-$(date +%Y%m%d-%H%M%S)-disparo-grupos
sudo install -d -m 700 "$B" && sudo cp -a /opt/headturbo-wa-proxy/{lib.mjs,server.mjs} "$B"/
sudo cp lib.mjs server.mjs /opt/headturbo-wa-proxy/
cd /opt/headturbo-wa-proxy && sudo docker compose build wa-proxy && sudo docker compose up -d --force-recreate --no-deps wa-proxy
# voltar: sudo cp -a "$B"/{lib.mjs,server.mjs} /opt/headturbo-wa-proxy/ e o mesmo build/up
```
