# Plan C: candado de facturación y API para el BI · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Proteger los datos fiscales una vez que su pago ya no se puede facturar, y abrir un API de solo lectura para que el BI del cliente consuma eventos, pagos reales, pagos esperados, cambios y datos de facturación.

**Architecture:** El candado vive en el **pago**, no en el evento, porque el SAT exige facturar el ingreso en el mes en que se recibe. Es una función pura sobre la fecha del pago más un desbloqueo de admin auditado. El API del BI es un módulo aislado bajo `/api/bi` con llave en encabezado, que solo lee y solo se registra si hay llave configurada.

**Tech Stack:** pnpm + Turbo, Fastify 5, Prisma 6 + Postgres (Docker 5434), React 18 + Vite 6, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-03-cambios-estatus-multisalon-facturacion-bi-design.md` — sección "RESUELTO · Candado de los datos fiscales" y cambio 7.

**Rama:** continúa en `feat/planA-estatus-multisalon`.

---

## Antes de empezar

- [ ] **Punto de partida verde**

```bash
cd /Users/fernando.diaz/Projects/hacienda-san-andres && docker compose up -d
set -a && source .env && set +a
pnpm typecheck && pnpm --filter @hsa/api exec vitest run && pnpm --filter @hsa/shared run test
```

Esperado: typecheck 4/4, 78 tests de API, 37 de shared.

**Advertencias heredadas:** no correr la suite de la API dos veces en paralelo (el bloqueo de
disponibilidad hace que compitan por fechas), y **nunca `git commit --amend`** en esta rama.

---

## Estructura de archivos

**Candado (parte 1)**
- Crear: `packages/shared/src/facturacion/candado.ts` + `candado.test.ts`
- Crear: `packages/database/prisma/migrations/20260806120000_candado_factura/migration.sql`
- Modificar: `packages/database/prisma/schema.prisma`, `packages/shared/src/index.ts`
- Modificar: `apps/api/src/payments/service.ts`, `apps/api/src/payments/routes.ts`
- Modificar: `apps/api/src/quotes/service.ts` (bloquear escritura fiscal)
- Modificar: `apps/web/src/components/FacturacionSection.tsx`, `PagosPanel.tsx`

**API del BI (parte 2)** — módulo nuevo y aislado
- Crear: `apps/api/src/bi/apiKey.ts` (guardia de la llave)
- Crear: `apps/api/src/bi/service.ts` (consultas)
- Crear: `apps/api/src/bi/routes.ts` (5 endpoints)
- Crear: `apps/api/src/bi/bi.test.ts`
- Modificar: `apps/api/src/config.ts`, `apps/api/src/server.ts`
- Modificar: `apps/api/src/quotes/service.ts` (bitácora de edición enriquecida)
- Crear: `docs/API-BI.md` (contrato para quien consuma)

Tres archivos en `bi/` en vez de uno: la llave es una preocupación de seguridad que se prueba
por separado, y las consultas no deben mezclarse con el enrutado.

---

# Parte 1 · Candado de facturación

## Task 1: Modelo del candado

**Files:**
- Create: `packages/database/prisma/migrations/20260806120000_candado_factura/migration.sql`
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Escribir la migración**

```sql
-- Candado de facturación, POR PAGO: el SAT exige facturar el ingreso en el mes
-- en que se recibe, así que un anticipo de marzo se factura en marzo aunque el
-- evento sea en octubre.
--   facturadoAt   = cuándo se timbró el CFDI (lo llenará el PAC más adelante)
--   facturaUuid   = folio fiscal del CFDI (columna lista para esa integración)
--   desbloqueoAt  = un admin reabrió este pago para corregir tras una cancelación
ALTER TABLE "Payment" ADD COLUMN "facturadoAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "facturaUuid" TEXT;
ALTER TABLE "Payment" ADD COLUMN "desbloqueoAt" TIMESTAMP(3);
```

- [ ] **Step 2: Reflejarlo en el schema**

En `packages/database/prisma/schema.prisma`, dentro de `model Payment`, después de `folio`:

```prisma
  // Candado de facturación (ver docs del Plan C). El ingreso se factura en el mes
  // en que se recibe; pasado ese mes se va a la global de público en general.
  facturadoAt          DateTime?
  facturaUuid          String?
  desbloqueoAt         DateTime?
```

- [ ] **Step 3: Aplicar y verificar**

```bash
set -a && source .env && set +a
pnpm --filter @hsa/database exec prisma migrate deploy && pnpm db:generate
docker exec -i hsa-postgres psql -U hsa -d hsa -c '\d "Payment"' | grep -E "facturadoAt|facturaUuid|desbloqueoAt"
```

Esperado: las tres columnas presentes.

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma
git commit -m "feat(db): columnas del candado de facturación en Payment"
```

---

## Task 2: La regla del candado (función pura, TDD)

**Files:**
- Create: `packages/shared/src/facturacion/candado.ts`, `candado.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Escribir los tests**

Crear `packages/shared/src/facturacion/candado.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { estadoFacturaPago, datosFiscalesEditables } from './candado.js';

const HOY = new Date('2026-04-15T12:00:00.000Z');

describe('estadoFacturaPago', () => {
  it('un pago del mes en curso se puede facturar', () => {
    const e = estadoFacturaPago({ fecha: new Date('2026-04-02T00:00:00.000Z') }, HOY);
    expect(e.facturable).toBe(true);
    expect(e.motivo).toBeNull();
  });

  it('el último día del mes todavía se puede facturar', () => {
    const e = estadoFacturaPago({ fecha: new Date('2026-04-30T23:00:00.000Z') }, HOY);
    expect(e.facturable).toBe(true);
  });

  it('un pago de un mes ya cerrado se fue a la global', () => {
    const e = estadoFacturaPago({ fecha: new Date('2026-03-20T00:00:00.000Z') }, HOY);
    expect(e.facturable).toBe(false);
    expect(e.motivo).toMatch(/público en general/i);
    expect(e.motivo).toMatch(/marzo/i);
  });

  it('un pago ya facturado queda cerrado aunque sea del mes en curso', () => {
    const e = estadoFacturaPago(
      { fecha: new Date('2026-04-02T00:00:00.000Z'), facturadoAt: new Date('2026-04-05T00:00:00.000Z') },
      HOY,
    );
    expect(e.facturable).toBe(false);
    expect(e.motivo).toMatch(/ya se factur/i);
  });

  it('un desbloqueo de admin reabre un mes cerrado', () => {
    const e = estadoFacturaPago(
      { fecha: new Date('2026-03-20T00:00:00.000Z'), desbloqueoAt: new Date('2026-04-10T00:00:00.000Z') },
      HOY,
    );
    expect(e.facturable).toBe(true);
    expect(e.motivo).toBeNull();
  });

  it('el desbloqueo NO reabre un pago ya facturado', () => {
    const e = estadoFacturaPago(
      {
        fecha: new Date('2026-03-20T00:00:00.000Z'),
        facturadoAt: new Date('2026-03-25T00:00:00.000Z'),
        desbloqueoAt: new Date('2026-04-10T00:00:00.000Z'),
      },
      HOY,
    );
    expect(e.facturable).toBe(false);
    expect(e.motivo).toMatch(/ya se factur/i);
  });

  it('un pago anulado no cuenta para nada', () => {
    const e = estadoFacturaPago(
      { fecha: new Date('2026-04-02T00:00:00.000Z'), anuladoAt: new Date('2026-04-03T00:00:00.000Z') },
      HOY,
    );
    expect(e.facturable).toBe(false);
    expect(e.motivo).toMatch(/anulado/i);
  });
});

describe('datosFiscalesEditables', () => {
  it('un cliente sin pagos se puede editar', () => {
    expect(datosFiscalesEditables([], HOY).editable).toBe(true);
  });

  it('con al menos un pago aún facturable, se puede editar', () => {
    const r = datosFiscalesEditables(
      [{ fecha: new Date('2026-03-01T00:00:00.000Z') }, { fecha: new Date('2026-04-02T00:00:00.000Z') }],
      HOY,
    );
    expect(r.editable).toBe(true);
  });

  it('si todos los pagos ya están cerrados, no se puede editar', () => {
    const r = datosFiscalesEditables(
      [{ fecha: new Date('2026-02-10T00:00:00.000Z') }, { fecha: new Date('2026-03-01T00:00:00.000Z') }],
      HOY,
    );
    expect(r.editable).toBe(false);
    expect(r.motivo).toMatch(/público en general/i);
  });

  it('los pagos anulados se ignoran al decidir', () => {
    const r = datosFiscalesEditables(
      [{ fecha: new Date('2026-04-02T00:00:00.000Z'), anuladoAt: new Date('2026-04-03T00:00:00.000Z') }],
      HOY,
    );
    // Solo tenía un pago y está anulado ⇒ es como no tener pagos.
    expect(r.editable).toBe(true);
  });
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

```bash
pnpm --filter @hsa/shared exec vitest run src/facturacion/candado.test.ts
```

Esperado: FALLA — el módulo no existe.

- [ ] **Step 3: Escribir el módulo**

Crear `packages/shared/src/facturacion/candado.ts`:

```ts
/**
 * Candado de facturación, POR PAGO.
 *
 * El SAT exige facturar el ingreso en el mes en que se recibe: un anticipo
 * cobrado en marzo se factura en marzo aunque el evento sea en octubre. Si el
 * mes cierra sin que el cliente pidiera CFDI, ese ingreso entra en la factura
 * global de público en general y ya no se puede timbrar individualmente.
 *
 * Función pura: recibe el "hoy" en vez de leer el reloj, para poder probarla.
 */

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export interface PagoParaCandado {
  fecha: Date | string;
  /** Cuándo se timbró el CFDI. Lo llenará el PAC; hoy siempre null. */
  facturadoAt?: Date | string | null;
  /** Un admin reabrió el pago para corregir tras una cancelación. */
  desbloqueoAt?: Date | string | null;
  anuladoAt?: Date | string | null;
}

export interface EstadoFactura {
  facturable: boolean;
  /** Por qué no se puede facturar, en lenguaje para la operación. `null` si sí se puede. */
  motivo: string | null;
}

const aFecha = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

/** Primer instante del mes siguiente al de `d`, en UTC. */
function inicioDelMesSiguiente(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

export function estadoFacturaPago(pago: PagoParaCandado, hoy: Date): EstadoFactura {
  if (pago.anuladoAt) {
    return { facturable: false, motivo: 'El pago está anulado.' };
  }
  if (pago.facturadoAt) {
    return { facturable: false, motivo: 'Ya se facturó este pago.' };
  }
  if (pago.desbloqueoAt) {
    // Un admin lo reabrió a propósito (típicamente tras cancelar un CFDI).
    return { facturable: true, motivo: null };
  }
  const fecha = aFecha(pago.fecha);
  if (hoy < inicioDelMesSiguiente(fecha)) {
    return { facturable: true, motivo: null };
  }
  const mes = MESES[fecha.getUTCMonth()];
  return {
    facturable: false,
    motivo: `Cerró ${mes} sin CFDI: este pago se facturó a público en general.`,
  };
}

export interface EstadoEdicionFiscal {
  editable: boolean;
  motivo: string | null;
}

/**
 * ¿Se pueden todavía tocar los datos fiscales del cliente?
 *
 * Sí mientras quede al menos un pago facturable: ese pago aún puede llevar el
 * RFC corregido. Un cliente sin pagos (o con todos anulados) siempre es editable.
 */
export function datosFiscalesEditables(pagos: PagoParaCandado[], hoy: Date): EstadoEdicionFiscal {
  const vigentes = pagos.filter((p) => !p.anuladoAt);
  if (vigentes.length === 0) return { editable: true, motivo: null };
  const alguno = vigentes.some((p) => estadoFacturaPago(p, hoy).facturable);
  if (alguno) return { editable: true, motivo: null };
  return {
    editable: false,
    motivo: 'Todos los pagos de este evento ya se facturaron o se fueron a público en general.',
  };
}
```

- [ ] **Step 4: Exportarlo**

En `packages/shared/src/index.ts`:

```ts
export * from './facturacion/candado.js';
```

- [ ] **Step 5: Correr los tests para verlos pasar**

```bash
pnpm --filter @hsa/shared run test
```

Esperado: PASA. 37 previos + 11 nuevos = 48.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): regla del candado de facturación por pago"
```

---

## Task 3: Exponer y hacer valer el candado en la API

**Files:**
- Modify: `apps/api/src/payments/service.ts`, `apps/api/src/payments/routes.ts`
- Modify: `apps/api/src/quotes/service.ts`
- Test: `apps/api/src/payments/payments.test.ts`

- [ ] **Step 1: Escribir los tests**

Agregar en `apps/api/src/payments/payments.test.ts` (usar los helpers reales del archivo):

```ts
  it('un pago del mes en curso viene marcado como facturable', async () => {
    const q = await nuevaQuote();
    await registerPayment(prisma, storage, q.id,
      { monto: 15000, metodo: 'transferencia', concepto: 'anticipo', fecha: new Date().toISOString().slice(0, 10) },
      actor);
    const { payments } = await loadEstadoCuenta(prisma, {
      id: q.id, breakdown: q.breakdown, rentaTotal: q.rentaTotal,
      fechaEvento: q.fechaEvento, status: q.status, spaceIds: q.spaceIds,
    });
    expect(payments[0]).toBeDefined();
    const detalle = await getQuote(prisma, q.id, actor);
    expect(detalle.payments[0].facturable).toBe(true);
    expect(detalle.payments[0].motivoFactura).toBeNull();
  });

  it('un pago de un mes cerrado ya no es facturable', async () => {
    const q = await nuevaQuote();
    const p = await registerPayment(prisma, storage, q.id,
      { monto: 15000, metodo: 'transferencia', concepto: 'anticipo', fecha: '2020-03-15' },
      actor);
    expect(p.payment).toBeDefined();
    const detalle = await getQuote(prisma, q.id, actor);
    const pago = detalle.payments.find((x) => x.id === p.payment.id)!;
    expect(pago.facturable).toBe(false);
    expect(pago.motivoFactura).toMatch(/público en general/i);
  });

  it('solo un admin puede desbloquear la facturación de un pago', async () => {
    const q = await nuevaQuote();
    const p = await registerPayment(prisma, storage, q.id,
      { monto: 15000, metodo: 'transferencia', concepto: 'anticipo', fecha: '2020-03-15' },
      actor);
    const ventas = { id: actor.id, role: 'ventas' as const };
    await expect(desbloquearFactura(prisma, q.id, p.payment.id, ventas)).rejects.toThrow(/admin/i);

    const ok = await desbloquearFactura(prisma, q.id, p.payment.id, actor);
    expect(ok.facturable).toBe(true);
    const log = await prisma.activityLog.findFirst({
      where: { quoteId: q.id, descripcion: { contains: 'Desbloqueo' } },
    });
    expect(log).not.toBeNull();
  });
```

Agregar `desbloquearFactura` al import de `../quotes/service.js` o de `./service.js`, según
dónde termine viviendo.

⚠️ **Verificar antes de escribir el test, no asumir:** estos casos leen el detalle de la
cotización con `getQuote(prisma, q.id, actor)`. Revisa cómo se llama realmente la función que
`GET /api/quotes/:id` usa en `apps/api/src/quotes/service.ts` y cuál es su firma; el nombre
aquí es el esperado, no uno verificado. Si el acceso real es por la ruta HTTP, usa
`app.inject` con la cookie como hacen los demás tests del archivo.

- [ ] **Step 2: Correr los tests para verlos fallar**

```bash
set -a && source .env && set +a
pnpm --filter @hsa/api exec vitest run src/payments/payments.test.ts -t 'facturab'
```

Esperado: FALLA — los campos y la función no existen.

- [ ] **Step 3: Enriquecer los pagos que devuelve `getQuote`**

En `apps/api/src/quotes/service.ts`, importar la regla:

```ts
import { estadoFacturaPago, datosFiscalesEditables } from '@hsa/shared';
```

Donde `getQuote` arma su respuesta, mapear los pagos agregando el estado del candado:

```ts
  // El candado de facturación se calcula al vuelo: depende del calendario, no de
  // un campo guardado, así que un pago "caduca" solo al cerrar su mes.
  const ahora = new Date();
  const paymentsConCandado = payments.map((p) => {
    const est = estadoFacturaPago(
      { fecha: p.fecha, facturadoAt: p.facturadoAt, desbloqueoAt: p.desbloqueoAt, anuladoAt: p.anuladoAt },
      ahora,
    );
    return { ...p, facturable: est.facturable, motivoFactura: est.motivo };
  });
```

y devolver `paymentsConCandado` en lugar de `payments`. Agregar también, junto al
`estadoCuenta`, el estado de edición fiscal del evento:

```ts
    fiscalEditable: datosFiscalesEditables(
      payments.map((p) => ({ fecha: p.fecha, facturadoAt: p.facturadoAt, desbloqueoAt: p.desbloqueoAt, anuladoAt: p.anuladoAt })),
      ahora,
    ),
```

- [ ] **Step 4: Impedir la escritura fiscal cuando está cerrado**

En `updateQuote` de `apps/api/src/quotes/service.ts`, antes de escribir el cliente:

```ts
  if (input.client) {
    // Si ya no queda ningún pago facturable, los datos fiscales quedan congelados:
    // el ingreso se fue a la global de público en general y reescribir el RFC solo
    // crearía una discrepancia con lo ya declarado.
    const pagos = await db.payment.findMany({
      where: { quoteId: id },
      select: { fecha: true, facturadoAt: true, desbloqueoAt: true, anuladoAt: true },
    });
    const edicion = datosFiscalesEditables(pagos, new Date());
    const tocaFiscales = ['rfc', 'razonSocial', 'regimenFiscal', 'cpFiscal', 'usoCfdi', 'correoFacturacion']
      .some((k) => k in input.client!);
    if (!edicion.editable && tocaFiscales) {
      throw new QuoteError(409, edicion.motivo ?? 'Los datos fiscales ya no se pueden modificar.');
    }
    await db.client.update({ where: { id: existing.clientId }, data: input.client });
  }
```

- [ ] **Step 5: Agregar el desbloqueo de admin**

En `apps/api/src/payments/service.ts`:

```ts
/**
 * Reabre la facturación de un pago cuyo mes ya cerró. Solo admin.
 *
 * Existe porque los CFDI se cancelan y se reemiten: sin esta salida habría que
 * crear un cliente nuevo para corregir un RFC mal capturado. No reabre un pago
 * que YA se facturó — para eso primero hay que cancelar el CFDI.
 */
export async function desbloquearFactura(
  db: PrismaClient,
  quoteId: string,
  paymentId: string,
  actor: Actor,
) {
  if (actor.role !== 'admin') {
    throw new QuoteError(403, 'Solo un admin puede desbloquear la facturación de un pago.');
  }
  const pago = await db.payment.findFirst({ where: { id: paymentId, quoteId } });
  if (!pago) throw new QuoteError(404, 'Pago no encontrado');
  if (pago.facturadoAt) {
    throw new QuoteError(409, 'Este pago ya tiene CFDI. Cancélalo antes de reabrirlo.');
  }
  const actualizado = await db.payment.update({
    where: { id: paymentId },
    data: { desbloqueoAt: new Date() },
  });
  await logActivity(db, {
    quoteId,
    tipo: 'edicion',
    descripcion: `Desbloqueo de facturación del pago folio ${pago.folio}`,
    meta: { paymentId, folio: pago.folio },
    actorId: actor.id,
  });
  const est = estadoFacturaPago(
    { fecha: actualizado.fecha, facturadoAt: actualizado.facturadoAt, desbloqueoAt: actualizado.desbloqueoAt, anuladoAt: actualizado.anuladoAt },
    new Date(),
  );
  return { payment: actualizado, facturable: est.facturable };
}
```

Importar `estadoFacturaPago` de `@hsa/shared`, y `logActivity`/`QuoteError`/`Actor` de los
módulos donde ya viven.

- [ ] **Step 6: Exponer la ruta**

En `apps/api/src/payments/routes.ts`:

```ts
  app.patch<{ Params: { id: string; paymentId: string } }>(
    '/quotes/:id/payments/:paymentId/desbloquear-factura',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        return await desbloquearFactura(app.prisma, req.params.id, req.params.paymentId, req.user as Actor);
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );
```

- [ ] **Step 7: Correr la suite y commitear**

```bash
pnpm --filter @hsa/api exec vitest run
git add apps/api/src
git commit -m "feat(api): candado de facturación por pago y desbloqueo de admin"
```

---

## Task 4: El candado en la interfaz

**Files:**
- Modify: `apps/web/src/components/FacturacionSection.tsx`, `apps/web/src/components/QuoteForm.tsx`
- Modify: `apps/web/src/components/PagosPanel.tsx`, `apps/web/src/lib/types.ts`

- [ ] **Step 1: Tipos**

En `apps/web/src/lib/types.ts`, en la interfaz `Payment`:

```ts
  facturable?: boolean;
  motivoFactura?: string | null;
  facturadoAt?: string | null;
  desbloqueoAt?: string | null;
```

Y en `QuoteDetail`:

```ts
  fiscalEditable?: { editable: boolean; motivo: string | null };
```

- [ ] **Step 2: La tarjeta se vuelve de solo lectura**

`FacturacionSection.tsx` gana dos props:

```tsx
interface Props {
  requiereFactura: boolean;
  onRequiereFactura: (v: boolean) => void;
  datos: DatosFiscales;
  onChange: (patch: Partial<DatosFiscales>) => void;
  /** `false` cuando ya no queda ningún pago facturable. */
  editable?: boolean;
  motivoBloqueo?: string | null;
}
```

Con `editable === false`, cada `TextInput` y `SelectInput` recibe `disabled`, y arriba de los
campos aparece el aviso:

```tsx
{editable === false && (
  <p className="flex items-start gap-2 rounded-lg border border-ink/15 bg-ink/5 px-3 py-2.5 text-sm text-ink-500">
    <Lock size={15} className="mt-0.5 shrink-0" />
    <span>
      {motivoBloqueo ?? 'Los datos fiscales ya no se pueden modificar.'}{' '}
      Un administrador puede reabrir un pago desde el panel de pagos.
    </span>
  </p>
)}
```

Importar `Lock` de `lucide-react`. El valor por omisión de `editable` es `true`, para que crear
una cotización nueva (sin pagos) funcione igual que hoy.

- [ ] **Step 3: Pasarlo desde el formulario**

`QuoteForm` gana la prop `fiscalEditable?: { editable: boolean; motivo: string | null }` y la
reenvía:

```tsx
<FacturacionSection
  requiereFactura={requiereFactura}
  onRequiereFactura={setRequiereFactura}
  datos={fiscales}
  onChange={(patch) => setFiscales((prev) => ({ ...prev, ...patch }))}
  editable={fiscalEditable?.editable ?? true}
  motivoBloqueo={fiscalEditable?.motivo}
/>
```

En `EditQuotePage.tsx`, pasar `fiscalEditable={data.fiscalEditable}` al `QuoteForm`.
`NewQuotePage.tsx` no lo pasa: una cotización nueva no tiene pagos.

- [ ] **Step 4: Estado y desbloqueo en el panel de pagos**

En `PagosPanel.tsx`, en cada renglón de pago, mostrar el estado del candado y —solo para
admin— el botón de reabrir:

```tsx
{p.facturable === false && !p.anuladoAt && (
  <div className="flex flex-wrap items-center gap-2 text-xs text-charcoal-soft">
    <span className="inline-flex items-center gap-1">
      <Lock size={12} /> {p.motivoFactura}
    </span>
    {esAdmin && (
      <button
        type="button"
        onClick={() => desbloquear.mutate(p.id)}
        disabled={desbloquear.isPending}
        className="rounded border border-ink/15 px-2 py-0.5 text-xs text-ink hover:bg-ink/5"
      >
        Reabrir facturación
      </button>
    )}
  </div>
)}
```

Con la mutación:

```tsx
  const desbloquear = useMutation({
    mutationFn: (paymentId: string) =>
      api.patch(`/api/quotes/${quoteId}/payments/${paymentId}/desbloquear-factura`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quote', quoteId] }),
  });
```

Tomar `esAdmin` de `useAuth()` como ya hace el resto del panel, y `qc`/`quoteId` de lo que el
componente ya tenga.

- [ ] **Step 5: Compilar y commitear**

```bash
pnpm typecheck
git add apps/web/src
git commit -m "feat(web): datos fiscales de solo lectura cuando el pago ya no es facturable"
```

---

# Parte 2 · API para el BI

## Task 5: Bitácora de edición enriquecida

**Files:**
- Modify: `apps/api/src/quotes/service.ts`
- Test: `apps/api/src/quotes/quotes.test.ts`

**Por qué:** el endpoint `/api/bi/cambios` debe reportar cambios de salón y de tamaño de
evento. Hoy la bitácora de edición solo guarda el total antes y después, y solo cuando el
evento ya tenía compromiso de pago. Sin esto, el BI no puede ver lo que se le pidió.

- [ ] **Step 1: Escribir el test**

Agregar en `apps/api/src/quotes/quotes.test.ts`:

```ts
  it('la bitácora de edición registra el antes y después de espacios e invitados', async () => {
    const { eventTypeId, arcosId, camposId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2030-03-09', invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Bitacora Rica' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    await updateQuote(
      prisma, q.id,
      { fecha: '2030-03-09', invitados: 260, spaceIds: [arcosId, camposId], eventTypeId, horasExtra: 0, addOns: [] },
      actor,
    );

    const log = await prisma.activityLog.findFirst({
      where: { quoteId: q.id, tipo: 'edicion' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    const meta = log!.meta as Record<string, unknown>;
    expect(meta.invitadosAntes).toBe(200);
    expect(meta.invitadosDespues).toBe(260);
    expect(meta.espaciosAntes).toEqual([arcosId]);
    expect(meta.espaciosDespues).toEqual([arcosId, camposId]);
  });

  it('guardar sin cambiar nada no ensucia la bitácora', async () => {
    const { eventTypeId, camposId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2030-03-16', invitados: 200, spaceIds: [camposId], eventTypeId, client: { nombre: 'Sin Cambios' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    await updateQuote(
      prisma, q.id,
      { fecha: '2030-03-16', invitados: 200, spaceIds: [camposId], eventTypeId, horasExtra: 0, addOns: [] },
      actor,
    );

    const ediciones = await prisma.activityLog.count({ where: { quoteId: q.id, tipo: 'edicion' } });
    expect(ediciones).toBe(0);
  });
```

- [ ] **Step 2: Correr los tests para verlos fallar**

```bash
set -a && source .env && set +a
pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts -t 'bitácora'
```

Esperado: FALLA — hoy el `meta` solo trae totales, y una edición sin cambios sí escribe si el
estatus tiene compromiso.

- [ ] **Step 3: Reescribir el registro de edición**

En `updateQuote` de `apps/api/src/quotes/service.ts`, reemplazar el bloque
`if (existing.status === 'formalizada' || existing.status === 'complementada') { … }` por:

```ts
  // Se registra CUALQUIER edición que cambie algo material, no solo las de eventos
  // con compromiso de pago: el BI necesita el historial completo de cambios de
  // salón y de tamaño de evento. Si no cambió nada, no se escribe: una bitácora
  // llena de ruido no sirve para auditar.
  const antes = {
    invitados: existing.invitados,
    espacios: [...existing.spaceIds].sort(),
    fecha: existing.fechaEvento.toISOString().slice(0, 10),
    total: existing.total,
    rentaTotal: existing.rentaTotal,
  };
  const despues = {
    invitados: updated.invitados,
    espacios: [...updated.spaceIds].sort(),
    fecha: updated.fechaEvento.toISOString().slice(0, 10),
    total: updated.total,
    rentaTotal: updated.rentaTotal,
  };
  if (JSON.stringify(antes) !== JSON.stringify(despues)) {
    await logActivity(db, {
      quoteId: id,
      tipo: 'edicion',
      descripcion: `Edición en ${existing.status}: total ${existing.total} → ${updated.total}`,
      meta: {
        invitadosAntes: antes.invitados, invitadosDespues: despues.invitados,
        espaciosAntes: existing.spaceIds, espaciosDespues: updated.spaceIds,
        fechaAntes: antes.fecha, fechaDespues: despues.fecha,
        totalAntes: antes.total, totalDespues: despues.total,
        rentaTotalAntes: antes.rentaTotal, rentaTotalDespues: despues.rentaTotal,
      },
      actorId: actor.id,
    });
  }
```

Nota: `espaciosAntes`/`espaciosDespues` guardan el orden original (no el ordenado), porque el
test compara contra `[arcosId, camposId]` tal como se enviaron. El ordenado solo sirve para
comparar si hubo cambio real.

- [ ] **Step 4: Correr la suite y commitear**

```bash
pnpm --filter @hsa/api exec vitest run
git add apps/api/src apps/api/src/quotes/quotes.test.ts
git commit -m "feat(api): la bitácora de edición registra espacios, invitados y fecha"
```

---

## Task 6: La llave del API del BI

**Files:**
- Create: `apps/api/src/bi/apiKey.ts`
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/src/bi/bi.test.ts`

- [ ] **Step 1: Agregar la variable de entorno**

En `apps/api/src/config.ts`, dentro de `envSchema`:

```ts
  // Llave del API de solo lectura para el BI. Si no está, el módulo /api/bi
  // NO se registra y sus rutas responden 404: no hay modo "abierto" por descuido.
  BI_API_KEY: z.string().min(32, 'BI_API_KEY debe tener al menos 32 caracteres').optional(),
```

Agregar también a `.env.example` y `.env.production.example`:

```
# API de solo lectura para el BI. Generar con: openssl rand -hex 32
# Si se deja vacía, /api/bi no existe.
BI_API_KEY=
```

⚠️ Ojo: una variable vacía en `.env` llega como `''`, que **falla** el `min(32)` en vez de
comportarse como ausente. Por eso el esquema debe tratar la cadena vacía como no definida:

```ts
  BI_API_KEY: z
    .string()
    .transform((v) => (v === '' ? undefined : v))
    .pipe(z.string().min(32, 'BI_API_KEY debe tener al menos 32 caracteres').optional())
    .optional(),
```

- [ ] **Step 2: Escribir el test de la llave**

Crear `apps/api/src/bi/bi.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';

const LLAVE = 'a'.repeat(64);
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer({ config: { ...loadConfig(), BI_API_KEY: LLAVE } });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('API del BI · llave', () => {
  it('sin llave responde 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/bi/eventos' });
    expect(r.statusCode).toBe(401);
  });

  it('con llave incorrecta responde 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/bi/eventos', headers: { 'x-api-key': 'b'.repeat(64) } });
    expect(r.statusCode).toBe(401);
  });

  it('con llave de otra longitud responde 401 y no truena', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/bi/eventos', headers: { 'x-api-key': 'corta' } });
    expect(r.statusCode).toBe(401);
  });

  it('con la llave correcta responde 200', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/bi/eventos', headers: { 'x-api-key': LLAVE } });
    expect(r.statusCode).toBe(200);
  });

  it('el mensaje de error no revela la llave', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/bi/eventos', headers: { 'x-api-key': 'b'.repeat(64) } });
    expect(r.body).not.toContain(LLAVE);
    expect(r.body).not.toContain('b'.repeat(64));
  });
});

describe('API del BI · sin llave configurada', () => {
  it('el módulo no existe y responde 404', async () => {
    const sinLlave = await buildServer({ config: { ...loadConfig(), BI_API_KEY: undefined } });
    await sinLlave.ready();
    const r = await sinLlave.inject({ method: 'GET', url: '/api/bi/eventos', headers: { 'x-api-key': LLAVE } });
    expect(r.statusCode).toBe(404);
    await sinLlave.close();
  });
});
```

- [ ] **Step 3: Correr para verlo fallar**

```bash
pnpm --filter @hsa/api exec vitest run src/bi/bi.test.ts
```

Esperado: FALLA — todas las rutas dan 404 porque el módulo no existe.

- [ ] **Step 4: Escribir el guardia**

Crear `apps/api/src/bi/apiKey.ts`:

```ts
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Compara en tiempo constante. `timingSafeEqual` exige buffers del mismo largo,
 * así que la diferencia de longitud se resuelve antes — y esa comparación previa
 * solo revela el largo de la llave, no su contenido.
 */
function igual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Guardia del API del BI. La llave nunca se escribe en logs ni en la respuesta:
 * el 401 es genérico a propósito.
 */
export function requireApiKey(esperada: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const recibida = req.headers['x-api-key'];
    if (typeof recibida !== 'string' || !igual(recibida, esperada)) {
      return reply.code(401).send({ error: 'Llave de API inválida o ausente.' });
    }
  };
}
```

- [ ] **Step 5: Correr los tests después de la Task 7**

Este test no puede pasar hasta que existan las rutas. Dejarlo rojo y volver al terminar la
Task 7.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bi/apiKey.ts apps/api/src/config.ts .env.example .env.production.example
git commit -m "feat(api): guardia de llave para el API del BI"
```

---

## Task 7: Los cinco endpoints del BI

**Files:**
- Create: `apps/api/src/bi/service.ts`, `apps/api/src/bi/routes.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/bi/bi.test.ts`

- [ ] **Step 1: Escribir el servicio**

Crear `apps/api/src/bi/service.ts`:

```ts
import type { PrismaClient } from '@hsa/database';
import { estadoFacturaPago, requisitosFactura } from '@hsa/shared';
import { loadEstadoCuentaBulk } from '../quotes/service.js';

/** Rango de fechas y paginación comunes a todos los endpoints del BI. */
export interface RangoBI {
  desde: Date;
  hasta: Date;
  limit: number;
  cursor?: string;
}

const incluirEvento = {
  client: true,
  eventType: { select: { nombre: true, slug: true } },
  createdBy: { select: { id: true, nombre: true } },
  banquetero: { select: { id: true, nombre: true } },
};

/** Eventos del rango, con su desglose separado en renta vs. proveedor. */
export async function biEventos(db: PrismaClient, r: RangoBI) {
  const quotes = await db.quote.findMany({
    where: { fechaEvento: { gte: r.desde, lte: r.hasta }, deletedAt: null },
    include: incluirEvento,
    orderBy: { fechaEvento: 'asc' },
    take: r.limit,
    ...(r.cursor ? { skip: 1, cursor: { id: r.cursor } } : {}),
  });
  return quotes.map((q) => ({
    id: q.id,
    fechaEvento: q.fechaEvento.toISOString().slice(0, 10),
    estatus: q.status,
    tipoEvento: q.eventType?.nombre ?? null,
    invitados: q.invitados,
    espacios: q.spaceIds,
    esCortesia: q.esCortesia,
    requiereFactura: q.requiereFactura,
    cliente: { id: q.clientId, nombre: q.client?.nombre ?? null, referencia: q.client?.numeroReferencia ?? null },
    vendedora: q.createdBy ? { id: q.createdBy.id, nombre: q.createdBy.nombre } : null,
    banquetero: q.banquetero ? { id: q.banquetero.id, nombre: q.banquetero.nombre } : null,
    // Dos bloques separados: la renta la cobra la hacienda, lo demás se paga al proveedor.
    renta: { subtotal: (q.breakdown as never as { rentaSubtotal: number }).rentaSubtotal, total: q.rentaTotal },
    otros: { total: q.total - q.rentaTotal },
    total: q.total,
  }));
}

/** Pagos realmente recibidos en el rango, con su estado de facturación. */
export async function biPagos(db: PrismaClient, r: RangoBI) {
  const ahora = new Date();
  const pagos = await db.payment.findMany({
    where: { fecha: { gte: r.desde, lte: r.hasta }, quote: { deletedAt: null } },
    include: {
      quote: { select: { id: true, fechaEvento: true, client: { select: { nombre: true } } } },
      registradoBy: { select: { nombre: true } },
      anuladoBy: { select: { nombre: true } },
    },
    orderBy: { fecha: 'asc' },
    take: r.limit,
    ...(r.cursor ? { skip: 1, cursor: { id: r.cursor } } : {}),
  });
  return pagos.map((p) => {
    const est = estadoFacturaPago(
      { fecha: p.fecha, facturadoAt: p.facturadoAt, desbloqueoAt: p.desbloqueoAt, anuladoAt: p.anuladoAt },
      ahora,
    );
    return {
      id: p.id,
      folio: p.folio,
      quoteId: p.quoteId,
      cliente: p.quote?.client?.nombre ?? null,
      fecha: p.fecha.toISOString().slice(0, 10),
      monto: p.monto,
      metodo: p.metodo,
      concepto: p.concepto,
      registradoPor: p.registradoBy?.nombre ?? null,
      anulado: p.anuladoAt != null,
      anuladoPor: p.anuladoBy?.nombre ?? null,
      motivoAnulacion: p.motivoAnulacion,
      facturable: est.facturable,
      motivoFactura: est.motivo,
      facturadoAt: p.facturadoAt?.toISOString() ?? null,
      facturaUuid: p.facturaUuid,
    };
  });
}

/** Hitos de cobro pendientes que vencen dentro del rango. */
export async function biPagosEsperados(db: PrismaClient, r: RangoBI) {
  const quotes = await db.quote.findMany({
    where: { deletedAt: null, status: { in: ['formalizada', 'complementada'] } },
    select: { id: true, rentaTotal: true, fechaEvento: true, status: true, spaceIds: true, breakdown: true,
              client: { select: { nombre: true } } },
    take: r.limit,
  });
  const estados = await loadEstadoCuentaBulk(db, quotes);
  const filas: unknown[] = [];
  for (const q of quotes) {
    const ec = estados.get(q.id);
    if (!ec?.plan) continue;
    for (const hito of ec.plan) {
      if (hito.completo || !hito.venceISO) continue;
      const vence = new Date(hito.venceISO);
      if (vence < r.desde || vence > r.hasta) continue;
      filas.push({
        quoteId: q.id,
        cliente: q.client?.nombre ?? null,
        hito: hito.key,
        etiqueta: hito.label,
        objetivo: hito.objetivo,
        cubierto: hito.cubierto,
        restante: hito.restante,
        venceISO: hito.venceISO,
      });
    }
  }
  return filas;
}

/** Bitácora: cambios de salón, invitados, fecha, estatus y pagos. */
export async function biCambios(db: PrismaClient, r: RangoBI) {
  const logs = await db.activityLog.findMany({
    where: { createdAt: { gte: r.desde, lte: r.hasta }, quote: { deletedAt: null } },
    include: { actor: { select: { nombre: true } }, quote: { select: { client: { select: { nombre: true } } } } },
    orderBy: { createdAt: 'asc' },
    take: r.limit,
    ...(r.cursor ? { skip: 1, cursor: { id: r.cursor } } : {}),
  });
  return logs.map((l) => ({
    id: l.id,
    quoteId: l.quoteId,
    cliente: l.quote?.client?.nombre ?? null,
    tipo: l.tipo,
    descripcion: l.descripcion,
    detalle: l.meta,
    actor: l.actor?.nombre ?? null,
    fecha: l.createdAt.toISOString(),
  }));
}

/** Datos fiscales de los eventos que pidieron factura, con lo que falta. */
export async function biFacturacion(db: PrismaClient, r: RangoBI) {
  const quotes = await db.quote.findMany({
    where: { fechaEvento: { gte: r.desde, lte: r.hasta }, deletedAt: null, requiereFactura: true },
    include: { client: true },
    orderBy: { fechaEvento: 'asc' },
    take: r.limit,
    ...(r.cursor ? { skip: 1, cursor: { id: r.cursor } } : {}),
  });
  return quotes.map((q) => {
    const req = requisitosFactura(q.client ?? {});
    return {
      quoteId: q.id,
      fechaEvento: q.fechaEvento.toISOString().slice(0, 10),
      total: q.total,
      cliente: {
        id: q.clientId,
        nombre: q.client?.nombre ?? null,
        rfc: q.client?.rfc ?? null,
        razonSocial: q.client?.razonSocial ?? null,
        regimenFiscal: q.client?.regimenFiscal ?? null,
        cpFiscal: q.client?.cpFiscal ?? null,
        usoCfdi: q.client?.usoCfdi ?? null,
        correoFacturacion: q.client?.correoFacturacion ?? null,
      },
      faltantes: req.filter((x) => !x.ok).map((x) => x.label),
    };
  });
}
```

- [ ] **Step 2: Escribir las rutas**

Crear `apps/api/src/bi/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireApiKey } from './apiKey.js';
import { biEventos, biPagos, biPagosEsperados, biCambios, biFacturacion, type RangoBI } from './service.js';

const LIMITE_MAX = 500;
const LIMITE_DEFAULT = 100;

const querySchema = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().optional(),
});

/** Rango por omisión: el año en curso. El BI casi siempre manda el suyo. */
function aRango(q: z.infer<typeof querySchema>): RangoBI {
  const hoy = new Date();
  const desde = q.desde ? new Date(`${q.desde}T00:00:00.000Z`) : new Date(Date.UTC(hoy.getUTCFullYear(), 0, 1));
  const hasta = q.hasta ? new Date(`${q.hasta}T23:59:59.999Z`) : new Date(Date.UTC(hoy.getUTCFullYear(), 11, 31, 23, 59, 59));
  // El tope es duro: un BI que pida 100000 recibe 500, no un timeout.
  const limit = Math.min(q.limit ?? LIMITE_DEFAULT, LIMITE_MAX);
  return { desde, hasta, limit, cursor: q.cursor };
}

/**
 * API de solo lectura para el BI del cliente. Ni un endpoint de escritura.
 * Se registra únicamente si hay `BI_API_KEY`; sin ella estas rutas no existen.
 */
export async function biRoutes(app: FastifyInstance): Promise<void> {
  const llave = app.config.BI_API_KEY;
  if (!llave) return;
  const guardia = requireApiKey(llave);

  const endpoints: [string, (db: never, r: RangoBI) => Promise<unknown>][] = [
    ['eventos', biEventos as never],
    ['pagos', biPagos as never],
    ['pagos-esperados', biPagosEsperados as never],
    ['cambios', biCambios as never],
    ['facturacion', biFacturacion as never],
  ];

  for (const [nombre, consulta] of endpoints) {
    app.get(`/bi/${nombre}`, { preHandler: guardia }, async (req, reply) => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: 'Parámetros inválidos' });
      const rango = aRango(parsed.data);
      const datos = (await consulta(app.prisma as never, rango)) as unknown[];
      return {
        desde: rango.desde.toISOString().slice(0, 10),
        hasta: rango.hasta.toISOString().slice(0, 10),
        limit: rango.limit,
        // Cursor para la siguiente página: el id del último elemento, o null si
        // vino menos de `limit` (ya no hay más).
        siguienteCursor:
          datos.length === rango.limit ? ((datos[datos.length - 1] as { id?: string }).id ?? null) : null,
        datos,
      };
    });
  }
}
```

- [ ] **Step 3: Registrarlo en el servidor**

En `apps/api/src/server.ts`, importar `biRoutes` y agregarlo al final de los registros:

```ts
  await app.register(biRoutes, { prefix: '/api' });
```

- [ ] **Step 4: Ampliar los tests con los datos**

Agregar a `apps/api/src/bi/bi.test.ts`:

```ts
describe('API del BI · datos', () => {
  it('cada endpoint responde con la envoltura estándar', async () => {
    for (const ruta of ['eventos', 'pagos', 'pagos-esperados', 'cambios', 'facturacion']) {
      const r = await app.inject({
        method: 'GET',
        url: `/api/bi/${ruta}?desde=2020-01-01&hasta=2035-12-31`,
        headers: { 'x-api-key': LLAVE },
      });
      expect(r.statusCode, ruta).toBe(200);
      const body = r.json();
      expect(body, ruta).toHaveProperty('datos');
      expect(Array.isArray(body.datos), ruta).toBe(true);
      expect(body, ruta).toHaveProperty('siguienteCursor');
    }
  });

  it('el limit se recorta al tope duro', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/bi/eventos?limit=99999',
      headers: { 'x-api-key': LLAVE },
    });
    expect(r.json().limit).toBe(500);
  });

  it('rechaza un rango con formato inválido', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/bi/eventos?desde=marzo',
      headers: { 'x-api-key': LLAVE },
    });
    expect(r.statusCode).toBe(400);
  });

  it('no expone ningún endpoint de escritura', async () => {
    for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      const r = await app.inject({ method, url: '/api/bi/eventos', headers: { 'x-api-key': LLAVE } });
      expect(r.statusCode, method).toBe(404);
    }
  });
});
```

- [ ] **Step 5: Correr todo**

```bash
set -a && source .env && set +a
pnpm --filter @hsa/api exec vitest run src/bi/bi.test.ts
pnpm --filter @hsa/api exec vitest run
pnpm typecheck
```

Esperado: los tests del BI en verde y la suite completa sin regresiones.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): API de solo lectura para el BI con cinco endpoints"
```

---

## Task 8: Documentar el contrato del API

**Files:**
- Create: `docs/API-BI.md`

- [ ] **Step 1: Escribir la documentación**

Crear `docs/API-BI.md` con exactamente esta estructura:

```markdown
# API de solo lectura para el BI

## Advertencia
La llave da acceso de lectura a TODOS los datos comerciales y fiscales de la hacienda:
clientes, RFC, montos y pagos. Va en un secreto de la plataforma, nunca en el repositorio.
Se revoca cambiándola: no hay lista de revocación ni caducidad.

## Autenticación
Encabezado `x-api-key`. Generar con `openssl rand -hex 32`.
En EasyPanel: variable de entorno `BI_API_KEY` del servicio de la API.
Sin la variable, estas rutas no existen y responden 404.

## Envoltura de respuesta
(mostrar el JSON real de `{ desde, hasta, limit, siguienteCursor, datos }`)

## Paginación
(explicar que se repite la llamada pasando `cursor=<siguienteCursor>` hasta que venga `null`)

## Endpoints
Para cada uno de los cinco: qué devuelve, **sobre qué campo se aplica el rango de fechas**
(evento en `/eventos` y `/facturacion`, fecha del pago en `/pagos`, vencimiento del hito en
`/pagos-esperados`, fecha del registro en `/cambios`) y un ejemplo de respuesta.
```

Los ejemplos de respuesta se **copian de una corrida real** contra la base de desarrollo
(`curl` con la llave), no se inventan: un ejemplo que no corresponde al JSON real es peor que
no tener ejemplo.

- [ ] **Step 2: Commit**

```bash
git add docs/API-BI.md
git commit -m "docs: contrato del API del BI"
```

---

## Task 9: Cierre y verificación

- [ ] **Step 1: Suite completa**

```bash
set -a && source .env && set +a
pnpm typecheck && pnpm --filter @hsa/api exec vitest run && pnpm --filter @hsa/shared run test
```

Esperado: typecheck 4/4; API 78 previos + ~14 nuevos; shared 37 + 11 = 48.

- [ ] **Step 2: Probar el API del BI de verdad**

Con una llave temporal en el entorno, levantar la API y pegarle con curl:

```bash
export BI_API_KEY=$(openssl rand -hex 32)
# (levantar la API con esa variable)
curl -s -H "x-api-key: $BI_API_KEY" 'http://localhost:3001/api/bi/eventos?desde=2026-01-01&hasta=2031-12-31' | head -40
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3001/api/bi/eventos'   # espera 401
```

- [ ] **Step 3: Verificar el candado en el navegador**

1. Registrar un pago con fecha de un mes ya cerrado (p. ej. `2020-03-15`). En el panel de
   pagos debe aparecer el candado con "Cerró marzo sin CFDI…".
2. Con ese pago como único del evento, abrir la edición: los campos fiscales deben estar
   deshabilitados con el aviso.
3. Como admin, pulsar "Reabrir facturación": los campos vuelven a habilitarse y el movimiento
   queda en la bitácora.
4. Registrar un pago con fecha de hoy: debe aparecer sin candado.

- [ ] **Step 4: Limpiar los datos de prueba**

Borrar las cotizaciones, pagos y clientes creados durante la verificación.

- [ ] **Step 5: Reportar**

Resumir qué se construyó, resultados de tests, qué se verificó, y que la rama sigue sin
mergear ni pushear. Recordar que para pushear la cuenta activa de `gh` debe ser `SinergIA-cun`.

---

## Notas para quien implemente

**El candado vive en el PAGO, no en el evento.** Es la consecuencia de que el SAT exige
facturar el ingreso en el mes en que se recibe. Un mismo evento puede tener el anticipo cerrado
y el finiquito abierto. Si en la revisión ves el candado colgado del `Quote`, está mal.

**El candado se calcula al vuelo, no se guarda.** Depende del calendario: un pago "caduca" solo
porque pasó el tiempo, sin que nadie escriba nada. Guardarlo en una columna obligaría a un
proceso que la recorra cada noche.

**`facturadoAt` hoy siempre es `null`.** El disparador "ya se facturó" llegará con la
integración del PAC, que es otro proyecto. La columna y la regla ya lo contemplan para que esa
integración sea conectar, no migrar.

**El API del BI no se registra si no hay llave.** Es deliberado: no existe un modo "abierto"
por descuido. Si las rutas dan 404 en producción, lo primero que hay que revisar es si
`BI_API_KEY` llegó al contenedor.

**Ni un endpoint de escritura bajo `/api/bi`.** Hay un test que lo verifica; si alguien agrega
un POST, ese test se pone rojo. Es intencional.
