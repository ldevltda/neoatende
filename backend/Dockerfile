# ============ deps + build ============
FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache git openssh-client netcat-openbsd tzdata \
  && ln -snf /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime \
  && echo America/Sao_Paulo > /etc/timezone

RUN git config --global url."https://".insteadOf ssh://

# Copia manifests do backend (NPM)
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# Código do backend (inclui docker-entrypoint.sh e, se existir, copy_cert_assets.sh)
COPY backend/ .

# 🔧 AJUSTE 1: garanta que SEMPRE exista um entrypoint em /app (fallback se faltar no repo)
RUN if [ ! -f ./docker-entrypoint.sh ]; then \
      echo "Criando docker-entrypoint.sh fallback"; \
      printf '%s\n' \
        '#!/bin/sh' \
        'set -e' \
        'echo "[entrypoint] Iniciando backend..."' \
        'if [ ! -d dist ]; then echo "[entrypoint] dist/ ausente; executando build"; npm run build || true; fi' \
        'if [ -f dist/server.js ]; then exec node dist/server.js; fi' \
        'if [ -f dist/main.js ];   then exec node dist/main.js;   fi' \
        'if [ -f dist/index.js ];  then exec node dist/index.js;  fi' \
        'echo "[entrypoint] Nenhum arquivo dist/{server,main,index}.js encontrado"; ls -la dist || true; exit 1' \
      > ./docker-entrypoint.sh; \
    fi \
 && chmod +x ./docker-entrypoint.sh

# 🔧 AJUSTE 2: torne certificados opcionais (SEM COPY que falha quando a pasta não existe)
#    - Em vez de "COPY certificates ./certs-temp", apenas crie a pasta.
#    - Se você realmente tiver a pasta, pode reativar o COPY mais tarde.
RUN mkdir -p /app/certs-temp

# 🔧 AJUSTE 3: rode o script de certificados SE ele existir (sem falhar se não existir)
RUN if [ -f ./copy_cert_assets.sh ]; then \
      chmod +x ./copy_cert_assets.sh && ./copy_cert_assets.sh || true; \
    else \
      echo "copy_cert_assets.sh não encontrado; seguindo sem copiar certificados."; \
    fi \
 && rm -rf /app/certs-temp || true

# Build (se houver)
RUN npm run build || echo "Sem etapa de build explícita"

# ============ runtime ============
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo
# ⚠️ instale o nc aqui também (entrypoint usa "nc")
RUN apk add --no-cache netcat-openbsd tzdata \
  && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
  && echo $TZ > /etc/timezone

ENV HOST=0.0.0.0
ENV PORT=3000
ARG STACK_NAME
ENV STACK_NAME=$STACK_NAME

COPY --from=deps /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=deps /etc/timezone /etc/timezone
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/dist ./dist
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/src ./src

# ✅ Agora este COPY NUNCA quebra, porque garantimos o arquivo no estágio deps (fallback)
COPY --from=deps /app/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
CMD ["/app/docker-entrypoint.sh"]
