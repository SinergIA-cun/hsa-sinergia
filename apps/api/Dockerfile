# API HSA — Fastify (se ejecuta con tsx para resolver los paquetes workspace en TS).
FROM node:24-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

FROM node:24-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
# Generar el cliente Prisma dentro de la imagen
RUN pnpm --filter @hsa/database run generate
EXPOSE 3001
# Aplica migraciones, siembra el catálogo 2027 (idempotente) y arranca la API.
CMD ["sh", "-c", "pnpm --filter @hsa/database run migrate:deploy && pnpm --filter @hsa/database run backfill:fase6 && pnpm --filter @hsa/database run backfill:fase7 && pnpm --filter @hsa/database run backfill:fase8 && pnpm --filter @hsa/database run backfill:fase9 && pnpm --filter @hsa/database run backfill:fase11 && pnpm --filter @hsa/database run backfill:fase12 && pnpm --filter @hsa/database run backfill:fase13 && pnpm --filter @hsa/database run backfill:fase14 && pnpm --filter @hsa/api exec tsx src/scripts/backfill-codigo-evento.ts && pnpm --filter @hsa/api exec tsx src/scripts/reconcile-statuses.ts && pnpm --filter @hsa/api exec tsx src/index.ts"]
