# headturbo-wa-proxy: Node puro, sem dependências de npm.
FROM node:22-alpine
# ffmpeg (com libopus): converte todo áudio com ptt em Ogg/Opus mono 48 kHz, o formato da nota de voz.
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY lib.mjs server.mjs ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.mjs"]
