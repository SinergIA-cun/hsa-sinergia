# Cambios: estatus, multi-salón, facturación, agenda y API para BI · Diseño

**Fecha:** 2026-08-03
**Estado:** aprobado en chat (2026-08-03)
**Alcance:** 7 cambios sobre el cotizador HSA, agrupados en 3 planes de implementación.

---

## Contexto

Siete peticiones del cliente. Comparten modelo de datos (estatus, espacios, cliente,
bitácora), por eso van en un solo spec, pero se construyen en tres tandas para poder
verificar en navegador entre una y otra.

Estado del repo al escribir esto: `main` limpio, 99 commits, último `1e526b1` (2026-07-21),
`pnpm typecheck` verde. La base de datos de desarrollo es Postgres en Docker puerto 5434.

---

## Cambio 1 · El apartado formaliza el evento

### Problema

El negocio considera formalizado un evento desde que el cliente da el apartado. El sistema
llama a eso "apartada" y reserva "formalizada" para el pago del complemento, así que la
pantalla contradice al negocio. Además la palabra "formalizar" aparece pegada al hito del
complemento.

### Decisión

Recorrer los nombres **renombrando los valores del enum en la base**, no solo las etiquetas
de la interfaz.

| Valor hoy | Valor nuevo | Etiqueta | Se dispara al pagar |
|---|---|---|---|
| `apartada` | `formalizada` | "Formalizada" | anticipo |
| `formalizada` | `complementada` | "Complemento cubierto" | complemento |
| `liquidada` | `liquidada` | "Liquidada" | finiquito |

`borrador`, `enviada`, `aceptada` y `vencida` no cambian.

**Por qué en la base y no solo etiquetas:** dejar el valor `apartada` mostrándose como
"Formalizada" crea una discrepancia permanente entre código y pantalla que costará en cada
cambio futuro. El renombrado es sin pérdida y semánticamente correcto: las filas que hoy
dicen `apartada` significan "pagó el anticipo", que es exactamente lo que el negocio llama
formalizado.

**Por qué es seguro:** `QuoteStatus` es un tipo unión en TypeScript (generado por Prisma en
la API, declarado a mano en `apps/web/src/lib/types.ts`). Los mapas `Record<QuoteStatus, …>`
de `apps/web/src/lib/status.ts` obligan al compilador a señalar cada sitio que use los
literales viejos. `pnpm typecheck` es la red de seguridad.

### Migración

Una sola migración manual, dos sentencias, **el orden importa** (no se puede renombrar hacia
un valor que ya existe):

```sql
ALTER TYPE "QuoteStatus" RENAME VALUE 'formalizada' TO 'complementada';
ALTER TYPE "QuoteStatus" RENAME VALUE 'apartada' TO 'formalizada';
```

Mismo patrón que la migración existente `20260710182008_rol_ventas`. No requiere backfill:
las filas conservan su significado.

### El apartado ahora bloquea el espacio

Hoy `apps/api/src/availability/service.ts` distingue cuatro niveles y solo bloquea las dos
últimas etapas. Con el cambio, cualquier evento con compromiso de pago bloquea, y el nivel
intermedio desaparece:

| Nivel | Significado | Efecto al guardar |
|---|---|---|
| `libre` | nada en esa fecha | permite |
| `cotizaciones` | hay cotizaciones sin pago (`borrador`/`enviada`/`aceptada`) | permite, avisa |
| `bloqueada` | hay `formalizada`, `complementada` o `liquidada` | **no permite** |

Se elimina el nivel `apartada` del tipo `AvailabilityLevel`. `vencida` se sigue ignorando.

#### El bloqueo tiene que mudarse al servidor

**Hallazgo al revisar el código:** hoy el bloqueo vive **únicamente en el navegador**. El
`QuoteForm` deshabilita el botón de guardar, pero `createQuote` y `updateQuote` nunca
consultan la disponibilidad. Consecuencias reales:

- Una llamada directa a la API guarda un evento encima de otro sin resistencia.
- Dos personas de ventas con la pantalla abierta al mismo tiempo pueden guardar ambas la
  misma fecha y el mismo salón: cada navegador consultó la disponibilidad antes de que la
  otra guardara.

Mientras "apartada" era un aviso suave, esto era tolerable. Al convertir el apartado en un
compromiso firme, deja de serlo: un bloqueo que solo existe en la interfaz no es un bloqueo.

Se agrega la validación en `createQuote` y `updateQuote`: consultan `getAvailability` para los
espacios y la fecha (con `excludeQuoteId` al editar) y responden **409** con el motivo si algún
espacio está bloqueado. El front conserva su aviso anticipado, que sigue siendo la buena
experiencia; el servidor pasa a ser la autoridad.

Efecto secundario a tener presente: si por datos previos ya existen dos eventos en conflicto,
editar el que no tiene compromiso empezará a responder 409 hasta que se le cambie fecha o
espacio. Con los datos actuales (todos de prueba) no hay riesgo.

### Textos

- Hito del complemento: `'Complemento (formalizar)'` → **`'Complemento'`**, en
  `apps/api/src/quotes/estadoCuenta.ts` y en el preview del `QuoteForm`.
- El primer hito sigue siendo **"Apartar fecha"**: es la acción que realiza el cliente.
  El estatus que produce es Formalizada.
- Secciones de `QuotesListPage`: "Cotizaciones" / "Formalizados" / "Complemento cubierto" /
  "Liquidados".
- Leyenda y colores de la agenda: azul = Formalizada (anticipo), blanco con contorno =
  Complemento cubierto y Liquidada, vino = tentativa, verde = cortesía familiar.
- `PublicQuotePage`: la frase de condiciones del complemento pierde "formalizar".
- Aviso de disponibilidad del `QuoteForm`: se reescribe para el nuevo esquema de tres
  niveles (el texto actual menciona "aún sin formalizar el 30%", que deja de aplicar).

---

## Cambio 2 · De uno a tres salones por evento

### Problema

Hay graduaciones que juntan dos salones. El sistema permite exactamente uno.

### Qué ya funciona

El motor de precios (`packages/shared/src/pricing/engine.ts`) **ya suma la renta de todos
los espacios** de `spaceIds`. El precio no requiere cambios.

### Validación a relajar

Tres lugares imponen un solo espacio:

- `packages/shared/src/schemas.ts` — `spaceIds` tiene `.min(1)`, sin tope.
- `apps/api/src/quotes/service.ts:43` — `refine(spaceIds.length === 1)` en crear.
- `apps/api/src/quotes/service.ts:53` — `refine(spaceIds.length === 1)` en editar.

Queda: **mínimo 1, máximo 3**, sin duplicados (el refine de duplicados ya existe). El tope
de 3 se declara en el esquema compartido para que front y API compartan la regla.

### Plan de pagos con varios salones

Cada espacio tiene su propia `SpacePaymentRule` (anticipo fijo + porcentaje de complemento).
Reglas sembradas: Jardín La Cúpula $25,000/25%, Salón Los Arcos $20,000/10%,
Jardín Los Campos $15,000/15%. Los demás espacios no tienen regla.

Fórmula acordada:

- **Anticipo** = suma de los anticipos de los espacios elegidos.
  Arcos + Campos = $20,000 + $15,000 = $35,000.
- **Complemento** = suma del porcentaje de cada espacio aplicado a **su parte proporcional
  de la renta total**:

  ```
  complemento = Σ ( pct_i × rentaTotal × renta_i / Σ renta_j )
  ```

  donde `renta_i` es la **renta base** de ese espacio: el precio del espacio por rango y tipo
  de día, **antes** de horas extra, capilla y descuento por alimentos. Esas tres partidas no
  son atribuibles a un espacio concreto, así que solo entran vía `rentaTotal`, que es la base
  sobre la que se mide todo el plan.

**Propiedad que se exige en pruebas:** con un solo espacio la fórmula se reduce a
`pct × rentaTotal`, idéntica a la de hoy. Ninguna cotización existente cambia de plan.

- **Finiquito** = `rentaTotal` completo, sin cambio.
- Si **cualquiera** de los espacios elegidos carece de regla, el plan queda
  `planPendiente: true`, como hoy con la Capilla.

### `spaceId` en las líneas del desglose

Para repartir proporcionalmente hace falta la renta de cada espacio por separado. Hoy solo
se puede obtener parseando el texto del concepto (`/^Renta (.+)$/`), lo que ya se hace en
`QuoteForm.lineLabel` y es frágil.

Se agrega **`spaceId?: string`** a `QuoteLine` (`packages/shared/src/types.ts`) y el motor lo
puebla en las líneas de renta de espacio. Beneficios: habilita el cálculo por espacio y
elimina el parseo de texto en los dos lados. Las demás líneas (horas extra, capilla,
descuento, alimentos, add-ons) no llevan `spaceId`.

### Firma de `computeEstadoCuenta`

Pasa de una regla a varias con su renta asociada:

```ts
// antes
rule: SpaceRule | null

// después
rules: { spaceId: string; rule: SpaceRule; rentaBase: number }[] | null
```

`liquidarDiasAntes` se toma como el **máximo** de los espacios elegidos (el finiquito más
exigente manda). Hoy todas las reglas usan 30 días, así que en la práctica no cambia nada,
pero deja el comportamiento definido.

### Sitios que asumen `spaceIds[0]`

Hay que revisarlos uno por uno. Los identificados en `apps/api/src/quotes/service.ts`:
líneas 115 (regla de pago del estado de cuenta), 155 y 180 (el mismo cálculo en el listado).
El front asume `spaceIds[0]` en `QuoteForm` para la disponibilidad (línea 168) y para el
preview del plan (línea 147).

No requieren cambio, ya manejan varios: `getAgenda` y `primarySpace` de la agenda, y el
campo `lugar` de la hoja operativa (ya hace `join(', ')`).

### Interfaz

- `QuoteForm`: el selector acumula en lugar de reemplazar. Al llegar a 3, los no
  seleccionados se deshabilitan con la razón. El texto "Un solo espacio por evento" se
  reemplaza por "Hasta 3 espacios".
- Contrato (`ContratoPage`): lista los espacios donde hoy va uno, y la tabla de pagos de la
  página 3 lleva **un renglón por salón** con su anticipo y su porcentaje.

---

## Cambio 3 · Colores de disponibilidad en el selector

### Problema

Para saber si un salón está ocupado hay que seleccionarlo. El formulario solo consulta la
disponibilidad del espacio ya elegido (`spaceIds=${spaceId}`, un solo id).

### Solución

`GET /api/availability` ya acepta varios `spaceIds`. Se le piden **todos los espacios del
catálogo** para la fecha, en una sola llamada, en cuanto hay fecha.

Cada botón se pinta por nivel (los tres niveles del Cambio 1):

| Nivel | Aspecto | Interacción |
|---|---|---|
| `libre` | verde suave | seleccionable |
| `cotizaciones` | ámbar + "N cotización(es)" | seleccionable |
| `bloqueada` | rojo atenuado + motivo ("apartado por Gómez") | **deshabilitado** |

Sin fecha elegida, los botones se ven neutros como hoy.

**Cuidado:** `blocked` (lo que impide guardar) se calcula **solo sobre los espacios
seleccionados**, no sobre toda la respuesta. Si se calculara sobre el catálogo completo,
cualquier fecha con un evento bloquearía todo. El aviso detallado existente
(`AvailabilityBanner`) se conserva para los espacios seleccionados.

`excludeQuoteId` se sigue enviando al editar, para que un evento no se bloquee contra sí mismo.

---

## Cambio 4 · Arrastrar eventos entre fechas en la agenda

### Consecuencia que gobierna el diseño

**Cambiar la fecha cambia el precio.** La renta depende del tipo de día
(viernes / viernes especial / sábado / domingo a jueves). Mover un sábado a un martes puede
bajar el total decenas de miles de pesos. Un arrastre que solo escriba la fecha dejaría el
desglose, el contrato y el plan de pagos mintiendo.

Por eso el movimiento **recalcula la cotización completa** por el mismo camino que la edición
normal (`updateQuote`), no con una escritura directa de la fecha.

### Confirmación

El diálogo muestra el cambio de fecha **y** el cambio de total antes de aplicar:

> Mover **Boda Gómez** del sáb 14 mar al mar 17 mar.
> El total cambia de $108,500 a $94,200 (martes es día más barato).
> [Cancelar] [Mover]

Si el total nuevo queda por debajo de lo ya pagado, el diálogo lo advierte de forma
prominente y permite continuar; el badge de desfase existente lo marca después para que
alguien lo resuelva.

### Reglas

- No se arrastran eventos `liquidada` ni `vencida`, ni los de la papelera.
- Si algún espacio del evento está bloqueado en la fecha destino (excluyéndose a sí mismo),
  se rechaza con el motivo.
- Ventas solo mueve sus propias cotizaciones; admin mueve todas (mismo `ownershipWhere` que
  el resto).
- Todo movimiento queda en la bitácora: tipo `edicion`, con fecha anterior, fecha nueva,
  total anterior y total nuevo.

### Endpoint

`PATCH /api/quotes/:id/fecha` con `{ fecha: "YYYY-MM-DD" }`. Internamente reconstruye la
selección actual de la cotización cambiando solo la fecha y reutiliza la lógica de
recálculo de `updateQuote`, para no tener dos caminos que puedan divergir.

### Biblioteca

**`@dnd-kit/core`** (~10kb comprimido), única dependencia nueva del paquete. El arrastre
nativo de HTML5 no funciona con eventos táctiles y la operación es en tablet.

---

## Cambio 5 · Quitar el valet

Todos los eventos tienen valet y el cliente lo paga directo al valet en el evento ($100 por
auto). No es un concepto que HSA cobre, así que sale del sistema por completo.

Se elimina:

- El add-on "Valet parking" del catálogo: se **desactiva** (`activo: false`), no se borra.
  Borrarlo dejaría líneas huérfanas en el `breakdown` congelado de cotizaciones existentes.
- La sugerencia automática de autos en `QuoteForm` (`valetSuggestion`, la ref `valetManual`,
  el efecto que la recalcula y el botón de re-sugerir).
- `PricingConfig.valetRatio` y su campo en el panel de admin (`ConfigSection`), y su
  exposición en `/api/catalog`. La columna se deja en la base para no romper el cliente
  Prisma con una migración destructiva innecesaria; deja de leerse y de mostrarse.
- La nota del valet en los "Términos de la renta" de `PublicQuotePage`.
- La constante `DEFAULT_VALET_RATIO` del `QuoteForm`.

Las cotizaciones existentes **no se tocan**: son de prueba y ninguna es real, así que no hay
riesgo de descuadrar pagos, y el principio de no reescribir un desglose ya emitido se
mantiene.

---

## Cambio 6 · Facturación

### Modelo: en el cliente, reutilizable

Campos nuevos en `Client`, todos **opcionales** para no romper los clientes ya capturados:

| Campo | Tipo | Notas |
|---|---|---|
| `rfc` | `String?` | 13 caracteres persona física, 12 moral |
| `razonSocial` | `String?` | nombre fiscal exacto, **sin** régimen societario (el SAT rechaza el CFDI 4.0 si se incluye) |
| `regimenFiscal` | `String?` | clave SAT: 601, 603, 605, 606, 608, 612, 616, 621, 626… |
| `cpFiscal` | `String?` | 5 dígitos del domicilio fiscal |
| `usoCfdi` | `String?` | clave SAT: G01, G03, CP01, S01… (**no** `P01`: era de CFDI 3.3, el SAT lo retiró y su reemplazo es `S01`) |
| `correoFacturacion` | `String?` | suele diferir del correo de contacto |
| `csfKey` / `csfMime` | `String?` | Constancia de Situación Fiscal adjunta (ver abajo) |

Campo nuevo en `Quote`: **`requiereFactura Boolean @default(false)`**.

El modelo cubre CFDI 4.0 completo para que timbrar más adelante sea conectar un PAC, sin
volver a migrar datos. **El timbrado no está en este alcance:** el sistema captura, valida y
muestra requisitos; quien factura lo hace en su sistema contable.

### Lista de requisitos

Función pura en `packages/shared` que recibe el cliente y devuelve los requisitos con su
estado:

```ts
requisitosFactura(client): { campo: string; label: string; ok: boolean }[]
```

Una sola implementación consumida por el formulario, el contrato y el API del BI, para que
las tres no puedan desincronizarse. Incluye validación de forma: RFC con longitud y patrón
válidos, CP de 5 dígitos, régimen y uso dentro de las claves conocidas, correo con formato.

### Catálogos SAT

`regimenFiscal` y `usoCfdi` van como **catálogo fijo en código** en `packages/shared`, no
como tabla editable en admin: son claves oficiales del SAT que cambian cada varios años, no
configuración del negocio.

### Constancia de Situación Fiscal

Adjunto opcional, reutilizando la interfaz `ComprobanteStorage` / `ServerStorage` que ya
existe para los comprobantes de pago (`apps/api/src/payments/storage.ts`), con su mismo
directorio persistente. Subida multipart y proxy autenticado para verla, igual que los
comprobantes.

Es la pieza más recortable del spec: si se cae, ningún otro cambio se ve afectado.

### Interfaz

- `QuoteForm` gana una tarjeta **"Facturación"** con la casilla "Requiere factura". Al
  marcarla se despliegan los campos fiscales y la lista de requisitos, tachando lo capturado
  y marcando en rojo lo que falta.
- Los campos fiscales se editan sobre el cliente: viajan en el objeto `client` del payload de
  crear/editar, que ya se persiste (`createQuote` crea el cliente, `updateQuote` lo actualiza
  en `service.ts:367`). No hace falta endpoint nuevo.
- Al reutilizar un cliente existente con el buscador, los datos fiscales llegan ya
  cargados.
- `ContratoPage` incluye un bloque "Datos de facturación" cuando `requiereFactura` es
  verdadero, y advierte si hay faltantes.
- La lista de cotizaciones marca los eventos que requieren factura y tienen datos
  incompletos.

---

## Cambio 7 · API de solo lectura para el BI

### Autenticación

Módulo nuevo `apps/api/src/bi/`, registrado con prefijo `/api/bi`. Llave larga en el
encabezado **`x-api-key`**, comparada contra el secreto de entorno `BI_API_KEY`.

- Comparación en **tiempo constante** (`crypto.timingSafeEqual`), no `===`.
- La llave **nunca** se escribe en logs ni en mensajes de error.
- Si `BI_API_KEY` no está configurada, el módulo **no se registra** y los endpoints
  responden 404. No hay modo "abierto" por accidente.
- Solo lectura: ni un endpoint de escritura en el módulo.
- Independiente de las sesiones de usuario y de los roles: revocar es cambiar la llave.

### Endpoints

Todos aceptan `desde` y `hasta` (ISO `YYYY-MM-DD`) y paginan con `limit` (tope 500, default
100) y `cursor`. Todos excluyen la papelera (`deletedAt: null`).

| Endpoint | Contenido |
|---|---|
| `GET /api/bi/eventos` | evento, cliente (con su número de referencia), tipo, espacios, invitados, fecha, estatus, vendedora, banquetero, cortesía, y el desglose con sus dos bloques separados: renta vs. alimentos y servicios (los "ingresos adicionales") |
| `GET /api/bi/pagos` | pagos reales: folio, monto, método, concepto, fecha, quién registró, y si está anulado con motivo y responsable |
| `GET /api/bi/pagos-esperados` | hitos futuros derivados de `computeEstadoCuenta`: por evento y por hito, objetivo, cubierto, restante y fecha de vencimiento |
| `GET /api/bi/cambios` | la bitácora: cambios de salón, de invitados, de fecha, de estatus, pagos y anulaciones |
| `GET /api/bi/facturacion` | datos fiscales de los eventos con `requiereFactura`, con su lista de faltantes |

El rango de fechas se interpreta sobre el campo natural de cada recurso: fecha del evento en
`/eventos`, fecha del pago en `/pagos`, vencimiento del hito en `/pagos-esperados`, fecha del
registro en `/cambios`.

### Hueco que hay que tapar: la bitácora de edición

Hoy `updateQuote` registra **solo el total anterior y el nuevo**, y **solo cuando el evento
ya estaba apartado o formalizado** (`service.ts:392`). No registra que se cambió de salón ni
que los invitados pasaron de 200 a 300 — precisamente lo que se pidió ver en el BI.

Cambios:

- El `meta` de las entradas `edicion` captura **antes y después** de: `spaceIds`,
  `invitados`, `fechaEvento`, `total` y `rentaTotal`.
- Se registra en **toda** edición, no solo en las que ya tienen compromiso de pago.
- Solo se escribe la entrada si algo cambió de verdad, para no llenar la bitácora de ruido
  cuando se guarda sin modificar nada.

### Rendimiento

Las consultas incluyen sus relaciones en una sola pasada (`include`), sin N+1. `limit` tiene
tope duro. Los endpoints son de solo lectura, así que no compiten con la operación.

---

## Pruebas

**Motor de precios (`packages/shared`), unitarias:**
- `spaceId` presente en las líneas de renta de espacio y ausente en las demás.
- Suma de renta con dos y tres espacios.
- `requisitosFactura`: RFC válido e inválido, CP de 4 y 5 dígitos, régimen desconocido,
  cliente vacío, cliente completo.

**Estado de cuenta (`apps/api/src/quotes/estadoCuenta.test.ts`), unitarias:**
- **Regresión clave:** con un solo espacio, el plan es idéntico al de antes del cambio.
- Anticipo con dos espacios = suma de anticipos.
- Complemento con dos espacios = suma proporcional, con números verificados a mano.
- Un espacio sin regla entre varios ⇒ `planPendiente: true`.
- `liquidarDiasAntes` toma el máximo.

**API, integración (Postgres en Docker 5434):**
- Crear con 1, 2 y 3 espacios funciona; con 4 responde 400.
- Un evento `formalizada` bloquea el espacio: crear otro en la misma fecha responde **409**
  llamando la API directo, sin pasar por el navegador (es la prueba de que el bloqueo ya vive
  en el servidor).
- Editar una cotización sin moverla de fecha ni espacio **no** se auto-bloquea
  (`excludeQuoteId` funcionando).
- Cotizaciones sin pago no bloquean.
- Con varios espacios, basta que **uno** esté bloqueado para responder 409.
- `PATCH /quotes/:id/fecha`: recalcula el total al cambiar de sábado a martes; rechaza
  `liquidada`; rechaza si el destino está bloqueado; escribe la bitácora.
- La bitácora de edición captura antes/después de espacios, invitados y fecha.
- Datos fiscales se persisten en el cliente y se reutilizan al reutilizar cliente.
- BI: sin llave ⇒ 401; con llave mala ⇒ 401; con llave buena ⇒ 200 con datos; `limit` por
  encima del tope se recorta; sin `BI_API_KEY` en el entorno ⇒ 404.

**Navegador, extremo a extremo:**
- Selector con colores en las tres condiciones (libre, con cotizaciones, bloqueado).
- Crear un evento con dos salones y verificar el plan de pagos contra el cálculo a mano.
- Arrastrar un evento a otra fecha, ver el cambio de total en el diálogo, confirmar y
  verificar bitácora y desglose.
- Marcar "requiere factura", ver la lista de faltantes tacharse conforme se captura, y verlo
  en el contrato.
- Que el valet no aparezca en ningún lado.

---

## Orden de construcción

Tres planes de implementación, por dependencias reales:

**Plan A — estatus, bloqueo en servidor, multi-salón y colores** (cambios 1, 2, 3). Se
encadenan: el renombrado de estatus redefine los niveles de disponibilidad, de los que
dependen tanto la validación en el servidor como los colores; y multi-salón toca el mismo
estado de cuenta. Es el plan más grande de los tres.

**Plan B — valet, facturación y arrastrar** (cambios 5, 6, 4). Independientes entre sí.
Arrastrar depende del bloqueo del Plan A.

**Plan C — API del BI** (cambio 7). Depende de facturación (Plan B) para el endpoint de
datos fiscales y de la bitácora enriquecida.

Cada plan cierra con `pnpm typecheck` y `pnpm test` verdes y verificación en navegador antes
de pasar al siguiente.

---

## Hallazgos pendientes de decisión (descubiertos al implementar, 2026-08-03)

### 1. La tabla de pagos del contrato afirma una multiplicación que no cuadra

**PREEXISTENTE — no lo introdujo este plan, pero sigue ahí y está en un documento que se
firma.** Verificado en el navegador con un evento real de Cúpula + Arcos:

> `Total del evento | $45,000.00 | 19.2% sobre el total = $99,350.00`

19.2% de $282,500 son **$54,240**, no $99,350. El $99,350 es el objetivo **acumulado**
(anticipo $45,000 + complemento $54,350). O sea: el porcentaje se refiere al complemento
solo, y el monto al acumulado — la frase los presenta como si uno fuera el producto del otro.

Confirmado preexistente: antes del Plan A, `objComplemento = anticipo + pct × total` y el
contrato ya decía `${porcentaje}% sobre el total = ${objetivo}`. Con Arcos solo (10%, anticipo
$20,000, total $100,000) imprimía "10% sobre el total = $30,000" cuando 10% de 100,000 son
10,000. El multi-salón no lo creó; solo lo vuelve más visible al hacer los porcentajes
fraccionarios.

**No se corrigió porque es texto de un contrato legal** y puede haber pasado por revisión
jurídica. Opciones:
1. Mostrar el monto incremental: "19.2% sobre el total = $54,350" y poner el acumulado en
   otra columna. Es la lectura natural de una tabla cuyos renglones son pagos a realizar.
2. Cambiar la frase para que sea cierta sin mover números: "19.2% sobre el total, para
   acumular $99,350".
3. Dejarlo. Nadie se ha quejado en la operación actual.

Recomendación: la 2, que es la de menor riesgo jurídico (no cambia ninguna cantidad, solo
deja de afirmar una igualdad falsa).

### 2. `updateStatus` no valida disponibilidad

**`updateStatus` no valida disponibilidad, y es la vía realista de doble reserva.**
Verificado experimentalmente: dos cotizaciones en borrador para la misma fecha y salón son
ambas legítimas (un borrador no bloquea). Si A se formaliza y luego B se formaliza mediante
`PATCH /quotes/:id/status`, las dos quedan comprometidas sobre el mismo espacio. El guardia
que se agregó en el Cambio 1 cubre crear y editar, pero no el cambio de estatus.

No se corrigió porque **la solución obvia es peor que el problema**: `registerPayment`
avanza el estatus automáticamente, así que bloquear `updateStatus` significaría que un pago
puede ser **rechazado** porque alguien más comprometió el espacio mientras tanto. Negarse a
registrar dinero que ya entró es peor que la doble reserva que evita.

Opciones para el dueño del producto:
1. Bloquear solo el cambio de estatus **manual**, dejando pasar el automático por pago (el
   evento queda comprometido y el desfase se resuelve a mano).
2. Permitirlo siempre pero **alertar** en el dashboard cuando dos eventos comprometidos
   comparten fecha y espacio.
3. Dejarlo como está: el aviso del navegador basta y coordinación lo resuelve.

Recomendación: la 2. No pierde dinero registrado, no bloquea a nadie, y hace visible el
conflicto a quien puede resolverlo. Requiere un plan aparte.

## Fuera de alcance

- Timbrado de CFDI ante un PAC (el modelo queda preparado).
- Conciliación bancaria automática con el número de referencia SPEI.
- Reglas de pago de los espacios sin configurar (Los Balcones, Los Pajaritos, Jardín del
  Caballo, La Capilla): faltan los montos del cliente. Siguen como "plan pendiente".
- Reescribir desgloses de cotizaciones existentes.
- Firma digital con Mifiel y correo diario de la hoja operativa: pendientes previos, ajenos
  a este paquete.
