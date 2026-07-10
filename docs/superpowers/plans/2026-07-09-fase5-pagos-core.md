# Fase 5 · Sub-plan 1 — Pagos, Estado de Cuenta y Log · Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar pagos (fichas) con anulación auditable, calcular estado de cuenta real por la regla por-espacio, bitácora de actividad, y edición de apartadas/formalizadas con registro — dejando la subida a Drive detrás de una interfaz degradable.

**Architecture:** El motor de estado de cuenta es una **función pura** (`computeEstadoCuenta`) testeable sin DB. La capa de servicio (`@hsa/api`) orquesta Prisma + la función pura + la bitácora. La subida de comprobante se abstrae en `ComprobanteStorage`; el default `PendingStorage` no sube nada y marca el pago como pendiente (el adaptador Drive real es un sub-plan aparte, bloqueado por la credencial). El front consume `estadoCuenta` en `EditQuotePage` (interno) y `PublicQuotePage` (cliente).

**Tech Stack:** Prisma 6 / Postgres · Fastify 5 · Zod · Vitest (DB Docker :5434, `fileParallelism:false`) · React 18 + TanStack Query.

**Referencia de diseño:** [../specs/2026-07-09-pagos-contrato-hsa-design.md](../specs/2026-07-09-pagos-contrato-hsa-design.md)

**Fuera de este sub-plan:** adaptador Drive real (googleapis), **rutas proxy de comprobante** (`GET .../comprobantes/:paymentId` — solo tienen sentido cuando la imagen se transmite desde Drive; aquí el comprobante es un **link directo** en `comprobanteUrl`), contrato HTML, sección operativa (horarios), reportes. Los campos operativos de `Quote` se crean aquí en el schema (para no re-migrar) pero su UI va en el sub-plan 2.

---

## Task 1: Schema Prisma + migración

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create (generado): `packages/database/prisma/migrations/<ts>_pagos_log/migration.sql`

- [ ] **Step 1: Editar enums existentes.** En `schema.prisma`, agregar `complemento` al enum `PaymentConcept`:

```prisma
enum PaymentConcept {
  anticipo
  complemento
  aCuenta
  finiquito
}
```

- [ ] **Step 2: Nuevo enum `ActivityType`** (junto a los otros enums):

```prisma
enum ActivityType {
  creada
  estatus
  pago
  pagoAnulado
  edicion
}
```

- [ ] **Step 3: Reemplazar `model PaymentRule` por `model SpacePaymentRule`.** Borrar el `model PaymentRule` actual y su relación `paymentRule PaymentRule?` en `EventType`. Agregar:

```prisma
model SpacePaymentRule {
  id                String @id @default(cuid())
  space             Space  @relation(fields: [spaceId], references: [id])
  spaceId           String @unique
  anticipo          Int
  complementoPct    Float
  liquidarDiasAntes Int    @default(30)
}
```

Y en `model Space` agregar la back-relation: `paymentRule SpacePaymentRule?`.

- [ ] **Step 4: Campos operativos + relaciones en `Quote`.** En `model Quote` agregar:

```prisma
  horaInicio   String?
  horaTermino  String?
  horarioCivil String?
  payments     Payment[]
  activityLog  ActivityLog[]
```

- [ ] **Step 5: Modelos `Payment` y `ActivityLog`:**

```prisma
model Payment {
  id                   String         @id @default(cuid())
  quote                Quote          @relation(fields: [quoteId], references: [id])
  quoteId              String
  monto                Int
  metodo               PaymentMethod
  concepto             PaymentConcept
  fecha                DateTime
  referencia           String?
  comprobanteUrl       String?
  comprobantePendiente Boolean        @default(false)
  registradoBy         User?          @relation("PaymentRegistradoBy", fields: [registradoById], references: [id])
  registradoById       String?
  anuladoAt            DateTime?
  anuladoBy            User?          @relation("PaymentAnuladoBy", fields: [anuladoById], references: [id])
  anuladoById          String?
  motivoAnulacion      String?
  createdAt            DateTime       @default(now())

  @@index([quoteId])
}

model ActivityLog {
  id          String       @id @default(cuid())
  quote       Quote        @relation(fields: [quoteId], references: [id])
  quoteId     String
  tipo        ActivityType
  descripcion String
  meta        Json?
  actor       User?        @relation("ActivityActor", fields: [actorId], references: [id])
  actorId     String?
  createdAt   DateTime     @default(now())

  @@index([quoteId])
}
```

- [ ] **Step 6: Back-relations en `model User`.** Agregar dentro de `User`:

```prisma
  paymentsRegistrados Payment[]     @relation("PaymentRegistradoBy")
  paymentsAnulados    Payment[]     @relation("PaymentAnuladoBy")
  actividades         ActivityLog[] @relation("ActivityActor")
```

- [ ] **Step 7: Crear la migración.**

Run: `pnpm --filter @hsa/database exec prisma migrate dev --name pagos_log`
Expected: crea la migración y regenera el client sin error. (DB Docker :5434 arriba.)

- [ ] **Step 8: Verificar typecheck del paquete database.**

Run: `pnpm --filter @hsa/database exec tsc --noEmit`
Expected: sin errores.

- [ ] **Step 9: Commit.**

```bash
git add packages/database/prisma
git commit -m "feat(db): modelos Payment, ActivityLog y SpacePaymentRule"
```

---

## Task 2: Seed de reglas por espacio

**Files:**
- Modify: `packages/database/prisma/seed.ts:69` (reemplazar el `paymentRule.create` por espacio)

- [ ] **Step 1: Quitar el seed viejo de `paymentRule`.** Borrar la línea `await prisma.paymentRule.create({ data: { eventTypeId: et.id } });` (y su bucle si aplica).

- [ ] **Step 2: Sembrar `SpacePaymentRule` idempotente** tras crear los espacios (`arcos`, `campos`, `cupula`). Insertar después del bloque de espacios:

```ts
const spaceRules: { space: { id: string }; anticipo: number; complementoPct: number }[] = [
  { space: cupula, anticipo: 25000, complementoPct: 0.25 },
  { space: arcos, anticipo: 20000, complementoPct: 0.1 },
  { space: campos, anticipo: 15000, complementoPct: 0.15 },
  // La Capilla queda sin regla (pendiente de datos del cliente).
];
for (const r of spaceRules) {
  await prisma.spacePaymentRule.create({
    data: { spaceId: r.space.id, anticipo: r.anticipo, complementoPct: r.complementoPct },
  });
}
```

- [ ] **Step 3: Correr el seed contra la DB limpia de dev.**

Run: `pnpm --filter @hsa/database exec tsx prisma/seed.ts`
Expected: sin error. (Si falla por datos previos, es idempotencia — el seed ya salta si `space.count()>0`; para dev, resetear con `prisma migrate reset` es aceptable localmente.)

- [ ] **Step 4: Commit.**

```bash
git add packages/database/prisma/seed.ts
git commit -m "feat(db): seed de SpacePaymentRule (Cúpula/Arcos/Campos)"
```

---

## Task 3: Motor puro de estado de cuenta

**Files:**
- Create: `apps/api/src/quotes/estadoCuenta.ts`
- Test: `apps/api/src/quotes/estadoCuenta.test.ts`

- [ ] **Step 1: Escribir el test (RED).** `apps/api/src/quotes/estadoCuenta.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeEstadoCuenta, type SpaceRule } from './estadoCuenta.js';

const rule: SpaceRule = { anticipo: 20000, complementoPct: 0.1, liquidarDiasAntes: 30 };
const base = {
  total: 100000,
  fechaEvento: new Date('2027-05-08T00:00:00.000Z'),
  status: 'aceptada' as const,
  now: new Date('2027-01-01T00:00:00.000Z'),
};

describe('computeEstadoCuenta', () => {
  it('sin regla: plan pendiente, sin sugerencia', () => {
    const ec = computeEstadoCuenta({ ...base, rule: null, payments: [] });
    expect(ec.plan).toBeNull();
    expect(ec.planPendiente).toBe(true);
    expect(ec.sugerido).toBeNull();
    expect(ec.saldo).toBe(100000);
  });

  it('pagado excluye anulados', () => {
    const ec = computeEstadoCuenta({
      ...base, rule,
      payments: [{ monto: 20000, anuladoAt: null }, { monto: 5000, anuladoAt: new Date() }],
    });
    expect(ec.pagado).toBe(20000);
    expect(ec.saldo).toBe(80000);
  });

  it('umbrales: anticipo→apartada, +complemento→formalizada, total→liquidada', () => {
    expect(computeEstadoCuenta({ ...base, rule, payments: [{ monto: 20000, anuladoAt: null }] }).sugerido).toBe('apartada');
    // anticipo 20000 + 10% de 100000 = 30000
    expect(computeEstadoCuenta({ ...base, rule, payments: [{ monto: 30000, anuladoAt: null }] }).sugerido).toBe('formalizada');
    expect(computeEstadoCuenta({ ...base, rule, payments: [{ monto: 100000, anuladoAt: null }] }).sugerido).toBe('liquidada');
    expect(computeEstadoCuenta({ ...base, rule, payments: [{ monto: 1000, anuladoAt: null }] }).sugerido).toBeNull();
  });

  it('desfase: estatus formalizada pero pagado no cubre el complemento', () => {
    const ec = computeEstadoCuenta({ ...base, status: 'formalizada', rule, payments: [{ monto: 20000, anuladoAt: null }] });
    expect(ec.desfase).toBe(true);
  });

  it('no hay desfase cuando el pagado cubre el estatus', () => {
    const ec = computeEstadoCuenta({ ...base, status: 'apartada', rule, payments: [{ monto: 20000, anuladoAt: null }] });
    expect(ec.desfase).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar).**

Run: `pnpm --filter @hsa/api exec vitest run src/quotes/estadoCuenta.test.ts`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `estadoCuenta.ts` (GREEN).**

```ts
export type PaymentStatus = 'apartada' | 'formalizada' | 'liquidada';

export interface SpaceRule {
  anticipo: number;
  complementoPct: number;
  liquidarDiasAntes: number;
}

export interface PaymentLite {
  monto: number;
  anuladoAt: Date | null;
}

export interface Milestone {
  key: 'apartar' | 'complemento' | 'finiquito';
  label: string;
  objetivo: number;
  cubierto: number;
  completo: boolean;
  venceISO: string | null;
}

export interface EstadoCuenta {
  total: number;
  pagado: number;
  saldo: number;
  plan: Milestone[] | null;
  planPendiente: boolean;
  sugerido: PaymentStatus | null;
  desfase: boolean;
}

// Orden de los estatus con umbral de pago.
const RANK: Record<PaymentStatus, number> = { apartada: 1, formalizada: 2, liquidada: 3 };

function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}
function minusDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() - days);
  return r;
}

export function computeEstadoCuenta(args: {
  total: number;
  fechaEvento: Date;
  status: string;
  rule: SpaceRule | null;
  payments: PaymentLite[];
  fechaApartado?: Date | null;
  now?: Date;
}): EstadoCuenta {
  const { total, fechaEvento, status, rule, payments, fechaApartado } = args;
  const pagado = payments.filter((p) => p.anuladoAt == null).reduce((s, p) => s + p.monto, 0);
  const saldo = total - pagado;

  if (!rule) {
    return { total, pagado, saldo, plan: null, planPendiente: true, sugerido: null, desfase: false };
  }

  const objApartar = rule.anticipo;
  const objComplemento = rule.anticipo + Math.round(rule.complementoPct * total);
  const objFiniquito = total;

  const complementoVence = fechaApartado ? addMonths(fechaApartado, 3) : null;
  const finiquitoVence = minusDays(fechaEvento, rule.liquidarDiasAntes);

  const plan: Milestone[] = [
    { key: 'apartar', label: 'Apartar fecha', objetivo: objApartar, cubierto: Math.min(pagado, objApartar), completo: pagado >= objApartar, venceISO: null },
    { key: 'complemento', label: 'Complemento (formalizar)', objetivo: objComplemento, cubierto: Math.min(pagado, objComplemento), completo: pagado >= objComplemento, venceISO: complementoVence?.toISOString() ?? null },
    { key: 'finiquito', label: 'Finiquito', objetivo: objFiniquito, cubierto: Math.min(pagado, objFiniquito), completo: pagado >= objFiniquito, venceISO: finiquitoVence.toISOString() },
  ];

  let sugerido: PaymentStatus | null = null;
  if (pagado >= objFiniquito) sugerido = 'liquidada';
  else if (pagado >= objComplemento) sugerido = 'formalizada';
  else if (pagado >= objApartar) sugerido = 'apartada';

  // Desfase: el estatus actual exige un umbral que el pagado ya no cubre.
  let desfase = false;
  if (status in RANK) {
    const req = RANK[status as PaymentStatus];
    if (req >= RANK.apartada && pagado < objApartar) desfase = true;
    if (req >= RANK.formalizada && pagado < objComplemento) desfase = true;
    if (req >= RANK.liquidada && pagado < objFiniquito) desfase = true;
  }

  return { total, pagado, saldo, plan, planPendiente: false, sugerido, desfase };
}

/** ¿`sugerido` está más adelante que el estatus actual? (para proponer avanzar) */
export function esUpgrade(actual: string, sugerido: PaymentStatus | null): boolean {
  if (!sugerido) return false;
  const actualRank = actual in RANK ? RANK[actual as PaymentStatus] : 0;
  return RANK[sugerido] > actualRank;
}
```

- [ ] **Step 4: Correr el test (debe pasar).**

Run: `pnpm --filter @hsa/api exec vitest run src/quotes/estadoCuenta.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/quotes/estadoCuenta.ts apps/api/src/quotes/estadoCuenta.test.ts
git commit -m "feat(api): motor puro de estado de cuenta con hitos, sugerencia y desfase"
```

---

## Task 4: Bitácora de actividad (helper + integración en ciclo)

**Files:**
- Create: `apps/api/src/quotes/activityLog.ts`
- Modify: `apps/api/src/quotes/service.ts` (createQuote, updateStatus, updateQuote)

- [ ] **Step 1: Helper de log.** `apps/api/src/quotes/activityLog.ts`:

```ts
import type { PrismaClient, Prisma } from '@hsa/database';

export type LogTipo = 'creada' | 'estatus' | 'pago' | 'pagoAnulado' | 'edicion';

/** Escribe una entrada de bitácora. Nunca lanza: la bitácora no debe tumbar la operación. */
export async function logActivity(
  db: PrismaClient,
  input: { quoteId: string; tipo: LogTipo; descripcion: string; meta?: Prisma.InputJsonValue; actorId?: string | null },
): Promise<void> {
  try {
    await db.activityLog.create({
      data: {
        quoteId: input.quoteId,
        tipo: input.tipo,
        descripcion: input.descripcion,
        meta: input.meta,
        actorId: input.actorId ?? null,
      },
    });
  } catch {
    // no-op: la bitácora es best-effort
  }
}
```

- [ ] **Step 2: Log en `createQuote`.** En `service.ts`, tras `db.quote.create(...)` (capturar el resultado en `const created`), antes de retornar:

```ts
await logActivity(db, { quoteId: created.id, tipo: 'creada', descripcion: 'Cotización creada', actorId: actor.id });
return created;
```

(Importar `logActivity` arriba: `import { logActivity } from './activityLog.js';`)

- [ ] **Step 3: Log en `updateStatus`.** Capturar el estatus anterior y registrar:

```ts
const updated = await db.quote.update({ where: { id }, data: { status }, include: includeRels });
await logActivity(db, {
  quoteId: id, tipo: 'estatus',
  descripcion: `Estatus: ${existing.status} → ${status}`,
  meta: { de: existing.status, a: status }, actorId: actor.id,
});
return updated;
```

- [ ] **Step 4: Verificar con el test de ciclo existente.**

Run: `pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts`
Expected: PASS (no rompe nada; el log es aditivo).

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/quotes/activityLog.ts apps/api/src/quotes/service.ts
git commit -m "feat(api): bitácora de actividad en creación y cambio de estatus"
```

---

## Task 5: Permitir editar apartada/formalizada con registro

**Files:**
- Modify: `apps/api/src/quotes/service.ts` (`EDITABLE_STATUSES`, `updateQuote`)
- Modify: `apps/web/src/lib/status.ts` (`EDITABLE_STATUSES`)
- Test: `apps/api/src/quotes/quotes.test.ts` (ajustar el caso 409)

- [ ] **Step 1: Actualizar el test de ciclo (RED).** En `quotes.test.ts`, el caso "Editar tras apartar: bloqueado (409)" cambia: ahora editar en `apartada` **se permite** (200) y deja log. Reemplazar el bloque `edit2` por:

```ts
    // Editar tras apartar: ahora SE PERMITE (deja registro en bitácora)
    const edit2 = await app.inject({
      method: 'PUT',
      url: `/api/quotes/${q.id}`,
      cookies: auth,
      payload: { fecha: '2027-05-08', invitados: 260, spaceIds: [arcosId], eventTypeId },
    });
    expect(edit2.statusCode).toBe(200);

    // Editar tras liquidar: bloqueado (409)
    await app.inject({ method: 'PATCH', url: `/api/quotes/${q.id}/status`, cookies: auth, payload: { status: 'liquidada' } });
    const edit3 = await app.inject({
      method: 'PUT',
      url: `/api/quotes/${q.id}`,
      cookies: auth,
      payload: { fecha: '2027-05-08', invitados: 250, spaceIds: [arcosId], eventTypeId },
    });
    expect(edit3.statusCode).toBe(409);
```

- [ ] **Step 2: Correr el test (debe fallar).**

Run: `pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts`
Expected: FAIL (hoy apartada da 409).

- [ ] **Step 3: Relajar el candado en `service.ts` (GREEN).** Cambiar:

```ts
const EDITABLE_STATUSES = new Set(['borrador', 'enviada', 'aceptada', 'apartada', 'formalizada']);
```

Y en `updateQuote`, después de recalcular y hacer `db.quote.update(...)` (capturar en `const updated`), registrar la edición cuando el estatus tenía compromiso:

```ts
if (existing.status === 'apartada' || existing.status === 'formalizada') {
  await logActivity(db, {
    quoteId: id, tipo: 'edicion',
    descripcion: `Edición en ${existing.status}: total ${existing.total} → ${updated.total}`,
    meta: { totalAntes: existing.total, totalDespues: updated.total }, actorId: actor.id,
  });
}
return updated;
```

- [ ] **Step 4: Alinear el front.** En `apps/web/src/lib/status.ts`:

```ts
export const EDITABLE_STATUSES: QuoteStatus[] = ['borrador', 'enviada', 'aceptada', 'apartada', 'formalizada'];
```

- [ ] **Step 5: Correr tests + typecheck web.**

Run: `pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts && pnpm --filter @hsa/web exec tsc --noEmit`
Expected: PASS + sin errores.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/quotes/service.ts apps/api/src/quotes/quotes.test.ts apps/web/src/lib/status.ts
git commit -m "feat: editar apartada/formalizada permitido con registro en bitácora"
```

---

## Task 6: `ComprobanteStorage` (interfaz + default pendiente)

**Files:**
- Create: `apps/api/src/payments/storage.ts`
- Test: `apps/api/src/payments/storage.test.ts`

- [ ] **Step 1: Test (RED).** `apps/api/src/payments/storage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PendingStorage } from './storage.js';

describe('PendingStorage', () => {
  it('no sube: marca pendiente y no da url', async () => {
    const s = new PendingStorage();
    const r = await s.upload(Buffer.from('x'), 'image/jpeg');
    expect(r.url).toBeNull();
    expect(r.pendiente).toBe(true);
  });
});
```

- [ ] **Step 2: Correr (debe fallar).**

Run: `pnpm --filter @hsa/api exec vitest run src/payments/storage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `storage.ts` (GREEN).**

```ts
export interface UploadResult {
  url: string | null;
  pendiente: boolean;
}

/** Abstracción de almacenamiento del comprobante. El adaptador Drive real
 *  (googleapis) se implementa en un sub-plan aparte, gated por credencial. */
export interface ComprobanteStorage {
  upload(data: Buffer, contentType: string): Promise<UploadResult>;
  stream(ref: string): Promise<NodeJS.ReadableStream | null>;
}

/** Default sin credencial: no sube nada, deja el pago con comprobante pendiente. */
export class PendingStorage implements ComprobanteStorage {
  async upload(): Promise<UploadResult> {
    return { url: null, pendiente: true };
  }
  async stream(): Promise<NodeJS.ReadableStream | null> {
    return null;
  }
}
```

- [ ] **Step 4: Correr (debe pasar).**

Run: `pnpm --filter @hsa/api exec vitest run src/payments/storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/payments/storage.ts apps/api/src/payments/storage.test.ts
git commit -m "feat(api): interfaz ComprobanteStorage con default PendingStorage"
```

---

## Task 7: Servicio de pagos (registrar + anular)

**Files:**
- Create: `apps/api/src/payments/service.ts`
- Modify: `apps/api/src/quotes/service.ts` (exponer helper `loadEstadoCuenta` reusable)
- Test: `apps/api/src/payments/payments.test.ts`

- [ ] **Step 1: Helper `loadEstadoCuenta` en `quotes/service.ts`.** Reusable por getQuote/getByToken/payments. Agregar:

```ts
import { computeEstadoCuenta } from './estadoCuenta.js';

/** Carga regla del espacio + pagos y arma el estado de cuenta de una cotización. */
export async function loadEstadoCuenta(db: PrismaClient, quote: {
  id: string; total: number; fechaEvento: Date; status: string; spaceIds: string[];
}) {
  const spaceId = quote.spaceIds[0];
  const [rule, payments, firstApartado] = await Promise.all([
    spaceId ? db.spacePaymentRule.findUnique({ where: { spaceId } }) : Promise.resolve(null),
    db.payment.findMany({ where: { quoteId: quote.id }, orderBy: { fecha: 'asc' } }),
    db.activityLog.findFirst({
      where: { quoteId: quote.id, tipo: 'estatus', descripcion: { contains: 'apartada' } },
      orderBy: { createdAt: 'asc' }, select: { createdAt: true },
    }),
  ]);
  const ec = computeEstadoCuenta({
    total: quote.total,
    fechaEvento: quote.fechaEvento,
    status: quote.status,
    rule: rule ? { anticipo: rule.anticipo, complementoPct: rule.complementoPct, liquidarDiasAntes: rule.liquidarDiasAntes } : null,
    payments: payments.map((p) => ({ monto: p.monto, anuladoAt: p.anuladoAt })),
    fechaApartado: firstApartado?.createdAt ?? null,
  });
  return { estadoCuenta: ec, payments };
}
```

- [ ] **Step 2: Test del servicio (RED).** `apps/api/src/payments/payments.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@hsa/database';
import { createQuote, type Actor } from '../quotes/service.js';
import { registerPayment, anularPayment } from './service.js';
import { PendingStorage } from './storage.js';

let actor: Actor;
let arcosId: string, eventTypeId: string;
const quotes: string[] = [];
const clients: string[] = [];

beforeAll(async () => {
  const admin = await prisma.user.findUnique({ where: { email: 'admin@haciendasanandres.com.mx' } });
  actor = { id: admin!.id, role: 'admin' };
  arcosId = (await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } }))!.id;
  eventTypeId = (await prisma.eventType.findFirst({ where: { slug: 'boda' } }))!.id;
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
});

async function nuevaQuote() {
  const q = await createQuote(prisma, { fecha: '2027-05-08', invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Pago Test' } }, actor);
  quotes.push(q.id); clients.push(q.clientId);
  return q;
}

describe('registerPayment / anularPayment', () => {
  it('registra un pago y recalcula estado de cuenta', async () => {
    const q = await nuevaQuote();
    const res = await registerPayment(prisma, new PendingStorage(), q.id, {
      monto: 20000, metodo: 'transferencia', concepto: 'anticipo', fecha: '2027-01-10',
    }, actor);
    expect(res.estadoCuenta.pagado).toBe(20000);
    expect(res.payment.comprobantePendiente).toBe(false);
    expect(res.sugerenciaUpgrade).toBe('apartada'); // Arcos anticipo 20000
  });

  it('anular excluye el pago del acumulado (solo admin)', async () => {
    const q = await nuevaQuote();
    const { payment } = await registerPayment(prisma, new PendingStorage(), q.id, {
      monto: 20000, metodo: 'efectivo', concepto: 'anticipo', fecha: '2027-01-10',
    }, actor);
    const after = await anularPayment(prisma, q.id, payment.id, 'monto equivocado', actor);
    expect(after.estadoCuenta.pagado).toBe(0);
  });

  it('vendedora no puede anular (403 lo maneja la ruta; el servicio exige admin)', async () => {
    const q = await nuevaQuote();
    const { payment } = await registerPayment(prisma, new PendingStorage(), q.id, {
      monto: 5000, metodo: 'efectivo', concepto: 'aCuenta', fecha: '2027-01-10',
    }, actor);
    await expect(
      anularPayment(prisma, q.id, payment.id, 'x', { id: actor.id, role: 'vendedora' }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Correr (debe fallar).**

Run: `pnpm --filter @hsa/api exec vitest run src/payments/payments.test.ts`
Expected: FAIL (servicio no existe).

- [ ] **Step 4: Implementar `payments/service.ts` (GREEN).**

```ts
import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { QuoteError, ownershipWhere, loadEstadoCuenta, type Actor } from '../quotes/service.js';
import { logActivity } from '../quotes/activityLog.js';
import { esUpgrade } from '../quotes/estadoCuenta.js';
import type { ComprobanteStorage } from './storage.js';

export const registerPaymentSchema = z.object({
  monto: z.number().int().positive(),
  metodo: z.enum(['efectivo', 'transferencia', 'tarjeta']),
  concepto: z.enum(['anticipo', 'complemento', 'aCuenta', 'finiquito']),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  referencia: z.string().optional(),
  comprobanteUrl: z.string().url().optional(),
});

export const anularSchema = z.object({ motivo: z.string().min(3) });

async function findOwnedQuote(db: PrismaClient, id: string, actor: Actor) {
  const quote = await db.quote.findFirst({ where: { id, ...ownershipWhere(actor) } });
  if (!quote) throw new QuoteError(404, 'Cotización no encontrada');
  return quote;
}

export async function registerPayment(
  db: PrismaClient,
  storage: ComprobanteStorage,
  quoteId: string,
  rawInput: unknown,
  actor: Actor,
  file?: { data: Buffer; contentType: string },
) {
  const quote = await findOwnedQuote(db, quoteId, actor);
  const input = registerPaymentSchema.parse(rawInput);

  let comprobanteUrl = input.comprobanteUrl ?? null;
  let comprobantePendiente = false;
  if (file) {
    const r = await storage.upload(file.data, file.contentType);
    comprobanteUrl = r.url;
    comprobantePendiente = r.pendiente;
  }

  const payment = await db.payment.create({
    data: {
      quoteId,
      monto: input.monto,
      metodo: input.metodo,
      concepto: input.concepto,
      fecha: new Date(`${input.fecha}T00:00:00.000Z`),
      referencia: input.referencia ?? null,
      comprobanteUrl,
      comprobantePendiente,
      registradoById: actor.id,
    },
  });

  await logActivity(db, {
    quoteId, tipo: 'pago',
    descripcion: `Pago ${input.concepto} $${input.monto} (${input.metodo})`,
    meta: { paymentId: payment.id, monto: input.monto, concepto: input.concepto }, actorId: actor.id,
  });

  const { estadoCuenta } = await loadEstadoCuenta(db, quote);
  const sugerenciaUpgrade = esUpgrade(quote.status, estadoCuenta.sugerido) ? estadoCuenta.sugerido : null;
  return { payment, estadoCuenta, sugerenciaUpgrade };
}

export async function anularPayment(
  db: PrismaClient,
  quoteId: string,
  paymentId: string,
  motivo: string,
  actor: Actor,
) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin puede anular pagos');
  const quote = await findOwnedQuote(db, quoteId, actor);
  const payment = await db.payment.findFirst({ where: { id: paymentId, quoteId } });
  if (!payment) throw new QuoteError(404, 'Pago no encontrado');
  if (payment.anuladoAt) throw new QuoteError(409, 'El pago ya está anulado');

  await db.payment.update({
    where: { id: paymentId },
    data: { anuladoAt: new Date(), anuladoById: actor.id, motivoAnulacion: motivo },
  });
  await logActivity(db, {
    quoteId, tipo: 'pagoAnulado',
    descripcion: `Pago anulado $${payment.monto}: ${motivo}`,
    meta: { paymentId, motivo }, actorId: actor.id,
  });

  const { estadoCuenta } = await loadEstadoCuenta(db, quote);
  return { estadoCuenta };
}
```

- [ ] **Step 5: Exportar `ownershipWhere` desde `quotes/service.ts`.** Cambiar su declaración a `export function ownershipWhere(...)`.

- [ ] **Step 6: Correr (debe pasar).**

Run: `pnpm --filter @hsa/api exec vitest run src/payments/payments.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/api/src/payments/service.ts apps/api/src/payments/payments.test.ts apps/api/src/quotes/service.ts
git commit -m "feat(api): servicio de pagos (registrar/anular) con estado de cuenta y sugerencia"
```

---

## Task 8: Rutas de pagos + estado de cuenta en getQuote/getByToken

**Files:**
- Create: `apps/api/src/payments/routes.ts`
- Modify: `apps/api/src/server.ts` (registrar rutas + `@fastify/multipart`)
- Modify: `apps/api/src/quotes/service.ts` (`getQuote` y `getByToken` devuelven estado de cuenta + pagos + bitácora)
- Test: extender `apps/api/src/payments/payments.test.ts` con casos HTTP

- [ ] **Step 1: `getQuote` incluye estado de cuenta + pagos + bitácora.** En `quotes/service.ts`, reescribir `getQuote`:

```ts
export async function getQuote(db: PrismaClient, id: string, actor: Actor) {
  const quote = await db.quote.findFirst({ where: { id, ...ownershipWhere(actor) }, include: includeRels });
  if (!quote) return null;
  const { estadoCuenta, payments } = await loadEstadoCuenta(db, quote);
  const activityLog = await db.activityLog.findMany({ where: { quoteId: id }, orderBy: { createdAt: 'desc' }, include: { actor: { select: { nombre: true } } } });
  return { quote, estadoCuenta, payments, activityLog };
}
```

Nota: la ruta `GET /quotes/:id` hoy responde `{ quote }`; ahora responderá `{ quote, estadoCuenta, payments, activityLog }`. Ajustar el front en Task 9.

- [ ] **Step 2: `getByToken` con estado de cuenta real.** Reemplazar el cuerpo hardcodeado:

```ts
export async function getByToken(db: PrismaClient, token: string) {
  const quote = await db.quote.findUnique({ where: { publicToken: token }, include: includeRels });
  if (!quote) return null;
  const { estadoCuenta, payments } = await loadEstadoCuenta(db, quote);
  const pagosPublicos = payments
    .filter((p) => p.anuladoAt == null)
    .map((p) => ({ id: p.id, monto: p.monto, concepto: p.concepto, fecha: p.fecha.toISOString(), tieneComprobante: Boolean(p.comprobanteUrl) }));
  return { quote, estadoCuenta: { ...estadoCuenta, pagos: pagosPublicos } };
}
```

- [ ] **Step 3: Rutas de pagos.** `apps/api/src/payments/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import { QuoteError, type Actor } from '../quotes/service.js';
import { registerPayment, anularPayment, anularSchema } from './service.js';
import { PendingStorage } from './storage.js';

const storage = new PendingStorage(); // sustituible por DriveStorage cuando exista credencial

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>('/quotes/:id/payments', { preHandler: requireAuth }, async (req, reply) => {
    try {
      // JSON por ahora (link/manual); multipart llega con el adaptador Drive.
      const result = await registerPayment(app.prisma, storage, req.params.id, req.body, req.user as Actor);
      return reply.code(201).send(result);
    } catch (e) {
      if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.patch<{ Params: { id: string; paymentId: string } }>(
    '/quotes/:id/payments/:paymentId/anular',
    { preHandler: requireAuth },
    async (req, reply) => {
      const parsed = anularSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Motivo requerido' });
      try {
        const result = await anularPayment(app.prisma, req.params.id, req.params.paymentId, parsed.data.motivo, req.user as Actor);
        return result;
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );
}
```

- [ ] **Step 4: Registrar en `server.ts`.** Importar y registrar bajo `/api`:

```ts
import { paymentRoutes } from './payments/routes.js';
// ...
await app.register(paymentRoutes, { prefix: '/api' });
```

- [ ] **Step 5: Casos HTTP en el test.** Agregar a `payments.test.ts` un `describe('pagos HTTP')` que: login admin → POST pago 201 → GET `/api/quotes/:id` trae `estadoCuenta.pagado` correcto → PATCH anular como admin 200 → login/uso de vendedora recibe 403 al anular. (Seguir el patrón de `quotes.test.ts` para login y cookies.)

- [ ] **Step 6: Correr toda la suite de API.**

Run: `pnpm --filter @hsa/api run test`
Expected: PASS (incluye estadoCuenta, payments, quotes, availability, server, catalog).

- [ ] **Step 7: Commit.**

```bash
git add apps/api/src
git commit -m "feat(api): rutas de pagos + estado de cuenta real en getQuote/getByToken"
```

---

## Task 9: Web — panel de pagos en EditQuotePage

**Files:**
- Modify: `apps/web/src/lib/types.ts` (tipos Payment, EstadoCuenta con plan, ActivityLog; quitar `paymentRule` viejo de EventType)
- Create: `apps/web/src/components/PagosPanel.tsx`
- Modify: `apps/web/src/pages/EditQuotePage.tsx` (montar el panel + manejar respuesta ampliada de `/quotes/:id`)

- [ ] **Step 1: Tipos.** En `types.ts`: quitar el bloque `paymentRule` de `EventType` (líneas 38-42, dejar `EventType` sin él). Agregar:

```ts
export interface Payment {
  id: string;
  monto: number;
  metodo: 'efectivo' | 'transferencia' | 'tarjeta';
  concepto: 'anticipo' | 'complemento' | 'aCuenta' | 'finiquito';
  fecha: string;
  referencia: string | null;
  comprobanteUrl: string | null;
  comprobantePendiente: boolean;
  anuladoAt: string | null;
  motivoAnulacion: string | null;
}

export interface Milestone {
  key: 'apartar' | 'complemento' | 'finiquito';
  label: string;
  objetivo: number;
  cubierto: number;
  completo: boolean;
  venceISO: string | null;
}

export interface EstadoCuenta {
  total: number;
  pagado: number;
  saldo: number;
  plan: Milestone[] | null;
  planPendiente: boolean;
  sugerido: 'apartada' | 'formalizada' | 'liquidada' | null;
  desfase: boolean;
  pagos?: unknown[];
}

export interface ActivityEntry {
  id: string;
  tipo: 'creada' | 'estatus' | 'pago' | 'pagoAnulado' | 'edicion';
  descripcion: string;
  createdAt: string;
  actor?: { nombre: string } | null;
}

export interface QuoteDetail {
  quote: Quote;
  estadoCuenta: EstadoCuenta;
  payments: Payment[];
  activityLog: ActivityEntry[];
}
```

- [ ] **Step 2: Componente `PagosPanel.tsx`.** Presentacional + acciones vía props. Muestra: estado de cuenta (total/pagado/saldo), plan de hitos o aviso pendiente, aviso de desfase, lista de pagos (anulados tachados), formulario "Registrar pago", y bitácora. Usa `formatMXN` y `formatEventDate`/`formatTimestamp`. El registro llama `api.post(\`/api/quotes/${quoteId}/payments\`, payload)`; si la respuesta trae `sugerenciaUpgrade`, muestra botón "Marcar como {sugerido}" que hace `api.patch(.../status)`. Anular (solo admin) pide motivo con `prompt`/modal y hace `api.patch(.../payments/:id/anular, { motivo })`. Tras cada acción, invalida `['quote', id]`.

  Estructura mínima (completar estilos con las clases de marca ya usadas):

```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate, formatTimestamp } from '../lib/date.ts';
import { Button, Card, TextInput, SelectInput, Field } from './ui.tsx';
import { STATUS_LABEL } from '../lib/status.ts';
import type { EstadoCuenta, Payment, ActivityEntry, QuoteStatus } from '../lib/types.ts';

interface Props {
  quoteId: string;
  isAdmin: boolean;
  estadoCuenta: EstadoCuenta;
  payments: Payment[];
  activityLog: ActivityEntry[];
}

export function PagosPanel({ quoteId, isAdmin, estadoCuenta, payments, activityLog }: Props) {
  const qc = useQueryClient();
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState('transferencia');
  const [concepto, setConcepto] = useState('anticipo');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [referencia, setReferencia] = useState('');
  const [comprobanteUrl, setComprobanteUrl] = useState('');
  const [sugerido, setSugerido] = useState<QuoteStatus | null>(null);
  const [err, setErr] = useState('');

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['quote', quoteId] });
    await qc.invalidateQueries({ queryKey: ['quotes'] });
  }

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      const res = await api.post<{ sugerenciaUpgrade: QuoteStatus | null }>(
        `/api/quotes/${quoteId}/payments`,
        {
          monto: Number(monto),
          metodo, concepto, fecha,
          referencia: referencia || undefined,
          comprobanteUrl: comprobanteUrl || undefined,
        },
      );
      setMonto(''); setReferencia(''); setComprobanteUrl('');
      setSugerido(res.sugerenciaUpgrade);
      await refresh();
    } catch {
      setErr('No se pudo registrar el pago. Revisa los datos.');
    }
  }

  async function avanzar() {
    if (!sugerido) return;
    await api.patch(`/api/quotes/${quoteId}/status`, { status: sugerido });
    setSugerido(null);
    await refresh();
  }

  async function anular(paymentId: string) {
    const motivo = window.prompt('Motivo de la anulación:');
    if (!motivo) return;
    await api.patch(`/api/quotes/${quoteId}/payments/${paymentId}/anular`, { motivo });
    await refresh();
  }

  return (
    <div className="mt-8 grid gap-6">
      {/* Estado de cuenta */}
      <Card className="p-6">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div><p className="text-xs uppercase tracking-wide text-charcoal-soft">Total</p><p className="font-display text-2xl text-ink">{formatMXN(estadoCuenta.total)}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-charcoal-soft">Pagado</p><p className="font-display text-2xl text-ink">{formatMXN(estadoCuenta.pagado)}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-charcoal-soft">Saldo</p><p className="font-display text-2xl text-gold">{formatMXN(estadoCuenta.saldo)}</p></div>
        </div>
        {estadoCuenta.desfase && (
          <p className="mt-4 rounded-lg bg-wine/10 px-3 py-2 text-sm text-wine">
            Aviso: el acumulado ya no cubre el hito de este estatus. Revisa si corresponde ajustar el estatus.
          </p>
        )}
        {estadoCuenta.planPendiente ? (
          <p className="mt-4 text-sm text-charcoal-soft">Plan de pagos pendiente de configurar para este espacio.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {estadoCuenta.plan?.map((m) => (
              <li key={m.key} className="flex items-center justify-between text-sm">
                <span className={m.completo ? 'text-ink' : 'text-charcoal-soft'}>
                  {m.completo ? '✓' : '○'} {m.label} {m.venceISO && <span className="text-xs text-charcoal-soft/70">· vence {formatEventDate(m.venceISO)}</span>}
                </span>
                <span className="tabular-nums">{formatMXN(m.cubierto)} / {formatMXN(m.objetivo)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {sugerido && (
        <Card className="flex items-center justify-between gap-4 border-gold/40 p-4">
          <p className="text-sm text-ink">El pago alcanza el hito. ¿Marcar como <strong>{STATUS_LABEL[sugerido]}</strong>?</p>
          <div className="flex gap-2">
            <Button variant="gold" onClick={avanzar}>Sí, avanzar</Button>
            <Button variant="ghost" onClick={() => setSugerido(null)}>Ahora no</Button>
          </div>
        </Card>
      )}

      {/* Registrar pago */}
      <Card className="p-6">
        <h3 className="mb-4 font-display text-xl text-ink">Registrar pago</h3>
        <form onSubmit={registrar} className="grid gap-4 sm:grid-cols-2">
          <Field label="Monto (MXN)"><TextInput type="number" min="1" value={monto} onChange={(e) => setMonto(e.target.value)} required /></Field>
          <Field label="Fecha"><TextInput type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></Field>
          <Field label="Método">
            <SelectInput value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              <option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option>
            </SelectInput>
          </Field>
          <Field label="Concepto">
            <SelectInput value={concepto} onChange={(e) => setConcepto(e.target.value)}>
              <option value="anticipo">Anticipo</option><option value="complemento">Complemento</option><option value="aCuenta">A cuenta</option><option value="finiquito">Finiquito</option>
            </SelectInput>
          </Field>
          <Field label="Referencia (opcional)"><TextInput value={referencia} onChange={(e) => setReferencia(e.target.value)} /></Field>
          <Field label="Link del comprobante (Drive, opcional)"><TextInput type="url" value={comprobanteUrl} onChange={(e) => setComprobanteUrl(e.target.value)} placeholder="https://drive.google.com/…" /></Field>
          <div className="sm:col-span-2">
            {err && <p className="mb-2 text-sm text-wine">{err}</p>}
            <Button type="submit" variant="primary">Guardar pago</Button>
          </div>
        </form>
      </Card>

      {/* Lista de pagos */}
      {payments.length > 0 && (
        <Card className="p-6">
          <h3 className="mb-4 font-display text-xl text-ink">Pagos</h3>
          <ul className="divide-y divide-cream-200">
            {payments.map((p) => (
              <li key={p.id} className={`flex items-center justify-between gap-4 py-2.5 text-sm ${p.anuladoAt ? 'opacity-50 line-through' : ''}`}>
                <span>{formatEventDate(p.fecha)} · {p.concepto} · {p.metodo}{p.referencia && ` · ${p.referencia}`}{p.comprobantePendiente && ' · comprobante pendiente'}</span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{formatMXN(p.monto)}</span>
                  {isAdmin && !p.anuladoAt && <button onClick={() => anular(p.id)} className="text-xs text-wine hover:underline">Anular</button>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Bitácora */}
      {activityLog.length > 0 && (
        <Card className="p-6">
          <h3 className="mb-4 font-display text-xl text-ink">Bitácora</h3>
          <ul className="space-y-2 text-sm">
            {activityLog.map((a) => (
              <li key={a.id} className="flex justify-between gap-4 text-charcoal-soft">
                <span>{a.descripcion}{a.actor?.nombre && ` — ${a.actor.nombre}`}</span>
                <span className="text-xs text-charcoal-soft/70">{formatTimestamp(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Montar en `EditQuotePage.tsx`.** El query de `['quote', id]` ahora devuelve `QuoteDetail`. Cambiar el tipo del `useQuery` a `api.get<QuoteDetail>(\`/api/quotes/${id}\`)`, extraer `quote/estadoCuenta/payments/activityLog`, y renderizar `<PagosPanel .../>` bajo la sección existente (tanto en el modo editable como no editable). Usar `useAuth()` para `isAdmin`.

- [ ] **Step 4: Typecheck + build web.**

Run: `pnpm --filter @hsa/web exec tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src
git commit -m "feat(web): panel de pagos, estado de cuenta y bitácora en la cotización"
```

---

## Task 10: Web — estado de cuenta real en la página del cliente

**Files:**
- Modify: `apps/web/src/pages/PublicQuotePage.tsx`

- [ ] **Step 1: Mostrar plan de hitos y pagos.** La respuesta de `/api/c/:token` ahora trae `estadoCuenta` con `pagado`/`saldo` reales, `plan` y `pagos`. Bajo las tarjetas de Total/Pagado/Saldo (que ya existen y ahora reflejan valores reales), agregar una sección "Plan de pagos" que liste los hitos (`estadoCuenta.plan`) con objetivo/cubierto y, si hay `estadoCuenta.pagos`, una lista de pagos del cliente (fecha + concepto + monto). Si `planPendiente`, omitir el plan. Usar `formatMXN` y `formatEventDate`. No mostrar bitácora ni datos de quién capturó.

- [ ] **Step 2: Actualizar el tipo local `EstadoCuenta`** en la página para incluir `plan`, `planPendiente`, `pagos` (reusar el de `types.ts`).

- [ ] **Step 3: Verificación en navegador (preview).** Levantar `hsa-web` (necesita la API en :3001 con DB). Login → crear cotización → registrar un pago → ver que estado de cuenta y hitos se actualizan → abrir `/c/:token` y confirmar pagado/saldo/plan reales. Screenshot de evidencia.

- [ ] **Step 4: Commit.**

```bash
git add apps/web/src/pages/PublicQuotePage.tsx
git commit -m "feat(web): estado de cuenta real y plan de pagos en la página del cliente"
```

---

## Cierre del sub-plan

- [ ] Correr toda la suite: `pnpm --filter @hsa/api run test` (verde) + `pnpm typecheck`.
- [ ] Revisión final de código (subagent-driven-development lanza el reviewer).
- [ ] Nota de despliegue: comunicar al equipo la captura retroactiva de fichas para cotizaciones ya apartadas/formalizadas (arrancan desfasadas). Migración de prod corre `migrate deploy` + re-seed de `SpacePaymentRule` (o insertar manualmente Cúpula/Arcos/Campos).
- [ ] El **adaptador Drive real** y el **contrato + sección operativa** son sub-planes aparte.
