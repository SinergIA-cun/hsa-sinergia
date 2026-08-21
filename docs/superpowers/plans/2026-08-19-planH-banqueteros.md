# Plan H · Banqueteros: cuenta corriente, apartados sin precio y estado de cuenta

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un banquetero deje de ser una etiqueta y pase a ser una contraparte con cuenta: un depósito se reparte entre varios eventos, se pueden apartar fechas sin precio, y su estado de cuenta se comparte por enlace.

**Diseño aprobado:** `docs/superpowers/specs/2026-08-13-banqueteros-cuenta-corriente-design.md`. Léelo antes que este plan.

**Tech Stack:** pnpm + Turbo, Fastify 5, Prisma 6 + Postgres (docker `hsa-postgres`, puerto 5434), React 18 + Vite 6 + Tailwind 4 + TanStack Query, Vitest.

---

## Los tres casos reales que esto resuelve

Textual del dueño:

1. **"Un banquetero puede comprar 3 o 4 eventos y luego venderlos él."**
2. **"Puede hacer un pago por 323,345 pesos y luego decirte cómo van distribuidos: 55,000 a evento A, 55,000 a evento B, el resto a evento C."**
3. **"Son los que más graduaciones venden. Piden fechas muy adelantadas: están pidiendo 2028 y pagando fechas aún sin tener claros los precios."**

Hoy ninguno cabe: `Payment.quoteId` es **obligatorio**, no hay forma de apartar sin precio, y `Banquetero` es `{ nombre, telefono, activo }`. **Los tres viven hoy en la cabeza de alguien y en un hilo de WhatsApp.**

## Decisiones del dueño (no volver a preguntar)

1. **El banquetero es el cliente de la hacienda:** firma él y se le factura a él. El festejado es dato operativo. **Ya implementado** en el Plan G punto 3 (`Quote.festejado`, `festejadoTelefono`, selector en el formulario).
2. **Sección interna con enlace compartible de solo lectura.** Sin usuarios externos, sin contraseñas.
3. **El saldo sin asignar es legítimo y visible.** Se registra el depósito completo aunque solo se sepa el destino de una parte.

## Lo que este plan NO hace

- No mete a la hacienda en la reventa: **no** se registra a qué precio revende ni su margen.
- No da acceso propio al banquetero (decisión 2).
- No toca el motor de precios. Un apartado sin precio no pasa por el motor.

## Reglas de la rama (heredadas de los planes A–G)

- **`git commit --amend` PROHIBIDO.**
- Tests de API con `fileParallelism: false`. No correr dos suites de API a la vez.
- **`pnpm test` Y `pnpm typecheck` cachean por turbo**: `--force` en los dos. `pnpm lint` no es task de turbo.
- `pnpm --filter X test -- nombre` **NO filtra**: es `pnpm --filter X test nombre`.
- Nada de archivos de trabajo en la raíz; usa el scratchpad.
- Postgres: Docker, puerto **5434**, contenedor `hsa-postgres`, usuario/base `hsa`. Puede estar detenido.

### Gotchas verificados en este repo

- `prisma migrate dev` **reintroduce `DROP SEQUENCE "client_ref_seq"` / `"recibo_folio_seq"` en cada diff**: bórralo a mano. Romper `recibo_folio_seq` mata el folio de los recibos, que este plan usa.
- `migrate dev` **se niega** en sesión no interactiva si el diff implica pérdida de datos: `prisma migrate diff --from-url … --to-schema-datamodel … --script` + `migrate deploy`, con `dotenv -e ../../.env`.
- **Una copia de datos no puede ir en un backfill de TS** si una migración posterior borra la columna origen: el `CMD` corre `migrate:deploy` completo antes de todos los backfills.
- **Postgres no puede quitar un valor de un enum.** Para retirar uno: migrar filas, crear tipo nuevo, mover columna, borrar viejo.
- **Prisma TRUNCA los flotantes del lado del cliente** al escribir en columnas `Int` (`5.5 → 5`), sin error. Postgres redondearía a la mitad par pero nunca ve el flotante. Todo monto calculado necesita `Math.round`; todo monto **capturado** debe rechazar decimales, no redondearlos.
- `logActivity` **traga sus errores** (`catch {}`) y `LogTipo` es unión de TS **y** enum `ActivityType`: un tipo nuevo necesita migración `ALTER TYPE … ADD VALUE IF NOT EXISTS` **y** un test que cuente registros.
- **`ActivityLog.quoteId` es obligatorio**: un evento que no pertenece a una cotización no cabe ahí.

### Símbolos reales (no inventar)

- `Actor` y `ownershipWhere` se exportan de `apps/api/src/quotes/service.ts`. No existe `apps/api/src/auth/types.ts`.
- `app.prisma` (no `app.db`); `req.user as Actor` (no `req.actor`); papelera `deletedAt`; rol de vendedor `ventas`; `requireAdmin` en `apps/api/src/auth/plugin.ts`.
- **`seleccionGuardada()` + `SELECCION_INCLUDE`** en `quotes/service.ts`: el helper único para recalcular desde la cotización guardada. **Omitir el include es error de compilación.** Úsalo siempre que recalcules.
- Helpers de test en `quotes.test.ts`: cliente `prisma`, actor admin en la variable de módulo **`actor`**, `ids()`, `authCookies()`, `createdQuoteIds`/`createdClientIds`. **No existe `entradaValida()` ni `adminActor`.** Usuario `ventas`: patrón en `payments.test.ts`.
- Pantallas de admin: `apps/web/src/components/admin/*Section.tsx` desde `apps/web/src/pages/AdminPage.tsx`. **No existe `apps/web/src/pages/admin/`.**
- Estatus vigentes: `borrador, formalizada, complementada, liquidada`. Los que apartan fecha: `formalizada, complementada, liquidada`.
- `apps/api/dist/` **NO** está versionado (está en `.gitignore`), pero existe en disco y ensucia los greps.

---

## Task 1 · La cuenta corriente: el depósito

**El corazón del plan.** Un depósito entra a la cuenta del banquetero; después se reparte.

**La decisión de diseño que lo hace elegante:** cada asignación **genera un `Payment` real en la cotización**, con su folio. Así el estado de cuenta, los hitos, el candado de facturación y el API del BI siguen funcionando **sin cambiar una línea**. El `Payment` gana un `pagoBanqueteroId` opcional que es la liga al depósito madre.

**Files:** `schema.prisma` + migración · `apps/api/src/banqueteros/cuenta.ts` (nuevo) · `routes.ts` · tests

- [ ] **Step 1: Modelo**

```prisma
/// Un depósito del banquetero a la hacienda, ANTES de saber a qué eventos va.
/// El dinero llega antes que la instrucción de cómo repartirlo (decisión 3 del
/// dueño), así que el saldo sin asignar es un estado legítimo y visible.
model PagoBanquetero {
  id              String        @id @default(cuid())
  banquetero      Banquetero    @relation(fields: [banqueteroId], references: [id])
  banqueteroId    String
  monto           Int
  metodo          PaymentMethod
  fecha           DateTime
  referencia      String?
  comprobanteKey  String?
  comprobanteMime String?
  registradoBy    User?         @relation("PagoBanqueteroRegistradoBy", fields: [registradoById], references: [id])
  registradoById  String?
  anuladoAt       DateTime?
  motivoAnulacion String?
  createdAt       DateTime      @default(now())
  /// Los pagos por evento que salieron de este depósito.
  asignaciones    Payment[]

  @@index([banqueteroId, fecha])
}
```

`Payment` gana `pagoBanquetero PagoBanquetero?` + `pagoBanqueteroId String?` + `@@index([pagoBanqueteroId])`.
`Banquetero` gana `depositos PagoBanquetero[]`.

- [ ] **Step 2: Tests de la cuenta (función pura primero donde se pueda)**

- Registrar un depósito de 323,345 deja saldo sin asignar de 323,345.
- Asignar 55,000 al evento A **crea un `Payment`** en A, con folio, y baja el saldo a 268,345.
- Asignar más que el saldo sin asignar responde **409**, y no crea nada.
- Asignar a una cotización de **otro banquetero** responde 409: un depósito no puede pagar el evento de alguien más.
- Anular una asignación **devuelve el monto al saldo** y anula su `Payment`.
- Anular el depósito con asignaciones vivas responde **409**.
- El saldo sin asignar **no cuenta como pagado** en ninguna cotización.
- Un monto con decimales se **rechaza** (no se redondea).
- Solo admin registra y anula depósitos; ventas puede **asignar** lo suyo.

- [ ] **Step 3: Correr, confirmar rojo, implementar, correr.**

> **El riesgo fiscal que hay que fijar con test.** El candado del Plan C corre **por
> pago** y el SAT exige facturar el ingreso en el mes en que se **recibe**. Un
> depósito de marzo asignado en mayo **sigue siendo de marzo**. El `Payment` que
> nace de una asignación tiene que llevar la **fecha del depósito**, no la de la
> asignación. Test obligatorio: depósito de marzo, asignación en mayo, y
> `estadoFacturaPago` del `Payment` resultante lo trata como de marzo.

- [ ] **Step 4: Commit.**

---

## Task 2 · Apartar una fecha sin precio

**Files:** `schema.prisma` + migración · `apps/api/src/banqueteros/apartados.ts` (nuevo) · `availability/service.ts` · tests

- [ ] **Step 1: Modelo**

```prisma
/// Una fecha apartada por un banquetero ANTES de que exista cotización o precio.
/// Bloquea la disponibilidad igual que un evento comprometido —es dinero real
/// sobre una fecha— pero NO tiene total: no es una venta cerrada.
model ApartadoFecha {
  id            String      @id @default(cuid())
  banquetero    Banquetero  @relation(fields: [banqueteroId], references: [id])
  banqueteroId  String
  fechaEvento   DateTime
  spaceIds      String[]
  /// Catálogo al que se le garantizó el precio, si se negoció uno.
  priceList     PriceList?  @relation(fields: [priceListId], references: [id])
  priceListId   String?
  deposito      Int         @default(0)
  vence         DateTime
  nota          String?
  /// La cotización que nació de este apartado, al convertirlo.
  quote         Quote?      @relation(fields: [quoteId], references: [id])
  quoteId       String?     @unique
  canceladoAt   DateTime?
  createdAt     DateTime    @default(now())

  @@index([fechaEvento])
  @@index([banqueteroId])
}
```

- [ ] **Step 2: Tests**

- Un apartado **bloquea** la disponibilidad de su fecha y espacios (`level: 'bloqueada'`).
- Aparece en la agenda, distinguible de una cotización.
- **No** suma a ningún reporte de ingreso comprometido: no tiene total.
- Un apartado **vencido** deja de bloquear.
- Uno cancelado deja de bloquear.
- Convertirlo crea la cotización con **su catálogo** si lo tiene, y con el activo si no.
- Al convertir, el depósito **pasa como pago** de la cotización nueva.
- No se puede apartar una fecha ya comprometida sin confirmar (mismo trato que los empalmes: **avisa, no bloquea**).
- Convertir dos veces el mismo apartado responde 409.

- [ ] **Step 3: Correr, implementar, correr.**

> `getAvailability` y `getAgenda` hoy solo miran `Quote`. Hay que sumarles los
> apartados vivos. **Es el punto donde este plan puede romper algo existente**:
> corre la suite completa de disponibilidad y agenda después.

- [ ] **Step 4: Commit.**

---

## Task 3 · El estado de cuenta del banquetero

**Files:** `apps/api/src/banqueteros/estadoCuenta.ts` (nuevo) · `routes.ts` · tests

- [ ] **Step 1: Tests**

- Devuelve sus eventos, sus depósitos, cómo se repartieron, su saldo sin asignar y sus apartados por vencer.
- El saldo sin asignar es `Σ depósitos vivos − Σ asignaciones vivas`.
- Un banquetero sin nada devuelve ceros, no un error.
- Las cotizaciones en papelera no aparecen.
- Solo admin y ventas lo ven autenticado; **el enlace público es de solo lectura y no expone otros banqueteros**.

- [ ] **Step 2: Implementar** `estadoCuentaBanquetero(db, banqueteroId)` y `GET /banqueteros/:id/estado-cuenta`.

- [ ] **Step 3: Enlace compartible.** `Banquetero` gana `publicToken String @unique`, y `GET /b/:token` sirve el estado de cuenta sin sesión. Mismo patrón que el token del cliente. **Test de que un token inválido da 404 y que el token no filtra datos de otro banquetero.**

- [ ] **Step 4: Commit.**

---

## Task 4 · La sección de banqueteros en la interfaz

**Files:** `apps/web/src/components/admin/BanqueterosSection.tsx` · `apps/web/src/pages/BanqueteroPage.tsx` (nuevo) · `apps/web/src/pages/BanqueteroPublicoPage.tsx` (nuevo) · `App.tsx`

- [ ] **Step 1: La lista** con nombre, eventos, saldo sin asignar y apartados por vencer. El saldo sin asignar **se destaca**: es dinero sin destino.
- [ ] **Step 2: La ficha del banquetero:** sus eventos, sus depósitos con sus asignaciones, y los botones de registrar depósito y repartirlo.
- [ ] **Step 3: El reparto.** Un depósito y una lista de sus eventos; se escribe cuánto va a cada uno; **el remanente se muestra en vivo** y no se puede pasar del saldo. Guardar crea los pagos.
- [ ] **Step 4: La página pública** del estado de cuenta, con el patrón editorial de `PublicQuotePage`.
- [ ] **Step 5: Typecheck, verificación en navegador y commit.** Si el panel no entrega clics, condúcelo por `javascript_tool` y **dilo**, aclarando qué quedó sin verificar con interacción real.

---

## Task 5 · El tablero grita lo que hoy es invisible

- [ ] **Step 1:** Saldo sin asignar por banquetero. Dinero sin destino.
- [ ] **Step 2:** Apartados por vencer en los próximos 30 días.
- [ ] **Step 3:** Fechas apartadas sin convertir, con su vencimiento.
- [ ] **Step 4: Eventos pasados sin liquidar.** Por la regla del negocio —*"no hay forma de hacer el evento si no está pagado"*— **no deberían existir**. Si existen, o no se capturó un pago o el evento no se hizo. Va como alerta, no como estado silencioso.
- [ ] **Step 5: Commit.**

---

## Task 6 · Cierre

- [ ] **Step 1:** `pnpm typecheck --force && pnpm test --force && pnpm lint` en verde.
- [ ] **Step 2: La prueba que da sentido al plan.** Registrar un depósito de $323,345 de un banquetero con tres eventos; repartir 55,000 / 55,000 / el resto; confirmar que cada evento tiene su pago con folio, que el saldo sin asignar queda en cero, y que los tres estados de cuenta cuadran.
- [ ] **Step 3:** Confirmar que el desglose de una cotización sin banquetero es **idéntico** al de antes del plan. Este plan no debe tocar el motor.
- [ ] **Step 4: Push y PR. No mergear sin autorización del dueño.**
- [ ] **Step 5: Actualizar la memoria del proyecto.**
