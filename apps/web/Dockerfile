# Web HSA — build de Vite servido por nginx.
#
# Dos modos de despliegue (ver docs/DEPLOY.md y docs/EASYPANEL.md):
#  1. Mismo dominio (docker-compose en VPS): deja VITE_API_URL vacío; nginx
#     hace proxy de /api al contenedor `api` (ver nginx.conf).
#  2. Dominios separados (EasyPanel, un servicio por Dockerfile): define
#     VITE_API_URL con el dominio público de la API al construir la imagen
#     (EasyPanel no siempre expone "Build Args" en la UI — si no los expone,
#     edita el default de abajo y vuelve a desplegar).
ARG VITE_API_URL=""

FROM node:24-slim AS build
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm --filter @hsa/web run build

FROM nginx:1.27-alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
