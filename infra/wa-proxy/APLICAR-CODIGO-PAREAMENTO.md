# Proxy da VPS: código de pareamento (entrar com número de telefone)

O que muda no `headturbo-wa-proxy` (`lib.mjs` + `server.mjs`, testes em `src/test/codigoPareamento.test.tsx`):
rota fechada nova `pairing-code`, `{ phone, sessao? }`. Vai ao OpenWA v0.24.0
`POST /sessions/:id/pairing-code` com `{ phoneNumber }` (papel OPERATOR, a mesma chave por sessão que já lê o QR)
e devolve só `{ pairingCode, status }`, com o código conferido (8 letras/números). Limite próprio, por sessão:
3 por minuto e 15 por hora (em memória). O código nunca vai para o log (só rota, status e final do telefone).
Prazo da chamada ao OpenWA: 80 s (o whatsapp-web.js tenta até 4x15 s enquanto a página do QR recarrega).

Antes de aplicar, `lib.mjs` e `server.mjs` da VPS tinham o mesmo sha256 da origin/main (conferido em 19/10/2026).
Copiar os dois inteiros não desfaz nada.

Ordem não importa: enquanto o proxy não tiver a rota (404 "não existe"), a aba "Número de telefone" do modal
Conectar mostra "A ponte da VPS ainda não tem o pedido de código" e o QR continua funcionando.

## Aplicar (não foi aplicado; quem aplica é o Breno ou o Paulo com OK dele)

Do Mac, na pasta do repo:

```bash
scp infra/wa-proxy/lib.mjs infra/wa-proxy/server.mjs head-turbo-vps:/tmp/
```

Na VPS (`ssh head-turbo-vps`):

```bash
sudo cp -a /opt/headturbo-wa-proxy /opt/headturbo-wa-proxy.bak-$(date +%F-%H%M)
sudo install -m 0644 /tmp/lib.mjs /tmp/server.mjs /opt/headturbo-wa-proxy/
cd /opt/headturbo-wa-proxy
sudo docker compose build wa-proxy
sudo docker compose up -d --force-recreate --no-deps wa-proxy
```

## Conferir

```bash
curl -s http://127.0.0.1:2786/healthz                                                        # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:2786/v1/pairing-code       # 401 (rota existe, sem assinatura); antes era 404
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:2786/v1/logout             # 404 (continua não existindo)
```

Depois, no CRM: /crm/conexoes > Conectar (num número desconectado, com a sessão em qr_ready) > aba
"Número de telefone" > digitar o número > Gerar código. No celular: WhatsApp > Aparelhos conectados > Conectar
aparelho > Conectar com número de telefone > digitar o código. O modal fecha sozinho quando a sessão fica "ready".

Cuidado (OpenWA #1653, medido pelo próprio projeto no whatsapp-web.js): pedir código para um número que JÁ tem
sessão ligada pode fazer o WhatsApp desligar aquele aparelho. A função recusa telefone gravado em outro número do
CRM, mas não enxerga número ligado fora do CRM: teste com um número que não está conectado em lugar nenhum.

## Voltar atrás

```bash
B=$(ls -d /opt/headturbo-wa-proxy.bak-* | tail -1)
sudo install -m 0644 "$B/lib.mjs" "$B/server.mjs" /opt/headturbo-wa-proxy/
cd /opt/headturbo-wa-proxy && sudo docker compose build wa-proxy && sudo docker compose up -d --force-recreate --no-deps wa-proxy
```

Com o proxy antigo nada quebra: só a aba do código avisa que falta a atualização.
