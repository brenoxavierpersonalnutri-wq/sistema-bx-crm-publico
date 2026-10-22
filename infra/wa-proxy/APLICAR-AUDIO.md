# Proxy da VPS: nota de voz (todo áudio do sistema)

Desde 21/10/2026 todo áudio com `ptt: true` vira nota de voz de verdade (bolha de microfone com onda, "gravado na
hora"), venha de onde vier: robô de IA, automação, fluxo, disparo a grupo, envio manual pela tela Conversas.

O que o proxy (`lib.mjs` + `server.mjs`, testes em `src/test/waProxyVoz.test.ts`) faz numa rota com ptt
(`send-audio`, `send-group-media`, `send-group-manual-media`):

1. Baixa o arquivo da URL (https, até 16 MB, 20 s).
2. Converte com ffmpeg para **Ogg/Opus mono 48 kHz** (32 kb/s, `-application voip`), o formato que o WhatsApp exige
   para PTT. Já em Ogg/Opus mono 48 kHz, só copia. Cache por sha256 dos bytes em `DATA_DIR/voz/<hash>.ogg`
   (+ `.json` com a duração), até 400 arquivos.
3. Manda ao OpenWA em `base64` com `mimetype: "audio/ogg; codecs=opus"` e `ptt: true` (no whatsapp-web.js vira
   `sendAudioAsVoice`; no Baileys, `audioMessage.ptt`).
4. Só em `send-audio` a telefone e com `gravando` diferente de `false`: antes de mandar, "gravando áudio…"
   (`POST /sessions/:id/chats/typing` com `state: "recording"`, reenviado a cada 8 s) pela duração do áudio, entre
   2 s e 12 s.

Conversão falhou (download, arquivo sem áudio, ffmpeg): 422 `{ motivo: "conversao" }`, sem gastar vaga de envio, e
o CRM cai para `send-document` (`_shared/notaDeVoz.ts`): o lead recebe o arquivo do mesmo jeito.

O Dockerfile instala `ffmpeg` (Alpine, com libopus) e o `mem_limit` subiu para 256m (o ffmpeg e o `/tmp` em tmpfs
contam no teto).

## Aplicar

Do Mac, na pasta do repo:

```bash
scp infra/wa-proxy/lib.mjs infra/wa-proxy/server.mjs infra/wa-proxy/Dockerfile infra/wa-proxy/docker-compose.yml head-turbo-vps:/tmp/
```

Na VPS (`ssh head-turbo-vps`):

```bash
cd /opt/headturbo-wa-proxy
B=backup-$(date +%Y%m%d-%H%M%S)-audio-ptt
sudo mkdir "$B" && sudo cp -a lib.mjs server.mjs Dockerfile docker-compose.yml "$B"/
sudo install -m 0644 /tmp/lib.mjs /tmp/server.mjs /tmp/Dockerfile /tmp/docker-compose.yml /opt/headturbo-wa-proxy/
sudo docker compose build wa-proxy
sudo docker compose up -d --force-recreate --no-deps wa-proxy
```

## Conferir

```bash
curl -s http://127.0.0.1:2786/healthz                                                  # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:2786/v1/send-audio   # 401 (rota existe, sem assinatura)
sudo docker exec headturbo-wa-proxy ffmpeg -hide_banner -encoders | grep libopus        # proxy (não o OpenWA) tem libopus
```

## Voltar atrás

```bash
cd /opt/headturbo-wa-proxy
B=$(ls -d backup-*-audio-ptt | tail -1)
sudo install -m 0644 "$B"/lib.mjs "$B"/server.mjs "$B"/Dockerfile "$B"/docker-compose.yml /opt/headturbo-wa-proxy/
sudo docker compose build wa-proxy && sudo docker compose up -d --force-recreate --no-deps wa-proxy
```

Com o proxy antigo e as edge functions novas: o proxy antigo recusa o campo `gravando` (400). Por isso a ordem é
proxy primeiro, edge functions depois.
