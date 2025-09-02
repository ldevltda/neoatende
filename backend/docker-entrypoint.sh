#!/bin/sh
set -e

# cores
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

printf "${YELLOW}🚀 Iniciando backend...${NC}\n"

wait_for_service() {
  service="$1"; host="$2"; port="$3"; max_attempts="${4:-60}"; attempt=1
  printf "${YELLOW}⏳ Aguardando %s em %s:%s...${NC}\n" "$service" "$host" "$port"
  while [ "$attempt" -le "$max_attempts" ]; do
    if nc -z "$host" "$port" 2>/dev/null; then
      printf "${GREEN}✅ %s está pronto!${NC}\n" "$service"; return 0
    fi
    printf "${YELLOW}   Tentativa %s/%s...${NC}\n" "$attempt" "$max_attempts"
    sleep 1; attempt=$((attempt + 1))
  done
  printf "${RED}❌ Timeout aguardando %s${NC}\n" "$service"; return 1
}

# defaults
DB_DIALECT="${DB_DIALECT:-postgres}"
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-user}"
DB_PASS="${DB_PASS:-senha}"
DB_NAME="${DB_NAME:-db_name}"

REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PORT="${REDIS_PORT:-6379}"

# Monta URLs se não vierem prontas
if [ -z "$DATABASE_URL" ]; then
  DATABASE_URL="${DB_DIALECT}://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
fi
if [ -z "$REDIS_URL" ]; then
  REDIS_URL="redis://${REDIS_HOST}:${REDIS_PORT}"
fi
export DATABASE_URL REDIS_URL

# Espera serviços
wait_for_service "PostgreSQL" "$DB_HOST" "$DB_PORT" || { printf "${RED}❌ Postgres indisponível${NC}\n"; exit 1; }
wait_for_service "Redis" "$REDIS_HOST" "$REDIS_PORT" || { printf "${RED}❌ Redis indisponível${NC}\n"; exit 1; }

# Compila se faltar dist
if [ ! -d "dist" ]; then
  printf "${YELLOW}🛠  Compilando TypeScript...${NC}\n"
  npm run build || true
fi

# Migra/seed usando URL
printf "${YELLOW}🔄 Executando migrações...${NC}\n"
npx sequelize db:migrate --url "$DATABASE_URL" --migrations-path dist/database/migrations \
  && printf "${GREEN}✅ Migrações OK${NC}\n" \
  || printf "${YELLOW}⚠️  Migrações falharam (talvez já aplicadas)${NC}\n"

printf "${YELLOW}🌱 Executando seeds...${NC}\n"
npx sequelize db:seed:all --url "$DATABASE_URL" --seeders-path dist/database/seeders \
  && printf "${GREEN}✅ Seeds OK${NC}\n" \
  || printf "${YELLOW}⚠️  Seeds falharam (talvez já rodados)${NC}\n"

# Sobe app
printf "${YELLOW}🚀 Iniciando aplicação...${NC}\n"
exec node dist/server.js
