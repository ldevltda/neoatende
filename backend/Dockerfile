# ============ deps + build ============
FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache git openssh-client netcat-openbsd tzdata \
  && ln -snf /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime \
  && echo America/Sao_Paulo > /etc/timezone

RUN git config --global url."https://".insteadOf ssh://

# Manifests do backend (NPM)
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# Código do backend (inclui docker-entrypoint.sh e, se existir, copy_cert_assets.sh)
COPY backend/ .

# (Opcional) Se você QUISER permitir certificados, crie a pasta temporária;
# se não houver nada montado/cop... o script já trata e usa "padrão".
RUN mkdir -p /app/certs-temp

# Executa o script de certificados SE ele existir (não quebra se não existir)
RUN if [ -f ./copy_cert_assets.sh ]; then \
      chmod +x ./copy_cert_assets.sh && ./copy_cert_assets.sh || true; \
    else \
      echo "copy_cert_assets.sh não encontrado; seguindo sem copiar certificados."; \
    fi

# Build (se houver)
RUN npm run build || echo "Sem etapa de build explícita"

# ============ runtime ============
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo
# 'nc' é usado no entrypoint, então precisa estar no runtime
RUN apk add --no-cache netcat-openbsd tzdata \
  && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
  && echo $TZ > /etc/timezone

ENV HOST=0.0.0.0
ENV PORT=3000
ARG STACK_NAME
ENV STACK_NAME=$STACK_NAME

# Artefatos do build
COPY --from=deps /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=deps /etc/timezone /etc/timezone
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/dist ./dist
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/src ./src

# Entrypoint (já veio no COPY backend/ . do estágio deps)
COPY --from=deps /app/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
CMD ["/app/docker-entrypoint.sh"]
