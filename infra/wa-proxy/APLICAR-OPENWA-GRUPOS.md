# 2ª instância do OpenWA (motor Baileys) para o número de grupos — 19/10/2026

Modelo híbrido aprovado pelo Breno: a instância principal (`/opt/openwa`, whatsapp-web.js, container
`headturbo-openwa-api`, `127.0.0.1:2785`) continua com closer e os números do time, intocada. O número
dedicado a grupos (sessão `grupos-1`) roda numa instância separada, com motor Baileys.

| | principal | grupos |
|---|---|---|
| pasta | `/opt/openwa` | `/opt/openwa-grupos` |
| projeto compose | `headturbo-openwa` | `headturbo-openwa-grupos` |
| container | `headturbo-openwa-api` | `headturbo-openwa-grupos-api` |
| motor | whatsapp-web.js | baileys (`BAILEYS_SYNC_FULL_HISTORY=false`, `BAILEYS_MARK_ONLINE_ON_CONNECT=false`) |
| porta (só local) | `127.0.0.1:2785` | `127.0.0.1:2787` |
| volume (sqlite + sessão) | `headturbo_openwa_data` | `headturbo_openwa_grupos_data` |
| rede | `headturbo-openwa_net` 172.20.0.0/16 | `headturbo-openwa-grupos_net` 172.21.0.0/16 |
| IP do proxy na rede | 172.20.0.50 | 172.21.0.50 |
| imagem | `headturbo-openwa-api:e9afb97da44f` | a mesma (sem rebuild; o motor é escolhido por `ENGINE_TYPE`) |
| sessões | closer, comercial-fit-2, suporte-consultoria-1, comercial-implementacao-1 | grupos-1 (`MAX_CONCURRENT_SESSIONS=1`) |

Ritmo de envio (`SEND_PACING_*`, `SIMULATE_TYPING*`) copiado da principal. Chaves (`API_MASTER_KEY`,
`API_KEY_PEPPER`) geradas com `openssl rand -hex 32` direto no `.env` (root 0600), sem eco.

## Proxy

`OPENWA_BASE_<NOME>` (no `environment` do compose; não é segredo) manda a sessão para outra instância.
Sem a variável, a sessão segue em `OPENWA_BASE`, como antes. Variável inválida: 503 só naquela sessão.
A chave da sessão continua no mesmo lugar das outras extras: `OPENWA_OPERATOR_KEY_GRUPOS_1` e
`OPENWA_SESSION_ID_GRUPOS_1` em `/etc/headturbo-wa-proxy/proxy.env`, e `grupos-1` em `OPENWA_SESSOES_EXTRAS`.

501 do motor (Baileys não tem histórico ao vivo): `history` responde 200 `[]` (cabeçalho `X-Sem-Historico: 1`);
`chats-recentes` devolve as conversas com `mensagens: []` sem marcar parcial; `media-id` sem arquivo guardado
responde 404 `sem-historico` (final, o CRM não repete). O log `inicio` mostra `sessoesComInstanciaPropria`.

Testes: `src/test/waProxyInstancias.test.ts` (sobe o `server.mjs` contra dois OpenWA falsos).

## Aplicar (root, na VPS)

```bash
# 0) instância nova já de pé (docker compose up -d em /opt/openwa-grupos) e sessão grupos-1 criada
# 1) backup
B=/opt/headturbo-wa-proxy/backup-$(date +%Y%m%d-%H%M%S)-openwa-grupos
sudo install -d -m 700 "$B"
sudo cp -a /opt/headturbo-wa-proxy/{lib.mjs,server.mjs,docker-compose.yml} "$B"/
sudo cp -a /etc/headturbo-wa-proxy/proxy.env "$B"/proxy.env
sudo cp -a /usr/local/sbin/headturbo-openwa-chave-sessao /usr/local/sbin/headturbo-openwa-webhook-crm "$B"/
# 2) scripts novos (aceitam --instancia grupos; sem a opção = igual a antes)
sudo install -m 700 headturbo-openwa-chave-sessao /usr/local/sbin/
sudo install -m 755 headturbo-openwa-webhook-crm /usr/local/sbin/
# 3) chave operator da sessão (restrita a grupos-1 e ao IP 172.21.0.50), gravada no proxy.env
sudo headturbo-openwa-chave-sessao grupos-1 --instancia grupos            # seco
sudo headturbo-openwa-chave-sessao grupos-1 --instancia grupos --executar
# 4) proxy novo, SÓ o container do proxy
sudo cp lib.mjs server.mjs docker-compose.yml /opt/headturbo-wa-proxy/
cd /opt/headturbo-wa-proxy && sudo docker compose build wa-proxy && sudo docker compose up -d --force-recreate --no-deps wa-proxy
# 5) webhook da sessão para o CRM (seco antes)
sudo headturbo-openwa-webhook-crm --instancia grupos --sessao grupos-1 --com-eventos-grupo
sudo headturbo-openwa-webhook-crm --instancia grupos --sessao grupos-1 --com-eventos-grupo --executar
# 6) iniciar a sessão (gera QR; o Breno pareia pela tela Conexões)
#    POST http://127.0.0.1:2787/api/sessions/<id>/start com a chave admin da instância (curl --config 0600)
```

CRM: rodar `supabase/migrations/20261107100000_crm_numero_grupos_1.sql` no SQL editor do Lovable Cloud
(cartão "Grupos 1" em /crm/conexoes). `wa_proxy_multisessao` já está ligado desde 17/10.

## Conferir

```bash
sudo docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'openwa|wa-proxy'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:2787/api/health          # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:2786/v1/status    # 401 (sem assinatura)
sudo docker logs headturbo-wa-proxy 2>&1 | grep '"inicio"' | tail -1                # sessoesComInstanciaPropria ["grupos-1"]
```

Nunca `docker logs`/`inspect`/`exec env` nos containers do OpenWA (o 1º boot imprime a chave; o log do 1º boot da
instância de grupos foi zerado). Nunca `docker compose down` em nada.

## Rollback

```bash
# para SÓ a instância de grupos (volume e sessão ficam; volta com "start")
cd /opt/openwa-grupos && sudo docker compose stop
# proxy de volta ao backup
B=<pasta do backup acima>
sudo cp -a "$B"/{lib.mjs,server.mjs,docker-compose.yml} /opt/headturbo-wa-proxy/
sudo cp -a "$B"/proxy.env /etc/headturbo-wa-proxy/proxy.env
sudo cp -a "$B"/headturbo-openwa-chave-sessao "$B"/headturbo-openwa-webhook-crm /usr/local/sbin/
cd /opt/headturbo-wa-proxy && sudo docker compose build wa-proxy && sudo docker compose up -d --force-recreate --no-deps wa-proxy
```

O compose antigo do proxy não cita a rede `headturbo-openwa-grupos_net`, então o rollback do proxy funciona com a
instância de grupos parada ou de pé. No CRM, o cartão sai com `UPDATE public.crm_numeros SET ativo = false WHERE chave = 'grupos-1';`.
Remover de vez a instância (só com OK do Breno; apaga a sessão pareada): `sudo docker rm headturbo-openwa-grupos-api`,
`sudo docker volume rm headturbo_openwa_grupos_data`, `sudo docker network rm headturbo-openwa-grupos_net`, `trash /opt/openwa-grupos`.
