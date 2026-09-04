# Web HSA — build de Vite servido por nginx.
#
# La configuración del despliegue (a qué API le pega, con qué nombre y qué
# clausulado imprime) se lee EN EL ARRANQUE, no al compilar: el entrypoint
# escribe `/config.js` con las variables del contenedor. Así UNA imagen sirve a
# la instalación del cliente y a la del demo, y cambiar el nombre del demo no
# obliga a reconstruir.
#
# Antes `VITE_API_URL` se horneaba, con el dominio de la API de PRODUCCIÓN como
# valor por omisión. Una segunda instancia construida del mismo repo sin "build
# arg" servía una app que le pegaba a la base del cliente, sin nada en pantalla
# que lo delatara. Ese es el modo de falla que esto cierra.
#
# Variables (todas opcionales, todas de arranque):
#   VITE_API_URL          dominio público de la API. Vacío = mismo dominio, con
#                         el proxy /api de nginx (modo docker-compose).
#   VITE_MARCA_*          identidad del salón. Ver src/lib/marca.ts.
#   VITE_MARCA_CONTRATO   `neutro` para el clausulado del demo.

FROM node:24-slim AS build
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
COPY apps/web/docker-entrypoint.sh /docker-entrypoint-hsa.sh
RUN chmod +x /docker-entrypoint-hsa.sh
EXPOSE 80
CMD ["/docker-entrypoint-hsa.sh"]
