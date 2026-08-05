# Plan B: quitar el valet, facturación y arrastrar en la agenda · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sacar el valet del cobro, capturar los datos de facturación del cliente con su lista de requisitos, y poder mover un evento de fecha arrastrándolo en la agenda.

**Architecture:** Los tres cambios son independientes entre sí. El valet sale desactivando el add-on (no borrándolo, para no dejar huérfanas las líneas ya congeladas) y quitando la sugerencia de autos. Facturación agrega campos opcionales al `Client` modelados para CFDI 4.0, con una función pura compartida que calcula qué falta. Arrastrar en la agenda recalcula el precio por el mismo camino que la edición normal, porque cambiar la fecha cambia el tipo de día y por tanto el total.

**Tech Stack:** pnpm + Turbo, Fastify 5, Prisma 6 + Postgres (Docker 5434), React 18 + Vite 6 + Tailwind 4 + TanStack Query, Vitest, `@dnd-kit/core` (dependencia nueva).

**Spec:** `docs/superpowers/specs/2026-08-03-cambios-estatus-multisalon-facturacion-bi-design.md` (cambios 5, 6 y 4)

**Rama:** continúa en `feat/planA-estatus-multisalon` (el Plan A ya está ahí, sin mergear).

---

## Antes de empezar

- [ ] **Base de datos arriba y punto de partida verde**

```bash
cd /Users/fernando.diaz/Projects/hacienda-san-andres && docker compose up -d
set -a && source .env && set +a
pnpm typecheck && pnpm --filter @hsa/api exec vitest run && pnpm --filter @hsa/shared run test
```

Esperado: typecheck 4/4, 70 tests de API, 27 de shared. Si algo falla, resolverlo antes de
empezar — no arrastrar fallos del Plan A.

**Dos advertencias heredadas del Plan A:**
- **No correr la suite de la API dos veces en paralelo.** El bloqueo de disponibilidad en el
  servidor hace que dos corridas compitan por las mismas fechas y produzcan fallos fantasma.
- **`git commit --amend` es peligroso en esta rama.** Si hay sesiones concurrentes, HEAD puede
  moverse entre tu commit y tu amend, y terminas reescribiendo el commit de alguien más.
  Commit nuevo siempre.

---

## Estructura de archivos

**Base de datos**
- Crear: `packages/database/prisma/migrations/20260803190000_facturacion/migration.sql`
- Crear: `packages/database/prisma/backfill-fase12.ts` (desactiva el add-on del valet)
- Modificar: `packages/database/prisma/schema.prisma`, `prisma/seed.ts`
- Modificar: `apps/api/Dockerfile` (agregar el backfill al arranque)

**Motor compartido (`packages/shared`)** — funciones puras, sin base de datos
- Crear: `packages/shared/src/facturacion/catalogos.ts` (claves SAT)
- Crear: `packages/shared/src/facturacion/requisitos.ts` (`requisitosFactura`)
- Crear: `packages/shared/src/facturacion/requisitos.test.ts`
- Modificar: `packages/shared/src/index.ts` (exportar lo nuevo)

**API**
- Modificar: `apps/api/src/quotes/service.ts` (datos fiscales del cliente, `requiereFactura`, `moveQuoteDate`)
- Modificar: `apps/api/src/quotes/routes.ts` (`PATCH /quotes/:id/fecha`, subida de la CSF)
- Modificar: `apps/api/src/catalog/routes.ts`, `apps/api/src/admin/routes.ts` (fuera `valetRatio`)
- Modificar: `apps/api/src/quotes/quotes.test.ts`, `apps/api/src/admin/admin.test.ts`

**Front**
- Crear: `apps/web/src/components/FacturacionSection.tsx` (tarjeta de datos fiscales)
- Crear: `apps/web/src/components/MoverFechaModal.tsx` (confirmación del arrastre)
- Modificar: `apps/web/src/components/QuoteForm.tsx`, `admin/ConfigSection.tsx`
- Modificar: `apps/web/src/pages/AgendaPage.tsx`, `ContratoPage.tsx`, `QuotesListPage.tsx`, `PublicQuotePage.tsx`
- Modificar: `apps/web/src/lib/types.ts`

Los dos componentes nuevos existen para no engordar más `QuoteForm.tsx` (ya ~620 líneas) ni
`AgendaPage.tsx`.

---

# Parte 1 · Quitar el valet

## Task 1: Desactivar el add-on del valet

**Files:**
- Create: `packages/database/prisma/backfill-fase12.ts`
- Modify: `packages/database/prisma/seed.ts:74`, `packages/database/package.json`, `apps/api/Dockerfile`

**Contexto:** todos los eventos tienen valet y el cliente lo paga directo al valet en el
evento ($100 por auto). No es un concepto que cobre la Hacienda, así que sale del desglose.

**El add-on se DESACTIVA, no se borra.** Las cotizaciones existentes tienen líneas
congeladas que lo referencian por id; borrarlo dejaría esas líneas apuntando a la nada.

- [ ] **Step 1: Escribir el backfill**

Crear `packages/database/prisma/backfill-fase12.ts`:

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Saca el valet del cobro: todos los eventos lo tienen y el cliente lo paga
 * directo al valet en el evento ($100 por auto). Se DESACTIVA en vez de
 * borrarse porque las cotizaciones ya emitidas lo referencian por id en su
 * desglose congelado. Idempotente.
 */
async function main(): Promise<void> {
  const { count } = await prisma.addOn.updateMany({
    where: { nombre: { contains: 'alet' }, activo: true },
    data: { activo: false },
  });
  console.log(count > 0 ? `Valet desactivado (${count} add-on).` : 'Valet ya estaba desactivado.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('backfill-fase12 falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
```

`contains: 'alet'` cubre "Valet parking" y "valet parking" sin depender de mayúsculas.

- [ ] **Step 2: Registrar el script**

En `packages/database/package.json`, junto a los otros backfills:

```json
    "backfill:fase12": "tsx prisma/backfill-fase12.ts",
```

- [ ] **Step 3: Correrlo en desarrollo**

```bash
set -a && source .env && set +a
pnpm --filter @hsa/database run backfill:fase12
```

Esperado: `Valet desactivado (1 add-on).` Correrlo dos veces y ver que la segunda dice
`Valet ya estaba desactivado.` (idempotencia).

- [ ] **Step 4: Quitarlo del seed**

En `packages/database/prisma/seed.ts` línea ~74, borrar la línea del valet del arreglo de
add-ons, dejando las otras dos:

```ts
      { nombre: 'DJ Hora extra', kind: AddOnKind.porUnidad, price: 2950 },
      { nombre: 'Mesa de dulces (por persona)', kind: AddOnKind.porPersona, price: 110 },
```

- [ ] **Step 5: Agregarlo al arranque de producción**

En `apps/api/Dockerfile`, en el `CMD`, insertar `backfill:fase12` después de `backfill:fase11`:

```
pnpm --filter @hsa/database run backfill:fase11 && pnpm --filter @hsa/database run backfill:fase12 &&
```

- [ ] **Step 6: Commit**

```bash
git add packages/database apps/api/Dockerfile
git commit -m "feat(db): el valet sale del cobro (add-on desactivado)"
```

---

## Task 2: Quitar la sugerencia de autos del formulario

**Files:**
- Modify: `apps/web/src/components/QuoteForm.tsx`

- [ ] **Step 1: Borrar el estado y la lógica del valet**

Quitar, en este orden:

1. La constante de la línea ~12: `const DEFAULT_VALET_RATIO = 2.5; …`
2. Las líneas ~70-71 dentro del componente:
   ```tsx
   const valetAddOn = catalog.addOns.find((a) => a.nombre.toLowerCase().includes('valet'));
   const valetRatio = catalog.config?.valetRatio ?? DEFAULT_VALET_RATIO;
   ```
3. El bloque completo de las líneas ~105-115 (el comentario, `valetManual`, `valetSuggestion`
   y el `useEffect` que recalcula la sugerencia).
4. En `toggleAddOn` (líneas ~223-228), las dos referencias al valet. La función queda:
   ```tsx
   function toggleAddOn(id: string, kind: string) {
     setAddOns((prev) => {
       const next = { ...prev };
       if (id in next) delete next[id];
       else next[id] = 1;
       return next;
     });
   }
   ```
   Nota: `kind` deja de usarse dentro del cuerpo, pero la firma se conserva porque el JSX la
   pasa; si el linter marca el parámetro sin usar, renombrarlo a `_kind`.
5. En el JSX de servicios adicionales (líneas ~524, ~554, ~559-570): borrar `const isValet = …`
   y el bloque `{isValet && (<button …>)}` completo, dejando solo el `<input type="number">`
   del contador de unidades:
   ```tsx
                  {active && a.kind === 'porUnidad' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={addOns[a.id]}
                        onChange={(e) => setAddOns((prev) => ({ ...prev, [a.id]: Number(e.target.value) }))}
                        className="w-20 rounded-md border border-ink/15 px-2 py-1 text-sm"
                      />
                    </div>
                  )}
   ```
6. Quitar `RotateCcw` del import de `lucide-react` de la línea 4 si ya no se usa en el archivo
   (verificar con `grep -n RotateCcw apps/web/src/components/QuoteForm.tsx`).
7. Quitar `useRef` del import de `react` de la línea 1 si ya no queda ningún `useRef`.

- [ ] **Step 2: Verificar que no quedó nada**

```bash
grep -n "valet\|Valet\|RotateCcw\|useRef" apps/web/src/components/QuoteForm.tsx
```

Esperado: sin resultados.

- [ ] **Step 3: Compilar**

```bash
pnpm typecheck
```

Esperado: 4/4 exitosos.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/QuoteForm.tsx
git commit -m "feat(web): fuera la sugerencia de autos del valet"
```

---

## Task 3: Quitar `valetRatio` de la configuración

**Files:**
- Modify: `apps/api/src/catalog/routes.ts:25`, `apps/api/src/admin/routes.ts:60`
- Modify: `apps/web/src/components/admin/ConfigSection.tsx`, `apps/web/src/lib/types.ts:60,76`
- Modify: `apps/web/src/pages/PublicQuotePage.tsx:217`
- Test: `apps/api/src/admin/admin.test.ts`

**La columna `PricingConfig.valetRatio` se queda en la base.** Quitarla exigiría una
migración destructiva sin ningún beneficio; simplemente deja de leerse y de mostrarse.

- [ ] **Step 1: Ajustar los tests primero**

En `apps/api/src/admin/admin.test.ts`:
- Borrar el test `'GET /admin/config devuelve valetRatio'` (línea ~170).
- Borrar el test `'PATCH /admin/config actualiza valetRatio y luego se restaura'` (línea ~180).
- Borrar el test `'GET /catalog incluye config.valetRatio'` (línea ~200).
- Borrar la línea ~41 del `afterAll`/`beforeAll` que restaura `valetRatio`, y su comentario de
  la línea ~40.

Agregar un test que fije el comportamiento nuevo:

```ts
  it('GET /catalog ya no expone config del valet', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/catalog',
      cookies: { hsa_token: token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('config');
  });
```

Usar el nombre de la cookie y la variable de token tal como ya aparecen en ese archivo.

- [ ] **Step 2: Correr los tests para verlos fallar**

```bash
set -a && source .env && set +a
pnpm --filter @hsa/api exec vitest run src/admin/admin.test.ts -t 'valet'
```

Esperado: FALLA — `/catalog` todavía devuelve `config`.

- [ ] **Step 3: Quitarlo de la API**

En `apps/api/src/catalog/routes.ts`, la respuesta pierde `config` y la consulta pierde
`pricingConfig`. El `Promise.all` queda con cuatro elementos:

```ts
    const [engine, spaces, eventTypes, addOns] = await Promise.all([
      loadCatalog(app.prisma),
      app.prisma.space.findMany({
        where: { activo: true },
        include: { paymentRule: true },
        orderBy: { nombre: 'asc' },
      }),
      app.prisma.eventType.findMany({
        include: { foodPackages: { include: { brackets: true } } },
        orderBy: { nombre: 'asc' },
      }),
      app.prisma.addOn.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ]);
    return { engine, spaces, eventTypes, addOns };
```

En `apps/api/src/admin/routes.ts` línea ~60, borrar del `configSchema`:

```ts
  valetRatio: z.number().positive().optional(),
```

- [ ] **Step 4: Quitarlo del front**

En `apps/web/src/lib/types.ts`:
- Línea ~60: borrar `config?: { valetRatio: number };` de la interfaz `Catalog`.
- Línea ~76: borrar `valetRatio: number;` de `AdminConfig`.

En `apps/web/src/components/admin/ConfigSection.tsx`, quitar el estado `valetRatio`
(línea ~20), su `setValetRatio` del efecto (línea ~32), el `<Field label="Valet…">` completo
(líneas ~86-88), y en `onSubmit` la constante `ratio` y su uso. La validación y el envío
quedan:

```tsx
    if ([iva, extraHour, foodDiscount].some((n) => Number.isNaN(n))) {
      setError('Revisa que todos los campos sean números válidos.');
      return;
    }
    setError('');
    saveConfig.mutate({
      ivaRate: iva / 100,
      extraHourRate: extraHour / 100,
      foodDiscountRate: foodDiscount / 100,
    });
```

- [ ] **Step 5: Quitar la nota del valet de la página del cliente**

En `apps/web/src/pages/PublicQuotePage.tsx` línea ~217, borrar la viñeta completa que dice
"El valet parking se cobra según el total de vehículos del día (costo por automóvil $100)."
Dejar las demás viñetas de "Términos de la renta" intactas.

- [ ] **Step 6: NO tocar la cláusula K del contrato**

⚠️ `apps/web/src/pages/ContratoPage.tsx` líneas ~376-380 tienen la **cláusula K**, texto legal
que describe que el evento será atendido por un valet designado por la Hacienda y que se dan
dos cortesías. Eso **sigue siendo cierto** — lo que cambió es que la Hacienda no lo cobra, no
que el servicio desaparezca. Es boilerplate del contrato real firmado. **No borrarla.**

Verificar que sigue ahí:

```bash
grep -n "Valet Parking" apps/web/src/pages/ContratoPage.tsx
```

Esperado: dos coincidencias, las de la cláusula K.

- [ ] **Step 7: Correr tests y compilar**

```bash
pnpm typecheck && pnpm --filter @hsa/api exec vitest run src/admin/admin.test.ts
```

Esperado: typecheck 4/4 y los tests de admin en verde.

- [ ] **Step 8: Renombrar el fixture del motor**

En `packages/shared/src/pricing/engine.test.ts`, el catálogo de prueba usa un add-on llamado
`{ id: 'valet', name: 'Valet parking', … }` solo para ejercitar el tipo `porUnidad`. Ahora que
el valet no existe en el producto, ese nombre confunde a quien lea el test. Renombrarlo en las
5 apariciones (`grep -n valet packages/shared/src/pricing/engine.test.ts`):

```ts
    { id: 'porunidad', name: 'Servicio por unidad', kind: 'porUnidad', price: 100 },
```

y los `addOnId: 'valet'` pasan a `addOnId: 'porunidad'`. Los montos y aserciones no cambian.

```bash
pnpm --filter @hsa/shared run test
```

Esperado: 27 tests en verde, igual que antes.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src apps/web/src packages/shared/src
git commit -m "feat: el valet sale del catálogo, la config y la página del cliente"
```

---

# Parte 2 · Facturación

## Task 4: Modelo de datos fiscales

**Files:**
- Create: `packages/database/prisma/migrations/20260803190000_facturacion/migration.sql`
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Escribir la migración**

```sql
-- Datos fiscales del cliente (CFDI 4.0). Todos opcionales: los clientes ya
-- capturados no los tienen y no deben romperse. El timbrado NO está en alcance;
-- el modelo se deja completo para que conectar un PAC después no exija migrar.
ALTER TABLE "Client" ADD COLUMN "rfc" TEXT;
ALTER TABLE "Client" ADD COLUMN "razonSocial" TEXT;
ALTER TABLE "Client" ADD COLUMN "regimenFiscal" TEXT;
ALTER TABLE "Client" ADD COLUMN "cpFiscal" TEXT;
ALTER TABLE "Client" ADD COLUMN "usoCfdi" TEXT;
ALTER TABLE "Client" ADD COLUMN "correoFacturacion" TEXT;
ALTER TABLE "Client" ADD COLUMN "csfKey" TEXT;
ALTER TABLE "Client" ADD COLUMN "csfMime" TEXT;

-- Marca por evento: este cliente pidió factura para ESTE evento.
ALTER TABLE "Quote" ADD COLUMN "requiereFactura" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 2: Reflejarlo en el schema de Prisma**

En `packages/database/prisma/schema.prisma`, dentro de `model Client`, después de
`numeroReferencia`:

```prisma
  // Datos fiscales (CFDI 4.0). Opcionales: se capturan solo si el cliente
  // pide factura, y se reutilizan en todos sus eventos.
  rfc               String?
  razonSocial       String?  // nombre fiscal exacto, SIN régimen societario
  regimenFiscal     String?  // clave SAT: 601, 612, 626…
  cpFiscal          String?  // 5 dígitos del domicilio fiscal
  usoCfdi           String?  // clave SAT: G03, S01…
  correoFacturacion String?
  csfKey            String?  // Constancia de Situación Fiscal adjunta
  csfMime           String?
```

Y en `model Quote`, junto a las otras banderas:

```prisma
  requiereFactura Boolean @default(false)
```

- [ ] **Step 3: Aplicar y regenerar**

```bash
set -a && source .env && set +a
pnpm --filter @hsa/database exec prisma migrate deploy && pnpm db:generate
```

Esperado: `Applying migration 20260803190000_facturacion` y `Generated Prisma Client`.

- [ ] **Step 4: Verificar en la base**

```bash
docker exec -i hsa-postgres psql -U hsa -d hsa -c "\d \"Client\"" | grep -E "rfc|razonSocial|regimenFiscal|cpFiscal|usoCfdi|correoFacturacion|csf"
docker exec -i hsa-postgres psql -U hsa -d hsa -c "\d \"Quote\"" | grep requiereFactura
```

Esperado: las ocho columnas del cliente y la del quote.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma
git commit -m "feat(db): datos fiscales del cliente y bandera requiereFactura"
```

---

## Task 5: Catálogos SAT y lista de requisitos (función pura)

**Files:**
- Create: `packages/shared/src/facturacion/catalogos.ts`
- Create: `packages/shared/src/facturacion/requisitos.ts`
- Create: `packages/shared/src/facturacion/requisitos.test.ts`
- Modify: `packages/shared/src/index.ts`

**Por qué en `shared`:** la misma verdad la consumen el formulario, el contrato y (en el Plan C)
el API del BI. Una sola implementación evita que las tres se desincronicen.

- [ ] **Step 1: Escribir los tests primero**

Crear `packages/shared/src/facturacion/requisitos.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { requisitosFactura, faltanDatosFactura } from './requisitos.js';

const completo = {
  rfc: 'GODE561231GR8',
  razonSocial: 'Juan Pérez López',
  regimenFiscal: '612',
  cpFiscal: '53100',
  usoCfdi: 'G03',
  correoFacturacion: 'juan@ejemplo.com',
};

describe('requisitosFactura', () => {
  it('un cliente completo no tiene faltantes', () => {
    const r = requisitosFactura(completo);
    expect(r.every((x) => x.ok)).toBe(true);
    expect(faltanDatosFactura(completo)).toBe(false);
  });

  it('un cliente vacío tiene todos los requisitos pendientes', () => {
    const r = requisitosFactura({});
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => !x.ok)).toBe(true);
    expect(faltanDatosFactura({})).toBe(true);
  });

  it('acepta RFC de persona moral (12) y física (13)', () => {
    const moral = requisitosFactura({ ...completo, rfc: 'ABC120101XYZ' });
    expect(moral.find((x) => x.campo === 'rfc')!.ok).toBe(true);
    const fisica = requisitosFactura({ ...completo, rfc: 'GODE561231GR8' });
    expect(fisica.find((x) => x.campo === 'rfc')!.ok).toBe(true);
  });

  it('rechaza un RFC con longitud o forma inválida', () => {
    for (const rfc of ['ABC', 'ABCD1234567890', '1234561231GR8', '']) {
      const r = requisitosFactura({ ...completo, rfc });
      expect(r.find((x) => x.campo === 'rfc')!.ok).toBe(false);
    }
  });

  it('el RFC no distingue mayúsculas ni espacios alrededor', () => {
    const r = requisitosFactura({ ...completo, rfc: '  gode561231gr8 ' });
    expect(r.find((x) => x.campo === 'rfc')!.ok).toBe(true);
  });

  it('el código postal debe tener exactamente 5 dígitos', () => {
    expect(requisitosFactura({ ...completo, cpFiscal: '5310' }).find((x) => x.campo === 'cpFiscal')!.ok).toBe(false);
    expect(requisitosFactura({ ...completo, cpFiscal: '531000' }).find((x) => x.campo === 'cpFiscal')!.ok).toBe(false);
    expect(requisitosFactura({ ...completo, cpFiscal: '53100' }).find((x) => x.campo === 'cpFiscal')!.ok).toBe(true);
  });

  it('el régimen y el uso deben ser claves conocidas del SAT', () => {
    expect(requisitosFactura({ ...completo, regimenFiscal: '999' }).find((x) => x.campo === 'regimenFiscal')!.ok).toBe(false);
    expect(requisitosFactura({ ...completo, usoCfdi: 'ZZ9' }).find((x) => x.campo === 'usoCfdi')!.ok).toBe(false);
  });

  it('el correo de facturación debe tener forma de correo', () => {
    expect(requisitosFactura({ ...completo, correoFacturacion: 'no-es-correo' }).find((x) => x.campo === 'correoFacturacion')!.ok).toBe(false);
  });

  it('cada requisito trae una etiqueta legible', () => {
    for (const r of requisitosFactura({})) {
      expect(r.label.length).toBeGreaterThan(3);
    }
  });
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

```bash
pnpm --filter @hsa/shared exec vitest run src/facturacion/requisitos.test.ts
```

Esperado: FALLA — el módulo no existe.

- [ ] **Step 3: Escribir los catálogos SAT**

Crear `packages/shared/src/facturacion/catalogos.ts`:

```ts
/**
 * Claves del SAT para CFDI 4.0.
 *
 * Van en código, no en una tabla editable por el admin: son claves oficiales
 * que cambian cada varios años, no configuración del negocio. Si el SAT publica
 * una clave nueva que la hacienda necesite, se agrega aquí.
 *
 * Es un subconjunto curado, no el catálogo completo: solo los regímenes y usos
 * que aparecen al facturar la renta de un salón de eventos.
 */

export const REGIMENES_FISCALES: Record<string, string> = {
  '601': 'General de Ley Personas Morales',
  '603': 'Personas Morales con Fines no Lucrativos',
  '605': 'Sueldos y Salarios e Ingresos Asimilados a Salarios',
  '606': 'Arrendamiento',
  '608': 'Demás ingresos',
  '612': 'Personas Físicas con Actividades Empresariales y Profesionales',
  '616': 'Sin obligaciones fiscales',
  '621': 'Incorporación Fiscal',
  '626': 'Régimen Simplificado de Confianza',
};

export const USOS_CFDI: Record<string, string> = {
  G01: 'Adquisición de mercancías',
  G02: 'Devoluciones, descuentos o bonificaciones',
  G03: 'Gastos en general',
  CP01: 'Pagos',
  S01: 'Sin efectos fiscales',
};

/** El uso habitual al facturar un evento. */
export const USO_CFDI_SUGERIDO = 'G03';
```

⚠️ Nota para quien implemente: **`P01` ("Por definir") NO existe en CFDI 4.0** — era de la
versión 3.3 y el SAT lo retiró. Su reemplazo es `S01`. Si ves `P01` mencionado en el spec o en
notas viejas, está desactualizado.

- [ ] **Step 4: Escribir la función de requisitos**

Crear `packages/shared/src/facturacion/requisitos.ts`:

```ts
import { REGIMENES_FISCALES, USOS_CFDI } from './catalogos.js';

export interface DatosFiscales {
  rfc?: string | null;
  razonSocial?: string | null;
  regimenFiscal?: string | null;
  cpFiscal?: string | null;
  usoCfdi?: string | null;
  correoFacturacion?: string | null;
}

export interface RequisitoFactura {
  campo: keyof DatosFiscales;
  label: string;
  ok: boolean;
  /** Qué se espera, para mostrarlo cuando falta o está mal. */
  ayuda: string;
}

// Persona moral 12 caracteres, física 13. 3-4 letras (o &/Ñ), fecha AAMMDD, 3 de homoclave.
const RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/;
const CP = /^\d{5}$/;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const limpio = (v?: string | null): string => (v ?? '').trim();

/**
 * Qué falta para poder facturarle a este cliente. Fuente única: la consumen el
 * formulario, el contrato y el API del BI, para que las tres digan lo mismo.
 */
export function requisitosFactura(d: DatosFiscales): RequisitoFactura[] {
  const rfc = limpio(d.rfc).toUpperCase();
  const cp = limpio(d.cpFiscal);
  const regimen = limpio(d.regimenFiscal);
  const uso = limpio(d.usoCfdi);
  const correo = limpio(d.correoFacturacion);

  return [
    {
      campo: 'rfc',
      label: 'RFC',
      ok: RFC.test(rfc),
      ayuda: '12 caracteres si es empresa, 13 si es persona física.',
    },
    {
      campo: 'razonSocial',
      label: 'Razón social',
      ok: limpio(d.razonSocial).length > 0,
      ayuda: 'Nombre fiscal exacto, sin el régimen societario (sin "S.A. de C.V.").',
    },
    {
      campo: 'regimenFiscal',
      label: 'Régimen fiscal',
      ok: regimen in REGIMENES_FISCALES,
      ayuda: 'Clave del SAT, viene en la Constancia de Situación Fiscal.',
    },
    {
      campo: 'cpFiscal',
      label: 'Código postal fiscal',
      ok: CP.test(cp),
      ayuda: '5 dígitos del domicilio fiscal, no el del evento.',
    },
    {
      campo: 'usoCfdi',
      label: 'Uso del CFDI',
      ok: uso in USOS_CFDI,
      ayuda: 'Para la renta de un salón suele ser "Gastos en general".',
    },
    {
      campo: 'correoFacturacion',
      label: 'Correo para la factura',
      ok: CORREO.test(correo),
      ayuda: 'Puede ser distinto al correo de contacto.',
    },
  ];
}

/** ¿Falta algo para poder facturar? */
export function faltanDatosFactura(d: DatosFiscales): boolean {
  return requisitosFactura(d).some((r) => !r.ok);
}
```

- [ ] **Step 5: Exportarlo**

En `packages/shared/src/index.ts`, agregar:

```ts
export * from './facturacion/catalogos.js';
export * from './facturacion/requisitos.js';
```

- [ ] **Step 6: Correr los tests para verlos pasar**

```bash
pnpm --filter @hsa/shared run test
```

Esperado: PASA. 27 tests previos + 9 nuevos = 36.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): catálogos SAT y lista de requisitos de facturación"
```

---

## Task 6: Persistir los datos fiscales

**Files:**
- Modify: `apps/api/src/quotes/service.ts` (`clientSchema`, `createQuoteSchema`, `updateQuoteSchema`, `createQuote`, `updateQuote`)
- Modify: `apps/api/src/clients/routes.ts` (devolver los datos fiscales al reutilizar cliente)
- Test: `apps/api/src/quotes/quotes.test.ts`

- [ ] **Step 1: Escribir los tests**

Agregar en `apps/api/src/quotes/quotes.test.ts` (usar los helpers reales del archivo:
`ids()`, `createdQuoteIds`, `createdClientIds`):

```ts
  it('guarda los datos fiscales en el cliente y marca requiereFactura', async () => {
    const { eventTypeId, camposId } = await ids();
    const q = await createQuote(
      prisma,
      {
        fecha: '2029-11-10',
        invitados: 200,
        spaceIds: [camposId],
        eventTypeId,
        requiereFactura: true,
        client: {
          nombre: 'Con Factura',
          rfc: 'GODE561231GR8',
          razonSocial: 'Juan Pérez López',
          regimenFiscal: '612',
          cpFiscal: '53100',
          usoCfdi: 'G03',
          correoFacturacion: 'facturas@ejemplo.com',
        },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    expect(q.requiereFactura).toBe(true);
    const cliente = await prisma.client.findUnique({ where: { id: q.clientId } });
    expect(cliente?.rfc).toBe('GODE561231GR8');
    expect(cliente?.regimenFiscal).toBe('612');
    expect(cliente?.cpFiscal).toBe('53100');
  });

  it('los datos fiscales se reutilizan al buscar el cliente existente', async () => {
    const { eventTypeId, camposId } = await ids();
    const q = await createQuote(
      prisma,
      {
        fecha: '2029-11-17',
        invitados: 200,
        spaceIds: [camposId],
        eventTypeId,
        client: { nombre: 'Reuso Fiscal', rfc: 'ABC120101XYZ', cpFiscal: '11000' },
      },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    const res = await app.inject({
      method: 'GET',
      url: '/api/clients?q=Reuso',
      cookies: { hsa_token: token },
    });
    expect(res.statusCode).toBe(200);
    const encontrado = res.json().clients.find((c: { nombre: string }) => c.nombre === 'Reuso Fiscal');
    expect(encontrado.rfc).toBe('ABC120101XYZ');
    expect(encontrado.cpFiscal).toBe('11000');
  });
```

Usar el nombre real de la cookie y de la variable del token tal como aparecen en el archivo.

- [ ] **Step 2: Correr los tests para verlos fallar**

```bash
set -a && source .env && set +a
pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts -t 'fiscal'
```

Esperado: FALLA — el esquema rechaza los campos o no los persiste.

- [ ] **Step 3: Ampliar el esquema del cliente**

En `apps/api/src/quotes/service.ts`, `clientSchema` (línea ~23):

```ts
const clientSchema = z.object({
  nombre: z.string().min(1),
  telefono: z.string().optional(),
  correo: z.string().email().optional(),
  empresa: z.string().optional(),
  // Datos fiscales (CFDI 4.0). Se validan de forma laxa aquí —un cliente puede
  // guardarse a medias mientras junta los papeles— y la lista de requisitos de
  // @hsa/shared es la que dice si ya se le puede facturar.
  rfc: z.string().max(13).optional(),
  razonSocial: z.string().max(200).optional(),
  regimenFiscal: z.string().max(3).optional(),
  cpFiscal: z.string().max(5).optional(),
  usoCfdi: z.string().max(4).optional(),
  correoFacturacion: z.string().max(200).optional(),
});
```

Se usa validación laxa a propósito: ventas debe poder guardar el RFC aunque todavía no tenga
el código postal. Quién puede facturar lo decide `requisitosFactura`, no el esquema.

- [ ] **Step 4: Agregar `requiereFactura` a crear y editar**

En `createQuoteSchema` y en `updateQuoteSchema`, dentro de sus respectivos `.extend({…})`:

```ts
    requiereFactura: z.boolean().default(false),
```

En `createQuote`, dentro del `data` del `db.quote.create`, junto a `esCortesia`:

```ts
      requiereFactura: input.requiereFactura,
```

En `updateQuote`, dentro del `data` del `db.quote.update`:

```ts
      requiereFactura: input.requiereFactura,
```

- [ ] **Step 5: Devolver los datos fiscales en la búsqueda de clientes**

En `apps/api/src/clients/routes.ts`, ampliar el `select`:

```ts
      select: {
        id: true,
        nombre: true,
        telefono: true,
        correo: true,
        empresa: true,
        numeroReferencia: true,
        rfc: true,
        razonSocial: true,
        regimenFiscal: true,
        cpFiscal: true,
        usoCfdi: true,
        correoFacturacion: true,
      },
```

- [ ] **Step 6: Correr los tests para verlos pasar**

```bash
pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts
```

Esperado: PASA, incluidos los dos nuevos.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): persiste los datos fiscales del cliente y requiereFactura"
```

---

## Task 7: Adjuntar la Constancia de Situación Fiscal

**Files:**
- Modify: `apps/api/src/clients/routes.ts`
- Test: `apps/api/src/quotes/quotes.test.ts`

**Reutiliza la infraestructura que ya existe** para las fotos de comprobante de pago:
`ServerStorage` de `apps/api/src/payments/storage.ts`, con el mismo directorio
`COMPROBANTES_DIR`. No hace falta variable de entorno nueva.

**Esta es la pieza más recortable del plan.** Si se cae, ningún otro cambio se ve afectado.

- [ ] **Step 1: Escribir el test**

Agregar en `apps/api/src/quotes/quotes.test.ts`:

```ts
  it('sube la Constancia de Situación Fiscal y la devuelve por el proxy', async () => {
    const cliente = await prisma.client.create({ data: { nombre: 'Cliente CSF' } });
    createdClientIds.push(cliente.id);

    const boundary = '----hsaTest';
    const pdf = Buffer.from('%PDF-1.4 constancia de prueba');
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="csf"; filename="csf.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      pdf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const up = await app.inject({
      method: 'POST',
      url: `/api/clients/${cliente.id}/csf`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      cookies: { hsa_token: token },
      payload: body,
    });
    expect(up.statusCode).toBe(200);

    const ver = await app.inject({
      method: 'GET',
      url: `/api/clients/${cliente.id}/csf`,
      cookies: { hsa_token: token },
    });
    expect(ver.statusCode).toBe(200);
    expect(ver.headers['content-type']).toContain('application/pdf');
  });

  it('la CSF exige autenticación', async () => {
    const cliente = await prisma.client.create({ data: { nombre: 'Cliente CSF Sin Auth' } });
    createdClientIds.push(cliente.id);
    const res = await app.inject({ method: 'GET', url: `/api/clients/${cliente.id}/csf` });
    expect(res.statusCode).toBe(401);
  });
```

- [ ] **Step 2: Correr los tests para verlos fallar**

```bash
pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts -t 'CSF'
```

Esperado: FALLA con 404 — las rutas no existen.

- [ ] **Step 3: Agregar las dos rutas**

En `apps/api/src/clients/routes.ts`, agregar al inicio del archivo:

```ts
import { ServerStorage } from '../payments/storage.js';
```

y dentro de `clientRoutes`, antes del `app.get('/clients', …)`:

```ts
  // La CSF se guarda con la misma infraestructura que los comprobantes de pago.
  const storage = new ServerStorage(app.config.COMPROBANTES_DIR);

  const CSF_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

  app.post<{ Params: { id: string } }>('/clients/:id/csf', { preHandler: requireAuth }, async (req, reply) => {
    if (!req.isMultipart()) return reply.code(400).send({ error: 'Se espera multipart con el archivo en el campo "csf".' });
    let archivo: { data: Buffer; mime: string } | undefined;
    for await (const part of req.parts()) {
      if (part.type === 'file' && part.fieldname === 'csf') {
        const buf = await part.toBuffer();
        if (buf.length > 0) archivo = { data: buf, mime: part.mimetype };
      }
    }
    if (!archivo) return reply.code(400).send({ error: 'Falta el archivo.' });
    if (!CSF_MIMES.has(archivo.mime)) {
      return reply.code(400).send({ error: 'La constancia debe ser PDF, JPG o PNG.' });
    }
    const guardado = await storage.save(archivo.data, archivo.mime);
    await app.prisma.client.update({
      where: { id: req.params.id },
      data: { csfKey: guardado.key, csfMime: guardado.mime },
    });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/clients/:id/csf', { preHandler: requireAuth }, async (req, reply) => {
    const cliente = await app.prisma.client.findUnique({
      where: { id: req.params.id },
      select: { csfKey: true, csfMime: true },
    });
    if (!cliente?.csfKey) return reply.code(404).send({ error: 'Sin constancia.' });
    const data = await storage.load(cliente.csfKey);
    if (!data) return reply.code(404).send({ error: 'Sin constancia.' });
    return reply.type(cliente.csfMime ?? 'application/octet-stream').send(data);
  });
```

El límite de tamaño lo aplica el plugin `multipart` ya registrado en `server.ts` (8 MB).

- [ ] **Step 4: Correr los tests para verlos pasar**

```bash
pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts
```

Esperado: PASA.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/clients
git commit -m "feat(api): subida y consulta de la Constancia de Situación Fiscal"
```

---

## Task 8: Tarjeta de Facturación en el formulario

**Files:**
- Create: `apps/web/src/components/FacturacionSection.tsx`
- Modify: `apps/web/src/components/QuoteForm.tsx`, `apps/web/src/lib/types.ts`

- [ ] **Step 1: Ampliar los tipos del front**

En `apps/web/src/lib/types.ts`, en la interfaz `Client`, agregar:

```ts
  rfc?: string | null;
  razonSocial?: string | null;
  regimenFiscal?: string | null;
  cpFiscal?: string | null;
  usoCfdi?: string | null;
  correoFacturacion?: string | null;
```

Y en la interfaz `Quote`:

```ts
  requiereFactura?: boolean;
```

- [ ] **Step 2: Crear el componente**

Crear `apps/web/src/components/FacturacionSection.tsx`:

```tsx
import { Check, X, FileText } from 'lucide-react';
import { REGIMENES_FISCALES, USOS_CFDI, requisitosFactura, type DatosFiscales } from '@hsa/shared';
import { Card, Field, TextInput, SelectInput } from './ui.tsx';

interface Props {
  requiereFactura: boolean;
  onRequiereFactura: (v: boolean) => void;
  datos: DatosFiscales;
  onChange: (patch: Partial<DatosFiscales>) => void;
}

/**
 * Datos fiscales del cliente (CFDI 4.0) y la lista de lo que falta para poder
 * facturarle. Los datos viven en el CLIENTE, no en el evento: se capturan una
 * vez y se reaprovechan en todos sus eventos.
 */
export function FacturacionSection({ requiereFactura, onRequiereFactura, datos, onChange }: Props) {
  const requisitos = requisitosFactura(datos);
  const faltan = requisitos.filter((r) => !r.ok).length;

  return (
    <Card className="space-y-4 p-6">
      <h2 className="font-display text-xl text-ink">Facturación</h2>

      <label
        className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
          requiereFactura ? 'border-gold bg-gold/10' : 'border-ink/12 bg-white/50 hover:border-ink/30'
        }`}
      >
        <input
          type="checkbox"
          checked={requiereFactura}
          onChange={(e) => onRequiereFactura(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]"
        />
        <span className="flex-1">
          <span className="font-medium text-ink">Requiere factura</span>
          <span className="block text-xs text-charcoal-soft">
            Los datos fiscales se guardan en el cliente y se reutilizan en sus próximos eventos.
          </span>
        </span>
      </label>

      {requiereFactura && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="RFC">
              <TextInput
                value={datos.rfc ?? ''}
                onChange={(e) => onChange({ rfc: e.target.value.toUpperCase() })}
                placeholder="GODE561231GR8"
              />
            </Field>
            <Field label="Código postal fiscal">
              <TextInput
                value={datos.cpFiscal ?? ''}
                onChange={(e) => onChange({ cpFiscal: e.target.value })}
                placeholder="53100"
              />
            </Field>
          </div>

          <Field label="Razón social" hint="Nombre fiscal exacto, sin 'S.A. de C.V.'">
            <TextInput
              value={datos.razonSocial ?? ''}
              onChange={(e) => onChange({ razonSocial: e.target.value })}
              placeholder="Como aparece en la Constancia de Situación Fiscal"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Régimen fiscal">
              <SelectInput value={datos.regimenFiscal ?? ''} onChange={(e) => onChange({ regimenFiscal: e.target.value })}>
                <option value="">Selecciona…</option>
                {Object.entries(REGIMENES_FISCALES).map(([clave, nombre]) => (
                  <option key={clave} value={clave}>
                    {clave} · {nombre}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Uso del CFDI">
              <SelectInput value={datos.usoCfdi ?? ''} onChange={(e) => onChange({ usoCfdi: e.target.value })}>
                <option value="">Selecciona…</option>
                {Object.entries(USOS_CFDI).map(([clave, nombre]) => (
                  <option key={clave} value={clave}>
                    {clave} · {nombre}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>

          <Field label="Correo para la factura">
            <TextInput
              type="email"
              value={datos.correoFacturacion ?? ''}
              onChange={(e) => onChange({ correoFacturacion: e.target.value })}
              placeholder="Puede ser distinto al de contacto"
            />
          </Field>

          <div className="rounded-lg bg-cream-200/70 p-4">
            <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
              <FileText size={13} />
              {faltan === 0 ? 'Listo para facturar' : `Faltan ${faltan} dato(s) para poder facturar`}
            </p>
            <ul className="space-y-1 text-sm">
              {requisitos.map((r) => (
                <li key={r.campo} className="flex items-start gap-2">
                  {r.ok ? (
                    <Check size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                  ) : (
                    <X size={15} className="mt-0.5 shrink-0 text-wine" />
                  )}
                  <span className={r.ok ? 'text-charcoal-soft line-through' : 'text-ink'}>
                    {r.label}
                    {!r.ok && <span className="block text-xs text-charcoal-soft">{r.ayuda}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Conectarla al formulario**

En `apps/web/src/components/QuoteForm.tsx`:

1. Importar:
   ```tsx
   import { FacturacionSection } from './FacturacionSection.tsx';
   import type { DatosFiscales } from '@hsa/shared';
   ```
2. Agregar a `QuoteFormInitial` y a `QuotePayload` los campos nuevos:
   ```tsx
   requiereFactura: boolean;
   fiscales: DatosFiscales;
   ```
   En `QuotePayload`, `fiscales` no va suelto: sus campos viajan dentro de `client`. Declarar
   en `QuotePayload`:
   ```tsx
   requiereFactura: boolean;
   ```
   y ampliar el tipo de `client` a:
   ```tsx
   client: { nombre: string; telefono?: string; correo?: string } & DatosFiscales;
   ```
3. Estado nuevo, junto a los demás `useState`:
   ```tsx
   const [requiereFactura, setRequiereFactura] = useState(initial?.requiereFactura ?? false);
   const [fiscales, setFiscales] = useState<DatosFiscales>(initial?.fiscales ?? {});
   ```
4. En `pickCliente`, cargar los datos fiscales del cliente reutilizado:
   ```tsx
   setFiscales({
     rfc: c.rfc, razonSocial: c.razonSocial, regimenFiscal: c.regimenFiscal,
     cpFiscal: c.cpFiscal, usoCfdi: c.usoCfdi, correoFacturacion: c.correoFacturacion,
   });
   ```
   Para que eso compile, ampliar `ClienteLite` en
   `apps/web/src/components/ClienteSearch.tsx` con los mismos campos opcionales que ahora
   devuelve `GET /api/clients` (Task 6 Step 5):

   ```tsx
   export interface ClienteLite {
     id: string;
     nombre: string;
     telefono: string | null;
     correo: string | null;
     numeroReferencia: number;
     rfc?: string | null;
     razonSocial?: string | null;
     regimenFiscal?: string | null;
     cpFiscal?: string | null;
     usoCfdi?: string | null;
     correoFacturacion?: string | null;
   }
   ```

   Conservar los campos que el tipo ya tenga y solo agregar los seis fiscales.
5. Renderizar la tarjeta después de la de Cliente y antes de la de Evento:
   ```tsx
   <FacturacionSection
     requiereFactura={requiereFactura}
     onRequiereFactura={setRequiereFactura}
     datos={fiscales}
     onChange={(patch) => setFiscales((prev) => ({ ...prev, ...patch }))}
   />
   ```
6. En `handleSubmit`, mandar todo junto:
   ```tsx
     requiereFactura,
     client: {
       nombre,
       telefono: telefono || undefined,
       correo: correo || undefined,
       ...fiscales,
     },
   ```

- [ ] **Step 4: Pasar los datos iniciales al editar**

En `apps/web/src/pages/EditQuotePage.tsx`, donde se arma el `initial` del `QuoteForm`,
agregar:

```tsx
  requiereFactura: quote.requiereFactura ?? false,
  fiscales: {
    rfc: quote.client?.rfc, razonSocial: quote.client?.razonSocial,
    regimenFiscal: quote.client?.regimenFiscal, cpFiscal: quote.client?.cpFiscal,
    usoCfdi: quote.client?.usoCfdi, correoFacturacion: quote.client?.correoFacturacion,
  },
```

- [ ] **Step 5: Compilar**

```bash
pnpm typecheck
```

Esperado: 4/4 exitosos.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): tarjeta de facturación con lista de requisitos"
```

---

## Task 9: Facturación en el contrato y en la lista

**Files:**
- Modify: `apps/web/src/pages/ContratoPage.tsx`, `apps/web/src/pages/QuotesListPage.tsx`

- [ ] **Step 1: Bloque de datos fiscales en el contrato**

En `apps/web/src/pages/ContratoPage.tsx`, importar:

```tsx
import { faltanDatosFactura } from '@hsa/shared';
```

Y renderizar el bloque solo cuando el evento pide factura. Colocarlo al final de la página 1,
después de la cláusula B (donde ya se nombran los espacios):

```tsx
{quote.requiereFactura && (
  <div style={{ marginTop: '1rem' }}>
    <p><b>Datos de facturación</b></p>
    <table>
      <tbody>
        <tr><td>RFC</td><td><span className="fill">{quote.client?.rfc || BLANK}</span></td></tr>
        <tr><td>Razón social</td><td><span className="fill">{quote.client?.razonSocial || BLANK}</span></td></tr>
        <tr><td>Régimen fiscal</td><td><span className="fill">{quote.client?.regimenFiscal || BLANK}</span></td></tr>
        <tr><td>Código postal fiscal</td><td><span className="fill">{quote.client?.cpFiscal || BLANK}</span></td></tr>
        <tr><td>Uso del CFDI</td><td><span className="fill">{quote.client?.usoCfdi || BLANK}</span></td></tr>
        <tr><td>Correo para la factura</td><td><span className="fill">{quote.client?.correoFacturacion || BLANK}</span></td></tr>
      </tbody>
    </table>
    {faltanDatosFactura(quote.client ?? {}) && (
      <p style={{ fontStyle: 'italic' }}>
        Faltan datos para poder emitir la factura; se solicitarán antes del evento.
      </p>
    )}
  </div>
)}
```

- [ ] **Step 2: Marca en la lista de cotizaciones**

En `apps/web/src/pages/QuotesListPage.tsx`, importar `faltanDatosFactura` de `@hsa/shared` y,
dentro de `QuoteRow`, junto al badge de estatus, agregar la marca:

```tsx
{q.requiereFactura && (() => {
  const incompleto = faltanDatosFactura(q.client ?? {});
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${
        incompleto ? 'bg-wine/10 text-wine' : 'bg-emerald-600/10 text-emerald-700'
      }`}
      title={incompleto ? 'Requiere factura y faltan datos fiscales' : 'Requiere factura · datos completos'}
    >
      Factura
    </span>
  );
})()}
```

- [ ] **Step 3: Compilar**

```bash
pnpm typecheck
```

Esperado: 4/4 exitosos.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages
git commit -m "feat(web): datos de facturación en el contrato y marca en la lista"
```

---

# Parte 3 · Arrastrar en la agenda

## Task 10: Endpoint para mover la fecha

**Files:**
- Modify: `apps/api/src/quotes/service.ts`, `apps/api/src/quotes/routes.ts`
- Test: `apps/api/src/quotes/quotes.test.ts`

**Lo que gobierna este diseño:** cambiar la fecha **cambia el precio**, porque la renta depende
del tipo de día (viernes / viernes especial / sábado / domingo a jueves). Mover un sábado a un
martes puede bajar el total decenas de miles de pesos. Escribir solo la fecha dejaría el
desglose, el contrato y el plan de pagos mintiendo. Por eso `moveQuoteDate` **delega en
`updateQuote`**, que ya recalcula, valida disponibilidad y registra en bitácora — dos caminos
distintos podrían divergir.

- [ ] **Step 1: Escribir los tests**

Agregar en `apps/api/src/quotes/quotes.test.ts`:

```ts
  it('mover la fecha recalcula el total según el tipo de día', async () => {
    const { eventTypeId, camposId } = await ids();
    // 2029-12-01 es sábado; 2029-12-04 es martes (domAJue, más barato).
    const q = await createQuote(
      prisma,
      { fecha: '2029-12-01', invitados: 200, spaceIds: [camposId], eventTypeId, client: { nombre: 'Mover Fecha' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    const totalSabado = q.total;

    const movida = await moveQuoteDate(prisma, q.id, '2029-12-04', actor);
    expect(movida.fechaEvento.toISOString().slice(0, 10)).toBe('2029-12-04');
    expect(movida.total).toBeLessThan(totalSabado);
  });

  it('no se puede mover una cotización liquidada', async () => {
    const { eventTypeId, camposId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2029-12-08', invitados: 200, spaceIds: [camposId], eventTypeId, client: { nombre: 'Mover Liquidada' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);
    await updateStatus(prisma, q.id, 'liquidada', actor);

    await expect(moveQuoteDate(prisma, q.id, '2029-12-15', actor)).rejects.toThrow(/liquidada/i);
  });

  it('no se puede mover a una fecha donde el espacio está comprometido', async () => {
    const { eventTypeId, cupulaId } = await ids();
    const ocupa = await createQuote(
      prisma,
      { fecha: '2029-12-22', invitados: 200, spaceIds: [cupulaId], eventTypeId, client: { nombre: 'Ocupa Destino' } },
      actor,
    );
    createdQuoteIds.push(ocupa.id);
    createdClientIds.push(ocupa.clientId);
    await updateStatus(prisma, ocupa.id, 'formalizada', actor);

    const mover = await createQuote(
      prisma,
      { fecha: '2029-12-29', invitados: 200, spaceIds: [cupulaId], eventTypeId, client: { nombre: 'Quiere Mover' } },
      actor,
    );
    createdQuoteIds.push(mover.id);
    createdClientIds.push(mover.clientId);

    await expect(moveQuoteDate(prisma, mover.id, '2029-12-22', actor)).rejects.toThrow(/no está disponible/i);
  });

  it('el movimiento queda en la bitácora con las dos fechas', async () => {
    const { eventTypeId, camposId } = await ids();
    const q = await createQuote(
      prisma,
      { fecha: '2030-01-12', invitados: 200, spaceIds: [camposId], eventTypeId, client: { nombre: 'Bitacora Mover' } },
      actor,
    );
    createdQuoteIds.push(q.id);
    createdClientIds.push(q.clientId);

    await moveQuoteDate(prisma, q.id, '2030-01-19', actor);
    const log = await prisma.activityLog.findFirst({
      where: { quoteId: q.id, tipo: 'edicion', descripcion: { contains: 'Fecha' } },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.descripcion).toContain('2030-01-12');
    expect(log!.descripcion).toContain('2030-01-19');
  });
```

Agregar `moveQuoteDate` al import de `./service.js` en el archivo de test.

- [ ] **Step 2: Correr los tests para verlos fallar**

```bash
set -a && source .env && set +a
pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts -t 'mover'
```

Esperado: FALLA — `moveQuoteDate` no existe.

- [ ] **Step 3: Implementar el servicio**

En `apps/api/src/quotes/service.ts`, después de `updateQuote`:

```ts
/**
 * Mueve un evento a otra fecha (arrastre en la agenda).
 *
 * Cambiar la fecha cambia el precio: la renta depende del tipo de día. Por eso
 * NO se escribe la fecha a secas — se reconstruye la selección actual con la
 * fecha nueva y se delega en `updateQuote`, que recalcula el desglose, valida
 * que el espacio esté libre en el destino y respeta ownership y estatus
 * editables (liquidada y vencida quedan fuera por ese camino).
 */
export async function moveQuoteDate(db: PrismaClient, id: string, fecha: string, actor: Actor) {
  const existing = await db.quote.findFirst({ where: { id, ...ownershipWhere(actor) } });
  if (!existing) throw new QuoteError(404, 'Cotización no encontrada');
  assertNotTrashed(existing);
  if (!EDITABLE_STATUSES.has(existing.status)) {
    throw new QuoteError(409, `No se puede mover una cotización en estatus "${existing.status}"`);
  }

  const fechaAntes = existing.fechaEvento.toISOString().slice(0, 10);
  const addOns = (existing.addOns as unknown as { addOnId: string; cantidad: number }[]) ?? [];

  const actualizada = await updateQuote(
    db,
    id,
    {
      fecha,
      invitados: existing.invitados,
      spaceIds: existing.spaceIds,
      horasExtra: existing.horasExtra,
      usaCapilla: existing.usaCapilla,
      capillaHorario: existing.capillaHorario,
      esCortesia: existing.esCortesia,
      usaDjHoraExtra: existing.usaDjHoraExtra,
      requiereFactura: existing.requiereFactura,
      eventTypeId: existing.eventTypeId,
      foodPackageId: existing.foodPackageId ?? undefined,
      horasEvento: existing.horasEvento,
      addOns,
    },
    actor,
  );

  await logActivity(db, {
    quoteId: id,
    tipo: 'edicion',
    descripcion: `Fecha: ${fechaAntes} → ${fecha} · total ${existing.total} → ${actualizada.total}`,
    meta: { fechaAntes, fechaDespues: fecha, totalAntes: existing.total, totalDespues: actualizada.total },
    actorId: actor.id,
  });

  return actualizada;
}
```

- [ ] **Step 4: Exponer la ruta**

En `apps/api/src/quotes/routes.ts`, importar `moveQuoteDate` y agregar:

```ts
  app.patch<{ Params: { id: string } }>('/quotes/:id/fecha', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Fecha inválida' });
    try {
      const quote = await moveQuoteDate(app.prisma, req.params.id, parsed.data.fecha, req.user as Actor);
      return { quote };
    } catch (e) {
      if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });
```

Si `z` no está importado en ese archivo, agregar `import { z } from 'zod';`.

- [ ] **Step 5: Correr los tests para verlos pasar**

```bash
pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts
```

Esperado: PASA, incluidos los cuatro nuevos.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/quotes
git commit -m "feat(api): mover un evento de fecha recalculando el precio"
```

---

## Task 11: Arrastrar el chip en la agenda

**Files:**
- Create: `apps/web/src/components/MoverFechaModal.tsx`
- Modify: `apps/web/src/pages/AgendaPage.tsx`, `apps/web/package.json`

- [ ] **Step 1: Instalar la dependencia**

```bash
pnpm --filter @hsa/web add @dnd-kit/core
```

**Por qué no el arrastre nativo del navegador:** HTML5 drag-and-drop no funciona con eventos
táctiles, y la operación de la hacienda es en tablet. `@dnd-kit/core` usa eventos de puntero y
sí funciona. Pesa ~10 kB comprimido y es la única dependencia nueva del Plan B.

- [ ] **Step 2: Crear el modal de confirmación**

Crear `apps/web/src/components/MoverFechaModal.tsx`:

```tsx
import { AlertTriangle } from 'lucide-react';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import { Button, Card } from './ui.tsx';

interface Props {
  cliente: string;
  fechaOrigen: string;
  fechaDestino: string;
  totalActual: number;
  totalNuevo: number | null;
  pagado: number;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirmación de un arrastre en la agenda. Muestra el cambio de precio porque
 * la renta depende del tipo de día: mover un sábado a un martes puede bajar el
 * total decenas de miles de pesos, y quien arrastra debe verlo antes de soltar.
 */
export function MoverFechaModal({
  cliente, fechaOrigen, fechaDestino, totalActual, totalNuevo, pagado, busy, error, onCancel, onConfirm,
}: Props) {
  const cambia = totalNuevo != null && totalNuevo !== totalActual;
  const bajaDeLoPagado = totalNuevo != null && totalNuevo < pagado;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4" role="dialog" aria-modal="true">
      <Card className="w-full max-w-md space-y-4 p-6">
        <h2 className="font-display text-xl text-ink">Mover evento</h2>
        <p className="text-sm text-charcoal">
          Mover <strong>{cliente}</strong> del {formatEventDate(fechaOrigen, 'long')} al{' '}
          <strong>{formatEventDate(fechaDestino, 'long')}</strong>.
        </p>

        {cambia && (
          <p className="rounded-lg bg-cream-200/70 px-3 py-2 text-sm text-ink">
            El total cambia de <strong>{formatMXN(totalActual)}</strong> a{' '}
            <strong>{formatMXN(totalNuevo!)}</strong>, porque la renta depende del día de la semana.
          </p>
        )}
        {!cambia && totalNuevo != null && (
          <p className="text-sm text-charcoal-soft">El total no cambia: {formatMXN(totalActual)}.</p>
        )}

        {bajaDeLoPagado && (
          <p className="flex items-start gap-2 rounded-lg border border-wine/30 bg-wine/10 px-3 py-2 text-sm text-wine">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              El total nuevo queda por debajo de lo ya pagado ({formatMXN(pagado)}). El evento
              quedará marcado con desfase para que alguien lo resuelva.
            </span>
          </p>
        )}

        {error && <p className="text-sm text-wine">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button variant="gold" onClick={onConfirm} disabled={busy}>
            {busy ? 'Moviendo…' : 'Mover'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Hacer los chips arrastrables y las celdas soltables**

En `apps/web/src/pages/AgendaPage.tsx`:

1. Importar:
   ```tsx
   import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
   import { computeQuote } from '@hsa/shared';
   import { MoverFechaModal } from '../components/MoverFechaModal.tsx';
   import type { QuoteDetail } from '../lib/types.ts';
   ```
2. Agregar dos componentes auxiliares al final del archivo:
   ```tsx
   /** Un evento arrastrable. Los liquidados y vencidos no se mueven. */
   function ChipArrastrable({ id, movible, className, title, onClick, children }: {
     id: string; movible: boolean; className: string; title: string;
     onClick: () => void; children: React.ReactNode;
   }) {
     const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled: !movible });
     return (
       <button
         ref={setNodeRef}
         {...(movible ? listeners : {})}
         {...attributes}
         onClick={onClick}
         title={title}
         className={`${className} ${isDragging ? 'opacity-40' : ''} ${movible ? 'cursor-grab' : ''}`}
       >
         {children}
       </button>
     );
   }

   /** Una celda de día que acepta eventos soltados encima. */
   function CeldaSoltable({ fecha, children }: { fecha: string; children: React.ReactNode }) {
     const { setNodeRef, isOver } = useDroppable({ id: fecha });
     return (
       <div
         ref={setNodeRef}
         className={`min-h-[6rem] border-b border-r border-cream-200 p-1.5 ${isOver ? 'bg-gold/10 ring-1 ring-inset ring-gold' : ''}`}
       >
         {children}
       </div>
     );
   }
   ```
3. Envolver el `<Card>` del calendario en `<DndContext onDragEnd={onDragEnd}>`.
4. Reemplazar el `<div className="min-h-[6rem] border-b …">` de cada día por
   `<CeldaSoltable fecha={fecha}>`, conservando su contenido.
5. Reemplazar el `<button …>` de cada evento por `<ChipArrastrable …>`, pasando
   `id={e.quoteId}` y `movible={e.status !== 'liquidada' && e.status !== 'vencida'}`.

- [ ] **Step 4: Manejar el soltar**

Agregar dentro del componente `AgendaPage`:

```tsx
  const [mover, setMover] = useState<{
    quoteId: string; cliente: string; origen: string; destino: string;
    totalActual: number; totalNuevo: number | null; pagado: number;
  } | null>(null);
  const [moviendo, setMoviendo] = useState(false);
  const [errorMover, setErrorMover] = useState('');

  // Al soltar, se pide la cotización y se calcula el total de la fecha nueva
  // EN EL NAVEGADOR con el mismo motor que usa el servidor, para poder mostrar
  // el cambio de precio antes de confirmar.
  async function onDragEnd(ev: DragEndEvent) {
    const quoteId = String(ev.active.id);
    const destino = ev.over ? String(ev.over.id) : null;
    if (!destino) return;
    const evento = (agendaQ.data?.events ?? []).find((e) => e.quoteId === quoteId);
    if (!evento) return;
    const origen = evento.fechaEvento.slice(0, 10);
    if (origen === destino) return;

    setErrorMover('');
    const detalle = await api.get<QuoteDetail>(`/api/quotes/${quoteId}`);
    let totalNuevo: number | null = null;
    if (catalogQ.data) {
      try {
        totalNuevo = Math.round(
          computeQuote(catalogQ.data.engine, {
            fecha: destino,
            invitados: detalle.quote.invitados,
            spaceIds: detalle.quote.spaceIds,
            horasExtra: detalle.quote.horasExtra,
            usaCapilla: detalle.quote.usaCapilla ?? false,
            usaDjHoraExtra: detalle.quote.usaDjHoraExtra ?? false,
            eventTypeId: detalle.quote.eventTypeId,
            foodPackageId: detalle.quote.foodPackageId ?? undefined,
            addOns: detalle.quote.addOns ?? [],
          }).total,
        );
      } catch {
        totalNuevo = null; // p. ej. el espacio no tiene precio para ese día
      }
    }

    setMover({
      quoteId,
      cliente: evento.cliente,
      origen,
      destino,
      totalActual: detalle.quote.total,
      totalNuevo,
      pagado: detalle.estadoCuenta.pagado,
    });
  }

  async function confirmarMover() {
    if (!mover) return;
    setMoviendo(true);
    setErrorMover('');
    try {
      await api.patch(`/api/quotes/${mover.quoteId}/fecha`, { fecha: mover.destino });
      await agendaQ.refetch();
      setMover(null);
    } catch (e) {
      setErrorMover(e instanceof Error ? e.message : 'No se pudo mover el evento.');
    } finally {
      setMoviendo(false);
    }
  }
```

Y renderizar el modal al final del JSX:

```tsx
      {mover && (
        <MoverFechaModal
          cliente={mover.cliente}
          fechaOrigen={mover.origen}
          fechaDestino={mover.destino}
          totalActual={mover.totalActual}
          totalNuevo={mover.totalNuevo}
          pagado={mover.pagado}
          busy={moviendo}
          error={errorMover}
          onCancel={() => setMover(null)}
          onConfirm={confirmarMover}
        />
      )}
```

Agregar `useState` al import de `react` si no está.

- [ ] **Step 5: Nota al pie de la agenda**

Cambiar el texto de la línea ~198 para mencionar el arrastre:

```tsx
      <p className="mt-2 text-xs text-charcoal-soft">
        El chip muestra el espacio (Cúpula → Arcos → Campos). Toca un evento para abrir su
        contrato, o arrástralo a otro día para cambiarle la fecha.
      </p>
```

- [ ] **Step 6: Compilar**

```bash
pnpm typecheck
```

Esperado: 4/4 exitosos.

- [ ] **Step 7: Commit**

```bash
git add apps/web package.json pnpm-lock.yaml
git commit -m "feat(web): arrastrar un evento en la agenda para cambiarle la fecha"
```

---

## Task 12: Cierre y verificación en navegador

- [ ] **Step 1: Suite completa**

```bash
set -a && source .env && set +a
pnpm typecheck && pnpm --filter @hsa/api exec vitest run && pnpm --filter @hsa/shared run test
```

Esperado: typecheck 4/4; API con los 70 previos + 8 nuevos = 78; shared con 27 + 9 = 36.

- [ ] **Step 2: Levantar la aplicación**

Arrancar la API (`pnpm --filter @hsa/api exec tsx src/index.ts` con el `.env` cargado) y la
web con la configuración `hsa-web` de `Projects/.claude/launch.json` (puerto 5273). Entrar con
`admin@haciendasanandres.com.mx` / `admin1234`.

- [ ] **Step 3: Verificar en el navegador**

1. **Valet fuera:** el formulario ya no lista "Valet parking" en servicios adicionales, no hay
   botón de sugerir autos, y el panel de Admin → Configuración ya no tiene el campo del ratio.
   La página del cliente ya no menciona el valet en "Términos de la renta".
2. **Cláusula K intacta:** generar un contrato y confirmar que la cláusula K **sigue** hablando
   del Valet Parking designado por la Hacienda. Si desapareció, se borró de más.
3. **Facturación:** marcar "Requiere factura", ver la lista de requisitos en rojo, capturar los
   datos y ver cómo se van tachando. Guardar, reabrir y confirmar que siguen ahí.
4. **Reutilizar cliente:** crear un segundo evento buscando ese mismo cliente y confirmar que
   los datos fiscales llegan cargados.
5. **Contrato con factura:** generar el contrato y verificar el bloque "Datos de facturación".
6. **Marca en la lista:** el evento con factura muestra el badge, en rojo si faltan datos.
7. **Arrastrar:** mover un evento de un sábado a un martes. El diálogo debe mostrar las dos
   fechas y el cambio de total. Confirmar y verificar que la agenda se actualiza, que el
   desglose del evento trae el precio nuevo y que la bitácora registra el movimiento.
8. **Arrastre bloqueado:** intentar mover un evento a un día donde su espacio ya está
   comprometido. Debe rechazarse con el motivo.
9. **Liquidado no se arrastra:** un evento liquidado no debe poder arrastrarse.
10. **En tablet:** reducir la ventana al preset móvil y confirmar que el arrastre sigue
    funcionando con eventos de puntero (es la razón de usar `@dnd-kit` en vez del arrastre
    nativo).

- [ ] **Step 4: Limpiar los datos de prueba**

Borrar las cotizaciones y clientes creados durante la verificación. No dejar residuo en la
base de desarrollo: con el bloqueo de disponibilidad del Plan A, un evento comprometido de
prueba bloquea esa fecha para siempre.

- [ ] **Step 5: Reportar**

Resumir qué se construyó, resultado de tests y typecheck, qué se verificó en navegador, y que
la rama sigue sin mergear ni pushear. Recordar que para pushear la cuenta activa de `gh` debe
ser `SinergIA-cun`.

---

## Notas para quien implemente

**La cláusula K del contrato no se toca.** Es la parte del plan más fácil de arruinar por
exceso de celo: el usuario pidió quitar el valet *del cobro*, y el contrato describe el
servicio real que sí se presta. Borrar una cláusula de un documento legal porque se quitó una
línea de precio sería un error caro.

**El add-on del valet se desactiva, no se borra.** Las cotizaciones existentes lo referencian
por id en su desglose congelado.

**La validación fiscal del esquema es laxa a propósito.** Ventas necesita poder guardar un
cliente con el RFC capturado y el código postal pendiente. Quién puede facturar lo decide
`requisitosFactura`, no zod.

**`moveQuoteDate` delega en `updateQuote` en vez de escribir la fecha.** Ese es el punto del
diseño: un solo camino de recálculo. Si en la revisión ves una versión que hace
`db.quote.update({ fechaEvento })` directo, está mal.

**`P01` no existe en CFDI 4.0.** Si aparece en notas viejas, es de la versión 3.3; el
reemplazo es `S01`.

**Dos decisiones de producto siguen abiertas del Plan A** (documentadas en el spec) y **no**
se resuelven en este plan: la tabla de pagos del contrato que afirma una multiplicación que no
cuadra, y `updateStatus` sin validación de disponibilidad.
