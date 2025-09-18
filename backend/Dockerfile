# ============ Stage 1: deps + build do BACKEND ============
FROM node:20-alpine AS deps
WORKDIR /app

# utilitários usados no entrypoint (nc) + fuso
RUN apk add --no-cache git openssh-client netcat-openbsd tzdata \
  && ln -snf /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime \
  && echo America/Sao_Paulo > /etc/timezone

# Evita que npm tente usar ssh://
RUN git config --global url."https://".insteadOf ssh://

# Instala deps do backend
COPY backend/package.json backend/package-lock.json ./
ENV NPM_CONFIG_LEGACY_PEER_DEPS=true
RUN npm ci --legacy-peer-deps

# Copia código do backend
COPY backend/ .

# Certificados e script de assets (se você usa)
COPY certificates ./certs-temp
COPY backend/copy_cert_assets.sh ./copy_cert_assets.sh
RUN chmod +x copy_cert_assets.sh \
  && ./copy_cert_assets.sh \
  && rm -rf ./certs-temp

# Build do backend (gera /app/dist)
RUN npm run build || echo "Sem etapa de build explícita (ok)"

# ============ Stage 2: build do FRONTEND ============
FROM node:20-alpine AS fe
WORKDIR /fe

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ .
# Se seu front é CRA, o build sai em /fe/build. (Se for Vite, ajuste para /fe/dist)
RUN npm run build

# ============ Stage 3: runtime (app único) ============
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo

# timezone
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Porta e host do backend
ENV HOST=0.0.0.0
ENV PORT=3000
ARG STACK_NAME
ENV STACK_NAME=$STACK_NAME

# traz timezone e node_modules/dist do back
COPY --from=deps /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=deps /etc/timezone /etc/timezone
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/dist ./dist
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/src ./src

# traz o build do frontend para um diretório conhecido
# (se o seu build sai em /fe/dist, troque /fe/build por /fe/dist abaixo)
COPY --from=fe /fe/build ./frontend-build

# entrypoint (o seu atual)
COPY backend/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
CMD ["/app/docker-entrypoint.sh"]
