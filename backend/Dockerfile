# ============ deps + build ============
FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache git openssh-client netcat-openbsd tzdata bash \
  && ln -snf /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime \
  && echo America/Sao_Paulo > /etc/timezone

RUN git config --global url."https://".insteadOf ssh://

# Manifests
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# Código do backend (precisa existir no contexto!)
COPY backend/ .

# cria pasta para o script lidar com ausência de certs
RUN mkdir -p /app/certs-temp

# copy_cert_assets.sh gerado dentro da imagem
RUN cat > /app/copy_cert_assets.sh <<'EOF'
#!/bin/sh
set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
CERTS_DIR="/app/certs-temp"; CERT_TARGET="/app/certs/production-cert.p12"
echo -e "${YELLOW}🔐 Configurando certificados para: $STACK_NAME${NC}"
if [ ! -d "$CERTS_DIR" ]; then
  echo -e "${YELLOW}⚠️  Diretório de certificados não encontrado: $CERTS_DIR${NC}"
  echo -e "${YELLOW}💡 Usando certificado padrão${NC}"; exit 0
fi
CERT_FILE="$CERTS_DIR/${STACK_NAME}-production-cert.p12"
mkdir -p /app/certs
if [ -f "$CERT_FILE" ]; then
  echo -e "${GREEN}✅ Copiando certificado: $CERT_FILE${NC}"
  cp "$CERT_FILE" "$CERT_TARGET" && chmod 600 "$CERT_TARGET"
else
  echo -e "${YELLOW}ℹ️  Certificado não encontrado: $CERT_FILE${NC}"
fi
echo -e "${GREEN}🔐 Concluído${NC}"; exit 0
EOF

RUN sed -i 's/\r$//' /app/copy_cert_assets.sh \
  && chmod +x /app/copy_cert_assets.sh \
  && /app/copy_cert_assets.sh || true \
  && rm -rf /app/certs-temp

# entrypoint gerado sempre (independe do contexto)
RUN cat > /app/docker-entrypoint.sh <<'EOSH'
#!/bin/sh
set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
printf "${YELLOW}🚀 Iniciando backend...${NC}\n"
wait_for_service() {
  service="$1"; host="$2"; port="$3"; max_attempts="${4:-60}"; attempt=1
  printf "${YELLOW}⏳ Aguardando %s em %s:%s...${NC}\n" "$service" "$host" "$port"
  while [ "$attempt" -le "$max_attempts" ]; do
    if nc -z "$host" "$port" 2>/dev/null; then
      printf "${GREEN}✅ %s pronto${NC}\n" "$service"; return 0; fi
    printf "${YELLOW}   Tentativa %s/%s...${NC}\n" "$attempt" "$max_attempts"
    sleep 1; attempt=$((attempt + 1))
  done
  printf "${RED}❌ Timeout %s${NC}\n" "$service"; return 1
}
DB_DIALECT="${DB_DIALECT:-postgres}"; DB_HOST="${DB_HOST:-postgres}"; DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-user}"; DB_PASS="${DB_PASS:-senha}"; DB_NAME="${DB_NAME:-db_name}"
REDIS_HOST="${REDIS_HOST:-redis}"; REDIS_PORT="${REDIS_PORT:-6379}"
[ -z "$DATABASE_URL" ] && DATABASE_URL="${DB_DIALECT}://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
[ -z "$REDIS_URL" ] && REDIS_URL="redis://${REDIS_HOST}:${REDIS_PORT}"
export DATABASE_URL REDIS_URL
wait_for_service "PostgreSQL" "$DB_HOST" "$DB_PORT" || exit 1
wait_for_service "Redis" "$REDIS_HOST" "$REDIS_PORT" || exit 1
if [ ! -d "dist" ]; then printf "${YELLOW}🛠  build...${NC}\n"; npm run build || true; fi
printf "${YELLOW}🔄 migrações...${NC}\n"
npx sequelize db:migrate --url "$DATABASE_URL" --migrations-path dist/database/migrations || true
printf "${YELLOW}🌱 seeds...${NC}\n"
npx sequelize db:seed:all --url "$DATABASE_URL" --seeders-path dist/database/seeders || true
printf "${YELLOW}🚀 subindo...${NC}\n"
exec node dist/server.js
EOSH

RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

RUN npm run build || echo "Sem etapa de build explícita"

# ============ runtime ============
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production TZ=America/Sao_Paulo
RUN apk add --no-cache netcat-openbsd tzdata \
  && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

ENV HOST=0.0.0.0 PORT=3000
ARG STACK_NAME
ENV STACK_NAME=$STACK_NAME

COPY --from=deps /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=deps /etc/timezone /etc/timezone
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/dist ./dist
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/src ./src
COPY --from=deps /app/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
CMD ["/app/docker-entrypoint.sh"]
