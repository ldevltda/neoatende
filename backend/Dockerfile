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

# Código do backend
COPY backend/ .

# Certificados e script
COPY certificates ./certs-temp
COPY backend/copy_cert_assets.sh ./copy_cert_assets.sh
RUN chmod +x copy_cert_assets.sh \
  && ./copy_cert_assets.sh \
  && rm -rf ./certs-temp

# Build (se houver)
RUN npm run build || echo "Sem etapa de build explícita"

# ============ runtime ============
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo

# 1) Só precisamos do 'nc'; use busybox-extras (vem com nc)
RUN apk add --no-cache busybox-extras

# 2) Reaproveita timezone do estágio de build (já funciona no Fly e local)
COPY --from=deps /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=deps /etc/timezone /etc/timezone

# resto igual
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/dist ./dist
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/src ./src

COPY backend/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
CMD ["/app/docker-entrypoint.sh"]
