# ============ deps + build ============
FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache git openssh-client netcat-openbsd tzdata \
  && ln -snf /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime \
  && echo America/Sao_Paulo > /etc/timezone

RUN git config --global url."https://".insteadOf ssh://

# Manifests
COPY package.json package-lock.json ./
RUN npm ci

# Código do backend (inclui scripts)
COPY . .

# EntryPoint (se existir)
RUN if [ -f ./docker-entrypoint.sh ]; then chmod +x ./docker-entrypoint.sh; fi

# ===== Certificados (OPCIONAL) =====
# Se você manter o contexto em backend/, não dá para copiar a pasta /certs da raiz do repo.
# Portanto, comente o COPY abaixo ou crie uma pasta `backend/certs/` no repo e troque o caminho.
# COPY certs ./certs-temp

RUN if [ -f ./copy_cert_assets.sh ] && [ -d ./certs-temp ]; then \
      chmod +x ./copy_cert_assets.sh && ./copy_cert_assets.sh && rm -rf ./certs-temp ; \
    else \
      echo "Sem certificados/roteiro: pulando etapa de certs." ; \
    fi

RUN npm run build || echo "Sem etapa de build explícita"

# ============ runtime ============
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo
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

COPY --from=deps /app/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN if [ -f /app/docker-entrypoint.sh ]; then chmod +x /app/docker-entrypoint.sh; fi

EXPOSE 3000
CMD ["/app/docker-entrypoint.sh"]
