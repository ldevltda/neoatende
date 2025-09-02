# ============ deps + build ============
FROM node:20-alpine AS deps
WORKDIR /app

# Ferramentas e timezone
RUN apk add --no-cache git openssh-client netcat-openbsd tzdata bash \
  && ln -snf /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime \
  && echo America/Sao_Paulo > /etc/timezone

# Evita URLs ssh:// em ambientes restritos
RUN git config --global url."https://".insteadOf ssh://

# Manifests do backend (NPM)
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# Código do backend
COPY backend/ .

# Certificados e script de cópia
COPY certificates ./certs-temp
COPY backend/copy_cert_assets.sh ./copy_cert_assets.sh
RUN chmod +x copy_cert_assets.sh \
  && ./copy_cert_assets.sh \
  && rm -rf ./certs-temp

# entrypoint: traga para este estágio e deixe executável
COPY backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Build (se houver)
RUN npm run build || echo "Sem etapa de build explícita"

# ============ runtime ============
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

ENV HOST=0.0.0.0
ENV PORT=3000
ARG STACK_NAME
ENV STACK_NAME=$STACK_NAME

# Timezone do estágio anterior (garante consistência)
COPY --from=deps /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=deps /etc/timezone /etc/timezone

# Dependências e artefatos do app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/dist ./dist
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/src ./src

# Copie o entrypoint a partir do estágio deps (evita problemas de caminho/ .dockerignore)
COPY --from=deps /app/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
CMD ["/app/docker-entrypoint.sh"]
