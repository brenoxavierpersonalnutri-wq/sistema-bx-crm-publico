# headturbo-livekit — estúdio de lives na VPS

LiveKit (SFU + TURN) + Egress (Chrome que renderiza `https://equipe.brenoxavier.com.br/lives/render/:id`
e manda RTMP para YouTube/Facebook/Instagram/Cloudflare) + Redis. Nada aqui foi instalado: estes
são os passos, para o Breno (ou o Paulo com OK dele) rodar na VPS `203.0.113.10`.

## O que precisa existir antes

1. **DNS na Cloudflare, "DNS only" (nuvem cinza)** — proxy laranja quebra WebRTC/TURN:
   - `livekit.brenoxavier.com.br` A `203.0.113.10`
   - `turn.brenoxavier.com.br` A `203.0.113.10`
2. Stack do Caddy em `/opt/head-turbo` rodando (a mesma do n8n e do wa-gw).

## 1. Firewall (ufw)

```bash
sudo ufw allow 50000:60000/udp comment 'livekit ICE'
sudo ufw allow 7881/tcp        comment 'livekit ICE/TCP'
sudo ufw allow 3478/udp        comment 'livekit TURN/UDP'
sudo ufw allow 5349/tcp        comment 'livekit TURN/TLS'
# Caddy (container) -> LiveKit (rede host) na 7880. NÃO abrir a 7880 para a internet.
GW=$(docker network inspect head-turbo_default -f '{{(index .IPAM.Config 0).Subnet}}')
sudo ufw allow from "$GW" to any port 7880 proto tcp comment 'caddy -> livekit'
sudo ufw status numbered
```

Se a Hostinger tiver firewall no painel (hPanel > VPS > Firewall), abrir as mesmas portas lá.

## 2. Arquivos

```bash
sudo mkdir -p /opt/headturbo-livekit /etc/headturbo-livekit
sudo cp docker-compose.yml livekit.yaml /opt/headturbo-livekit/
sudo mkdir -p /opt/headturbo-livekit/gravacoes && sudo chown 1001:1001 /opt/headturbo-livekit/gravacoes

API_KEY=API$(openssl rand -hex 6)
API_SECRET=$(openssl rand -base64 48 | tr -d '/+=' | cut -c1-43)
echo "LIVEKIT_KEYS=\"$API_KEY: $API_SECRET\"" | sudo tee /etc/headturbo-livekit/livekit.env >/dev/null
sed -e "s/TROCAR_PELA_API_KEY/$API_KEY/" -e "s/TROCAR_PELO_API_SECRET/$API_SECRET/" egress.yaml.exemplo \
  | sudo tee /etc/headturbo-livekit/egress.yaml >/dev/null
sudo sed -i "s/TROCAR_PELA_API_KEY/$API_KEY/" /opt/headturbo-livekit/livekit.yaml
sudo chmod 600 /etc/headturbo-livekit/*
```

Guardar `API_KEY` e `API_SECRET` só nos secrets das edge functions (passo 5). Nunca em chat.

## 3. Caddy

Acrescentar `Caddyfile.livekit` ao Caddyfile da stack, trocando `GATEWAY_DOCKER` pelo gateway:

```bash
docker network inspect head-turbo_default -f '{{(index .IPAM.Config 0).Gateway}}'
docker exec <container-do-caddy> caddy reload --config /etc/caddy/Caddyfile
```

Esperar o certificado do `turn.brenoxavier.com.br` aparecer no volume do Caddy (o LiveKit lê de lá):

```bash
docker volume ls | grep caddy        # se o nome não for head-turbo_caddy_data, exporte CADDY_DATA_VOLUME
docker run --rm -v head-turbo_caddy_data:/d alpine ls /d/caddy/certificates/acme-v02.api.letsencrypt.org-directory/
```

## 4. Subir

```bash
cd /opt/headturbo-livekit
sudo CADDY_DATA_VOLUME=head-turbo_caddy_data docker compose up -d
docker compose ps
curl -s https://livekit.brenoxavier.com.br      # responde "OK"
docker logs --tail 50 headturbo-livekit-egress  # "service ready"
```

Teste de conectividade WebRTC (de fora): entre em `/lives`, crie uma sala, abra o estúdio e veja a
própria câmera na prévia; depois abra o link de convite em outra rede (4G do celular) para provar o TURN.

Renovação do certificado do TURN: o Caddy renova sozinho; o LiveKit só relê ao reiniciar.
Cron mensal (crontab do root, bloco `# >>> headturbo-livekit-turn-cert`, instalado em 17/10/2026):
`0 4 1 * * /usr/bin/docker restart headturbo-livekit-server` (dia 1, 04:00 BRT).

## 5. Edge functions (Lovable > Cloud > Secrets)

| Secret | Valor |
|---|---|
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | **não colar**: pareamento automático (abaixo). Se existirem no env, vencem |
| `LIVE_CHAVES_SEGREDO` | `openssl rand -base64 48` (cifra as chaves RTMP; trocar invalida as salvas) |
| `LIVE_SITE_URL` | `https://equipe.brenoxavier.com.br` |
| `CF_ACCOUNT_ID`, `CF_STREAM_TOKEN` (Stream:Edit), `CF_STREAM_CUSTOMER_CODE` (`customer-xxxx`), `CF_STREAM_WEBHOOK_SECRET` | Cloudflare Stream |

### Pareamento automático do LiveKit (ninguém cola segredo)

As funções leem `LIVEKIT_*` do env se existir; senão de `integracao_config` chave `livekit`
(JSON, só service role), que a VPS grava UMA vez pela função `live-pareamento`
(IP da VPS + HMAC com o `WA_PROXY_SECRET` já pareado, janela 5 min, nonce único; depois 410).

```bash
sudo install -o root -g root -m 0700 headturbo-live-parear /usr/local/sbin/
sudo headturbo-live-parear             # seco: confere arquivos e publicação, não envia nada
sudo headturbo-live-parear --executar  # depois da migration 20261025090000 e da função publicada
```

Sai só status HTTP e um hash de 12 hex (recalculado localmente: "confere"). Trocou a chave do
LiveKit? O dono roda no SQL `SELECT public.live_pareamento_reabrir();` e a VPS roda `--executar` de novo.

## 6. Vídeo da aula (Ingress URL_INPUT + headturbo-aulas) — instalado em 20/10/2026

Arquivo pré-gravado tocado "ao vivo" no palco (com banners/marca): o navegador sobe o MP4/MOV em pedaços de 16 MB
para `headturbo-aulas` (Python stdlib, systemd, DynamicUser) via `https://livekit.brenoxavier.com.br/aulas/up/<id>`;
o Ingress (`livekit/ingress:v1.5.0`, rede host) lê `http://172.18.0.1:7890/aulas/arquivo/<id>?t=...` e publica o
participante "Vídeo da aula" (720p, 1 camada). Tokens HS256 com chave = hex(HMAC(api_secret, "headturbo-aulas-v1")),
emitidos pela edge function `live-aula`. Nenhuma porta nova para fora: RTMP/WHIP do Ingress desligados (-1), relay em
localhost:9090, 7890 só para 172.18.0.0/16, `/aulas/arquivo` não passa pelo Caddy.

```bash
# Ingress
grep -E "^api_key:|^api_secret:" /etc/headturbo-livekit/egress.yaml > /etc/headturbo-livekit/ingress.yaml
sed -n '/^ws_url/,$p' ingress.yaml.exemplo >> /etc/headturbo-livekit/ingress.yaml   # resto da config
chmod 600 /etc/headturbo-livekit/ingress.yaml
cp docker-compose.yml /opt/headturbo-livekit/ && cd /opt/headturbo-livekit && docker compose up -d --no-deps ingress
# servidor de aulas
install -d /usr/local/lib/headturbo-aulas && install -m 0644 aulas/headturbo-aulas.py /usr/local/lib/headturbo-aulas/
install -m 0644 aulas/headturbo-aulas.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now headturbo-aulas
ufw allow from 172.18.0.0/16 to 172.18.0.1 port 7890 proto tcp comment "caddy -> headturbo-aulas"
```

No Caddyfile, o bloco `livekit.brenoxavier.com.br` ganha `@aulas path /aulas/up/* /aulas/fim/* /aulas/saude` ->
`172.18.0.1:7890` (handle) e o resto -> `172.18.0.1:7880`. Arquivos em `/var/lib/headturbo-aulas` (limite 8 GB por
arquivo; recusa se o disco ficar com menos de 5 GB). Conferir: `curl -s https://livekit.brenoxavier.com.br/aulas/saude`.
Desfazer: `docker compose stop ingress`, `systemctl disable --now headturbo-aulas`, voltar o Caddyfile do backup.

## Recursos

VPS KVM 4 (4 vCPU, 15 GB). Egress: `cpus: 3`, `mem_limit: 6g` (um RoomComposite 1080p30 por vez).
LiveKit: 1,5 CPU / 2 GB. Redis: 0,5 / 256 MB. O PostgreSQL de memória e o n8n continuam com folga,
mas **durante uma live** o Egress usa quase toda a CPU: evite rodar build ou backup pesado no horário.

## Desligar / remover

```bash
cd /opt/headturbo-livekit && sudo docker compose down     # para tudo (dados não importam: Redis é efêmero)
```
Remover as regras do ufw e o bloco do Caddy desfaz o resto.
