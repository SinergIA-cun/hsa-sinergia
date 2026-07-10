# Fase 5 · Comprobantes, Recibos, Condiciones y N.º de Referencia · Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Guardar la foto de comprobante de cada pago (servidor, tras interfaz para Drive futuro), generar recibos por pago que el cliente puede ver, mostrar condiciones de pago auto-calculadas, dar a cada cliente un número de referencia SPEI, y renombrar el rol `vendedora`→`ventas`.

**Architecture:** El almacenamiento del comprobante se abstrae en `ComprobanteStorage` con adaptador `ServerStorage` (directorio del VPS por env). Folios de recibo y números de referencia de cliente usan **secuencias de Postgres** (gapless). La subida es multipart (`@fastify/multipart`), pensada para cámara de tablet. Las imágenes se sirven por proxy (interno con auth; público validado por token). Recibo = vista imprimible pública por pago.

**Tech Stack:** Prisma 6 / Postgres · Fastify 5 + @fastify/multipart · Zod · Vitest (DB :5434) · React 18.

**Branch:** `feat/fase5-contrato` (continúa aquí).

---

## Task 1: Rename de rol `vendedora` → `ventas`

**Files:** `packages/database/prisma/schema.prisma`, migración manual, y refs: `apps/api/src/{server.ts,quotes/service.ts,auth/jwt.ts,users/routes.ts,availability/service.ts}`, `apps/web/src/{lib/types.ts,components/QuoteForm.tsx,pages/AdminPage.tsx,pages/QuotesListPage.tsx}`, y sus tests.

- [ ] **Step 1: Schema.** En `enum UserRole` cambiar `vendedora` por `ventas`.
- [ ] **Step 2: Migración manual (evita drop/recreate del enum).** Crear con `pnpm --filter @hsa/database exec prisma migrate dev --create-only --name rol_ventas`, luego REEMPLAZAR el SQL generado por:
```sql
ALTER TYPE "UserRole" RENAME VALUE 'vendedora' TO 'ventas';
```
Aplicar con `pnpm --filter @hsa/database exec prisma migrate dev`. (Preserva filas existentes: la usuaria 'Norma' pasa a `ventas` sola.)
- [ ] **Step 3: Backend refs.** Reemplazar todo literal `'vendedora'` por `'ventas'` y todo tipo `'vendedora' | 'admin'` por `'ventas' | 'admin'` en los archivos de `apps/api/src`. (Incluye `Actor`, `ownershipWhere` [role !== 'admin' se mantiene], `createUserSchema` role enum, `jwt` payload type, la declaración `FastifyRequest.user` en server.ts.)
- [ ] **Step 4: Web refs + etiquetas.** En `apps/web/src`: tipo `role: 'ventas' | 'admin'`, y las etiquetas visibles `Vendedora`/`VENDEDORA` → `Ventas`/`VENTAS`. En `AdminPage` el select de rol muestra "Ventas". En `QuotesListPage` el CRM por-`ventas` sigue igual (solo la etiqueta).
- [ ] **Step 5: Tests.** Actualizar cualquier `role: 'vendedora'` en `*.test.ts` a `'ventas'`.
- [ ] **Step 6: Verificar.** `pnpm --filter @hsa/api run test` verde; `pnpm --filter @hsa/api exec tsc --noEmit` y `pnpm --filter @hsa/web exec tsc --noEmit` limpios.
- [ ] **Step 7: Commit.** `git commit -m "refactor: renombra rol vendedora → ventas"`

---

## Task 2: Número de referencia del cliente (SPEI)

**Files:** `packages/database/prisma/schema.prisma`, migración manual, `apps/api/src/quotes/service.ts` (crear cliente + exponer), `apps/web/src/pages/PublicQuotePage.tsx`, tipos web.

- [ ] **Step 1: Schema.** En `model Client` agregar:
```prisma
  numeroReferencia Int @unique @default(dbgenerated("nextval('client_ref_seq')"))
```
- [ ] **Step 2: Migración manual con secuencia.** `migrate dev --create-only --name client_ref_seq`; al SQL generado, ANTEPONER la creación de la secuencia y el backfill de filas existentes:
```sql
CREATE SEQUENCE IF NOT EXISTS client_ref_seq START 1000;
-- (la columna la agrega el SQL generado por Prisma con el default nextval)
-- Backfill de clientes ya existentes:
UPDATE "Client" SET "numeroReferencia" = nextval('client_ref_seq') WHERE "numeroReferencia" IS NULL;
```
Nota: si Prisma genera la columna como NOT NULL con default, el orden debe ser: crear secuencia → add column con default → (el default cubre las filas nuevas; para las existentes Postgres aplica el default al agregar la columna NOT NULL). Verificar que tras aplicar, todos los clientes tengan un valor único. Aplicar con `migrate dev`.
- [ ] **Step 3: Exponer.** `getQuote` y `getByToken` ya incluyen `client` (vía `includeRels`); confirmar que `numeroReferencia` viaja en el objeto client. Añadir a los tipos web `Client.numeroReferencia: number`.
- [ ] **Step 4: Mostrar en la página del cliente.** En `PublicQuotePage`, bajo el hero o en el estado de cuenta, una línea discreta: *"Número de referencia para transferencias: {numeroReferencia}"*.
- [ ] **Step 5: Verificar + commit.** Tests/tsc verdes. `git commit -m "feat: número de referencia SPEI por cliente"`

---

## Task 3: Folio de recibo + almacenamiento de comprobante (servidor)

**Files:** `schema.prisma` + migración, `apps/api/src/payments/storage.ts` (nuevo), `apps/api/src/config.ts` (env), `.env.example`.

- [ ] **Step 1: Schema Payment.** Agregar:
```prisma
  folio          Int     @unique @default(dbgenerated("nextval('recibo_folio_seq')"))
  comprobanteKey String?
  comprobanteMime String?
```
- [ ] **Step 2: Migración manual con secuencia** `recibo_folio_seq` START 1 (mismo patrón que Task 2; backfill de pagos existentes con nextval). `migrate dev --create-only --name recibo_folio` → editar → aplicar.
- [ ] **Step 3: Env.** En `config.ts` agregar `COMPROBANTES_DIR` (default `./data/comprobantes`) al schema de config; documentarlo en `.env.example`.
- [ ] **Step 4: `ComprobanteStorage` + `ServerStorage`.** `apps/api/src/payments/storage.ts`:
```ts
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface StoredFile { key: string; mime: string }
export interface ComprobanteStorage {
  save(data: Buffer, mime: string): Promise<StoredFile>;
  load(key: string): Promise<Buffer | null>;
}

const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic' };

/** Guarda en un directorio del VPS. Reemplazable por DriveStorage a futuro. */
export class ServerStorage implements ComprobanteStorage {
  constructor(private dir: string) {}
  async save(data: Buffer, mime: string): Promise<StoredFile> {
    await mkdir(this.dir, { recursive: true });
    const key = randomUUID() + (EXT[mime] ?? '');
    await writeFile(join(this.dir, key), data);
    return { key, mime };
  }
  async load(key: string): Promise<Buffer | null> {
    // Sanitiza: solo el basename, sin traversal.
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '');
    if (!safe || safe !== key) return null;
    try { return await readFile(join(this.dir, safe)); } catch { return null; }
  }
}
```
- [ ] **Step 5: Test** `storage.test.ts`: `save` devuelve key + mime y `load(key)` recupera los bytes; `load('../etc/passwd')` → null (anti-traversal). Usar un dir temporal.
- [ ] **Step 6: Verificar + commit.** `git commit -m "feat(api): folio de recibo + almacenamiento de comprobante en servidor"`

---

## Task 4: Subida multipart + registro con comprobante + proxies de imagen

**Files:** `apps/api/src/payments/{service.ts,routes.ts}`, `apps/api/src/server.ts` (registrar `@fastify/multipart`), `apps/api/src/quotes/service.ts` (getByToken expone folio + tieneComprobante).

- [ ] **Step 1: Dependencia.** `pnpm --filter @hsa/api add @fastify/multipart`.
- [ ] **Step 2: Registrar multipart en server.ts** (`await app.register(multipart, { limits: { fileSize: 8*1024*1024 } })`).
- [ ] **Step 3: `registerPayment` acepta archivo.** Firma `(db, storage, quoteId, rawInput, actor, file?)` donde `file?: { data: Buffer; mime: string }`. Si viene, `const s = await storage.save(file.data, file.mime)` y persiste `comprobanteKey: s.key, comprobanteMime: s.mime`. (El `Payment.referencia` string sigue siendo el folio de transferencia opcional.)
- [ ] **Step 4: Ruta POST multipart.** En `payments/routes.ts`, `POST /quotes/:id/payments` lee multipart: campos de texto (monto/metodo/concepto/fecha/referencia) + un archivo opcional `comprobante`. Construir el `rawInput` (parsear `monto` a número) y `file` si hay parte de archivo. Instanciar `new ServerStorage(app.config.COMPROBANTES_DIR)`. Debe seguir aceptando **JSON** también (cuando no hay archivo) para no romper flujos existentes: si `content-type` es multipart, usar `req.parts()`; si es JSON, usar `req.body`.
- [ ] **Step 5: Proxies de imagen.**
  - `GET /quotes/:id/comprobante/:paymentId` (requireAuth + scoping): carga el Payment del quote, `storage.load(comprobanteKey)`, responde con `Content-Type` = `comprobanteMime`.
  - `GET /c/:token/recibo/:paymentId/imagen` (público): valida que el pago pertenezca al quote del token y no esté anulado; sirve la imagen.
- [ ] **Step 6: `getByToken`** — en `pagosPublicos` incluir `folio` y `tieneComprobante: Boolean(p.comprobanteKey)`.
- [ ] **Step 7: Tests.** Registrar pago con archivo (multipart via `app.inject` con `payload`+`headers` multipart, o probar `registerPayment` a nivel servicio con un `file` en memoria) → `comprobanteKey` set; proxy interno devuelve los bytes; proxy público valida token. Mantener el test JSON existente (sin archivo).
- [ ] **Step 8: Verificar + commit.** `git commit -m "feat(api): subida de comprobante (multipart) y proxies de imagen"`

---

## Task 5: Vista de recibo + verla como cliente e interno

**Files:** `apps/web/src/pages/ReciboPage.tsx` (nuevo), `apps/web/src/App.tsx` (ruta pública), `apps/web/src/pages/PublicQuotePage.tsx` ("Ver recibo"), `apps/web/src/components/PagosPanel.tsx` (ver comprobante interno), tipos web.

- [ ] **Step 1: Endpoint de datos del recibo.** Reusar `GET /api/c/:token` (ya trae `estadoCuenta.pagos` con `id, monto, concepto, fecha, folio, tieneComprobante` + `quote` con cliente/evento/numeroReferencia). El `ReciboPage` recibe `token` y `paymentId` por ruta y arma el recibo desde ahí.
- [ ] **Step 2: `ReciboPage`** ruta pública `/c/:token/recibo/:paymentId` (sin auth, como la página del cliente). Documento imprimible: marca, **Recibo N.º {folio}**, fecha de emisión, cliente + número de referencia, evento + fecha, monto (grande), concepto, método, y la **foto** (`<img src="/api/c/:token/recibo/:paymentId/imagen">`) si `tieneComprobante`. Botón Imprimir. `@media print`.
- [ ] **Step 3: Ruta** en `App.tsx` (junto a `/c/:token`, sin `Protected`).
- [ ] **Step 4: "Ver recibo" en la página del cliente.** En `PublicQuotePage`, cada pago de la lista con un link a su recibo.
- [ ] **Step 5: Interno.** En `PagosPanel`, cada pago no anulado con comprobante muestra un link/preview a `GET /api/quotes/:id/comprobante/:paymentId` (miniatura o "Ver comprobante").
- [ ] **Step 6: Verificar (tsc) + commit.** `git commit -m "feat(web): recibo por pago (vista imprimible) y visor de comprobante"`

---

## Task 6: Condiciones de pago auto-calculadas

**Files:** `apps/api/src/quotes/estadoCuenta.ts` (exponer % y restante en hitos), `apps/api/src/quotes/estadoCuenta.test.ts`, `apps/web/src/pages/PublicQuotePage.tsx`, `apps/web/src/components/PagosPanel.tsx`, tipos web.

- [ ] **Step 1: Enriquecer `Milestone`.** Agregar a cada hito `restante: Math.max(0, objetivo - cubierto)` y, al hito `complemento`, `porcentaje` = `Math.round(complementoPct * 100)`. Añadir campos al tipo `Milestone` (api y web) y al test.
- [ ] **Step 2: Texto de condiciones (web).** Helper que, de los hitos NO completos, arma frases:
  - apartar: *"Para apartar la fecha: {formatMXN(objetivo)}."*
  - complemento: *"Para formalizar: cubrir el {porcentaje}% ({formatMXN(objetivo)}) a más tardar el {formatEventDate(venceISO,'long')}."*
  - finiquito: *"Liquidación: el total ({formatMXN(objetivo)}) debe quedar cubierto el {formatEventDate(venceISO,'long')} (30 días antes del evento)."*
  Mostrar bajo el estado de cuenta en `PublicQuotePage` (y opcionalmente en `PagosPanel`). Si `planPendiente`, omitir.
- [ ] **Step 3: Verificar + commit.** `git commit -m "feat: condiciones de pago auto-calculadas en la vista del cliente"`

---

## Cierre
- `pnpm --filter @hsa/api run test` verde + ambos `tsc` limpios.
- Verificación E2E en navegador: registrar pago con foto (tablet-style) → recibo con folio + imagen → cliente ve su recibo → número de referencia visible → condiciones legibles.
- **Nota deploy:** `COMPROBANTES_DIR` debe apuntar a un volumen persistente del VPS; las secuencias `client_ref_seq`/`recibo_folio_seq` se crean por migración. El adaptador Drive se conecta cuando llegue la credencial (implementa `ComprobanteStorage`).
