# Plan E · Tramo 1 · Catálogo versionado y casado a la cotización

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada cotización quede casada a un catálogo versionado, de modo que reeditarla nunca la represie, y que un admin pueda crear el catálogo del año siguiente clonando el anterior con un porcentaje de incremento.

**Architecture:** `PriceList` deja de ser una lista de precios y se convierte en **el catálogo completo**: renta, servicios, paquetes de alimentos y los parámetros de precios (IVA, hora extra, descuento por alimentos, capilla en sábado). `Quote.priceListId` se fija al crear y manda al recalcular. El singleton `PricingConfig` desaparece: era la última fuente global capaz de represiar todo.

**Tech Stack:** pnpm + Turbo, Fastify 5, Prisma 6 + Postgres (docker `hsa-postgres`, puerto 5434), React 18 + Vite 6 + Tailwind 4 + TanStack Query, Vitest.

---

## Por qué existe este plan

El mismo error de diseño mordió dos veces en una semana:

1. El add-on del valet se desactivó → las cotizaciones que lo traían quedaron irrecalculables (PR #2).
2. `La Capilla` se desactivó como espacio → el contrato imprimiría su cuid crudo.

En los dos casos la causa es la misma: **el catálogo con el que se coteó no se conserva**, así que recalcular usa el catálogo de *hoy*. Hoy solo `RentalPrice` está versionado. `AddOn`, `FoodPackage` y `PricingConfig` son globales y mutables, así que cambiarles un precio represia toda cotización que se reedite. Este plan cierra los cuatro frentes.

## Reglas de la rama (heredadas de los planes A–D)

- **`git commit --amend` está PROHIBIDO.** Un subagente ya reescribió una vez un commit ajeno.
- Tests de API con `fileParallelism: false`. **No correr dos suites de API a la vez.**
- `pnpm --filter X test -- nombre` **NO filtra** (pnpm se come el `--`): es `pnpm --filter X test nombre`.
- Nada de archivos de trabajo en la raíz del repo; usa el scratchpad.
- Postgres de pruebas: Docker, puerto **5434**, contenedor `hsa-postgres`, usuario/base `hsa`.
- **`logActivity` traga sus errores (`catch {}`)** y `LogTipo` es unión de TS **y** enum `ActivityType` de Postgres: un `tipo` nuevo sin migración falla **en silencio**. Cualquier tipo nuevo necesita migración `ALTER TYPE … ADD VALUE IF NOT EXISTS` **y** un test que cuente los registros.
- Símbolos verificados: `Actor` y `ownershipWhere` se exportan de `apps/api/src/quotes/service.ts` (no existe `apps/api/src/auth/types.ts`). `app.prisma`, no `app.db`. `req.user as Actor`, no `req.actor`. Papelera es `deletedAt`, no `trashedAt`. El rol de vendedor es `ventas`. `requireAdmin` está en `apps/api/src/auth/plugin.ts`.
- `apps/api/dist/` está versionado con `.d.ts` viejos que contaminan los greps. Ignóralo.

## Decisiones ya tomadas por el dueño (no volver a preguntar)

1. **Clonar con % de incremento total, y también poder editar línea por línea.** Lo segundo es el tramo 2.
2. **Un admin sí puede mover una cotización a otro catálogo**, viendo el precio antes y después, y queda en bitácora. Caso real: alguien aparta en 2027 y mueve su evento a 2029.
3. **La Capilla nunca se renta sola.** Es solo la casilla con su tarifa de sábado. Se borra el espacio vestigial y su precio de renta.

## Estado inicial verificado en la base

```
Space:      6 filas; "La Capilla" con activo=false, capacidadMax=170, 1 RentalPrice
PriceList:  cmrbk0agn0000cb6v6opz0l37  2027  activa=true   tipo=dia
            cmrm731b7004zcb9isyzmcokw  2027  activa=false  tipo=plano   ← usada aunque inactiva
Quote:      ninguna referencia a La Capilla (spaceIds vacío, usaCapilla nunca true)
```

Todas las cotizaciones actuales son **de prueba** — el dueño lo confirmó explícitamente. La migración puede asignarlas todas al catálogo 2027 sin ceremonia.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `packages/database/prisma/schema.prisma` | `PriceList` absorbe params, addOns y foodPackages; `tipo` baja a `RentalPrice`; `Quote.priceListId`; muere `PricingConfig` |
| `packages/database/prisma/migrations/…_catalogo_versionado/` | Fase 1: columnas nuevas nullable, `tipo` en RentalPrice |
| `packages/database/prisma/backfill-fase13.ts` | Funde las dos listas 2027 en un catálogo, copia los params, casa add-ons/paquetes/cotizaciones, borra la Capilla vestigial |
| `packages/database/prisma/migrations/…_catalogo_obligatorio/` | Fase 2: `NOT NULL` en los FK y `DROP TABLE PricingConfig` |
| `apps/api/src/catalog/loader.ts` | `loadCatalog(db, { priceListId })` resuelve por id; los params salen del catálogo |
| `apps/api/src/pricelists/service.ts` (nuevo) | Listar, clonar con %, activar, y contar cotizaciones por catálogo |
| `apps/api/src/pricelists/routes.ts` (nuevo) | CRUD de admin bajo `/admin/price-lists` |
| `apps/api/src/quotes/service.ts` | `createQuote` fija el catálogo activo; `updateQuote` usa el fijado; `moverCatalogo` |
| `apps/web/src/pages/admin/CatalogosPage.tsx` (nuevo) | Pantalla de catálogos: alta por clonación, activar, ver uso |
| `apps/web/src/components/MoverCatalogoModal.tsx` (nuevo) | Antes/después del total al mover una cotización |

---

## Task 1: Esquema — el catálogo absorbe todo

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260811120000_catalogo_versionado/migration.sql`

- [ ] **Step 1: Cambiar el esquema**

`PriceList` queda así (las columnas nuevas nacen **nullable u opcionales** para que la migración pase sobre datos existentes):

```prisma
/// El catálogo completo de un año: renta, servicios, alimentos y parámetros.
/// Una cotización queda casada a uno y recalcula SIEMPRE contra él, de modo que
/// cambiar el catálogo de este año nunca represia lo cotizado el año pasado.
model PriceList {
  id        String    @id @default(cuid())
  nombre    String?   @unique // "2027", "2028". Nullable hasta el backfill.
  anio      Int
  vigencia  DateTime?
  activa    Boolean   @default(false)
  createdAt DateTime  @default(now())

  // Parámetros de precio. Vivían en el singleton PricingConfig, que era la
  // última fuente global capaz de represiar TODA cotización al reeditarla.
  ivaRate          Float @default(0.16)
  extraHourRate    Float @default(0.05)
  foodDiscountRate Float @default(0.05)
  capillaSabado    Int   @default(5000)

  rentalPrices RentalPrice[]
  addOns       AddOn[]
  foodPackages FoodPackage[]
  quotes       Quote[]
}
```

En `RentalPrice`, `tipo` baja de la lista al renglón, para que UN catálogo contenga renta por tipo de día **y** renta plana:

```prisma
model RentalPrice {
  // …campos existentes…
  /// "dia" = renta por tipo de día · "plano" = renta plana (Team Building).
  /// Antes vivía en PriceList, lo que obligaba a tener DOS listas por año y
  /// dejaba la plana fuera del filtro `activa`.
  tipo String @default("dia")

  @@index([priceListId, spaceId])
  @@index([priceListId, tipo])
}
```

`AddOn` y `FoodPackage` se casan al catálogo:

```prisma
model AddOn {
  id          String     @id @default(cuid())
  nombre      String
  kind        AddOnKind
  price       Int
  activo      Boolean    @default(true)
  priceList   PriceList? @relation(fields: [priceListId], references: [id])
  priceListId String?

  @@index([priceListId])
}
```

Lo mismo en `FoodPackage`: `priceList PriceList? @relation(...)` + `priceListId String?` + `@@index([priceListId])`.

Y `Quote`:

```prisma
model Quote {
  // …campos existentes…
  /// Catálogo con el que se coteó. MANDA al recalcular: reeditar una cotización
  /// de 2027 usa precios de 2027 aunque el catálogo activo ya sea 2028.
  priceList   PriceList? @relation(fields: [priceListId], references: [id])
  priceListId String?

  @@index([priceListId])
}
```

**No borres `PricingConfig` todavía.** Se cae en la Task 3, cuando ya nadie la lea.

- [ ] **Step 2: Generar la migración sin aplicarla, y revisarla**

```bash
pnpm --filter @hsa/database exec prisma migrate dev --name catalogo_versionado --create-only
```

Abre el SQL generado y **verifica a mano** que:
- Todas las columnas nuevas son nullable o traen `DEFAULT`.
- `RentalPrice.tipo` nace con `DEFAULT 'dia'`.
- **NO** hay ningún `DROP COLUMN "tipo"` en `PriceList` — ese drop va en la Task 3, después de que el backfill copie el valor a los renglones. Si Prisma lo generó, **bórralo del SQL** y déjalo para la fase 2.

- [ ] **Step 3: Aplicar y verificar que nada se rompió**

```bash
pnpm --filter @hsa/database exec prisma migrate dev
pnpm --filter @hsa/database run generate
pnpm typecheck
```

El typecheck va a fallar donde el código lea `PricingConfig` o `PriceList.tipo`. Eso es esperado; se arregla en la Task 4. **No lo arregles todavía**, solo anota la lista de archivos afectados.

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/
git commit -m "feat(db): PriceList se vuelve el catálogo completo (params, servicios, alimentos)"
```

---

## Task 2: Backfill — fundir las dos listas en un catálogo

**Files:**
- Create: `packages/database/prisma/backfill-fase13.ts`
- Modify: `packages/database/package.json` (script `backfill:fase13`)
- Modify: `apps/api/Dockerfile` (agregar al `CMD`, después de `fase12`)

- [ ] **Step 1: Escribir el backfill**

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Funde las dos PriceList de 2027 (dia + plano) en UN catálogo, le copia los
 * parámetros del singleton PricingConfig, y casa a él los servicios, los
 * paquetes de alimentos y todas las cotizaciones existentes.
 *
 * También borra el espacio vestigial "La Capilla": el negocio la trata como
 * casilla con tarifa de sábado, no como salón rentable. Si alguna cotización la
 * referencia, NO la borra y avisa — perder el nombre de un espacio ya cotizado
 * haría que el contrato imprima un cuid.
 *
 * Idempotente.
 */
async function main(): Promise<void> {
  // 1. El catálogo canónico: la lista 'dia' del año más reciente.
  const canon = await prisma.priceList.findFirst({
    where: { tipo: 'dia' },
    orderBy: { anio: 'desc' },
  });
  if (!canon) throw new Error('No hay ninguna PriceList tipo "dia" que promover a catálogo');

  const cfg = await prisma.pricingConfig.findUnique({ where: { id: 'default' } });

  await prisma.priceList.update({
    where: { id: canon.id },
    data: {
      nombre: canon.nombre ?? String(canon.anio),
      activa: true,
      ivaRate: cfg?.ivaRate ?? 0.16,
      extraHourRate: cfg?.extraHourRate ?? 0.05,
      foodDiscountRate: cfg?.foodDiscountRate ?? 0.05,
      capillaSabado: cfg?.capillaSabado ?? 5000,
    },
  });
  console.log(`· Catálogo canónico: ${canon.nombre ?? canon.anio} (${canon.id})`);

  // 2. Mover los renglones de las listas 'plano' al catálogo, marcándolos.
  const planas = await prisma.priceList.findMany({ where: { tipo: 'plano' } });
  for (const p of planas) {
    const { count } = await prisma.rentalPrice.updateMany({
      where: { priceListId: p.id },
      data: { priceListId: canon.id, tipo: 'plano' },
    });
    console.log(`· ${count} renglones de renta plana movidos desde ${p.id}`);
    await prisma.priceList.delete({ where: { id: p.id } });
  }

  // 3. Cualquier otra lista 'dia' que no sea la canónica se queda como está
  //    (catálogos de años anteriores), solo se asegura que no esté activa.
  await prisma.priceList.updateMany({
    where: { id: { not: canon.id }, activa: true },
    data: { activa: false },
  });

  // 4. Casar servicios, paquetes y cotizaciones huérfanos al catálogo.
  for (const [etiqueta, res] of [
    ['servicios', await prisma.addOn.updateMany({ where: { priceListId: null }, data: { priceListId: canon.id } })],
    ['paquetes', await prisma.foodPackage.updateMany({ where: { priceListId: null }, data: { priceListId: canon.id } })],
    ['cotizaciones', await prisma.quote.updateMany({ where: { priceListId: null }, data: { priceListId: canon.id } })],
  ] as const) {
    console.log(`· ${res.count} ${etiqueta} casados al catálogo`);
  }

  // 5. La Capilla vestigial.
  const capilla = await prisma.space.findFirst({ where: { nombre: { contains: 'apilla' } } });
  if (!capilla) {
    console.log('· No hay espacio "La Capilla" que limpiar.');
  } else {
    const enUso = await prisma.quote.count({ where: { spaceIds: { has: capilla.id } } });
    if (enUso > 0) {
      console.warn(
        `· ATENCIÓN: "La Capilla" (${capilla.id}) la referencian ${enUso} cotizaciones. NO se borra.`,
      );
    } else {
      await prisma.rentalPrice.deleteMany({ where: { spaceId: capilla.id } });
      await prisma.spacePaymentRule.deleteMany({ where: { spaceId: capilla.id } });
      await prisma.space.delete({ where: { id: capilla.id } });
      console.log('· Espacio vestigial "La Capilla" borrado (es casilla, no salón rentable).');
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('backfill-fase13 falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 2: Registrar el script**

En `packages/database/package.json`, junto a los otros `backfill:*`:

```json
"backfill:fase13": "tsx prisma/backfill-fase13.ts"
```

- [ ] **Step 3: Correrlo dos veces y verificar idempotencia**

```bash
pnpm --filter @hsa/database run backfill:fase13
pnpm --filter @hsa/database run backfill:fase13
```

La segunda corrida debe reportar 0 en todos los contadores y no fallar.

Verifica en la base:

```bash
docker exec hsa-postgres psql -U hsa -d hsa -c "SELECT nombre, anio, activa, \"ivaRate\", \"capillaSabado\" FROM \"PriceList\";"
docker exec hsa-postgres psql -U hsa -d hsa -c "SELECT tipo, count(*) FROM \"RentalPrice\" GROUP BY tipo;"
docker exec hsa-postgres psql -U hsa -d hsa -c "SELECT count(*) FROM \"Quote\" WHERE \"priceListId\" IS NULL;"
docker exec hsa-postgres psql -U hsa -d hsa -c "SELECT nombre FROM \"Space\" ORDER BY nombre;"
```
Esperado: **una** PriceList con nombre y params reales; renglones `dia` **y** `plano` en la misma; **0** cotizaciones sin catálogo; y La Capilla **fuera** de la lista de espacios.

- [ ] **Step 4: Agregarlo al arranque del contenedor**

En `apps/api/Dockerfile`, en el `CMD`, insertar `&& pnpm --filter @hsa/database run backfill:fase13` **después** de `backfill:fase12` y **antes** de `reconcile-statuses`.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/backfill-fase13.ts packages/database/package.json apps/api/Dockerfile
git commit -m "feat(db): backfill que funde las listas en un catálogo y limpia la Capilla"
```

---

## Task 3: Migración fase 2 — obligatoriedad y muerte de PricingConfig

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260811130000_catalogo_obligatorio/migration.sql`

> **Ejecuta esta task DESPUÉS de la Task 2**, con el backfill ya corrido. Si la
> corres antes, el `NOT NULL` falla sobre las filas huérfanas.

- [ ] **Step 1: Volver obligatorios los FK y quitar lo muerto**

En el esquema: `nombre String @unique` (sin `?`), y en `AddOn`, `FoodPackage` y `Quote` la relación deja de ser opcional (`priceList PriceList @relation(...)`, `priceListId String`). Borra por completo el modelo `PricingConfig` y quita `tipo` de `PriceList`.

- [ ] **Step 2: Generar la migración y revisarla**

```bash
pnpm --filter @hsa/database exec prisma migrate dev --name catalogo_obligatorio --create-only
```

Verifica en el SQL que aparezcan `ALTER COLUMN … SET NOT NULL`, `DROP COLUMN "tipo"` en `PriceList` y `DROP TABLE "PricingConfig"`. **Si algún `SET NOT NULL` falla al aplicar, el backfill quedó incompleto — vuelve a la Task 2, no fuerces la migración.**

- [ ] **Step 3: Aplicar**

```bash
pnpm --filter @hsa/database exec prisma migrate dev && pnpm --filter @hsa/database run generate
```

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/
git commit -m "feat(db): el catálogo es obligatorio y muere el singleton PricingConfig"
```

---

## Task 4: El loader resuelve por catálogo

**Files:**
- Modify: `apps/api/src/catalog/loader.ts`
- Modify: `apps/api/src/catalog/loader.test.ts`

- [ ] **Step 1: Test que fija el comportamiento nuevo**

```ts
describe('loadCatalog por catálogo', () => {
  it('resuelve el catálogo por id y toma sus parámetros, no un singleton global', async () => {
    const otro = await prisma.priceList.create({
      data: { nombre: 'PRUEBA-2099', anio: 2099, ivaRate: 0.08, extraHourRate: 0.10, capillaSabado: 9999 },
    });
    const cat = await loadCatalog(prisma, { priceListId: otro.id });
    expect(cat.ivaRate).toBe(0.08);
    expect(cat.extraHourRate).toBe(0.10);
    expect(cat.capillaSabado).toBe(9999);
    await prisma.priceList.delete({ where: { id: otro.id } });
  });

  it('sin priceListId toma el catálogo activo', async () => {
    const cat = await loadCatalog(prisma);
    expect(cat.rentalPrices.length).toBeGreaterThan(0);
  });

  it('un catálogo inexistente lanza, no cae al activo en silencio', async () => {
    await expect(loadCatalog(prisma, { priceListId: 'no-existe' })).rejects.toThrow(/no existe|not found/i);
  });

  it('la renta plana vive en el mismo catálogo, distinguida por tipo', async () => {
    const cat = await loadCatalog(prisma);
    expect(cat.rentalPricesFlat.length).toBeGreaterThan(0);
  });

  it('los servicios y paquetes son los del catálogo pedido', async () => {
    const cat = await loadCatalog(prisma);
    expect(cat.addOns.length).toBeGreaterThan(0);
    expect(cat.foodPackages.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `pnpm --filter @hsa/api test loader`
Expected: FAIL — `loadCatalog` todavía no acepta `priceListId`.

- [ ] **Step 3: Reescribir el loader**

Cambios clave, conservando el resto del mapeo tal cual:

```ts
export async function loadCatalog(
  db: PrismaClient,
  opts: { priceListId?: string } = {},
): Promise<Catalog> {
  // El catálogo pedido, o el activo. NUNCA se cae al activo en silencio cuando
  // se pidió uno concreto: eso represiaría la cotización que lo fijó.
  const priceList = opts.priceListId
    ? await db.priceList.findUnique({ where: { id: opts.priceListId } })
    : await db.priceList.findFirst({ where: { activa: true }, orderBy: { anio: 'desc' } });
  if (!priceList) {
    throw new Error(
      opts.priceListId
        ? `El catálogo ${opts.priceListId} no existe`
        : 'No hay catálogo activo',
    );
  }

  const [rentals, packages, addOns, eventTypes] = await Promise.all([
    db.rentalPrice.findMany({ where: { priceListId: priceList.id } }),
    db.foodPackage.findMany({ where: { priceListId: priceList.id }, include: { brackets: true } }),
    // Todos, activos e inactivos: el catálogo debe RESOLVER lo que ya no OFRECE.
    db.addOn.findMany({ where: { priceListId: priceList.id } }),
    db.eventType.findMany({ select: { id: true, djHoraExtra: true, rentaPlana: true } }),
  ]);
```

Los parámetros salen del catálogo, no del singleton:

```ts
  return {
    ivaRate: priceList.ivaRate,
    extraHourRate: priceList.extraHourRate,
    foodDiscountRate: priceList.foodDiscountRate,
    capillaSabado: priceList.capillaSabado,
    // …resto igual…
    rentalPrices: toRentalRows(rentals.filter((r) => r.tipo === 'dia')),
    rentalPricesFlat: toRentalRows(rentals.filter((r) => r.tipo === 'plano')),
```

- [ ] **Step 4: Arreglar `catalog/routes.ts`**

Recibe `priceListId` por query y lo pasa al loader. **Quita el segundo filtro `activo: true` de espacios** (`routes.ts:13`): el catálogo debe resolver espacios dados de baja igual que resuelve add-ons dados de baja — es el bug de La Capilla. Los espacios salen con su `activo` para que el selector solo ofrezca los vigentes.

- [ ] **Step 5: Correr toda la suite de la API**

Run: `pnpm --filter @hsa/api test`
Arregla lo que rompa. Cualquier lectura de `PricingConfig` que quede debe morir.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/catalog/
git commit -m "feat(api): el loader resuelve por catálogo y toma sus parámetros"
```

---

## Task 5: La cotización se casa al catálogo

**Files:**
- Modify: `apps/api/src/quotes/service.ts`
- Modify: `apps/api/src/quotes/quotes.test.ts`

- [ ] **Step 1: Tests**

> **Los helpers de los tests probablemente NO existen con estos nombres.**
> `entradaValida()`, `adminActor`, `ventasCookie` son nombres inventados por mí.
> En el repo real hay `adminAuthCookie()` y el cliente Prisma se llama `prisma`,
> no `db`; el rol de vendedor es `ventas`. Lee `apps/api/src/quotes/quotes.test.ts`
> y `payments.test.ts`, usa los patrones que ya existen, y escribe los helpers
> que falten. Al terminar, dime qué nombres reales usaste.
> Además: el tercer test apaga TODOS los catálogos y luego reactiva el de 2027 por
> año. Si en tu base hay más de un catálogo de 2027, deja el `finally` restaurando
> por **id** el que estaba activo, no por año.

```ts
describe('casamiento con el catálogo', () => {
  it('crear una cotización fija el catálogo activo', async () => {
    const q = await createQuote(prisma, entradaValida(), adminActor);
    const activo = await prisma.priceList.findFirst({ where: { activa: true } });
    expect(q.priceListId).toBe(activo!.id);
  });

  it('reeditar usa el catálogo FIJADO, no el activo', async () => {
    const q = await createQuote(prisma, entradaValida(), adminActor);
    const totalOriginal = q.total;

    // Nace un catálogo con la renta al doble y se vuelve el activo. Se arma con
    // Prisma a mano A PROPÓSITO: `clonarCatalogo` nace en la Task 6 y esta task
    // no debe depender de ella para poder ejecutarse y commitearse sola.
    const viejo = await prisma.priceList.findUniqueOrThrow({ where: { id: q.priceListId! } });
    const nuevo = await prisma.priceList.create({
      data: {
        nombre: 'PRUEBA-DOBLE', anio: 2099, activa: false,
        ivaRate: viejo.ivaRate, extraHourRate: viejo.extraHourRate,
        foodDiscountRate: viejo.foodDiscountRate, capillaSabado: viejo.capillaSabado,
      },
    });
    for (const r of await prisma.rentalPrice.findMany({ where: { priceListId: viejo.id } })) {
      await prisma.rentalPrice.create({
        data: {
          priceListId: nuevo.id, spaceId: r.spaceId, tipo: r.tipo, min: r.min, max: r.max,
          viernes: r.viernes * 2, viernesEspecial: r.viernesEspecial * 2,
          sabado: r.sabado * 2, domAJue: r.domAJue * 2,
        },
      });
    }
    await prisma.$transaction([
      prisma.priceList.updateMany({ data: { activa: false } }),
      prisma.priceList.update({ where: { id: nuevo.id }, data: { activa: true } }),
    ]);

    // Editar solo los invitados NO debe traer los precios nuevos.
    const editada = await updateQuote(prisma, q.id, { ...entradaValida(), invitados: 260 }, adminActor);
    expect(editada.priceListId).toBe(q.priceListId);
    // Sube algo por los invitados, pero nunca al doble.
    expect(editada.total).toBeLessThan(totalOriginal * 1.9);
  });

  it('sin catálogo activo, crear falla con un mensaje claro', async () => {
    await prisma.priceList.updateMany({ data: { activa: false } });
    await expect(createQuote(prisma, entradaValida(), adminActor)).rejects.toThrow(/catálogo activo/i);
    await prisma.priceList.updateMany({ where: { anio: 2027 }, data: { activa: true } });
  });
});
```

> El segundo test es **el corazón del plan**. Si pasa, la clase de bug que nos
> mordió dos veces esta semana está muerta.

- [ ] **Step 2: Correr y confirmar que falla**

Run: `pnpm --filter @hsa/api test quotes`

- [ ] **Step 3: Implementar**

En `createQuote`: resolver el catálogo activo, guardarlo en `data.priceListId`, y pasar su id al loader. En `updateQuote` (y en todo lo que recalcule: `moveQuoteDate`, duplicar, `computeAndEnrich`): pasar `{ priceListId: quote.priceListId }` al loader. **Nunca** llamar al loader sin id cuando ya existe la cotización.

- [ ] **Step 4: Correr la suite completa de la API**

Run: `pnpm --filter @hsa/api test`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/quotes/
git commit -m "feat(api): la cotización fija su catálogo al crear y recalcula contra él"
```

---

## Task 6: Clonar, activar y listar catálogos

**Files:**
- Create: `apps/api/src/pricelists/service.ts`
- Create: `apps/api/src/pricelists/routes.ts`
- Create: `apps/api/src/pricelists/pricelists.test.ts`
- Modify: `apps/api/src/server.ts` (registrar el módulo)

- [ ] **Step 1: Tests**

```ts
describe('catálogos', () => {
  it('clonar copia renta, servicios, paquetes y parámetros', async () => {
    const base = await prisma.priceList.findFirst({ where: { activa: true } });
    const clon = await clonarCatalogo(prisma, { nombre: 'CLON-2098', anio: 2098, clonarDe: base!.id });
    const [rBase, rClon] = await Promise.all([
      prisma.rentalPrice.count({ where: { priceListId: base!.id } }),
      prisma.rentalPrice.count({ where: { priceListId: clon.id } }),
    ]);
    expect(rClon).toBe(rBase);
    expect(await prisma.addOn.count({ where: { priceListId: clon.id } }))
      .toBe(await prisma.addOn.count({ where: { priceListId: base!.id } }));
    expect(clon.ivaRate).toBe(base!.ivaRate);
    expect(clon.activa).toBe(false); // clonar NO activa
  });

  it('el incremento se aplica a renta, servicios y alimentos', async () => {
    const base = await prisma.priceList.findFirst({ where: { activa: true } });
    const clon = await clonarCatalogo(prisma, { nombre: 'CLON-10PCT', anio: 2097, clonarDe: base!.id, incrementoPct: 10 });
    const rb = await prisma.rentalPrice.findFirst({ where: { priceListId: base!.id }, orderBy: { id: 'asc' } });
    const rc = await prisma.rentalPrice.findFirst({ where: { priceListId: clon.id, spaceId: rb!.spaceId, min: rb!.min }, });
    expect(rc!.sabado).toBe(Math.round(rb!.sabado * 1.1));
  });

  it('clonar copia también los brackets de cada paquete', async () => {
    const base = await prisma.priceList.findFirst({ where: { activa: true } });
    const clon = await clonarCatalogo(prisma, { nombre: 'CLON-BRACKETS', anio: 2096, clonarDe: base!.id });
    const pkgs = await prisma.foodPackage.findMany({ where: { priceListId: clon.id }, include: { brackets: true } });
    expect(pkgs.every((p) => p.brackets.length > 0)).toBe(true);
  });

  it('activar uno desactiva los demás', async () => {
    const clon = await clonarCatalogo(prisma, { nombre: 'CLON-ACTIVO', anio: 2095, clonarDe: (await prisma.priceList.findFirst({ where: { activa: true } }))!.id });
    await activarCatalogo(prisma, clon.id);
    expect(await prisma.priceList.count({ where: { activa: true } })).toBe(1);
  });

  it('el nombre es único', async () => {
    const base = await prisma.priceList.findFirst();
    await expect(clonarCatalogo(prisma, { nombre: base!.nombre!, anio: 2094, clonarDe: base!.id })).rejects.toThrow();
  });

  it('lista los catálogos con cuántas cotizaciones usa cada uno', async () => {
    const items = await listarCatalogos(prisma);
    expect(items.every((c) => typeof c.cotizaciones === 'number')).toBe(true);
  });

  it('solo admin puede clonar o activar', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/price-lists', cookies: ventasCookie, payload: { nombre: 'X', anio: 2093 } });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `pnpm --filter @hsa/api test pricelists`

- [ ] **Step 3: Implementar el servicio**

`clonarCatalogo(db, { nombre, anio, clonarDe?, incrementoPct? })` en **una transacción**:
1. Crear la `PriceList` con `activa: false` y los params del origen (o los defaults si no hay origen).
2. Copiar `RentalPrice` conservando `tipo`, aplicando el % a `viernes`, `viernesEspecial`, `sabado`, `domAJue` con `Math.round`.
3. Copiar `AddOn` conservando `activo`, con el % sobre `price`.
4. Copiar `FoodPackage` **y sus brackets**, con el % sobre `pricePerPerson`.

`activarCatalogo(db, id)`: en una transacción, `updateMany({ data: { activa: false } })` y luego activar el pedido.

`listarCatalogos(db)`: cada catálogo con `_count` de cotizaciones, renta, servicios y paquetes.

Un helper único para el porcentaje, para que no se implemente cuatro veces:

```ts
const conIncremento = (v: number, pct: number): number => Math.round(v * (1 + pct / 100));
```

- [ ] **Step 4: Rutas de admin**

`GET /admin/price-lists`, `POST /admin/price-lists`, `POST /admin/price-lists/:id/activar` — las tres con `preHandler: requireAdmin`. Registrar el módulo en `server.ts`.

- [ ] **Step 5: Correr**

Run: `pnpm --filter @hsa/api test`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/pricelists/ apps/api/src/server.ts
git commit -m "feat(api): clonar catálogos con incremento, activar y listar"
```

---

## Task 7: Mover una cotización a otro catálogo

**Files:**
- Modify: `apps/api/src/quotes/service.ts`
- Modify: `apps/api/src/quotes/routes.ts`
- Modify: `apps/api/src/quotes/activityLog.ts`
- Create: migración `ALTER TYPE` para el tipo de bitácora
- Modify: `apps/api/src/quotes/quotes.test.ts`

- [ ] **Step 1: El tipo de bitácora, con su migración**

Agregar `'catalogo'` a la unión `LogTipo` **y** crear la migración:

```sql
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'catalogo';
```

> Sin la migración, `logActivity` falla **en silencio** (`catch {}`) y el
> movimiento quedaría sin rastro. El test del Step 2 cuenta los registros justo
> para cazar eso; el typecheck no lo ve.

- [ ] **Step 2: Tests**

```ts
describe('mover de catálogo', () => {
  it('un admin la mueve, se represia y queda en bitácora', async () => {
    const q = await createQuote(prisma, entradaValida(), adminActor);
    const caro = await clonarCatalogo(prisma, { nombre: 'CARO', anio: 2092, clonarDe: q.priceListId!, incrementoPct: 100 });
    const r = await moverCatalogo(prisma, q.id, caro.id, adminActor);

    expect(r.antes).toBe(q.total);
    expect(r.despues).toBeGreaterThan(r.antes);
    expect(r.quote.priceListId).toBe(caro.id);

    const logs = await prisma.activityLog.findMany({ where: { quoteId: q.id, tipo: 'catalogo' } });
    expect(logs).toHaveLength(1); // si esto da 0, falta el ALTER TYPE
  });

  it('un vendedor no puede', async () => {
    const q = await createQuote(prisma, entradaValida(), adminActor);
    const res = await app.inject({
      method: 'POST', url: `/api/quotes/${q.id}/catalogo`,
      cookies: ventasCookie, payload: { priceListId: q.priceListId },
    });
    expect(res.statusCode).toBe(403);
  });

  it('un catálogo inexistente da 404 y no toca la cotización', async () => {
    const q = await createQuote(prisma, entradaValida(), adminActor);
    await expect(moverCatalogo(prisma, q.id, 'no-existe', adminActor)).rejects.toMatchObject({ status: 404 });
    const sinTocar = await prisma.quote.findUnique({ where: { id: q.id } });
    expect(sinTocar!.priceListId).toBe(q.priceListId);
  });
});
```

- [ ] **Step 3: Implementar**

`moverCatalogo(db, quoteId, priceListId, actor)`: valida pertenencia y papelera con `findOwnedQuote`; verifica que el catálogo exista (404 si no); recalcula con el catálogo nuevo; guarda `priceListId`, `total`, `rentaTotal` y `breakdown`; registra en bitácora con `tipo: 'catalogo'` y meta `{ de, a, totalAntes, totalDespues }`; devuelve `{ quote, antes, despues }`.

Ruta `POST /quotes/:id/catalogo` con `requireAdmin`.

- [ ] **Step 4: Correr**

Run: `pnpm --filter @hsa/api test`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/quotes/ packages/database/prisma/migrations/
git commit -m "feat(api): admin puede mover una cotización a otro catálogo, con bitácora"
```

---

## Task 8: Pantalla de catálogos en admin

**Files:**
- Create: `apps/web/src/pages/admin/CatalogosPage.tsx`
- Modify: el índice/menú de admin
- Modify: `apps/web/src/lib/types.ts`

- [ ] **Step 1: La pantalla**

Tabla con: nombre, año, activa, y cuántas cotizaciones / renglones de renta / servicios / paquetes tiene cada catálogo. El activo se distingue visualmente.

Formulario de alta: nombre, año, catálogo de origen (select) y **porcentaje de incremento opcional**. Junto al campo del porcentaje, texto que diga exactamente a qué se aplica: *"Se aplicará a la renta, a los servicios y a los paquetes de alimentos. Después puedes ajustar renglones sueltos."*

Botón "Activar" por renglón, con confirmación que aclare que **solo afecta a las cotizaciones nuevas** — las existentes siguen casadas a su catálogo.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @hsa/web typecheck`

- [ ] **Step 3: Verificar en el navegador**

Clonar 2027 → "2028" con 8%. Confirmar a mano que un precio de renta subió exactamente 8% redondeado. Activar 2028. Crear una cotización nueva y confirmar que quedó con 2028. Abrir una cotización vieja y confirmar que **no** cambió de total.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): pantalla de catálogos con clonación por porcentaje"
```

---

## Task 9: Mover de catálogo desde la interfaz

**Files:**
- Create: `apps/web/src/components/MoverCatalogoModal.tsx`
- Modify: `apps/web/src/pages/EditQuotePage.tsx`

- [ ] **Step 1: El modal**

Visible **solo para admin**. Muestra el catálogo actual, un select con los demás, y al elegir uno pide una vista previa del total nuevo antes de confirmar (`antes` / `después` con la diferencia). Al confirmar, invalida las queries de la cotización.

En la cotización, mostrar siempre a qué catálogo pertenece — un dato que hoy es invisible y que explica por qué dos cotizaciones de fechas parecidas tienen precios distintos.

- [ ] **Step 2: Typecheck y verificación en navegador**

Run: `pnpm --filter @hsa/web typecheck`
Mover una cotización de prueba a un catálogo con +100% y confirmar que el modal muestra el antes/después correcto y que la bitácora lo registró.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): mover una cotización de catálogo con antes y después"
```

---

## Task 10: Cierre

- [ ] **Step 1: Suite completa**

```bash
pnpm typecheck && pnpm test && pnpm lint
```
Todo en verde. Anotar los totales.

- [ ] **Step 2: La prueba que da sentido al plan, a mano**

Con la app corriendo: crea una cotización, clona su catálogo con +50%, activa el clon, y **reedita la cotización original cambiando solo los invitados**. Su precio debe seguir la escala de precios VIEJA. Si sube al ritmo del catálogo nuevo, el casamiento no está funcionando y el plan falló.

- [ ] **Step 3: Verificar que no quedó ninguna fuente global**

```bash
grep -rn "pricingConfig\|PricingConfig" apps/ packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist
```
Debe salir vacío.

- [ ] **Step 4: Commit final, push y PR**

No mergear sin autorización del dueño.

- [ ] **Step 5: Actualizar la memoria del proyecto**

Anotar: que el catálogo versionado mató la clase de bug del valet y la Capilla; que `PricingConfig` ya no existe; que `tipo` vive en `RentalPrice`; y que el tramo 2 (editores finos de renta, servicios y paquetes) sigue pendiente.

---

## Task 11: El DJ hora extra pasa al catálogo (agregada 2026-08-11 por decisión del dueño)

**Contexto.** `EventType.djHoraExtra` es un precio en pesos **global**: clonar el catálogo con +8% lo deja igual, y editarlo represia toda cotización que se reedite. Es la misma clase de bug que este plan vino a matar, y se colaba por la puerta de atrás.

**Decisión del dueño: conservar los dos precios.** No es un precio único — hoy vale $2,950 en boda/XV/empresarial/fin de año y $2,750 en bautizo/cumpleaños, y en graduación/renta/team building no se ofrece (`null`). Colapsarlo a un precio movería lo que cuesta un bautizo. Así que el servicio vive en el catálogo **con un precio por tipo de evento**, igual que ya funcionan los paquetes de alimentos.

**Lo que NO cambia:** sigue siendo una casilla que multiplica por `horasExtra` y va a "otros" sin IVA. Y sobre todo, **el motor no se toca**: ya recibe `djHoraExtraByEventType: Record<string, number>` y esa forma se conserva; solo cambia de dónde se llena.

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migración + `packages/database/prisma/backfill-fase14.ts`
- Modify: `apps/api/src/catalog/loader.ts`, `apps/api/src/pricelists/service.ts`
- Modify: `packages/database/prisma/seed.ts` y los datos del catálogo
- Modify: `apps/web/src/components/admin/CatalogosSection.tsx`

- [ ] **Step 1: Modelo**

```prisma
/// Precio de la hora extra de DJ, por catálogo y por tipo de evento.
/// Es por tipo de evento porque el precio real difiere ($2,950 en boda, $2,750
/// en bautizo) y un tipo sin renglón simplemente no ofrece el servicio.
model DjHoraExtraPrice {
  id          String    @id @default(cuid())
  priceList   PriceList @relation(fields: [priceListId], references: [id])
  priceListId String
  eventType   EventType @relation(fields: [eventTypeId], references: [id])
  eventTypeId String
  price       Int

  @@unique([priceListId, eventTypeId])
  @@index([priceListId])
}
```

`PriceList` gana `djPrices DjHoraExtraPrice[]`; `EventType` gana la relación inversa. **`EventType.djHoraExtra` se borra en la fase 2**, no antes: el backfill lo necesita para leer los valores.

- [ ] **Step 2: Backfill (entre las dos migraciones, como el fase13)**

Para **cada** catálogo existente, crear un renglón por cada `EventType` con `djHoraExtra` no nulo, copiando el valor. Idempotente (`skipDuplicates` o comprobar antes). Registrar cuántos creó. Agregarlo al `CMD` del Dockerfile después de `fase13`.

- [ ] **Step 3: El loader llena el mapa desde la tabla nueva**

```ts
const djPrices = await db.djHoraExtraPrice.findMany({ where: { priceListId: priceList.id } });
const djHoraExtraByEventType: Record<string, number> = {};
for (const d of djPrices) djHoraExtraByEventType[d.eventTypeId] = d.price;
```

Y se quita el `djHoraExtra` de la consulta de `eventTypes` (que sigue necesitándose para `rentaPlana`).

- [ ] **Step 4: Clonar los copia con el incremento**

En `clonarCatalogo`, dentro de la misma transacción, copiar `DjHoraExtraPrice` aplicando `conIncremento` con `Math.round`, igual que renta, servicios y alimentos.

- [ ] **Step 5: Tests**

- El precio del DJ sale del catálogo pedido, no de `EventType`.
- Clonar con % lo sube: `2950 → Math.round(2950 × 1.08) = 3186`.
- Un tipo de evento sin renglón **no cobra DJ** aunque la casilla esté marcada (hoy es el caso de graduación, renta y team building).
- **El test que da sentido a la task:** una cotización con DJ, un catálogo nuevo activo con el DJ al doble, y al reeditar el total **no se mueve**.
- Ningún flotante llega a la base.

- [ ] **Step 6: La pantalla de catálogos lo muestra**

Junto a los servicios: una lista de tipo de evento → precio del DJ. Solo lectura en este tramo (editarlos es del tramo 2).

- [ ] **Step 7: Migración fase 2 y cierre**

Recién ahora `DROP COLUMN "djHoraExtra"` de `EventType`. Correr `pnpm typecheck && pnpm test && pnpm lint`, y confirmar en la base que ningún catálogo quedó sin sus renglones de DJ.

> **No borres el add-on desactivado "DJ Hora extra"** que quedó en la tabla `AddOn`.
> Está inactivo y el catálogo ya sabe resolver add-ons dados de baja (PR #2);
> borrarlo antes de un despliegue solo agrega riesgo sin ganar nada.
