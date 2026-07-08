# Fase 2 — API + Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o executing-plans. Pasos con checkbox.

**Goal:** Levantar `apps/api` (Fastify 5) con auth (Vendedora/Admin), lectura de catálogo y creación/lectura de cotizaciones usando el motor de `@hsa/shared`, incluida la ruta pública `/c/:token`.

**Architecture:** Fastify + Prisma. El motor de precios NO se reimplementa: la API carga el catálogo de Postgres, lo mapea al tipo `Catalog` de `@hsa/shared` y llama `computeQuote`. Auth propia: argon2 + JWT (jose) en cookie httpOnly. Tests de integración con Vitest contra el Postgres de Docker (5434).

**Tech Stack:** Fastify 5, @fastify/{cookie,cors,helmet,rate-limit}, @node-rs/argon2, jose, zod, Prisma 6, Vitest.

**Prerrequisito:** Fase 1 mergeada; `docker compose up -d` (Postgres 5434). `.env` con `DATABASE_URL` + `JWT_SECRET`.

---

## Estructura de archivos

```
apps/api/
├── package.json, tsconfig.json, vitest.config.ts, .env (symlink lógico a raíz)
└── src/
    ├── server.ts            # buildServer(): registra plugins y rutas
    ├── index.ts             # arranca el server (listen)
    ├── config.ts            # env validado con zod (DATABASE_URL, JWT_SECRET, PORT, ...)
    ├── auth/
    │   ├── password.ts      # hash/verify argon2
    │   ├── jwt.ts           # sign/verify jose
    │   ├── plugin.ts        # decorator request.user + guards requireAuth/requireAdmin
    │   └── routes.ts        # POST /auth/login, POST /auth/logout, GET /auth/me
    ├── catalog/
    │   ├── loader.ts        # DB -> Catalog (@hsa/shared)
    │   └── routes.ts        # GET /catalog
    └── quotes/
        ├── service.ts       # createQuote/getQuote/listQuotes/getByToken
        └── routes.ts        # POST /quotes, GET /quotes, GET /quotes/:id, GET /c/:token
tests/ (o src/**/*.test.ts) integración
packages/database/prisma/schema.prisma  # + Client, Quote (modificar)
```

## Modelos nuevos (Prisma)

```prisma
model Client {
  id        String   @id @default(cuid())
  nombre    String
  telefono  String?
  correo    String?
  empresa   String?
  domicilio String?
  identificacion String?
  createdAt DateTime @default(now())
  quotes    Quote[]
}

model Quote {
  id            String      @id @default(cuid())
  client        Client      @relation(fields: [clientId], references: [id])
  clientId      String
  eventType     EventType   @relation(fields: [eventTypeId], references: [id])
  eventTypeId   String
  fechaEvento   DateTime
  horasEvento   Int?
  invitados     Int
  spaceIds      String[]
  horasExtra    Int         @default(0)
  foodPackageId String?
  addOns        Json        @default("[]")   // [{addOnId, cantidad}]
  breakdown     Json                          // QuoteBreakdown congelado
  total         Int
  rentaTotal    Int
  status        QuoteStatus @default(borrador)
  publicToken   String      @unique
  vigenciaHasta DateTime?
  createdAt     DateTime    @default(now())
  createdById   String?
}
```
(EventType necesita `quotes Quote[]` en relación inversa.)

---

### Task 1: Extender schema + migración

- [ ] Agregar `Client` y `Quote` a `schema.prisma`, más `quotes Quote[]` en `EventType`.
- [ ] `cd packages/database && DATABASE_URL=postgresql://hsa:hsa@localhost:5434/hsa?schema=public pnpm exec prisma migrate dev --name clientes_cotizaciones`
- [ ] Verificar que aplica. Commit: `feat(database): modelos Client y Quote + migración`.

### Task 2: Scaffold `apps/api`

- [ ] `apps/api/package.json` (name `@hsa/api`, deps: fastify, @fastify/cookie|cors|helmet|rate-limit, @node-rs/argon2, jose, zod, @hsa/shared, @hsa/database; dev: tsx, typescript, vitest). Scripts: `dev` (tsx watch), `build`, `typecheck`, `test`.
- [ ] `tsconfig.json` con override NodeNext (como los otros paquetes).
- [ ] `src/config.ts`: zod valida `DATABASE_URL`, `JWT_SECRET` (min 16), `PORT` (default 3001), `PUBLIC_WEB_URL` (default http://localhost:5173).
- [ ] `.env` raíz: agregar `JWT_SECRET="dev-secret-cambiar-en-prod-0123456789"`.
- [ ] `src/server.ts` `buildServer()` registra cookie/cors/helmet/rate-limit + health `GET /health` → `{ ok: true }`. `src/index.ts` hace listen.
- [ ] Test: `GET /health` responde 200 `{ok:true}` con `app.inject`. Commit: `feat(api): scaffold Fastify + health`.

### Task 3: Auth

- [ ] `auth/password.ts`: `hashPassword`, `verifyPassword` con `@node-rs/argon2`.
- [ ] `auth/jwt.ts`: `signToken({sub,role})`, `verifyToken` con jose (HS256, secret de config).
- [ ] `auth/plugin.ts`: hook que lee cookie `hsa_token`, verifica, setea `request.user`; decoradores `requireAuth`, `requireAdmin`.
- [ ] `auth/routes.ts`: `POST /auth/login` (zod email+password → busca User, verifica argon2, set cookie httpOnly) → `{user}`; `POST /auth/logout` (borra cookie); `GET /auth/me` (requireAuth) → `{user}`.
- [ ] Seed: agregar usuario admin `admin@haciendasanandres.com.mx` / pass `admin1234` (hash argon2) en `packages/database/prisma/seed.ts` (upsert por email).
- [ ] Tests: login OK/《credenciales inválidas》, me sin cookie = 401, me con cookie = user. Commit: `feat(api): auth argon2 + JWT cookie (login/logout/me + guards)`.

### Task 4: Catálogo

- [ ] `catalog/loader.ts`: `loadCatalog(prisma, { anio? })` → `Catalog` (@hsa/shared). Toma `PricingConfig`, `RentalPrice` de la `PriceList` activa (mapea a `RentalPriceRow` con `prices: {viernes,...}`), `FoodPackage`+`FoodPackagePrice`, `AddOn`. Lanza si no hay PriceList activa.
- [ ] `catalog/routes.ts`: `GET /catalog` (requireAuth) → espacios, tipos de evento con paquetes, add-ons, config (forma amigable para el wizard).
- [ ] Test: `loadCatalog` devuelve 4 espacios y 15 rentas; `computeQuote(loadCatalog(...), sel)` para Arcos 250 sábado = 108500. Commit: `feat(api): catalog loader + GET /catalog`.

### Task 5: Cotizaciones

- [ ] `quotes/service.ts`:
  - `createQuote(prisma, input)`: valida con `quoteSelectionSchema` (+ eventTypeId, clientId o datos de cliente, fechaEvento); carga catálogo; `computeQuote`; genera `publicToken` (crypto.randomUUID sin guiones o nanoid); persiste `Quote` con `breakdown`, `total`, `rentaTotal`, `spaceIds`, `addOns`, `status: 'enviada'`? (default borrador; enviar es otra acción). Devuelve la quote.
  - `getQuote(id)`, `listQuotes()`, `getByToken(token)` (incluye client + breakdown).
- [ ] `quotes/routes.ts`: `POST /quotes` (requireAuth), `GET /quotes` (requireAuth), `GET /quotes/:id` (requireAuth), `GET /c/:token` (PÚBLICA, sin auth) → cotización + estado de cuenta (saldo=total, pagos=[] por ahora).
- [ ] Tests de integración: crear cliente+quote vía service, verificar `total` = motor; `getByToken` devuelve breakdown; `POST /quotes` con app.inject autenticado crea y responde 201; `GET /c/:token` responde sin auth. Commit: `feat(api): quotes service + endpoints + ruta pública /c/:token`.

### Task 6: Verificación de fase

- [ ] `pnpm test` y `pnpm typecheck` verdes. Commit final si aplica.

## Notas
- Tests de integración necesitan Postgres 5434 arriba y migrado. Cada test limpia sus filas (o usa un esquema/tx dedicado). Simplicidad: crear datos con prefijos únicos y borrarlos en `afterEach`, o `TRUNCATE` selectivo. El catálogo seedeado se asume presente.
- Zona horaria y dinero: montos enteros en pesos (Int). `fechaEvento` como DateTime (medianoche local).
