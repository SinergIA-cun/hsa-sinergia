# Plan G · Ocho cambios de operación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ocho cambios pedidos por el dueño el 13-ago-2026, en su mayoría independientes entre sí.

**Tech Stack:** pnpm + Turbo, Fastify 5, Prisma 6 + Postgres (docker `hsa-postgres`, puerto 5434), React 18 + Vite 6 + Tailwind 4 + TanStack Query, Vitest.

---

## Hallazgos que cambian el alcance (verificados en el código)

1. **Los pagos YA tienen folio.** `Payment.folio` es una secuencia de Postgres (`recibo_folio_seq`) y `PagosPanel.tsx:188` ya lo muestra como `#123`. Del punto 5 solo falta el **código de evento**.
2. **El recibo YA existe**: `ReciboPage.tsx`, ruta `/c/:token/recibo/:paymentId` (`App.tsx:59`), enlazada solo desde `PublicQuotePage.tsx:188`. Cuelga del token del cliente, que la vendedora ya tiene a mano. Del punto 4 falta **el enlace**, no el recibo.
3. **`esCortesia` NUNCA ha afectado el precio.** Se guarda, se manda al BI y a la agenda, y el motor **no lo lee**. El punto 7 no es "agregar el descuento a la cortesía": es que la casilla nunca tuvo efecto.
4. **`vencida` es el único mecanismo de limpieza que existe.** `availability/service.ts:50,62,127` excluye las vencidas de los colores y de la agenda, y `service.ts:1015` las marca por vigencia. Quitarlo tiene consecuencia (ver decisión 3).

## Decisiones del dueño (no volver a preguntar)

1. **El descuento de cortesía pega SOLO sobre la renta.** Con 100% la renta queda en cero y alimentos y servicios se cobran completos.
2. **El servicio adicional del evento se captura SIEMPRE con IVA incluido.** El monto teclado es el final.
3. **Las 4 cotizaciones `vencida` pasan a `borrador`, y el vencimiento automático se elimina por completo.** Se le advirtió que entonces nada limpia la agenda —los borradores viejos seguirán pintando fechas en ámbar hasta que alguien los borre a mano— y lo aceptó.

## Decisiones tomadas por el implementador (corregibles por el dueño)

4. **El código de evento se congela al formalizar.** Mientras es borrador se regenera si cambia fecha, cliente o espacio; en cuanto hay compromiso de pago queda fijo, porque a partir de ahí está impreso en cosas.
5. **El concepto del pago se DEDUCE del saldo**, no se teclea: comparando el pagado acumulado contra los hitos del plan sale solo si es anticipo, a cuenta, complemento o finiquito. Queda editable para discrepar, pero **la regla del finiquito gana siempre** sobre lo capturado, que es lo que pidió el dueño ("sin importar como pusieron el campo").

## Reglas de la rama (heredadas de los planes A–E)

- **`git commit --amend` está PROHIBIDO.**
- Tests de API con `fileParallelism: false`. No correr dos suites de API a la vez.
- `pnpm --filter X test -- nombre` **NO filtra** (pnpm se come el `--`): es `pnpm --filter X test nombre`.
- **`pnpm test` cachea por turbo**: para totales reales, `--force`.
- Nada de archivos de trabajo en la raíz; usa el scratchpad.
- Postgres: Docker, puerto **5434**, contenedor `hsa-postgres`, usuario/base `hsa`.
- `apps/api/dist/` está versionado con `.d.ts` viejos que contaminan los greps.

### Gotchas de migración verificados en este repo

- **Postgres NO puede quitar un valor de un enum.** Para el punto 8 hay que crear un tipo nuevo, mover la columna y borrar el viejo — no existe `DROP VALUE`. Y **primero** migrar las filas.
- `prisma migrate dev` **reintroduce en cada diff** `DROP SEQUENCE "client_ref_seq"` / `DROP SEQUENCE "recibo_folio_seq"`. **Bórralo a mano**: romper `recibo_folio_seq` mata el folio de los recibos — que es justo lo que el punto 5 usa.
- `migrate dev` **se niega** en sesión no interactiva si el diff implica pérdida de datos: usa `prisma migrate diff --from-url … --to-schema-datamodel … --script` y `migrate deploy`. Necesita `dotenv -e ../../.env`.
- Una copia de datos **no puede ir en un backfill de TS** si una migración posterior borra la columna de origen: el `CMD` del Dockerfile corre `migrate:deploy` completo antes de todos los backfills.
- **Postgres TRUNCA los flotantes en columnas `Int`** (`5.5 → 5`), sin error. Todo precio necesita `Math.round`.
- `logActivity` **traga sus errores** (`catch {}`) y `LogTipo` es unión de TS **y** enum `ActivityType`: un tipo nuevo sin migración falla en silencio. Necesita `ALTER TYPE … ADD VALUE IF NOT EXISTS` **y** un test que cuente registros.

### Símbolos reales (no inventar)

- `Actor` y `ownershipWhere` se exportan de `apps/api/src/quotes/service.ts`. No existe `apps/api/src/auth/types.ts`.
- `app.prisma` (no `app.db`); `req.user as Actor` (no `req.actor`); papelera `deletedAt`; rol de vendedor `ventas`; `requireAdmin` en `apps/api/src/auth/plugin.ts`.
- Helpers de test en `apps/api/src/quotes/quotes.test.ts`: cliente `prisma`, actor admin en la variable de módulo **`actor`**, `ids()`, `authCookies()`, `createdQuoteIds`/`createdClientIds`. **No existe `entradaValida()` ni `adminActor`.** Usuario `ventas`: el patrón está en `payments.test.ts`.
- Pantallas de admin: `apps/web/src/components/admin/*Section.tsx` montadas desde `apps/web/src/pages/AdminPage.tsx`. **No existe `apps/web/src/pages/admin/`.**

---

## Task 1 · Contador de papelera (punto 1)

**Enfoque:** un sello por usuario, no un estado por cotización. `User.papeleraVistaAt`; el contador son las cotizaciones que el usuario puede ver (respetando `ownershipWhere`) con `deletedAt > papeleraVistaAt`. Abrir la papelera pone el sello en ahora.

**Files:** `schema.prisma` + migración · `apps/api/src/quotes/service.ts` · `routes.ts` · `apps/web` (icono de papelera y página)

- [ ] **Step 1: Tests**
  - Sin sello previo, todo lo que está en papelera cuenta.
  - Marcar visto pone el contador en cero.
  - Una cotización mandada a papelera **después** de marcar visto vuelve a contar.
  - Un vendedor **no** cuenta las de otro (usa `ownershipWhere`); un admin cuenta todas.
  - Restaurar una cotización la saca del contador.
- [ ] **Step 2: Correr y confirmar que fallan.**
- [ ] **Step 3: Implementar** `contarPapeleraSinVer(db, actor)` y `marcarPapeleraVista(db, actor)`; rutas `GET /quotes/trash/sin-ver` y `POST /quotes/trash/visto`.
- [ ] **Step 4: Interfaz.** Insignia roja con el número junto al icono de Papelera en la navegación. Al entrar a la papelera, marcar visto e invalidar la query del contador. La insignia se oculta en cero. Debe ser texto real accesible (`aria-label`), no solo un círculo de color.
- [ ] **Step 5: Commit.**

---

## Task 2 · Servicio adicional del evento (punto 2)

**Enfoque:** un renglón suelto de **esa** cotización, fuera del catálogo. Ejemplo real del dueño: el proveedor de comida cobra $200 más por persona por cambio de menú.

> **No es un add-on del catálogo y no debe serlo.** Justo por eso no sufre el problema de "resolver vs ofrecer" que costó dos bugs: vive en la cotización, no en un catálogo que puede cambiar.

**Decisión 2 del dueño: el monto capturado SIEMPRE trae IVA incluido.**

**Files:** `schema.prisma` + migración · `packages/shared/src/types.ts` y `pricing/engine.ts` (+ tests) · `apps/api/src/quotes/service.ts` · `apps/web/src/components/QuoteForm.tsx`

- [ ] **Step 1: Modelo**

```prisma
/// Servicio suelto de UN evento, fuera del catálogo. Ej.: el proveedor cobra
/// $200 más por persona por cambio de menú, solo para este evento.
/// El monto SIEMPRE trae IVA incluido (decisión del dueño).
model QuoteExtra {
  id       String    @id @default(cuid())
  quote    Quote     @relation(fields: [quoteId], references: [id])
  quoteId  String
  nombre   String
  kind     AddOnKind // fijo | porPersona | porUnidad
  monto    Int
  cantidad Int       @default(1) // solo para porUnidad
  @@index([quoteId])
}
```

- [ ] **Step 2: Tests del motor (función pura, primero)**
  - `porPersona`: $200 × 250 invitados = $50,000 en el grupo `otros`, `ivaIncluido: true`.
  - `fijo`: el monto tal cual.
  - `porUnidad`: monto × cantidad.
  - Suma al `total` y a `otrosTotal`, **no** a `rentaTotal` — o sea que **no** entra a la base del complemento ni del descuento de cortesía.
  - Sin extras, el desglose es byte por byte igual al de antes (test de no-regresión).
- [ ] **Step 3: Correr, implementar en el motor, correr.** `QuoteSelection` gana `extras: { nombre, kind, monto, cantidad }[]`.
- [ ] **Step 4: Persistir y recalcular.** `createQuote`/`updateQuote` guardan los extras y los pasan al motor. Al reeditar deben sobrevivir.
- [ ] **Step 5: Interfaz.** Botón "Agregar servicio de este evento" en el formulario: nombre, tipo de cobro, monto y cantidad. Aclarar en la etiqueta que **el monto incluye IVA** y que **es solo para este evento**, para que nadie lo confunda con el catálogo.
- [ ] **Step 6: Contrato y página del cliente** deben imprimir estos renglones como cualquier otro servicio.
- [ ] **Step 7: Commit.**

---

## Task 3 · Descuento de cortesía sobre la renta (punto 7)

**Contexto: `esCortesia` nunca ha hecho nada al precio.** Este es el cambio que se lo da.

**Decisión 1 del dueño: el % pega SOLO sobre la renta.** Con 100% la renta queda en cero; alimentos y servicios se cobran completos.

> **Ojo con el descuento que ya existe.** El motor ya tiene un descuento del 5% por alimentos (`engine.ts:105-110`) que también pega sobre la renta, y el comentario de la cabecera dice que los descuentos se calculan **sobre la misma base y no se componen entre sí**. El de cortesía tiene que seguir esa misma regla: base = renta de espacios, sin componerse con el otro. Un test debe fijar el caso de los dos juntos.

**Files:** `schema.prisma` + migración · `packages/shared/src/pricing/engine.ts` (+ tests) · `apps/api/src/quotes/service.ts` · `apps/web/src/components/QuoteForm.tsx` · `ContratoPage.tsx` · `PublicQuotePage.tsx`

- [ ] **Step 1: Modelo.** `Quote` gana `descuentoPct Float?` y `descuentoMotivo String?`.
- [ ] **Step 2: Tests del motor**
  - 100% deja `rentaTotal` en cero y `otrosTotal` intacto.
  - 50% deja la mitad de la renta.
  - Con el descuento del 5% por alimentos, **los dos sobre la misma base, sin componerse**.
  - El renglón del descuento aparece en el grupo `renta`, con monto negativo.
  - Sin `descuentoPct`, el desglose es idéntico al de antes.
  - Un `descuentoPct` fuera de 0..100 se rechaza.
- [ ] **Step 3: Correr, implementar, correr.**
- [ ] **Step 4: Interfaz.** Al marcar la casilla se abre un cuadro que pide **el porcentaje y el motivo**, y el motivo es **obligatorio**: un descuento de cientos de miles sin explicación es un problema de auditoría, no un campo opcional.
- [ ] **Step 5: El motivo se imprime** en el contrato y en la página del cliente, junto al renglón del descuento.
- [ ] **Step 6: Commit.**

---

## Task 4 · Código de evento (punto 5)

Formato pedido: `17ENE-CBOLADO-CUPULA` — día, mes abreviado, inicial del nombre + apellido, y el espacio abreviado.

**Decisión 4 del implementador: se congela al formalizar.** Mientras es borrador se regenera si cambia fecha, cliente o espacio; con compromiso de pago queda fijo.

**Files:** `packages/shared/src/codigoEvento.ts` (nuevo, función pura) · `schema.prisma` + migración · `apps/api/src/quotes/service.ts` · backfill · interfaz

- [ ] **Step 1: Tests de la función pura** (`packages/shared`)
  - `2027-01-17`, "Carlos Bolado", "Jardín La Cúpula" → `17ENE-CBOLADO-CUPULA`.
  - Acentos y eñes se normalizan: "Muñoz Peña" → `MUNOZ`… (define y fija la regla).
  - Nombre de una sola palabra: no truena.
  - **Varios espacios: manda el primero** (fija cuál).
  - Nombres largos se truncan a un tope definido.
  - Caracteres raros y espacios dobles no ensucian el código.
- [ ] **Step 2: Correr, implementar, correr.**
- [ ] **Step 3: Unicidad.** `Quote.codigo String? @unique`. Si el código ya existe, sufijo numérico (`-2`, `-3`). **Test de colisión obligatorio**: dos eventos del mismo cliente, misma fecha y mismo salón son raros pero posibles y no pueden romper el guardado.
- [ ] **Step 4: Generación y congelado.** Al crear, y al editar solo si el estatus **no** aparta fecha. Test: formalizar, cambiar la fecha, y verificar que el código **no** cambió.
- [ ] **Step 5: Backfill** que genere el código de las cotizaciones existentes. Idempotente.
- [ ] **Step 6: Mostrarlo** en el detalle, la lista, el contrato, el recibo y la página del cliente. Es la identidad del evento: tiene que verse donde alguien lo vaya a copiar.
- [ ] **Step 7: Commit.**

---

## Task 5 · Concepto de pago deducido y corregible (punto 6)

**Decisión 5 del implementador:** el concepto se **deduce** del pagado acumulado contra los hitos del plan; queda editable para discrepar; y **la regla del finiquito gana siempre** sobre lo capturado, como pidió el dueño.

**Files:** `packages/shared/src/pagos/concepto.ts` (nuevo, función pura) · `apps/api/src/payments/service.ts` · `routes.ts` · `apps/web/src/components/PagosPanel.tsx`

- [ ] **Step 1: Tests de la función pura**
  - El pago que cruza el objetivo del apartado → `anticipo`.
  - El que cruza el del complemento → `complemento`.
  - El que lleva el pagado a cubrir el total → `finiquito`, **aunque se haya capturado como otra cosa**.
  - Uno intermedio que no cruza ningún hito → `aCuenta`.
  - Los pagos anulados **no cuentan** para el acumulado.
  - Un pago que sobrepasa el total sigue siendo `finiquito` (no revienta).
  - Sin plan de pagos (espacio sin regla), respeta lo capturado y no inventa.
- [ ] **Step 2: Correr, implementar, correr.**
- [ ] **Step 3: Editar el concepto.** `PATCH /quotes/:id/payments/:paymentId/concepto`. Lo puede hacer **ventas sobre lo suyo** (es un error de captura, no un movimiento de dinero), y queda en bitácora. La regla del finiquito se reaplica después de editar.
- [ ] **Step 4: Reclasificar en cadena.** Anular o editar un pago cambia el acumulado, así que los conceptos de los pagos **posteriores** pueden cambiar. Test: tres pagos, se anula el segundo, y el tercero deja de ser finiquito.
- [ ] **Step 5: Interfaz.** El concepto es editable en el renglón del pago. Si el deducido difiere del capturado, mostrar el deducido y decir por qué.
- [ ] **Step 6: Commit.**

---

## Task 6 · La vendedora puede ver el recibo (punto 4)

**El recibo ya existe**; falta el enlace. Ruta `/c/:token/recibo/:paymentId`.

- [ ] **Step 1: Verificar que el detalle de la cotización trae el token.** Si no lo trae, agregarlo al `select` — **sin exponerlo a quien no deba verlo**.
- [ ] **Step 2: Agregar "Ver recibo"** en cada renglón de `PagosPanel.tsx`, junto a "Ver comprobante". Abre en pestaña nueva.
- [ ] **Step 3: No mostrarlo en pagos anulados**, o hacer evidente que el recibo es de un pago anulado. Un recibo de un pago anulado circulando es un problema.
- [ ] **Step 4: Verificar en el navegador** que la vendedora llega al recibo y que imprime bien.
- [ ] **Step 5: Commit.**

---

## Task 7 · Formulario con desplegable Banquetero / Cliente (punto 3)

**Enfoque:** un selector arriba del formulario, "¿Para quién es este evento?". Con **Cliente** todo queda como hoy. Con **Banquetero** se elige el banquetero y aparece el **festejado** (el cliente final).

> **Esto se apoya en el diseño de banqueteros** (`docs/superpowers/specs/2026-08-13-banqueteros-cuenta-corriente-design.md`), donde el dueño decidió que **el banquetero es el cliente de la hacienda**: firma él y se le factura a él. El festejado es dato operativo.
>
> Este plan hace **solo la parte del formulario** y el campo `festejado`. La cuenta corriente, los apartados sin precio y el estado de cuenta compartible son el plan de banqueteros, aparte.

- [ ] **Step 1: Modelo.** `Quote` gana `festejado String?` y `festejadoTelefono String?`.
- [ ] **Step 2: Tests.** Con banquetero, el cliente de la cotización es el banquetero; el festejado se guarda y sale en la hoja operativa; y el contrato sigue leyendo al **cliente**, no al festejado.
- [ ] **Step 3: Interfaz.** El desplegable cambia los campos. Al elegir banquetero, los datos de cliente se llenan desde él y quedan de solo lectura, con un enlace para editarlos en su ficha.
- [ ] **Step 4: El festejado se imprime en la hoja operativa**, no en el contrato.
- [ ] **Step 5: Commit.**

---

## Task 8 · Retirar los estatus que no se usan (punto 8)

Se van `enviada`, `aceptada` y `vencida`. Quedan `borrador`, `formalizada`, `complementada`, `liquidada`.

**Decisión 3 del dueño:** las 4 cotizaciones `vencida` pasan a `borrador`, y **el vencimiento automático se elimina**. Consecuencia aceptada: nada limpia la agenda, y los borradores viejos seguirán pintando fechas en ámbar.

> **Postgres NO puede quitar un valor de un enum.** Hay que: (1) migrar las filas a `borrador`, (2) crear el tipo nuevo, (3) mover la columna, (4) borrar el viejo. En ese orden, y la migración de datos **como migración SQL**, no como backfill de TS.

**Superficies a tocar** (todas verificadas):
- `QUOTE_STATUSES` en `apps/api/src/quotes/service.ts:23`
- `EDITABLE_STATUSES` (`service.ts:86`)
- `expirarVigencias` (`service.ts:1015-1042`) — **se elimina**, con su llamada y su entrada en el `CMD` si la tiene
- `availability/service.ts:50,62,127` — los `status: { not: 'vencida' }` dejan de tener sentido
- `VIVAS` en `apps/api/src/quotes/empalmes.ts`
- `apps/web/src/lib/status.ts` (etiquetas y estilos), el selector de estatus, el tablero, el BI

- [ ] **Step 1: Tests primero**
  - Crear una cotización con `enviada` responde 400.
  - Ninguna cotización queda con un estatus retirado.
  - Los empalmes siguen detectando (su `VIVAS` se reduce a `borrador`).
  - La agenda y los colores siguen funcionando sin el filtro de `vencida`.
  - El tablero no se cae por un estatus que ya no existe.
- [ ] **Step 2: Migración en cuatro pasos**, revisando el SQL a mano y borrando el bloque de secuencias que Prisma reintroduce.
- [ ] **Step 3: Barrer el código** de los tres valores. `grep -rn "enviada\|aceptada\|vencida"` debe quedar solo en comentarios históricos y migraciones.
- [ ] **Step 4: Correr la suite completa** y arreglar lo que rompa. Esta task rompe cosas en sitios inesperados; es la más invasiva del plan.
- [ ] **Step 5: Commit.**

---

## Task 9 · Cierre

- [ ] **Step 1:** `pnpm typecheck && pnpm test --force && pnpm lint` en verde.
- [ ] **Step 2: Verificación en navegador** de los ocho puntos, uno por uno, con números reales. Si el panel no entrega clics, conducir por `javascript_tool` y **decirlo**, aclarando qué quedó sin verificar con interacción real.
- [ ] **Step 3:** Confirmar que el desglose de una cotización **sin** extras y **sin** descuento es idéntico al de antes del plan. Dos cambios de este plan tocan el motor; una regresión ahí mueve dinero.
- [ ] **Step 4: Push y PR. No mergear sin autorización del dueño.**
- [ ] **Step 5: Actualizar la memoria del proyecto.**
