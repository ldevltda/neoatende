# ============ Stage 1: deps + build ============
FROM node:20-alpine AS build
WORKDIR /app

# (Opcional) acelera installs em regiões com rede instável
# RUN npm config set registry https://registry.npmjs.org/

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ .
# Se seu projeto usa a flag antiga do OpenSSL, remova do package.json e prefira react-scripts 5 ou Vite
RUN npm run build

# ============ Stage 2: runtime estático ============
FROM node:20-alpine AS runner
WORKDIR /app
RUN npm i -g serve

# Copia só o resultado do build
COPY --from=build /app/build ./build

EXPOSE 3000
CMD ["serve", "-s", "build", "-l", "3000"]
