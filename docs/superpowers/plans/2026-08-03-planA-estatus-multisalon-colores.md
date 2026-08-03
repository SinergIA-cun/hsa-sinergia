# Plan A: estatus, bloqueo en servidor, multi-salón y colores · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El apartado formaliza el evento y bloquea el espacio de verdad (en el servidor), un evento puede usar hasta 3 salones con plan de pagos proporcional, y el selector de espacios muestra la disponibilidad con colores sin tener que hacer clic.

**Architecture:** Se renombran los valores del enum `QuoteStatus` en Postgres (`apartada`→`formalizada`, `formalizada`→`complementada`) con dos sentencias en una migración; TypeScript señala cada sitio afectado. La disponibilidad baja de 4 a 3 niveles y su validación se muda de la interfaz al servidor. El motor de precios gana `spaceId` en las líneas de renta, lo que permite a `computeEstadoCuenta` recibir varias reglas de pago y repartir el complemento en proporción a la renta de cada espacio.

**Tech Stack:** pnpm + Turbo, Fastify 5, Prisma 6 + Postgres (Docker puerto 5434), React 18 + Vite 6 + Tailwind 4 + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-03-cambios-estatus-multisalon-facturacion-bi-design.md`

---

## Antes de empezar

- [ ] **Levantar la base de datos** (los tests de integración la necesitan)

```bash
cd /Users/fernando.diaz/Projects/hacienda-san-andres && docker compose up -d
```

Esperado: contenedor de Postgres arriba en el puerto 5434. Verificar con `docker ps`.

- [ ] **Crear la rama**

```bash
git checkout -b feat/planA-estatus-multisalon
```

- [ ] **Confirmar que el punto de partida está verde**

```bash
pnpm typecheck && pnpm test
```

Esperado: typecheck 4/4 exitosos; tests verdes (~55). Si algo falla aquí, resolverlo antes de continuar — no arrastrar fallos previos dentro del plan.

---

## Estructura de archivos

**Migración**
- Crear: `packages/database/prisma/migrations/20260803120000_estatus_formalizada/migration.sql`
- Modificar: `packages/database/prisma/schema.prisma` (enum `QuoteStatus`)

**Motor puro (`packages/shared`)** — sin acceso a base de datos, todo función pura
- Modificar: `packages/shared/src/types.ts` (`QuoteLine.spaceId`)
- Modificar: `packages/shared/src/pricing/engine.ts` (poblar `spaceId`)
- Modificar: `packages/shared/src/schemas.ts` (tope de 3 espacios)
- Modificar: `packages/shared/src/pricing/engine.test.ts`

**Estado de cuenta (API)** — función pura, aislada de Prisma a propósito
- Modificar: `apps/api/src/quotes/estadoCuenta.ts`
- Modificar: `apps/api/src/quotes/estadoCuenta.test.ts`

**Servicio de cotizaciones (API)**
- Modificar: `apps/api/src/quotes/service.ts` (estatus, reglas múltiples, bloqueo, `computeAndEnrich`)
- Modificar: `apps/api/src/quotes/quotes.test.ts`

**Disponibilidad (API)**
- Modificar: `apps/api/src/availability/service.ts` (3 niveles)
- Modificar: `apps/api/src/availability/availability.test.ts`

**Dashboard (API)**
- Modificar: `apps/api/src/dashboard/service.ts` (constantes de estatus)

**Front**
- Modificar: `apps/web/src/lib/types.ts`, `apps/web/src/lib/status.ts`
- Modificar: `apps/web/src/pages/QuotesListPage.tsx`, `AgendaPage.tsx`, `EditQuotePage.tsx`, `ContratoPage.tsx`
- Modificar: `apps/web/src/components/QuoteForm.tsx` (multi-selección, colores, preview del plan)

---

## Task 1: Renombrar los valores del enum en la base

**Files:**
- Create: `packages/database/prisma/migrations/20260803120000_estatus_formalizada/migration.sql`
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Escribir la migración**

Crear el directorio y el archivo. **El orden de las dos sentencias es obligatorio:** Postgres no permite renombrar un valor hacia uno que ya existe, así que primero se libera el nombre `formalizada`.

```sql
-- El negocio considera FORMALIZADO el evento desde que el cliente da el apartado.
-- Se recorren los nombres del enum sin perder información:
--   'apartada'    (pagó anticipo)    -> 'formalizada'
--   'formalizada' (pagó complemento) -> 'complementada'
-- El orden importa: primero se libera el nombre 'formalizada'.
ALTER TYPE "QuoteStatus" RENAME VALUE 'formalizada' TO 'complementada';
ALTER TYPE "QuoteStatus" RENAME VALUE 'apartada' TO 'formalizada';
```

- [ ] **Step 2: Actualizar el enum en el schema de Prisma**

En `packages/database/prisma/schema.prisma`, el enum `QuoteStatus` queda:

```prisma
enum QuoteStatus {
  borrador
  enviada
  aceptada
  formalizada
  complementada
  liquidada
  vencida
}
```

- [ ] **Step 3: Aplicar la migración y regenerar el cliente**

```bash
pnpm --filter @hsa/database exec dotenv -e ../../.env -- prisma migrate deploy && pnpm db:generate
```

Esperado: `1 migration found` / `applied`, y luego `Generated Prisma Client`.

- [ ] **Step 4: Verificar en la base que los valores cambiaron**

```bash
docker exec -i $(docker ps -qf "publish=5434") psql -U postgres -d hsa -c "SELECT unnest(enum_range(NULL::\"QuoteStatus\"));"
```

Esperado: la lista incluye `formalizada` y `complementada`, y **no** incluye `apartada`.

- [ ] **Step 5: Actualizar las listas de estatus en TypeScript**

En `apps/api/src/quotes/service.ts`, `QUOTE_STATUSES` (línea ~14):

```ts
export const QUOTE_STATUSES = [
  'borrador',
  'enviada',
  'aceptada',
  'formalizada',
  'complementada',
  'liquidada',
  'vencida',
] as const;
```

En `apps/web/src/lib/types.ts`, `QUOTE_STATUSES` (línea ~88): exactamente la misma lista, mismo orden.

- [ ] **Step 6: Ver la lista completa de errores del compilador**

```bash
pnpm typecheck 2>&1 | tail -40
```

Esperado: **falla**, con errores en `estadoCuenta.ts`, `service.ts`, `availability/service.ts`, `dashboard/service.ts`, `status.ts`, `QuotesListPage.tsx`, `AgendaPage.tsx`, `EditQuotePage.tsx`, `QuoteForm.tsx` y los tests. Esa lista es la guía de las Tasks 2 a 7: cada error es un sitio a corregir. Anotarla.

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma apps/api/src/quotes/service.ts apps/web/src/lib/types.ts
git commit -m "feat(db)!: apartada -> formalizada, formalizada -> complementada"
```

---

## Task 2: Estado de cuenta con los nuevos estatus y sin "formalizar" en el complemento

**Files:**
- Modify: `apps/api/src/quotes/estadoCuenta.ts`
- Test: `apps/api/src/quotes/estadoCuenta.test.ts`

- [ ] **Step 1: Actualizar los tests existentes a los nombres nuevos**

En `apps/api/src/quotes/estadoCuenta.test.ts`, reemplazar los literales viejos. El test de umbrales queda:

```ts
  it('umbrales: anticipo→formalizada, +complemento→complementada, total→liquidada', () => {
    expect(computeEstadoCuenta({ ...base, rule, payments: [{ monto: 20000, anuladoAt: null }] }).sugerido).toBe('formalizada');
    // anticipo 20000 + 10% de 100000 = 30000
    expect(computeEstadoCuenta({ ...base, rule, payments: [{ monto: 30000, anuladoAt: null }] }).sugerido).toBe('complementada');
    expect(computeEstadoCuenta({ ...base, rule, payments: [{ monto: 100000, anuladoAt: null }] }).sugerido).toBe('liquidada');
    expect(computeEstadoCuenta({ ...base, rule, payments: [{ monto: 1000, anuladoAt: null }] }).sugerido).toBeNull();
  });
```

En los tests de desfase, `status: 'formalizada'` pasa a `status: 'complementada'` (el que exige el complemento) y `status: 'apartada'` pasa a `status: 'formalizada'` (el que exige solo el anticipo):

```ts
  it('desfase: estatus complementada pero pagado no cubre el complemento', () => {
    const ec = computeEstadoCuenta({ ...base, status: 'complementada', rule, payments: [{ monto: 20000, anuladoAt: null }] });
    expect(ec.desfase).toBe(true);
  });

  it('no hay desfase cuando el pagado cubre el estatus', () => {
    const ec = computeEstadoCuenta({ ...base, status: 'formalizada', rule, payments: [{ monto: 20000, anuladoAt: null }] });
    expect(ec.desfase).toBe(false);
  });
```

En los dos tests que pasan `status: 'apartada'` (líneas ~53 y ~69), cambiar a `status: 'formalizada'`.

- [ ] **Step 2: Agregar un test nuevo para la etiqueta del complemento**

Agregar dentro del `describe`:

```ts
  it('el hito del complemento no menciona formalizar', () => {
    const ec = computeEstadoCuenta({ ...base, rule, payments: [] });
    const comp = ec.plan!.find((m) => m.key === 'complemento')!;
    expect(comp.label).toBe('Complemento');
    expect(ec.plan!.find((m) => m.key === 'apartar')!.label).toBe('Apartar fecha');
  });
```

- [ ] **Step 3: Correr los tests para verlos fallar**

```bash
pnpm --filter @hsa/api exec vitest run src/quotes/estadoCuenta.test.ts
```

Esperado: FALLA. Los de umbrales/desfase fallan porque el código sigue devolviendo `'apartada'`; el de la etiqueta falla con `expected 'Complemento (formalizar)' to be 'Complemento'`.

- [ ] **Step 4: Actualizar `estadoCuenta.ts`**

Tres cambios. Línea 1:

```ts
export type PaymentStatus = 'formalizada' | 'complementada' | 'liquidada';
```

Línea ~36:

```ts
const RANK: Record<PaymentStatus, number> = { formalizada: 1, complementada: 2, liquidada: 3 };
```

En el arreglo `plan` (línea ~92), quitar "(formalizar)":

```ts
    hito('complemento', 'Complemento', objComplemento, complementoVence?.toISOString() ?? null, Math.round(rule.complementoPct * 100)),
```

Y en la asignación de `sugerido` (líneas ~97-99):

```ts
  let sugerido: PaymentStatus | null = null;
  if (pagado >= objFiniquito) sugerido = 'liquidada';
  else if (pagado >= objComplemento) sugerido = 'complementada';
  else if (pagado >= objApartar) sugerido = 'formalizada';
```

En el bloque de desfase (líneas ~104-107), los nombres de las propiedades de `RANK`:

```ts
    if (req >= RANK.formalizada && pagado < objApartar) desfase = true;
    if (req >= RANK.complementada && pagado < objComplemento) desfase = true;
    if (req >= RANK.liquidada && pagado < objFiniquito) desfase = true;
```

- [ ] **Step 5: Correr los tests para verlos pasar**

```bash
pnpm --filter @hsa/api exec vitest run src/quotes/estadoCuenta.test.ts
```

Esperado: PASA, todos.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/quotes/estadoCuenta.ts apps/api/src/quotes/estadoCuenta.test.ts
git commit -m "feat(api): estado de cuenta con formalizada/complementada; el complemento ya no dice formalizar"
```

---

## Task 3: Arreglar la búsqueda de la fecha de apartado (trampa del renombrado)

**Files:**
- Modify: `apps/api/src/quotes/service.ts:120` y `:161`

**Contexto:** `loadEstadoCuenta` y `loadEstadoCuentaBulk` buscan cuándo se apartó el evento con `descripcion: { contains: 'apartada' }` — una búsqueda de texto sobre la bitácora. Tras el renombrado, las entradas nuevas dirán `"Estatus: aceptada → formalizada"`, que **no** contiene "apartada". Sin este arreglo, la fecha de vencimiento del complemento dejaría de calcularse en las cotizaciones nuevas, en silencio y sin que ningún test lo note.

- [ ] **Step 1: Escribir el test que expone el problema**

Agregar en `apps/api/src/quotes/quotes.test.ts` (usa los helpers que ya existen en ese archivo: `actor`, `arcosId`/espacio, `eventTypeId`, y los arreglos `created`/`createdClients` para limpieza):

```ts
  it('el complemento tiene fecha de vencimiento después de formalizar (bitácora nueva)', async () => {
    const q = await createQuote(
      prisma,
      { fecha: '2029-06-16', invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Fecha Apartado' } },
      actor,
    );
    created.push(q.id);
    createdClients.push(q.clientId);

    await updateStatus(prisma, q.id, 'formalizada', actor);

    const { estadoCuenta } = await loadEstadoCuenta(prisma, {
      id: q.id,
      rentaTotal: q.rentaTotal,
      fechaEvento: q.fechaEvento,
      status: 'formalizada',
      spaceIds: q.spaceIds,
    });
    const comp = estadoCuenta.plan!.find((m) => m.key === 'complemento')!;
    expect(comp.venceISO).not.toBeNull();
  });
```

Asegurar que `loadEstadoCuenta` esté en el `import` de `../quotes/service.js` al inicio del archivo de test.

> **Nota:** este objeto todavía **no** lleva `breakdown`, porque la firma de
> `loadEstadoCuenta` no lo pide hasta la Task 11. Esa task incluye el paso de
> agregárselo aquí. Pasarlo ahora sería un error de compilación (propiedad
> desconocida en un literal de objeto).

- [ ] **Step 2: Correr el test para verlo fallar**

```bash
pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts -t 'fecha de vencimiento'
```

Esperado: FALLA con `expected null not to be null` — confirma que la búsqueda por texto ya no encuentra el registro.

- [ ] **Step 3: Arreglar las dos consultas**

En `apps/api/src/quotes/service.ts`, línea ~120 (dentro de `loadEstadoCuenta`):

```ts
    db.activityLog.findFirst({
      // Primer momento en que el evento alcanzó el hito del anticipo. Se aceptan
      // ambos términos: 'formalizada' es el nombre actual y 'apartada' el que
      // quedó escrito en la bitácora de los eventos anteriores al renombrado.
      where: {
        quoteId: quote.id,
        tipo: 'estatus',
        OR: [{ descripcion: { contains: 'formalizada' } }, { descripcion: { contains: 'apartada' } }],
      },
      orderBy: { createdAt: 'asc' }, select: { createdAt: true },
    }),
```

Y en línea ~161 (dentro de `loadEstadoCuentaBulk`), el mismo `OR`:

```ts
    db.activityLog.findMany({
      // Ver la nota en loadEstadoCuenta: se aceptan el término nuevo y el legado.
      where: {
        quoteId: { in: quoteIds },
        tipo: 'estatus',
        OR: [{ descripcion: { contains: 'formalizada' } }, { descripcion: { contains: 'apartada' } }],
      },
      orderBy: { createdAt: 'asc' },
      select: { quoteId: true, createdAt: true },
    }),
```

- [ ] **Step 4: Correr el test para verlo pasar**

```bash
pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts -t 'fecha de vencimiento'
```

Esperado: PASA.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/quotes/service.ts apps/api/src/quotes/quotes.test.ts
git commit -m "fix(api): la fecha de apartado se sigue encontrando tras renombrar el estatus"
```

---

## Task 4: Actualizar el resto de los estatus en la API

**Files:**
- Modify: `apps/api/src/quotes/service.ts` (líneas ~61, ~392, ~523)
- Modify: `apps/api/src/dashboard/service.ts` (líneas 5 y 7)

- [ ] **Step 1: `EDITABLE_STATUSES` en el servicio**

Línea ~61 de `apps/api/src/quotes/service.ts`:

```ts
// Se permite editar el desglose incluso con compromiso de pago (formalizada/complementada);
// las ediciones en esos estatus quedan registradas en la bitácora de actividad.
const EDITABLE_STATUSES = new Set(['borrador', 'enviada', 'aceptada', 'formalizada', 'complementada']);
```

- [ ] **Step 2: La condición del log de edición**

Línea ~392:

```ts
  if (existing.status === 'formalizada' || existing.status === 'complementada') {
```

- [ ] **Step 3: Los estatus de evento real en la hoja operativa del día**

Línea ~523:

```ts
      status: { in: ['formalizada', 'complementada', 'liquidada'] },
```

- [ ] **Step 4: Las constantes del dashboard**

⚠️ **Estas dos NO las señala el compilador.** `EVENTOS` y `CONFIRMADOS` se usan con un
cast `as readonly string[]` antes del `.includes()` (líneas ~220 y ~292), así que
TypeScript acepta cualquier cadena y el error queda silencioso. Hay que corregirlas a
mano o el dashboard dejaría de ver los eventos reales.

Líneas 5 y 7 de `apps/api/src/dashboard/service.ts`:

```ts
// Estatus de evento real (ya reservado) — para fichas, próxima semana y alertas.
const EVENTOS = ['formalizada', 'complementada', 'liquidada'] as const;
// Confirmados que aún deben dinero (para alertas de finiquito).
const CONFIRMADOS = ['formalizada', 'complementada'] as const;
```

Y el comentario de la línea ~291 menciona los nombres viejos:

```ts
    // Alertas: confirmado (formalizada/complementada) que ya entró en sus 30 días sin finiquitar.
```

- [ ] **Step 4b: Verificar que no quedan literales viejos**

```bash
grep -rn "'apartada'\|\"apartada\"" apps packages --include='*.ts' --include='*.tsx' | grep -v node_modules
```

Esperado: en `apps/api` y `packages` **solo deben quedar dos coincidencias legítimas**, las
dos cláusulas `contains: 'apartada'` que la Task 3 agregó a propósito en
`quotes/service.ts` para seguir encontrando la bitácora escrita antes del renombrado.
Cualquier otra coincidencia es un literal olvidado.

Lo que quede en `apps/web` es trabajo de la Task 7, y `avail.level === 'apartada'` del
`QuoteForm` es del tipo `AvailabilityLevel` (Task 5), no de `QuoteStatus`.

- [ ] **Step 5: Actualizar los literales en los tests de la API**

Reemplazar `'apartada'` por `'formalizada'` en:
- `apps/api/src/dashboard/dashboard.test.ts:72`
- `apps/api/src/quotes/quotes.test.ts` líneas ~90, ~111, ~142, ~151, ~224, ~227, ~269, ~291
- `apps/api/src/payments/payments.test.ts` líneas ~61 y ~63 (el comentario "auto-apartada" pasa a "auto-formalizada")

En `payments.test.ts` el test comprueba que pagar el anticipo de Arcos ($20,000) avanza el estatus; el valor esperado pasa de `'apartada'` a `'formalizada'`.

- [ ] **Step 6: Correr toda la suite de la API**

```bash
pnpm --filter @hsa/api run test
```

Esperado: PASA. Si algún test de disponibilidad falla por el nivel `'apartada'`, es lo esperado — se resuelve en la Task 5. Si es el caso, continuar y volver a correr al final de esa task.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src
git commit -m "refactor(api): estatus nuevos en servicio, dashboard y tests"
```

---

## Task 5: Disponibilidad de 4 niveles a 3, y el apartado bloquea

**Files:**
- Modify: `apps/api/src/availability/service.ts`
- Test: `apps/api/src/availability/availability.test.ts`

- [ ] **Step 1: Reescribir el test de escalada de niveles**

En `apps/api/src/availability/availability.test.ts`, reemplazar el test `'escala el nivel: libre → cotizaciones → apartada → bloqueada, y excluye la propia'` por:

```ts
  it('escala el nivel: libre → cotizaciones → bloqueada, y excluye la propia', async () => {
    const libre = await getAvailability(prisma, FECHA, [arcosId]);
    expect(libre.spaces[0]!.level).toBe('libre');

    const q = await createQuote(
      prisma,
      { fecha: FECHA, invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Dispo Test' } },
      actor,
    );
    created.push(q.id);
    createdClients.push(q.clientId);

    // Cotización sin pago: avisa pero no bloquea.
    const conCotizacion = await getAvailability(prisma, FECHA, [arcosId]);
    expect(conCotizacion.spaces[0]!.level).toBe('cotizaciones');
    expect(conCotizacion.blocked).toBe(false);

    // Formalizada (pagó el anticipo): a partir de aquí bloquea.
    await updateStatus(prisma, q.id, 'formalizada', actor);
    const formalizada = await getAvailability(prisma, FECHA, [arcosId]);
    expect(formalizada.spaces[0]!.level).toBe('bloqueada');
    expect(formalizada.blocked).toBe(true);

    // Complementada sigue bloqueando.
    await updateStatus(prisma, q.id, 'complementada', actor);
    expect((await getAvailability(prisma, FECHA, [arcosId])).spaces[0]!.level).toBe('bloqueada');

    // Excluyéndose a sí misma, el espacio vuelve a verse libre (caso de edición).
    const excluida = await getAvailability(prisma, FECHA, [arcosId], q.id);
    expect(excluida.spaces[0]!.level).toBe('libre');
    expect(excluida.blocked).toBe(false);
  });
```

- [ ] **Step 2: Correr el test para verlo fallar**

```bash
pnpm --filter @hsa/api exec vitest run src/availability/availability.test.ts
```

Esperado: FALLA en la aserción de `'bloqueada'` tras formalizar — hoy ese estatus produce el nivel `'apartada'`.

- [ ] **Step 3: Actualizar `availability/service.ts`**

Línea 3, el tipo pierde el nivel intermedio:

```ts
export type AvailabilityLevel = 'libre' | 'cotizaciones' | 'bloqueada';
```

Línea 9, los contadores reflejan los estatus nuevos:

```ts
  counts: { cotizaciones: number; formalizadas: number; complementadas: number; liquidadas: number };
```

Líneas ~28-31, los conjuntos:

```ts
// Estatus que "ocupan": borrador/enviada/aceptada = cotización sin pago (aviso
// suave); cualquier cosa con compromiso de pago bloquea. vencida se ignora.
const COTIZACION = new Set(['borrador', 'enviada', 'aceptada']);
const BLOQUEO = new Set(['formalizada', 'complementada', 'liquidada']);
```

Líneas ~80-89, el bloque de conteo y nivel:

```ts
    const counts = {
      cotizaciones: relevantes.filter((q) => COTIZACION.has(q.status)).length,
      formalizadas: relevantes.filter((q) => q.status === 'formalizada').length,
      complementadas: relevantes.filter((q) => q.status === 'complementada').length,
      liquidadas: relevantes.filter((q) => q.status === 'liquidada').length,
    };
    let level: AvailabilityLevel = 'libre';
    if (relevantes.some((q) => BLOQUEO.has(q.status))) level = 'bloqueada';
    else if (counts.cotizaciones > 0) level = 'cotizaciones';
```

- [ ] **Step 4: Correr los tests para verlos pasar**

```bash
pnpm --filter @hsa/api exec vitest run src/availability/availability.test.ts
```

Esperado: PASA.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/availability
git commit -m "feat(api): el apartado bloquea el espacio; disponibilidad de 3 niveles"
```

---

## Task 6: Bloqueo de disponibilidad en el servidor

**Files:**
- Modify: `apps/api/src/quotes/service.ts` (`createQuote`, `updateQuote`)
- Test: `apps/api/src/quotes/quotes.test.ts`

**Contexto:** hoy el bloqueo solo existe en el navegador. Una llamada directa a la API guarda encima de un evento comprometido, y dos personas de ventas con la pantalla abierta pueden guardar ambas la misma fecha.

- [ ] **Step 1: Escribir los tests**

Agregar en `apps/api/src/quotes/quotes.test.ts`:

```ts
  it('rechaza crear sobre un espacio comprometido (bloqueo del servidor, sin pasar por el navegador)', async () => {
    const ocupa = await createQuote(
      prisma,
      { fecha: '2029-08-11', invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Ocupa Arcos' } },
      actor,
    );
    created.push(ocupa.id);
    createdClients.push(ocupa.clientId);
    await updateStatus(prisma, ocupa.id, 'formalizada', actor);

    await expect(
      createQuote(
        prisma,
        { fecha: '2029-08-11', invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Encima' } },
        actor,
      ),
    ).rejects.toThrow(/no está disponible/i);
  });

  it('editar sin cambiar fecha ni espacio no se auto-bloquea', async () => {
    const q = await createQuote(
      prisma,
      { fecha: '2029-08-12', invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Auto Bloqueo' } },
      actor,
    );
    created.push(q.id);
    createdClients.push(q.clientId);
    await updateStatus(prisma, q.id, 'formalizada', actor);

    const editada = await updateQuote(
      prisma,
      q.id,
      { fecha: '2029-08-12', invitados: 260, spaceIds: [arcosId], eventTypeId, horasExtra: 0, addOns: [] },
      actor,
    );
    expect(editada.invitados).toBe(260);
  });

  it('basta que UNO de varios espacios esté comprometido para rechazar', async () => {
    const ocupa = await createQuote(
      prisma,
      { fecha: '2029-08-13', invitados: 250, spaceIds: [camposId], eventTypeId, client: { nombre: 'Ocupa Campos' } },
      actor,
    );
    created.push(ocupa.id);
    createdClients.push(ocupa.clientId);
    await updateStatus(prisma, ocupa.id, 'formalizada', actor);

    // Arcos está libre, pero Campos no: la combinación se rechaza.
    await expect(
      createQuote(
        prisma,
        {
          fecha: '2029-08-13',
          invitados: 250,
          spaceIds: [arcosId, camposId],
          eventTypeId,
          client: { nombre: 'Dos Salones Uno Ocupado' },
        },
        actor,
      ),
    ).rejects.toThrow(/no está disponible/i);
  });
```

Asegurar que `updateQuote` esté importado en el archivo de test. Este último test
necesita `camposId` y la posibilidad de usar dos espacios, así que **depende de la
Task 9**: dejarlo escrito con `it.skip` si se ejecuta esta task antes, y quitarle el
`skip` al terminar la Task 9.

- [ ] **Step 2: Correr los tests para verlos fallar**

```bash
pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts -t 'bloqueo del servidor'
```

Esperado: FALLA — la creación tiene éxito en lugar de lanzar.

- [ ] **Step 3: Agregar el guardia**

En `apps/api/src/quotes/service.ts`, importar el servicio de disponibilidad al inicio del archivo:

```ts
import { getAvailability } from '../availability/service.js';
```

Agregar la función auxiliar justo después de `ownershipWhere` (~línea 103):

```ts
/**
 * El espacio comprometido no se puede sobrevender. El navegador ya avisa antes de
 * guardar, pero la autoridad es el servidor: sin esto, una llamada directa a la
 * API —o dos personas de ventas guardando al mismo tiempo— pisan el compromiso.
 */
async function assertEspaciosDisponibles(
  db: PrismaClient,
  fecha: string,
  spaceIds: string[],
  excludeQuoteId?: string,
): Promise<void> {
  const disp = await getAvailability(db, fecha, spaceIds, excludeQuoteId);
  const ocupados = disp.spaces.filter((s) => s.level === 'bloqueada');
  if (ocupados.length > 0) {
    const nombres = ocupados.map((s) => s.nombre).join(', ');
    throw new QuoteError(409, `${nombres} no está disponible el ${fecha}: ya hay un evento comprometido.`);
  }
}
```

En `createQuote`, llamarla después de validar la entrada y antes de escribir:

```ts
  await assertEspaciosDisponibles(db, input.fecha, input.spaceIds);
```

En `updateQuote`, después de `const input = updateQuoteSchema.parse(rawInput);` y pasando el propio id para no bloquearse contra sí misma:

```ts
  await assertEspaciosDisponibles(db, input.fecha, input.spaceIds, id);
```

- [ ] **Step 4: Correr los tests para verlos pasar**

```bash
pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts
```

Esperado: PASA, incluidos los dos nuevos. Si algún test previo empieza a fallar por chocar de fecha con otro, darle una fecha propia y aislada (el archivo ya usa fechas de 2029 para eso).

- [ ] **Step 5: Verificar que la ruta devuelve 409 y no 500**

Confirmar que las rutas de `apps/api/src/quotes/routes.ts` traducen `QuoteError` a su código HTTP (el patrón ya existe para el 409 de "no se puede editar"). Si `QuoteError` se maneja de forma centralizada, no hay nada que cambiar.

```bash
pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts -t '409'
```

Esperado: PASA.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/quotes
git commit -m "feat(api): el bloqueo de espacio se valida en el servidor (409), no solo en la UI"
```

---

## Task 7: Estatus nuevos en el front

**Files:**
- Modify: `apps/web/src/lib/status.ts`, `apps/web/src/lib/types.ts`
- Modify: `apps/web/src/pages/QuotesListPage.tsx:13-18`, `AgendaPage.tsx:32-46`, `EditQuotePage.tsx:99`
- Modify: `apps/web/src/components/QuoteForm.tsx:569-620`

- [ ] **Step 1: Etiquetas y estilos**

`apps/web/src/lib/status.ts` completo:

```ts
import type { QuoteStatus } from './types.ts';

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  aceptada: 'Aceptada',
  formalizada: 'Formalizada',
  complementada: 'Complemento cubierto',
  liquidada: 'Liquidada',
  vencida: 'Vencida',
};

export const STATUS_STYLE: Record<QuoteStatus, string> = {
  borrador: 'bg-cream-200 text-charcoal-soft',
  enviada: 'bg-ink/10 text-ink',
  aceptada: 'bg-gold/15 text-gold',
  formalizada: 'bg-gold/25 text-gold',
  complementada: 'bg-gold text-cream',
  liquidada: 'bg-ink text-cream',
  vencida: 'bg-wine/10 text-wine',
};

export const EDITABLE_STATUSES: QuoteStatus[] = ['borrador', 'enviada', 'aceptada', 'formalizada', 'complementada'];
```

- [ ] **Step 2: Tipos del front**

En `apps/web/src/lib/types.ts`, dos cambios además de `QUOTE_STATUSES` (ya hecho en la Task 1). Línea ~183:

```ts
  sugerido: 'formalizada' | 'complementada' | 'liquidada' | null;
```

Líneas ~203-210:

```ts
export type AvailabilityLevel = 'libre' | 'cotizaciones' | 'bloqueada';

export interface SpaceAvailability {
  spaceId: string;
  nombre: string;
  level: AvailabilityLevel;
  counts: { cotizaciones: number; formalizadas: number; complementadas: number; liquidadas: number };
  quotes: { id: string; cliente: string; status: string }[];
}
```

- [ ] **Step 3: Secciones de la lista**

`apps/web/src/pages/QuotesListPage.tsx` líneas 13-18:

```ts
const SECTIONS: { title: string; statuses: QuoteStatus[]; defaultOpen: boolean }[] = [
  { title: 'Contratos', statuses: ['borrador', 'enviada', 'aceptada', 'vencida'], defaultOpen: true },
  { title: 'Eventos Formalizados', statuses: ['formalizada'], defaultOpen: true },
  { title: 'Complemento cubierto', statuses: ['complementada'], defaultOpen: false },
  { title: 'Eventos Liquidados', statuses: ['liquidada'], defaultOpen: false },
];
```

- [ ] **Step 4: Colores y leyenda de la agenda**

`apps/web/src/pages/AgendaPage.tsx` líneas 32-46:

```ts
// Colores de la agenda por estado (cortesía familiar manda sobre todo):
//  vino = tentativa · azul = formalizada (pagó anticipo) · blanco/negro = complemento
//  cubierto o liquidada · verde = cortesía.
function agendaChipStyle(e: AgendaEvent): string {
  if (e.esCortesia) return 'bg-emerald-600 text-cream';
  if (e.status === 'complementada' || e.status === 'liquidada') return 'bg-white text-ink ring-1 ring-ink';
  if (e.status === 'formalizada') return 'bg-blue-600 text-white';
  return 'bg-wine/15 text-wine ring-1 ring-wine/25';
}

const LEYENDA: { label: string; dot: string }[] = [
  { label: 'Tentativa', dot: 'bg-wine' },
  { label: 'Formalizada', dot: 'bg-blue-600' },
  { label: 'Complemento cubierto', dot: 'bg-white ring-1 ring-ink' },
  { label: 'Cortesía familiar', dot: 'bg-emerald-600' },
];
```

- [ ] **Step 5: Disponibilidad del contrato**

`apps/web/src/pages/EditQuotePage.tsx` línea ~99:

```ts
  const contratoDisponible =
    !enPapelera && ['formalizada', 'complementada', 'liquidada'].includes(quote.status);
```

- [ ] **Step 5b: Términos de pago de la página del cliente**

`apps/web/src/pages/PublicQuotePage.tsx` línea ~28, dentro de `terminosPago`. La frase
que ve el cliente pierde la palabra "formalizar":

```tsx
    if (m.key === 'complemento') {
      const pct = m.porcentaje != null ? `${m.porcentaje}% del total = ` : '';
      return `Complemento: ${pct}${formatMXN(m.objetivo)}${vence}.`;
    }
```

- [ ] **Step 6: Aviso de disponibilidad en el formulario**

En `apps/web/src/components/QuoteForm.tsx`, la función `AvailabilityBanner` (líneas ~569-620) pierde la rama `'apartada'` y reescribe los textos. Reemplazar el cuerpo completo de la función por:

```tsx
function AvailabilityBanner({
  avail,
  fecha,
}: {
  avail?: SpaceAvailability;
  fecha: string;
}) {
  if (!fecha || !avail) return null;

  if (avail.level === 'bloqueada') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-wine/30 bg-wine/10 px-3 py-2.5 text-sm text-wine">
        <Ban size={16} className="mt-0.5 shrink-0" />
        <span>
          <strong>{avail.nombre}</strong> ya tiene un evento comprometido en esta fecha. No se
          puede cotizar este espacio para el {fecha}.
        </span>
      </div>
    );
  }
  if (avail.level === 'cotizaciones') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-ink/15 bg-ink/5 px-3 py-2.5 text-sm text-ink-500">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>
          Hay {avail.counts.cotizaciones} contrato(s) para <strong>{avail.nombre}</strong> en
          esta fecha, ninguno con pago aún.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-emerald-600/20 bg-emerald-600/5 px-3 py-2.5 text-sm text-emerald-700">
      <CheckCircle2 size={16} className="shrink-0" />
      <span>
        <strong>{avail.nombre}</strong> está disponible el {fecha}.
      </span>
    </div>
  );
}
```

- [ ] **Step 7: Verificar el compilador**

```bash
pnpm typecheck
```

Esperado: 4/4 exitosos. Si quedan errores, son sitios de la lista de la Task 1 Step 6 que faltan; resolverlos aquí.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): etiquetas y colores de los estatus nuevos"
```

---

## Task 8: `spaceId` en las líneas de renta del desglose

**Files:**
- Modify: `packages/shared/src/types.ts:56-62`
- Modify: `packages/shared/src/pricing/engine.ts:51`
- Test: `packages/shared/src/pricing/engine.test.ts`

**Contexto:** para repartir el complemento en proporción a cada espacio hace falta la renta de cada uno. Hoy solo se obtiene parseando el texto del concepto con una expresión regular, en el servicio y en el front.

- [ ] **Step 1: Escribir el test**

Agregar en `packages/shared/src/pricing/engine.test.ts` (usar los helpers de catálogo que ya existen en el archivo):

```ts
  it('las líneas de renta llevan spaceId; las demás no', () => {
    // El catálogo de prueba tiene 'arcos' (201-300) y 'cupula' (50-300): con 250
    // invitados ambos tienen fila de renta.
    const b = computeQuote(catalog, {
      fecha: '2027-05-08',
      invitados: 250,
      spaceIds: ['arcos', 'cupula'],
      horasExtra: 1,
      usaCapilla: false,
      usaDjHoraExtra: false,
      addOns: [],
    });

    const rentas = b.lines.filter((l) => l.spaceId != null);
    expect(rentas).toHaveLength(2);
    expect(rentas.map((l) => l.spaceId).sort()).toEqual(['arcos', 'cupula']);

    const horasExtra = b.lines.find((l) => l.concepto === 'Horas extra')!;
    expect(horasExtra.spaceId).toBeUndefined();
  });
```

Los ids `'arcos'` y `'cupula'` son los que ya usa el `catalog` de prueba definido al
inicio de ese archivo; no hace falta agregar espacios.

- [ ] **Step 2: Correr el test para verlo fallar**

```bash
pnpm --filter @hsa/shared exec vitest run src/pricing/engine.test.ts -t 'spaceId'
```

Esperado: FALLA — `spaceId` no existe en el tipo, el compilador de Vitest lo reporta.

- [ ] **Step 3: Agregar el campo al tipo**

`packages/shared/src/types.ts`:

```ts
export interface QuoteLine {
  concepto: string;
  detalle?: string;
  monto: number;                // por línea; la renta ya trae IVA, las bases no
  ivaIncluido: boolean;
  grupo: QuoteGroup;
  /** Solo en las líneas de renta de espacio: a qué espacio corresponde el monto.
   *  Es el dato que permite repartir el plan de pagos entre varios salones sin
   *  tener que interpretar el texto del concepto. */
  spaceId?: string;
}
```

- [ ] **Step 4: Poblarlo en el motor**

`packages/shared/src/pricing/engine.ts` línea ~51:

```ts
    lines.push({ concepto: `Renta ${spaceId}`, monto: round2(monto), ivaIncluido: true, grupo: 'renta', spaceId });
```

- [ ] **Step 5: Correr los tests del paquete**

```bash
pnpm --filter @hsa/shared run test
```

Esperado: PASA, todos.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): las líneas de renta llevan spaceId"
```

---

## Task 9: Permitir de 1 a 3 espacios

**Files:**
- Modify: `packages/shared/src/schemas.ts:6-11`
- Modify: `apps/api/src/quotes/service.ts:43` y `:53`
- Test: `apps/api/src/quotes/quotes.test.ts`

- [ ] **Step 1: Escribir los tests**

Agregar en `apps/api/src/quotes/quotes.test.ts`. Requiere el id de un segundo y tercer espacio; agregarlos en el `beforeAll` del archivo si no están:

```ts
  it('acepta hasta 3 espacios y suma su renta', async () => {
    const q = await createQuote(
      prisma,
      {
        fecha: '2029-09-15',
        invitados: 250,
        spaceIds: [arcosId, camposId],
        eventTypeId,
        client: { nombre: 'Dos Salones' },
      },
      actor,
    );
    created.push(q.id);
    createdClients.push(q.clientId);

    expect(q.spaceIds).toHaveLength(2);
    const lineasRenta = (q.breakdown as { lines: { spaceId?: string }[] }).lines.filter((l) => l.spaceId);
    expect(lineasRenta).toHaveLength(2);
  });

  it('rechaza más de 3 espacios', async () => {
    await expect(
      createQuote(
        prisma,
        {
          fecha: '2029-09-16',
          invitados: 250,
          spaceIds: [arcosId, camposId, cupulaId, capillaId],
          eventTypeId,
          client: { nombre: 'Cuatro Salones' },
        },
        actor,
      ),
    ).rejects.toThrow();
  });
```

En el `beforeAll`, agregar:

```ts
  const campos = await prisma.space.findFirst({ where: { nombre: 'Jardín Los Campos' } });
  const cupula = await prisma.space.findFirst({ where: { nombre: 'Jardín La Cúpula' } });
  const capilla = await prisma.space.findFirst({ where: { nombre: 'La Capilla' } });
  camposId = campos!.id;
  cupulaId = cupula!.id;
  capillaId = capilla!.id;
```

con sus declaraciones `let camposId: string;` etc. junto a `arcosId`.

- [ ] **Step 2: Correr los tests para verlos fallar**

```bash
pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts -t 'espacios'
```

Esperado: el de 2 espacios FALLA con "Solo se permite un espacio por evento".

- [ ] **Step 3: Poner el tope en el esquema compartido**

`packages/shared/src/schemas.ts`:

```ts
  spaceIds: z
    .array(z.string())
    .min(1)
    .max(3, { message: 'Máximo 3 espacios por evento' })
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'spaceIds no debe tener duplicados',
    }),
```

- [ ] **Step 4: Quitar los refine de un solo espacio en la API**

En `apps/api/src/quotes/service.ts`, borrar la línea 43 completa:

```ts
  .refine((d) => d.spaceIds.length === 1, { message: 'Solo se permite un espacio por evento' });
```

dejando que `createQuoteSchema` termine en el refine de `clientId ?? client`. Y borrar la línea 53, el mismo refine en `updateQuoteSchema`, dejando que termine en el `.extend({...})`.

- [ ] **Step 5: Correr los tests para verlos pasar**

```bash
pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts -t 'espacios'
```

Esperado: PASA los dos.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas.ts apps/api/src/quotes
git commit -m "feat: de 1 a 3 espacios por evento"
```

---

## Task 10: Plan de pagos proporcional con varias reglas

**Files:**
- Modify: `apps/api/src/quotes/estadoCuenta.ts`
- Test: `apps/api/src/quotes/estadoCuenta.test.ts`

- [ ] **Step 1: Escribir los tests, incluida la regresión de un solo espacio**

En `apps/api/src/quotes/estadoCuenta.test.ts`, adaptar el helper de arriba del archivo y agregar los casos. El `rule` suelto pasa a envolverse:

```ts
const ARCOS: SpaceRule = { anticipo: 20000, complementoPct: 0.1, liquidarDiasAntes: 30 };
const CAMPOS: SpaceRule = { anticipo: 15000, complementoPct: 0.15, liquidarDiasAntes: 30 };

// Un solo espacio: la renta base es irrelevante para el resultado porque el peso
// proporcional es 1. Se usa el total para que el caso se lea natural.
const soloArcos = [{ spaceId: 'arcos', rule: ARCOS, rentaBase: 100000 }];
```

Todos los `rule` de los tests existentes pasan a `rules: soloArcos`, y `rule: null` pasa a `rules: null`.

Casos nuevos:

```ts
  it('un solo espacio da el mismo plan que antes del cambio (regresión)', () => {
    const ec = computeEstadoCuenta({ ...base, rules: soloArcos, payments: [] });
    const plan = ec.plan!;
    // anticipo 20000; complemento = 20000 + 10% de 100000 = 30000; finiquito = total
    expect(plan.find((m) => m.key === 'apartar')!.objetivo).toBe(20000);
    expect(plan.find((m) => m.key === 'complemento')!.objetivo).toBe(30000);
    expect(plan.find((m) => m.key === 'complemento')!.porcentaje).toBe(10);
    expect(plan.find((m) => m.key === 'finiquito')!.objetivo).toBe(100000);
  });

  it('dos espacios: el anticipo suma y el complemento se reparte en proporción a la renta', () => {
    // Arcos aporta 60,000 de renta y Campos 40,000 (total 100,000).
    // Anticipo = 20,000 + 15,000 = 35,000.
    // Porcentaje ponderado = 10%×0.6 + 15%×0.4 = 6% + 6% = 12%.
    // Complemento = 35,000 + 12% de 100,000 = 47,000.
    const ec = computeEstadoCuenta({
      ...base,
      rules: [
        { spaceId: 'arcos', rule: ARCOS, rentaBase: 60000 },
        { spaceId: 'campos', rule: CAMPOS, rentaBase: 40000 },
      ],
      payments: [],
    });
    const plan = ec.plan!;
    expect(plan.find((m) => m.key === 'apartar')!.objetivo).toBe(35000);
    expect(plan.find((m) => m.key === 'complemento')!.objetivo).toBe(47000);
    expect(plan.find((m) => m.key === 'complemento')!.porcentaje).toBe(12);
    expect(plan.find((m) => m.key === 'finiquito')!.objetivo).toBe(100000);
  });

  it('si algún espacio no tiene regla, el plan queda pendiente', () => {
    const ec = computeEstadoCuenta({ ...base, rules: null, payments: [] });
    expect(ec.planPendiente).toBe(true);
    expect(ec.plan).toBeNull();
  });

  it('liquidarDiasAntes toma el máximo de los espacios', () => {
    const ec = computeEstadoCuenta({
      ...base,
      rules: [
        { spaceId: 'a', rule: { anticipo: 1000, complementoPct: 0.1, liquidarDiasAntes: 30 }, rentaBase: 50000 },
        { spaceId: 'b', rule: { anticipo: 1000, complementoPct: 0.1, liquidarDiasAntes: 45 }, rentaBase: 50000 },
      ],
      payments: [],
    });
    // Evento 2027-05-08 menos 45 días = 2027-03-24.
    expect(ec.plan!.find((m) => m.key === 'finiquito')!.venceISO).toContain('2027-03-24');
  });
```

- [ ] **Step 2: Correr los tests para verlos fallar**

```bash
pnpm --filter @hsa/api exec vitest run src/quotes/estadoCuenta.test.ts
```

Esperado: FALLA de compilación — `rules` no existe en los argumentos.

- [ ] **Step 3: Cambiar la firma y el cálculo**

En `apps/api/src/quotes/estadoCuenta.ts`, agregar el tipo del envoltorio después de `SpaceRule`:

```ts
/** Regla de un espacio junto con la renta base que aportó, para poder repartir
 *  el complemento en proporción cuando el evento usa más de un salón. */
export interface SpaceRuleWithRent {
  spaceId: string;
  rule: SpaceRule;
  rentaBase: number;
}
```

En la firma de `computeEstadoCuenta`, `rule: SpaceRule | null` pasa a:

```ts
  rules: SpaceRuleWithRent[] | null;
```

Y en el desestructurado, `rule` pasa a `rules`. El guardia de plan pendiente cubre también el arreglo vacío:

```ts
  if (!rules || rules.length === 0) {
    return { total, pagado, saldo, plan: null, planPendiente: true, sugerido: null, desfase: false };
  }
```

Reemplazar el cálculo de los objetivos (líneas ~72-74) por:

```ts
  // Anticipo: cada espacio aporta el suyo (sección H del contrato, por espacio).
  const objApartar = rules.reduce((s, r) => s + r.rule.anticipo, 0);

  // Complemento: el porcentaje de cada espacio pesa según la renta que ese
  // espacio aporta. Con un solo espacio el peso es 1 y la fórmula se reduce
  // exactamente a `pct × total`, idéntica a la de antes del multi-salón.
  const sumRenta = rules.reduce((s, r) => s + r.rentaBase, 0);
  const pctPonderado =
    sumRenta > 0
      ? rules.reduce((s, r) => s + r.rule.complementoPct * (r.rentaBase / sumRenta), 0)
      : // Sin renta base (dato faltante) no hay proporción posible: se toma el
        // porcentaje más alto, que es el criterio conservador para el negocio.
        Math.max(...rules.map((r) => r.rule.complementoPct));

  const objComplemento = objApartar + Math.round(pctPonderado * total);
  const objFiniquito = total;

  // El finiquito más exigente manda cuando los espacios difieren.
  const liquidarDiasAntes = Math.max(...rules.map((r) => r.rule.liquidarDiasAntes));
```

Sustituir el uso de `rule.liquidarDiasAntes` en `finiquitoVence` (línea ~76) por la constante nueva:

```ts
  const finiquitoVence = minusDays(fechaEvento, liquidarDiasAntes);
```

Y en el arreglo `plan`, el porcentaje del complemento sale del ponderado:

```ts
    hito('complemento', 'Complemento', objComplemento, complementoVence?.toISOString() ?? null, Math.round(pctPonderado * 100)),
```

- [ ] **Step 4: Correr los tests para verlos pasar**

```bash
pnpm --filter @hsa/api exec vitest run src/quotes/estadoCuenta.test.ts
```

Esperado: PASA, incluida la regresión de un solo espacio.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/quotes/estadoCuenta.ts apps/api/src/quotes/estadoCuenta.test.ts
git commit -m "feat(api): plan de pagos proporcional con varios espacios"
```

---

## Task 11: Cargar varias reglas desde la base

**Files:**
- Modify: `apps/api/src/quotes/service.ts` (`loadEstadoCuenta`, `QuoteEC`, `loadEstadoCuentaBulk`, `reconcileStatuses`)
- Modify: `apps/api/src/dashboard/service.ts` (el `select` que alimenta el bulk)

- [ ] **Step 1: Agregar el extractor de renta por espacio**

En `apps/api/src/quotes/service.ts`, después de `ownershipWhere`:

```ts
/**
 * Renta base por espacio, leída de las líneas del desglose congelado.
 *
 * Las cotizaciones anteriores al campo `spaceId` no lo traen; en ese caso se
 * reparte la renta en partes iguales entre sus espacios. Como esas cotizaciones
 * tienen exactamente un espacio, el reparto equivale al monto completo, que es
 * el valor correcto.
 */
function rentaBasePorEspacio(breakdown: unknown, spaceIds: string[], rentaTotal: number): Map<string, number> {
  const lines = (breakdown as { lines?: { spaceId?: string; monto?: number }[] } | null)?.lines ?? [];
  const out = new Map<string, number>();
  for (const l of lines) {
    if (l.spaceId && typeof l.monto === 'number') {
      out.set(l.spaceId, (out.get(l.spaceId) ?? 0) + l.monto);
    }
  }
  if (out.size === 0 && spaceIds.length > 0) {
    const parte = rentaTotal / spaceIds.length;
    for (const id of spaceIds) out.set(id, parte);
  }
  return out;
}
```

- [ ] **Step 2: Actualizar `loadEstadoCuenta`**

La firma recibe el desglose, y la carga de reglas pasa a `findMany`:

```ts
export async function loadEstadoCuenta(db: PrismaClient, quote: {
  id: string; rentaTotal: number; fechaEvento: Date; status: string; spaceIds: string[]; breakdown: unknown;
}) {
  const [rules, payments, firstApartado] = await Promise.all([
    db.spacePaymentRule.findMany({ where: { spaceId: { in: quote.spaceIds } } }),
    db.payment.findMany({ where: { quoteId: quote.id }, orderBy: { fecha: 'asc' } }),
    db.activityLog.findFirst({
      // Ver la nota de la Task 3: se aceptan el término nuevo y el legado.
      where: {
        quoteId: quote.id,
        tipo: 'estatus',
        OR: [{ descripcion: { contains: 'formalizada' } }, { descripcion: { contains: 'apartada' } }],
      },
      orderBy: { createdAt: 'asc' }, select: { createdAt: true },
    }),
  ]);

  const rentaBase = rentaBasePorEspacio(quote.breakdown, quote.spaceIds, quote.rentaTotal);
  // Basta que UN espacio no tenga regla para que el plan quede pendiente: no se
  // puede cobrar un plan a medias.
  const completo = quote.spaceIds.length > 0 && rules.length === quote.spaceIds.length;

  const ec = computeEstadoCuenta({
    total: quote.rentaTotal,
    fechaEvento: quote.fechaEvento,
    status: quote.status,
    rules: completo
      ? rules.map((r) => ({
          spaceId: r.spaceId,
          rule: { anticipo: r.anticipo, complementoPct: r.complementoPct, liquidarDiasAntes: r.liquidarDiasAntes },
          rentaBase: rentaBase.get(r.spaceId) ?? 0,
        }))
      : null,
    payments: payments.map((p) => ({ monto: p.monto, anuladoAt: p.anuladoAt })),
    fechaApartado: firstApartado?.createdAt ?? null,
  });
  return { estadoCuenta: ec, payments };
}
```

- [ ] **Step 3: Actualizar `QuoteEC` y `loadEstadoCuentaBulk`**

`QuoteEC` gana el desglose:

```ts
export interface QuoteEC {
  id: string;
  rentaTotal: number;
  fechaEvento: Date;
  status: string;
  spaceIds: string[];
  breakdown: unknown;
}
```

En `loadEstadoCuentaBulk`, los ids de espacio salen de todos los espacios y el bucle final arma las reglas por cotización:

```ts
  const spaceIds = [...new Set(quotes.flatMap((q) => q.spaceIds))];
```

```ts
  for (const q of quotes) {
    const rentaBase = rentaBasePorEspacio(q.breakdown, q.spaceIds, q.rentaTotal);
    const reglas = q.spaceIds.map((id) => ruleBySpace.get(id)).filter(Boolean);
    const completo = q.spaceIds.length > 0 && reglas.length === q.spaceIds.length;
    out.set(
      q.id,
      computeEstadoCuenta({
        total: q.rentaTotal,
        fechaEvento: q.fechaEvento,
        status: q.status,
        rules: completo
          ? reglas.map((r) => ({
              spaceId: r!.spaceId,
              rule: { anticipo: r!.anticipo, complementoPct: r!.complementoPct, liquidarDiasAntes: r!.liquidarDiasAntes },
              rentaBase: rentaBase.get(r!.spaceId) ?? 0,
            }))
          : null,
        payments: pagosByQuote.get(q.id) ?? [],
        fechaApartado: apartadoByQuote.get(q.id) ?? null,
      }),
    );
  }
```

- [ ] **Step 4: Agregar `breakdown` a los `select` y a los llamadores**

Primero, el test de la Task 3 ahora **sí** debe pasar el desglose. En
`apps/api/src/quotes/quotes.test.ts`, en el test `'el complemento tiene fecha de
vencimiento después de formalizar'`, agregar al objeto:

```ts
      breakdown: q.breakdown,
```

Luego, `pnpm typecheck` señala cada llamador al que le falta el campo. Al menos:
- `reconcileStatuses` en `apps/api/src/quotes/service.ts` (~línea 220): agregar `breakdown: true` al `select`.
- `apps/api/src/dashboard/service.ts`: agregar `breakdown: true` a los `select` de cotizaciones que se pasan a `loadEstadoCuentaBulk`.
- `listQuotes` y `getQuote` en `service.ts`, si seleccionan campos explícitamente.

- [ ] **Step 4b: El espacio de la ficha del dashboard muestra todos los salones**

`apps/api/src/dashboard/service.ts` línea ~224 toma solo el primer espacio:

```ts
    const espacio = espacioById.get(q.spaceIds[0] ?? '') ?? '—';
```

Con varios salones eso oculta información en la ficha operativa. Queda:

```ts
    // Un evento puede ocupar hasta 3 salones: se listan todos.
    const espacio = q.spaceIds.map((id) => espacioById.get(id) ?? id).join(' y ') || '—';
```

```bash
pnpm typecheck 2>&1 | grep -A2 "breakdown"
```

Esperado: la lista de llamadores que faltan. Agregar `breakdown: true` en cada uno hasta que el typecheck quede limpio.

- [ ] **Step 5: Correr toda la suite de la API**

```bash
pnpm --filter @hsa/api run test && pnpm typecheck
```

Esperado: tests verdes y typecheck 4/4.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): el estado de cuenta carga la regla de cada espacio del evento"
```

---

## Task 12: `computeAndEnrich` sin expresión regular

**Files:**
- Modify: `apps/api/src/quotes/service.ts:64-79`

- [ ] **Step 1: Reescribir la función usando `spaceId`**

```ts
/** Calcula el desglose y enriquece las líneas de renta con el nombre del espacio. */
async function computeAndEnrich(db: PrismaClient, selection: QuoteSelection) {
  const catalog = await loadCatalog(db);
  const breakdown = computeQuote(catalog, selection);
  const spaces = await db.space.findMany({ where: { id: { in: selection.spaceIds } } });
  const nameById = new Map(spaces.map((s) => [s.id, s.nombre]));
  const enriched = {
    ...breakdown,
    lines: breakdown.lines.map((l) => {
      // `spaceId` viene del motor: no hace falta interpretar el texto del concepto.
      const nombre = l.spaceId ? nameById.get(l.spaceId) : undefined;
      return nombre ? { ...l, concepto: `Renta ${nombre}` } : l;
    }),
  };
  return { breakdown, enriched };
}
```

Nota: `spaceId` se conserva en la línea enriquecida (el `...l` lo arrastra), que es justo lo que `rentaBasePorEspacio` necesita leer después.

- [ ] **Step 2: Verificar que el desglose guardado trae ambos datos**

```bash
pnpm --filter @hsa/api exec vitest run src/quotes/quotes.test.ts -t 'espacios'
```

Esperado: PASA. El test de 2 espacios de la Task 9 ya comprueba que las líneas guardadas traen `spaceId`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/quotes/service.ts
git commit -m "refactor(api): el enriquecido de líneas usa spaceId en vez de regex"
```

---

## Task 13: Formulario con varios espacios y plan proporcional

**Files:**
- Modify: `apps/web/src/components/QuoteForm.tsx`

- [ ] **Step 1: Selección múltiple con tope de 3**

Reemplazar `selectSpace` (líneas ~187-190):

```tsx
  const MAX_ESPACIOS = 3;

  // Hasta 3 espacios por evento (hay graduaciones que juntan salones).
  function toggleSpace(id: string) {
    setSpaceIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_ESPACIOS) return prev;
      return [...prev, id];
    });
  }
```

Y `canSave` (líneas ~183-185):

```tsx
  const canSave = Boolean(
    nombre && eventTypeId && fecha && spaceIds.length >= 1 && spaceIds.length <= MAX_ESPACIOS &&
    breakdown && !calcError && !blocked,
  );
```

- [ ] **Step 2: Etiquetas de las líneas por `spaceId`**

Reemplazar `lineLabel` (líneas ~160-165):

```tsx
  const spaceNameById = new Map(catalog.spaces.map((s) => [s.id, s.nombre]));
  const lineLabel = (line: QuoteLine): string => {
    const nombre = line.spaceId ? spaceNameById.get(line.spaceId) : undefined;
    return nombre ? `Renta ${nombre}` : line.concepto;
  };
```

Agregar `QuoteLine` al import de `@hsa/shared` en la primera línea del archivo:

```tsx
import { computeQuote, type QuoteBreakdown, type QuoteLine } from '@hsa/shared';
```

La llamada `<BreakdownGrouped breakdown={breakdown} lineLabel={lineLabel} />` no cambia,
pero **sí cambia la firma en `apps/web/src/components/BreakdownGrouped.tsx`**, en tres
lugares. En `Props`:

```tsx
interface Props {
  breakdown: QuoteBreakdown;
  /** Reetiqueta conceptos usando la línea completa (p. ej. usando `spaceId` para
   *  poner "Renta Salón Los Arcos" en vez de "Renta <id>"). */
  lineLabel?: (line: QuoteLine) => string;
}
```

En `BloqueProps`:

```tsx
  lineLabel: (line: QuoteLine) => string;
```

En la firma de `Plano` y en el valor por omisión de `BreakdownGrouped`:

```tsx
function Plano({ breakdown, lineLabel }: { breakdown: QuoteBreakdown; lineLabel: (line: QuoteLine) => string }) {
```

```tsx
export function BreakdownGrouped({ breakdown, lineLabel = (l) => l.concepto }: Props) {
```

Y las tres invocaciones `{lineLabel(l.concepto)}` (una en `Bloque`, una en `Plano`) pasan a:

```tsx
              {lineLabel(l)}
```

Buscar cualquier otro llamador de `BreakdownGrouped` que pase `lineLabel` y ajustarlo:

```bash
grep -rn "lineLabel" apps/web/src
```

- [ ] **Step 3: Preview del plan con varias reglas**

Reemplazar el `useMemo` del plan (líneas ~145-158). Replica la fórmula de `computeEstadoCuenta` para que el preview y el servidor coincidan:

```tsx
  // Preview del plan de pago. Se calcula sobre la RENTA (lo único que cobra y
  // rastrea HSA) y replica la fórmula del servidor: los anticipos se suman y el
  // porcentaje del complemento pesa según la renta que aporta cada espacio.
  const plan = useMemo(() => {
    if (!breakdown || spaceIds.length === 0) return null;
    const reglas = spaceIds.map((id) => catalog.spaces.find((s) => s.id === id)?.paymentRule ?? null);
    if (reglas.some((r) => !r)) return null; // un espacio sin regla ⇒ plan pendiente

    const rentaPorEspacio = new Map<string, number>();
    for (const l of breakdown.lines) {
      if (l.spaceId) rentaPorEspacio.set(l.spaceId, (rentaPorEspacio.get(l.spaceId) ?? 0) + l.monto);
    }
    const sumRenta = [...rentaPorEspacio.values()].reduce((s, v) => s + v, 0);

    const base = Math.round(breakdown.rentaTotal);
    const apartar = reglas.reduce((s, r) => s + r!.anticipo, 0);
    const pct =
      sumRenta > 0
        ? spaceIds.reduce((s, id, i) => s + reglas[i]!.complementoPct * ((rentaPorEspacio.get(id) ?? 0) / sumRenta), 0)
        : Math.max(...reglas.map((r) => r!.complementoPct));
    const formalizar = Math.round(pct * base);
    const liquidacion = base - apartar - formalizar;

    const dias = Math.max(...reglas.map((r) => r!.liquidarDiasAntes));
    const liqFecha = fecha ? new Date(`${fecha}T00:00:00.000Z`) : null;
    if (liqFecha) liqFecha.setUTCDate(liqFecha.getUTCDate() - dias);
    return { apartar, formalizar, liquidacion, liqFecha, dias };
  }, [breakdown, spaceIds, catalog.spaces, fecha]);
```

En el bloque que lo pinta (línea ~540), la etiqueta pierde "(formalizar)":

```tsx
                        <span className="text-charcoal-soft">Complemento</span>
```

- [ ] **Step 4: Verificar el compilador**

```bash
pnpm typecheck
```

Esperado: 4/4 exitosos.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): hasta 3 espacios en el formulario con plan proporcional"
```

---

## Task 14: Colores de disponibilidad en el selector

**Files:**
- Modify: `apps/web/src/components/QuoteForm.tsx`

- [ ] **Step 1: Consultar la disponibilidad de todos los espacios**

Reemplazar el bloque de la consulta (líneas ~167-181). Pide el catálogo completo en una sola llamada:

```tsx
  // Disponibilidad de TODOS los espacios en la fecha (global, todo el equipo de
  // ventas), en una sola llamada: así el selector puede pintarse con colores sin
  // que haya que hacer clic para descubrir que un salón está ocupado.
  const todosLosEspacios = catalog.spaces.map((s) => s.id).join(',');
  const { data: availability } = useQuery({
    queryKey: ['availability', fecha, todosLosEspacios, excludeQuoteId],
    queryFn: () =>
      api.get<Availability>(
        `/api/availability?fecha=${fecha}&spaceIds=${todosLosEspacios}` +
          (excludeQuoteId ? `&excludeQuoteId=${excludeQuoteId}` : ''),
      ),
    enabled: Boolean(fecha && todosLosEspacios),
  });

  const availBySpace = useMemo(
    () => new Map((availability?.spaces ?? []).map((s) => [s.spaceId, s])),
    [availability],
  );
  // OJO: `blocked` se mide SOLO sobre los espacios seleccionados. Si se usara el
  // `blocked` global de la respuesta, cualquier fecha con un evento en cualquier
  // salón impediría guardar.
  const blocked = spaceIds.some((id) => availBySpace.get(id)?.level === 'bloqueada');
  const capillaEventos = availability?.capillaEventos ?? [];
```

- [ ] **Step 2: Pintar los botones**

Reemplazar el bloque del selector (líneas ~315-336):

```tsx
        <Card className="space-y-3 p-6">
          <h2 className="font-display text-xl text-ink">Espacio</h2>
          <p className="-mt-1 text-xs text-charcoal-soft">
            Hasta {MAX_ESPACIOS} espacios por evento. {fecha ? 'El color indica la disponibilidad.' : 'Elige la fecha para ver disponibilidad.'}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {catalog.spaces.map((s) => {
              const active = spaceIds.includes(s.id);
              const av = fecha ? availBySpace.get(s.id) : undefined;
              const ocupado = av?.level === 'bloqueada';
              const topeAlcanzado = !active && spaceIds.length >= MAX_ESPACIOS;

              const estado = !av
                ? 'border-ink/12 bg-white/50 text-charcoal hover:border-ink/30'
                : av.level === 'bloqueada'
                  ? 'border-wine/30 bg-wine/10 text-wine/70 line-through'
                  : av.level === 'cotizaciones'
                    ? 'border-amber-500/40 bg-amber-500/10 text-charcoal hover:border-amber-500/70'
                    : 'border-emerald-600/30 bg-emerald-600/5 text-charcoal hover:border-emerald-600/60';

              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={ocupado || topeAlcanzado}
                  onClick={() => toggleSpace(s.id)}
                  title={
                    ocupado
                      ? `${s.nombre} ya tiene un evento comprometido el ${fecha}`
                      : topeAlcanzado
                        ? `Máximo ${MAX_ESPACIOS} espacios`
                        : undefined
                  }
                  className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors disabled:cursor-not-allowed ${
                    active ? 'border-gold bg-gold/10 text-ink' : estado
                  } ${topeAlcanzado && !ocupado ? 'opacity-50' : ''}`}
                >
                  <span className="font-medium">{s.nombre}</span>
                  <span className="text-right text-xs">
                    {ocupado ? (
                      <span className="text-wine">
                        {av!.quotes[0]?.cliente ? `apartado · ${av!.quotes[0]!.cliente}` : 'apartado'}
                      </span>
                    ) : av?.level === 'cotizaciones' ? (
                      <span className="text-amber-700">{av.counts.cotizaciones} cotización(es)</span>
                    ) : (
                      s.capacidadMax && <span className="text-charcoal-soft">hasta {s.capacidadMax}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {spaceIds.map((id) => (
            <AvailabilityBanner key={id} avail={availBySpace.get(id)} fecha={fecha} />
          ))}
```

El resto de la tarjeta (capilla, cortesía familiar) queda igual. Quitar la línea suelta `<AvailabilityBanner avail={avail} fecha={fecha} />` que había antes y la variable `avail` que ya no se usa.

- [ ] **Step 3: Agregar una leyenda de colores**

Justo debajo del `grid` de botones:

```tsx
          {fecha && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-charcoal-soft">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />Disponible</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" />Con cotizaciones</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-wine" />Apartado</span>
            </div>
          )}
```

- [ ] **Step 4: Verificar el compilador**

```bash
pnpm typecheck
```

Esperado: 4/4 exitosos.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/QuoteForm.tsx
git commit -m "feat(web): colores de disponibilidad en el selector de espacios"
```

---

## Task 15: Contrato con varios espacios

**Files:**
- Modify: `apps/web/src/pages/ContratoPage.tsx`

- [ ] **Step 1: Cargar el catálogo (para las reglas por espacio)**

`ContratoPage` hoy solo consulta la cotización. Para poner el anticipo y el porcentaje de
cada salón hace falta el catálogo. La clave `['catalog']` ya está en la caché de
TanStack Query porque otras pantallas la piden, así que no añade una petición real.

Agregar debajo de la consulta existente (línea ~19):

```tsx
  const catalogQ = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<Catalog>('/api/catalog'),
  });
```

Y al import de tipos (línea 7):

```tsx
import type { QuoteDetail, Catalog } from '../lib/types.ts';
```

- [ ] **Step 2: Nombrar todos los espacios en la cláusula B**

Reemplazar `espacioNombre` (líneas ~44-45), que hoy saca el nombre del texto del primer
concepto de renta, por una lista construida con `spaceId`:

```tsx
  const espaciosById = new Map((catalogQ.data?.spaces ?? []).map((s) => [s.id, s.nombre]));
  // Nombres de los espacios del evento. Se prefiere `spaceId` de las líneas; si el
  // desglose es anterior a ese campo, se usa el texto del concepto como respaldo.
  const nombresEspacios = quote.spaceIds.length > 0
    ? quote.spaceIds.map((id) => espaciosById.get(id) ?? id)
    : rentaLines
        .filter((l) => l.concepto.startsWith('Renta '))
        .map((l) => l.concepto.replace('Renta ', ''));
  const espacioNombre = nombresEspacios.length > 0 ? nombresEspacios.join(' y ') : BLANK;
```

`espacioNombre` conserva su nombre, así que la cláusula B de la línea ~126 no cambia.

- [ ] **Step 3: Un renglón por salón en la tabla de pagos de la página 3**

Reemplazar el `<tbody>` de un solo renglón (líneas ~239-251) por uno con un renglón por
espacio más un renglón de totales. Los renglones por espacio muestran el anticipo y el
porcentaje **de ese salón** (de su `paymentRule`); el renglón de totales muestra los montos
del plan, que son los que realmente se cobran:

```tsx
              <tbody>
                {quote.spaceIds.map((id) => {
                  const regla = catalogQ.data?.spaces.find((s) => s.id === id)?.paymentRule;
                  return (
                    <tr key={id}>
                      <td>{espaciosById.get(id) ?? id}</td>
                      <td>{regla ? formatMXNCents(regla.anticipo) : 'por definir'}</td>
                      <td>{regla ? `${Math.round(regla.complementoPct * 100)}% de su renta` : 'por definir'}</td>
                      <td />
                    </tr>
                  );
                })}
                <tr>
                  <td><b>{quote.spaceIds.length > 1 ? 'Total del evento' : 'Total'}</b></td>
                  <td><b>{hitoApartar ? formatMXNCents(hitoApartar.objetivo) : '—'}</b></td>
                  <td>
                    <b>
                      {hitoComplemento?.porcentaje != null ? `${hitoComplemento.porcentaje}% sobre el total = ` : ''}
                      {hitoComplemento ? formatMXNCents(hitoComplemento.objetivo) : '—'}
                    </b>
                  </td>
                  <td>
                    {hitoFiniquito ? formatMXNCents(hitoFiniquito.objetivo) : '—'}, cubierto{' '}
                    {hitoFiniquito?.venceISO ? `el ${formatEventDate(hitoFiniquito.venceISO, 'long')}` : '30 días antes del evento'}.
                  </td>
                </tr>
              </tbody>
```

- [ ] **Step 4: Verificar el compilador**

```bash
pnpm typecheck
```

Esperado: 4/4 exitosos.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ContratoPage.tsx
git commit -m "feat(web): el contrato lista los espacios del evento"
```

---

## Task 16: Cierre y verificación en navegador

- [ ] **Step 1: Suite completa y typecheck**

```bash
pnpm typecheck && pnpm test
```

Esperado: typecheck 4/4; todos los tests verdes. Los tests nuevos suman ~10 a los ~55 previos.

- [ ] **Step 2: Reseñar los estatus de la base de desarrollo**

```bash
pnpm --filter @hsa/api exec tsx src/scripts/reconcile-statuses.ts
```

Esperado: corre sin error. Confirma que la reconciliación sigue funcionando con los nombres nuevos.

- [ ] **Step 3: Levantar la aplicación**

Usar la configuración `hsa-web` de `Projects/.claude/launch.json` (web en el puerto 5273) y arrancar la API. Entrar con `admin@haciendasanandres.com.mx` / `admin1234`.

- [ ] **Step 4: Verificar en el navegador**

Recorrer y confirmar cada punto:

1. **Colores del selector:** elegir una fecha con un evento formalizado. El salón ocupado se ve rojo, tachado y no se puede seleccionar; uno con solo cotizaciones se ve ámbar con el conteo; el resto verde. La leyenda aparece.
2. **Multi-salón:** crear un evento con Arcos y Campos. El desglose muestra dos líneas de renta con los nombres de los salones. El plan de pagos sugerido muestra el anticipo sumado; verificarlo a mano contra la fórmula.
3. **Tope de 3:** al llegar a 3 espacios, los demás se deshabilitan.
4. **Estatus:** registrar un pago del anticipo y confirmar que el evento pasa a "Formalizada". Registrar el complemento y confirmar "Complemento cubierto". En ningún lado aparece la palabra "formalizar" pegada al complemento.
5. **Bloqueo real:** con un evento formalizado, intentar guardar otro en el mismo salón y fecha. El botón está deshabilitado y, si se fuerza por la API, responde 409.
6. **Agenda:** los chips de eventos formalizados se ven azules y los de complemento cubierto blancos con contorno. La leyenda dice "Formalizada" y "Complemento cubierto".
7. **Lista:** las cuatro secciones tienen los nombres nuevos y cada evento cae en la correcta.
8. **Contrato:** generar el contrato de un evento con dos salones. Ambos nombres aparecen y la tabla de pagos de la página 3 tiene un renglón por salón.

- [ ] **Step 5: Commit final si hubo ajustes de la verificación**

```bash
git add -A && git commit -m "fix: ajustes de la verificación en navegador del Plan A"
```

- [ ] **Step 6: Reportar al usuario**

Resumir: qué se construyó, resultado de tests y typecheck, qué se verificó en navegador, y que la rama `feat/planA-estatus-multisalon` está lista para revisar. **No mergear ni pushear sin autorización.** Recordar que la cuenta activa de `gh` debe ser `SinergIA-cun` para pushear.

---

## Notas para quien implemente

**El renombrado del enum es el riesgo principal, y el compilador NO lo cubre por completo.**
`QuoteStatus` es un tipo unión y los `Record<QuoteStatus, …>` de `status.ts` obligan a cubrir
casi todos los casos, pero se verificaron **tres agujeros donde un literal viejo sobrevive en
silencio**:

1. **Búsquedas por texto en la bitácora** (`descripcion: { contains: 'apartada' }`) —
   Task 3. Es la más peligrosa porque rompe un cálculo sin fallar.
2. **`EVENTOS` / `CONFIRMADOS` del dashboard**, que se castean a `readonly string[]` antes
   del `.includes()` — Task 4 Step 4.
3. **`['apartada', …].includes(quote.status)` de `EditQuotePage`**, un arreglo sin `as const`
   cuyo `.includes()` no se comprueba contra la unión — Task 7 Step 5.

Por eso la Task 4 incluye un `grep` explícito de literales viejos: typecheck limpio **no**
es prueba de que el renombrado esté completo.

**La regresión de un solo espacio es la prueba que importa** en la Task 10. Si esa falla, la fórmula proporcional está mal y todas las cotizaciones existentes cambiarían de plan de pagos.

**El `blocked` del formulario se mide solo sobre los espacios seleccionados.** Es el error fácil de la Task 14: usar el `blocked` global de la respuesta haría imposible guardar en cualquier fecha que tenga algún evento en cualquier salón.

**Ningún desglose existente se reescribe.** El plan solo cambia cómo se calculan los nuevos y cómo se lee el plan de pagos de los viejos.

**No hay import circular en la Task 6.** `quotes/service.ts` importa de
`availability/service.ts`, y ese archivo solo depende del cliente de Prisma. La dirección
inversa no existe (lo que sí importa `quotes/service.js` es el *test* de disponibilidad, que
no cuenta). Si en el futuro `availability/service.ts` necesitara algo de cotizaciones, habría
que extraer el tipo compartido en lugar de cerrar el ciclo.

**Los tests de integración comparten una base de datos.** Cada test nuevo usa su propia
fecha de 2029 y limpia lo que crea en el `afterAll`. Reutilizar una fecha de otro test hace
que el bloqueo del servidor de la Task 6 los tumbe entre sí de forma difícil de diagnosticar.
