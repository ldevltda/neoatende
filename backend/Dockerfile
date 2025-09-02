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

# Código do backend (inclui docker-entrypoint.sh se .dockerignore permitir)
COPY backend/ .

# (Garantia extra) Copia explicitamente o entrypoint para a raiz do estágio deps
# Se o arquivo não existir no contexto (por causa do .dockerignore), falha aqui — ver ajuste no .dockerignore abaixo
COPY backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Certificados e script
# OBS: se a pasta "certificates" não existir no contexto, esse COPY quebra. 
# Se não for usar certificados agora, comente as 3 linhas seguintes.
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

# ✅ Traga o entrypoint do estágio deps (não depende mais do caminho "backend/..." no contexto do runner)
COPY --from=deps /app/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
CMD ["/app/docker-entrypoint.sh"]