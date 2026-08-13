# Plan E · Tramo 2 · Editar el catálogo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un admin pueda editar todo lo que hay dentro de un catálogo —precios de renta, servicios, paquetes de alimentos, precios del DJ y parámetros— y que al hacerlo sobre un catálogo ya en uso vea **cuántas cotizaciones y de qué estatus** puede represiar, con el cambio registrado en una bitácora propia.

**Architecture:** El tramo 1 dejó el catálogo versionado y casado a cada cotización. Este tramo abre la edición de su contenido. Todo pasa por un mismo mecanismo de impacto y auditoría, porque el riesgo es idéntico en las cinco superficies: editar el precio de algo que una cotización ya trae la represia al reeditarse.

**Tech Stack:** pnpm + Turbo, Fastify 5, Prisma 6 + Postgres (docker `hsa-postgres`, puerto 5434), React 18 + Vite 6 + Tailwind 4 + TanStack Query, Vitest.

---

## Decisiones del dueño (no volver a preguntar)

1. **Se permite editar cualquier catálogo, incluido uno en uso**, siempre que sea admin, con aviso de cuántas cotizaciones puede afectar y registro en bitácora. Le planteé bloquear la edición en uso y eligió la flexibilidad a conciencia.
2. **En la matriz de renta solo se editan los precios existentes.** No se agregan ni se quitan rangos de invitados. Un hueco en los rangos hace que el motor lance `no tiene rango de renta para N invitados`, y esa puerta se queda cerrada.
3. Servicios y paquetes de alimentos **sí** se pueden agregar y quitar: es el caso del banquetero que cambia.

## Lo que este tramo NO debe romper

El invariante del tramo 1: **una cotización nunca cambia de precio sola.** Editar un catálogo NO reescribe el `total` ni el `breakdown` de ninguna cotización existente — esos quedan congelados. El represiado solo ocurre si alguien reedita la cotización después. El aviso existe para que quien edita lo sepa; la bitácora, para que se pueda reconstruir después.

Hay un test del tramo 1 que vigila el corazón de esto (`casamiento con el catálogo > reeditar usa el catálogo FIJADO`). **No se toca ni se debilita.**

## Reglas de la rama (heredadas de los planes A–E1)

- **`git commit --amend` está PROHIBIDO.**
- Tests de API con `fileParallelism: false`. **No correr dos suites de API a la vez.**
- `pnpm --filter X test -- nombre` **NO filtra** (pnpm se come el `--`): es `pnpm --filter X test nombre`.
- Nada de archivos de trabajo en la raíz del repo; usa el scratchpad.
- Postgres de pruebas: Docker, puerto **5434**, contenedor `hsa-postgres`, usuario/base `hsa`.
- `apps/api/dist/` está versionado con `.d.ts` viejos que contaminan los greps. Ignóralo.

### Gotchas de migración, verificados en este repo

- `prisma migrate dev` **reintroduce en cada diff** el bloque de deriva `DROP SEQUENCE "client_ref_seq"` / `DROP SEQUENCE "recibo_folio_seq"`. **Bórralo a mano**: romper `recibo_folio_seq` mata el folio de los recibos.
- El comando necesita `dotenv -e ../../.env` para ver `DATABASE_URL`.
- `migrate dev` **se niega de entrada** en sesión no interactiva cuando el diff implica pérdida de datos. Para eso: `prisma migrate diff --from-url … --to-schema-datamodel … --script` y aplicar con `migrate deploy`.
- **Una copia de datos NO puede ir en un backfill de TS si una migración posterior borra la columna de origen**: el `CMD` del Dockerfile corre `migrate:deploy` completo **antes** de todos los backfills. La copia tiene que ser ella misma una migración SQL. (Este tramo no borra columnas, pero la regla aplica si aparece.)
- **Postgres TRUNCA los flotantes en columnas `Int`**, no redondea: `5.5 → 5`, `3165.5 → 3165`, sin error ni aviso. Todo precio calculado necesita `Math.round` explícito.

### Símbolos reales (no inventar)

- `Actor` y `ownershipWhere` se exportan de `apps/api/src/quotes/service.ts`. **No existe `apps/api/src/auth/types.ts`.**
- `app.prisma`, no `app.db`. `req.user as Actor`, no `req.actor`. Papelera es `deletedAt`. Rol de vendedor: `ventas`. `requireAdmin` en `apps/api/src/auth/plugin.ts`.
- `logActivity` está en `apps/api/src/quotes/activityLog.ts`, **traga sus errores (`catch {}`)**, y `LogTipo` es unión de TS **y** enum `ActivityType` de Postgres. **`ActivityLog.quoteId` es OBLIGATORIO**, así que un cambio de catálogo NO cabe ahí: este plan crea su propia bitácora.
- Helpers de test en `apps/api/src/quotes/quotes.test.ts`: cliente `prisma`, actor admin en la variable de módulo **`actor`**, `ids()`, `authCookies()`, y `createdQuoteIds`/`createdClientIds` para limpieza. **No existe `entradaValida()` ni `adminActor`.** Para un usuario `ventas`, el patrón está resuelto en `payments.test.ts`.
- Servicios del tramo 1 en `apps/api/src/pricelists/service.ts`: `clonarCatalogo`, `activarCatalogo`, `listarCatalogos`, y el helper `conIncremento`.
- La pantalla es `apps/web/src/components/admin/CatalogosSection.tsx`, montada desde `apps/web/src/pages/AdminPage.tsx`. **No existe `apps/web/src/pages/admin/`.**
- Los tests que creen catálogos deben limpiarlos y **restaurar el activo por id**, y usar nombres con sufijo único por corrida (el `nombre` es `@unique` y una corrida abortada envenena la siguiente).

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `packages/database/prisma/schema.prisma` | Modelo `PriceListAudit` |
| `apps/api/src/pricelists/impacto.ts` (nuevo) | Cuántas cotizaciones cuelgan de un catálogo, desglosadas por estatus |
| `apps/api/src/pricelists/audit.ts` (nuevo) | Escribir y leer la bitácora del catálogo |
| `apps/api/src/pricelists/editar.ts` (nuevo) | Las cinco mutaciones: rentas, servicios, paquetes, dj, parámetros |
| `apps/api/src/pricelists/routes.ts` | Rutas nuevas bajo `/admin/price-lists/:id/*` |
| `apps/web/src/components/admin/CatalogoEditor.tsx` (nuevo) | Editor del contenido de un catálogo |
| `apps/web/src/components/admin/AvisoImpacto.tsx` (nuevo) | El aviso con el desglose por estatus |
| `apps/web/src/components/admin/CatalogosSection.tsx` | Enlace a "Editar" por catálogo |

---

## Task 1: Bitácora del catálogo e impacto

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migración
- Create: `apps/api/src/pricelists/impacto.ts`, `apps/api/src/pricelists/audit.ts`
- Create: `apps/api/src/pricelists/impacto.test.ts`

- [ ] **Step 1: Modelo**

```prisma
/// Bitácora de cambios AL CONTENIDO de un catálogo. Separada de `ActivityLog`
/// porque esa exige `quoteId` y un cambio de catálogo no pertenece a ninguna
/// cotización — pertenece a todas las que cuelgan de él.
model PriceListAudit {
  id          String    @id @default(cuid())
  priceList   PriceList @relation(fields: [priceListId], references: [id])
  priceListId String
  /// "renta" | "servicio" | "paquete" | "dj" | "parametros"
  tipo        String
  descripcion String
  meta        Json?
  actor       User?     @relation("PriceListAuditActor", fields: [actorId], references: [id])
  actorId     String?
  /// Cuántas cotizaciones estaban casadas a este catálogo AL MOMENTO del cambio.
  /// Se guarda el número entonces, no se recalcula después: es la medida real de
  /// lo que quien editó puso en riesgo, y cambiaría si se leyera hoy.
  cotizacionesEnRiesgo Int @default(0)
  createdAt   DateTime  @default(now())

  @@index([priceListId, createdAt])
}
```

`PriceList` gana `auditoria PriceListAudit[]`; `User` gana `priceListAudits PriceListAudit[] @relation("PriceListAuditActor")`.

- [ ] **Step 2: Test del impacto**

```ts
describe('impacto de editar un catálogo', () => {
  it('cuenta las cotizaciones vivas por estatus y excluye la papelera', async () => {
    const cat = await prisma.priceList.findFirstOrThrow({ where: { activa: true } });
    const imp = await impactoDeCatalogo(prisma, cat.id);
    expect(imp.total).toBeGreaterThanOrEqual(0);
    expect(typeof imp.porEstatus).toBe('object');
    // La papelera no cuenta: reeditar una cotización borrada no le importa a nadie.
    expect(Object.values(imp.porEstatus).reduce((s, n) => s + n, 0)).toBe(imp.total);
  });

  it('separa las comprometidas, que son las que de verdad duelen', async () => {
    const cat = await prisma.priceList.findFirstOrThrow({ where: { activa: true } });
    const imp = await impactoDeCatalogo(prisma, cat.id);
    // formalizada + complementada + liquidada
    expect(imp.comprometidas).toBeLessThanOrEqual(imp.total);
  });

  it('un catálogo recién clonado tiene impacto cero', async () => {
    const base = await prisma.priceList.findFirstOrThrow({ where: { activa: true } });
    const clon = await clonarCatalogo(prisma, { nombre: `IMPACTO-${Date.now()}`, anio: 2090, clonarDe: base.id });
    try {
      const imp = await impactoDeCatalogo(prisma, clon.id);
      expect(imp.total).toBe(0);
      expect(imp.comprometidas).toBe(0);
    } finally {
      await borrarCatalogoDePrueba(prisma, clon.id);
    }
  });

  it('un catálogo inexistente da 404', async () => {
    await expect(impactoDeCatalogo(prisma, 'no-existe')).rejects.toMatchObject({ status: 404 });
  });
});
```

> `Date.now()` en el nombre está bien aquí (es un test, no un script de workflow).
> `borrarCatalogoDePrueba` es un helper que tú escribes: borra en orden
> `DjHoraExtraPrice`, `RentalPrice`, brackets, `FoodPackage`, `AddOn`, `PriceListAudit`
> y al final la `PriceList`. Los FK son RESTRICT: el orden importa.

- [ ] **Step 3: Correr y confirmar que falla**

Run: `pnpm --filter @hsa/api test impacto`

- [ ] **Step 4: Implementar `impactoDeCatalogo`**

Devuelve `{ total, comprometidas, porEstatus: Record<string, number> }`, contando `Quote` con ese `priceListId` y `deletedAt: null`, agrupadas por `status`. `comprometidas` suma `formalizada`, `complementada` y `liquidada` — que son las que ya tienen dinero encima. Lanza `QuoteError(404)` si el catálogo no existe.

- [ ] **Step 5: Implementar `registrarCambioCatalogo`**

`registrarCambioCatalogo(db, { priceListId, tipo, descripcion, meta }, actor)` que **calcula el impacto y guarda `cotizacionesEnRiesgo` con él**. A diferencia de `logActivity`, **esta NO traga sus errores**: si la bitácora no se puede escribir, el cambio no se hace. Es un cambio de precios; un rastro perdido aquí no es aceptable.

- [ ] **Step 6: Correr, y commit**

```bash
git add packages/database/prisma/ apps/api/src/pricelists/
git commit -m "feat(api): bitácora del catálogo y medida de impacto por estatus"
```

---

## Task 2: Editar los precios de renta

**Files:**
- Create: `apps/api/src/pricelists/editar.ts`
- Modify: `apps/api/src/pricelists/routes.ts`
- Create: `apps/api/src/pricelists/editar.test.ts`

- [ ] **Step 1: Tests**

```ts
describe('editar precios de renta', () => {
  it('actualiza los cuatro precios de un renglón y no toca los demás', async () => {
    /* … editarRentas con un renglón; verificar el editado y uno vecino sin cambio … */
  });

  it('rechaza precios negativos o no enteros', async () => {
    /* 400 en -1 y en 1234.5 — Postgres TRUNCA los flotantes sin avisar */
  });

  it('rechaza un renglón que no pertenece al catálogo', async () => {
    /* 400/404: pasar el id de un RentalPrice de OTRO catálogo no debe editarlo */
  });

  it('NO reescribe el total ni el breakdown de las cotizaciones existentes', async () => {
    /* Crear cotización, editar la renta de su catálogo al doble,
       y verificar que quote.total y quote.breakdown quedaron IDÉNTICOS.
       Este test es el guardián del invariante del tramo 1. */
  });

  it('queda en la bitácora con el impacto del momento', async () => {
    /* un renglón en PriceListAudit con tipo 'renta' y cotizacionesEnRiesgo > 0 */
  });

  it('solo admin', async () => {
    /* 403 con cookie de ventas */
  });
});
```

> El cuarto test es el más importante del tramo. Si falla, editar un catálogo
> está reescribiendo cotizaciones y el invariante murió.

- [ ] **Step 2: Correr y confirmar que fallan**

- [ ] **Step 3: Implementar**

`editarRentas(db, priceListId, cambios, actor)` donde `cambios` es `{ id, viernes, viernesEspecial, sabado, domAJue }[]`. En una transacción: verificar que **cada** id pertenezca al catálogo (si no, 400), aplicar, y registrar en bitácora con `tipo: 'renta'` y meta con los ids y los valores antes/después. Esquema Zod con `z.number().int().nonnegative()` en los cuatro precios.

- [ ] **Step 4: Ruta**

`PATCH /admin/price-lists/:id/rentas` con `requireAdmin`.

- [ ] **Step 5: Correr la suite completa de la API, y commit**

```bash
git commit -m "feat(api): editar los precios de renta de un catálogo"
```

---

## Task 3: Servicios — alta, baja y edición

**Files:**
- Modify: `apps/api/src/pricelists/editar.ts`, `routes.ts`, `editar.test.ts`

- [ ] **Step 1: Tests**

```ts
describe('servicios del catálogo', () => {
  it('agrega un servicio al catálogo, no a los demás', async () => {});
  it('edita nombre, precio y tipo de cobro', async () => {});
  it('desactivar lo saca del selector pero el catálogo lo sigue resolviendo', async () => {
    /* Es la lección del PR #2: `activo: false` NO puede desaparecer del catálogo,
       o las cotizaciones que lo traen quedan irrecalculables. */
  });
  it('borrar un servicio EN USO responde 409 y no lo borra', async () => {
    /* Contar Quote.addOns de ese catálogo. El add-on de admin ya tenía esta
       guarda para el borrado duro; aquí se conserva. */
  });
  it('borrar un servicio sin uso sí lo borra', async () => {});
  it('rechaza precio negativo o no entero', async () => {});
  it('solo admin', async () => {});
});
```

- [ ] **Step 2: Correr, implementar, correr**

`POST/PATCH/DELETE /admin/price-lists/:id/servicios[/:addOnId]`. El `DELETE` cuenta el uso en `Quote.addOns` de las cotizaciones de **ese** catálogo y responde 409 con el número si hay. Bitácora `tipo: 'servicio'`.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(api): alta, baja y edición de servicios por catálogo"
```

---

## Task 4: Paquetes de alimentos — alta, baja y brackets

**Files:**
- Modify: `apps/api/src/pricelists/editar.ts`, `routes.ts`, `editar.test.ts`

- [ ] **Step 1: Tests**

```ts
describe('paquetes de alimentos del catálogo', () => {
  it('crea un paquete con sus brackets', async () => {});
  it('un paquete sin brackets no se puede crear', async () => {
    /* 400: un paquete sin precio hace que el motor lance
       "no tiene rango para N invitados" al primer uso. */
  });
  it('los brackets no se traslapan ni dejan hueco', async () => {
    /* 400 si [50,100] y [90,200]; 400 si [50,100] y [150,200] */
  });
  it('edita el precio por persona de un bracket', async () => {});
  it('borrar un paquete EN USO responde 409', async () => {
    /* Contar Quote.foodPackageId */
  });
  it('respeta el eventTypeId: un paquete es de un tipo de evento', async () => {});
  it('solo admin', async () => {});
});
```

> El tercer test es de negocio, no de estilo: un hueco entre brackets es una
> cotización que revienta meses después, cuando alguien capture ese número de
> invitados.

- [ ] **Step 2: Correr, implementar, correr**

`POST/PATCH/DELETE /admin/price-lists/:id/paquetes[/:packageId]`. La validación de brackets es una **función pura en `packages/shared`** con sus propios tests: es una regla de negocio, no de transporte. Bitácora `tipo: 'paquete'`.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(api): alta, baja y edición de paquetes de alimentos por catálogo"
```

---

## Task 5: DJ y parámetros

**Files:**
- Modify: `apps/api/src/pricelists/editar.ts`, `routes.ts`, `editar.test.ts`

- [ ] **Step 1: Tests**

```ts
describe('DJ y parámetros del catálogo', () => {
  it('edita el precio del DJ de un tipo de evento', async () => {});
  it('quitar el renglón del DJ deja de cobrarlo en ese tipo de evento', async () => {
    /* Es cómo se apaga el servicio: sin renglón, no se ofrece. */
  });
  it('edita IVA, hora extra, descuento de alimentos y capilla en sábado', async () => {});
  it('rechaza tasas fuera de 0..1', async () => {
    /* Un IVA de 16 en vez de 0.16 multiplica todo por 100. */
  });
  it('los parámetros son del catálogo, no globales', async () => {
    /* Editar los de 2028 no toca los de 2027 */
  });
  it('solo admin', async () => {});
});
```

- [ ] **Step 2: Correr, implementar, correr**

`PATCH /admin/price-lists/:id/dj` y `PATCH /admin/price-lists/:id/parametros`. Bitácora `tipo: 'dj'` y `'parametros'`.

- [ ] **Step 3: Retirar la sección de Configuración vieja**

`/admin/config` edita los parámetros **del catálogo activo**, lo que ahora es un segundo camino al mismo dato y la clase de duplicidad que este plan entero vino a eliminar. Se retira la sección de la interfaz y el endpoint, y los parámetros se editan solo desde el catálogo. Ajustar `admin.test.ts`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(api): editar el DJ y los parámetros por catálogo; retirar /admin/config"
```

---

## Task 6: El editor en la interfaz

**Files:**
- Create: `apps/web/src/components/admin/CatalogoEditor.tsx`, `AvisoImpacto.tsx`
- Modify: `apps/web/src/components/admin/CatalogosSection.tsx`, `apps/web/src/lib/types.ts`

- [ ] **Step 1: El aviso de impacto**

Antes de habilitar la edición de un catálogo con cotizaciones, mostrar el desglose **por estatus**, no solo el total:

```
Este catálogo lo usan 21 cotizaciones.
  14 en borrador o enviada — cambiar precios aquí es normal.
  7 comprometidas (formalizadas, con complemento o liquidadas).

Sus totales guardados NO cambian. Pero si alguien reedita una de las 7,
se recalculará con los precios nuevos. Si solo quieres corregir el
catálogo del año que viene, clónalo en vez de editar este.
```

Con un botón para clonar ahí mismo. El aviso **no bloquea** — el dueño eligió flexibilidad — pero da la información y la salida.

- [ ] **Step 2: El editor**

Pestañas o secciones: **Renta** (tabla por espacio y rango, con los cuatro precios editables; separar día y plano), **Servicios** (lista con alta, baja, edición y activar/desactivar), **Alimentos** (paquetes por tipo de evento, con sus brackets), **DJ** (precio por tipo de evento), **Parámetros** (IVA, hora extra, descuento, capilla).

Guardar por sección, no todo de golpe: una tabla de 37 renglones guardada entera hace imposible saber qué se cambió, y la bitácora pierde valor.

- [ ] **Step 3: La bitácora visible**

Al pie del editor, los últimos cambios del catálogo: fecha, quién, qué, y cuántas cotizaciones había en riesgo entonces.

- [ ] **Step 4: Typecheck y verificación en navegador**

Run: `pnpm --filter @hsa/web typecheck`

Verificar a mano: editar un precio de renta de 2028, confirmar que cambia; abrir una cotización de 2027 y confirmar que **su total no se movió**; editar 2027 y confirmar que aparece el aviso con el desglose correcto.

Si el panel del navegador no entrega clics, condúcelo por `javascript_tool` y **dilo explícitamente**, aclarando qué quedó sin verificar con interacción real.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): editor del contenido del catálogo con aviso de impacto"
```

---

## Task 7: Cierre

- [ ] **Step 1: Suite completa**

```bash
pnpm typecheck && pnpm test && pnpm lint
```

- [ ] **Step 2: La prueba que da sentido al tramo**

Con la app corriendo: toma una cotización de 2027, anota su total. Edita en 2027 el precio de renta de su salón al doble. **Su total no debe moverse.** Ahora reedítala cambiando solo el nombre del cliente: **ahora sí** debe subir, porque eso es lo que el dueño aceptó a cambio de la flexibilidad. Confirma que la bitácora del catálogo registró el cambio con las cotizaciones en riesgo.

- [ ] **Step 3: Confirmar que no quedó un segundo camino a los parámetros**

```bash
grep -rn "admin/config" apps/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist
```
Debe salir vacío.

- [ ] **Step 4: Push y PR. No mergear sin autorización del dueño.**

- [ ] **Step 5: Actualizar la memoria del proyecto**

Anotar: que editar un catálogo en uso está permitido por decisión del dueño y por qué; que la bitácora del catálogo es una tabla aparte porque `ActivityLog` exige `quoteId`; que `cotizacionesEnRiesgo` se congela al momento del cambio; y que `/admin/config` se retiró.
