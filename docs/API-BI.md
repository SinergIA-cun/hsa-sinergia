# API de solo lectura para el BI

## Advertencia

La llave da acceso de lectura a TODOS los datos comerciales y fiscales de la hacienda:
clientes, RFC, montos y pagos. Va en un secreto de la plataforma, nunca en el repositorio.
Se revoca cambiándola: no hay lista de revocación ni caducidad.

## Autenticación

Encabezado `x-api-key`. Generar con `openssl rand -hex 32`.
En EasyPanel: variable de entorno `BI_API_KEY` del servicio de la API.
Sin la variable, estas rutas no existen y responden 404.

```bash
curl -s -H "x-api-key: $BI_API_KEY" 'https://hsaapi.somossinergia.com/api/bi/eventos?desde=2026-01-01&hasta=2026-12-31'
```

Sin llave (o con una equivocada) la respuesta es un 401 genérico, que nunca repite la llave
recibida:

```json
{"error":"Llave de API inválida o ausente."}
```

Con `BI_API_KEY` no hay ningún endpoint de escritura: `POST`, `PATCH` y `DELETE` sobre estas
rutas responden 404, y hay una prueba automatizada que se pone en rojo si alguien agrega uno.

La **única** escritura es la importación de eventos (ver la sección *Importar y conciliar* al
final), y va con **otra llave**, `BI_IMPORT_API_KEY`. La de lectura no la abre (401).

## Envoltura de respuesta

Todos los endpoints devuelven la misma envoltura. Ejemplo real de
`GET /api/bi/eventos?desde=2031-01-01&hasta=2031-12-31&limit=1`:

```json
{
    "desde": "2031-01-01",
    "hasta": "2031-12-31",
    "limit": 1,
    "siguienteCursor": "cmsj6fu670002cbravm6zi175",
    "datos": [
        {
            "id": "cmsj6fu670002cbravm6zi175",
            "fechaEvento": "2031-09-13",
            "estatus": "borrador",
            "tipoEvento": "Boda",
            "invitados": 220,
            "espacios": ["cmrbk0ags0003cb6vhpboivie"],
            "esCortesia": false,
            "requiereFactura": true,
            "cliente": {
                "id": "cmsj6fu630000cbraxw735e3m",
                "nombre": "Ejemplo Docs BI",
                "referencia": 3712
            },
            "vendedora": {
                "id": "cmrc3csxf0000cb9e5uc63ljz",
                "nombre": "Administrador"
            },
            "banquetero": null,
            "renta": { "subtotal": 150000, "total": 174000 },
            "otros": { "total": 0 },
            "total": 174000
        }
    ]
}
```

| Campo | Qué es |
|---|---|
| `desde` / `hasta` | El rango efectivamente aplicado (`YYYY-MM-DD`), ya con los valores por omisión resueltos. |
| `limit` | El tope efectivo de filas, ya recortado (ver abajo). |
| `siguienteCursor` | `id` de la última fila si la página vino llena; `null` si ya no hay más. |
| `datos` | Las filas. Siempre un arreglo, nunca `null`. |

### Parámetros de consulta

| Parámetro | Formato | Por omisión |
|---|---|---|
| `desde` | `YYYY-MM-DD` | 1 de enero del año en curso |
| `hasta` | `YYYY-MM-DD` | 31 de diciembre del año en curso |
| `limit` | entero positivo | 100, con tope duro de 500 |
| `cursor` | `id` de una fila | sin cursor (primera página) |
| `ids` | ids de **eventos** separados por coma (hasta 100) | sin `ids`: el rango manda. Con `ids`, `/eventos`, `/pagos`, `/cargos` y `/devoluciones` traen lo de esos eventos **sin importar la fecha** (es como se relee lo que `/cambios` dijo que cambió). |

Un `limit` mayor a 500 se recorta a 500: un BI que pida 100000 recibe 500 filas, no un
timeout. Un `desde`/`hasta` con formato distinto a `YYYY-MM-DD` responde 400
(`{"error":"Parámetros inválidos"}`), no un rango silenciosamente mal interpretado.

**Límite de llamadas:** 200 por minuto por IP, para toda la API. Más allá responde 429.

## Leer lo incremental (cada minuto)

1. `GET /api/bi/cambios?desde=<día del último cambio visto>&cursor=<último id visto>`: trae lo
   nuevo de la bitácora en orden (`createdAt`, `id`). Guarden el último `id` como cursor.
2. Junten los `quoteId` que aparecieron y reléanlos con `?ids=` en `/eventos`, `/pagos`,
   `/cargos` y `/devoluciones` (hasta 100 por llamada). Así se ve el estado **actual** de cada
   evento, aunque el cambio no haya movido ninguna fecha (un pago capturado tarde, una edición).
3. Un cambio con `eventoEnPapelera: true` es de un evento que hoy está en la papelera: ya no sale
   en `/eventos` ni en `/pagos`. Si el último es `eliminada`, dénlo de baja; si después llega
   `restaurada`, volvió.
4. Los apartados no tienen bitácora: `/apartados` se relee por ventana de fechas.

## Paginación

Se repite la misma llamada pasando `cursor=<siguienteCursor>` hasta que `siguienteCursor`
venga `null`:

```bash
CURSOR=""
while :; do
  RESP=$(curl -s -H "x-api-key: $BI_API_KEY" \
    "https://hsaapi.somossinergia.com/api/bi/eventos?desde=2026-01-01&hasta=2026-12-31&limit=500&cursor=$CURSOR")
  echo "$RESP" | jq -c '.datos[]'
  CURSOR=$(echo "$RESP" | jq -r '.siguienteCursor // empty')
  [ -z "$CURSOR" ] && break
done
```

El orden dentro de cada endpoint es total (fecha, y el `id` desempata), así que ninguna fila
se repite ni se salta entre páginas aunque varios eventos caigan el mismo día.

**`/pagos-esperados` es la excepción: no pagina.** Sus filas son hitos derivados del plan de
pagos y no tienen `id` propio, así que su `siguienteCursor` siempre es `null`. Además su
`limit` acota los EVENTOS examinados, no las filas devueltas: con más de `limit` eventos
formalizados o complementados vivos, el resultado se trunca en silencio. Mientras la hacienda
esté por debajo de 500 eventos con compromiso de pago simultáneos, `limit=500` lo cubre todo;
si algún día los rebasa, hay que acotar el rango de vencimiento (trimestre por trimestre) o
agregarle paginación real al endpoint.

## Endpoints

### `GET /api/bi/eventos`

Todos los eventos vivos (no en la papelera) cuya **fecha de evento** cae en el rango, con el
desglose separado en dos bloques: `renta` es lo que cobra la hacienda y `otros` lo que se
paga al proveedor de alimentos y servicios.

- **Rango sobre:** `fechaEvento`.
- **Ejemplo:** ver la envoltura de arriba.

**El código del evento es el identificador principal.** Cada evento trae:

| Campo | Qué es |
|---|---|
| `codigo` | El código vigente, `04SEP26-HLANGRUEN-CUPULA` (día, mes, año, inicial + apellido del cliente, salón). Cambia si el evento se mueve de fecha o de salón, o si cambia el cliente. Dos eventos vivos nunca lo comparten: el segundo lleva sufijo (`-2`). |
| `codigos` | Todos los que ha tenido, del primero al vigente: `{ codigo, motivos, fechaEvento, desde }`. `motivos` es `alta`, `fecha`, `espacio`, `cliente` o `repetido`. Sirve para cuadrar registros que traen un código viejo. |
| `folio` | La llave interna (`26SEP-0184`). No cambia nunca. |
| `id` | El id técnico. Tampoco cambia. |

Los demás endpoints traen `eventoCodigo` (el código vigente del evento al que pertenece cada
renglón) además del id o el folio. Un evento que se mueve de fecha sale con su código nuevo;
como `/eventos` filtra por fecha de evento, para seguirlo hay que usar `id` o `folio`.

```json
{
  "id": "cm…",
  "codigo": "11SEP26-HLANGRUEN-CUPULA",
  "codigos": [
    { "codigo": "04SEP26-HLANGRUEN-CUPULA", "motivos": ["alta"], "fechaEvento": "2026-09-04", "desde": "2026-03-02T17:10:00.000Z" },
    { "codigo": "11SEP26-HLANGRUEN-CUPULA", "motivos": ["fecha"], "fechaEvento": "2026-09-11", "desde": "2026-08-20T15:31:00.000Z" }
  ],
  "folio": "26MAR-0021"
}
```

**Standby y cancelados.** `estatus` puede ser también `standby` (el evento se quedó sin
fecha: `fechaEvento` es la que TENÍA) o `cancelada`. Los dos sueltan la fecha: no ocupan agenda.

| Campo | Qué es |
|---|---|
| `standby` | `null`, o `{ desde, motivo, estatusPrevio }`: desde cuándo está sin fecha y a qué estatus vuelve al reprogramarse. |
| `cancelacion` | `null`, o `{ fecha, motivo, porcentaje, pagado, devolver, retenido, devuelto, pendiente }`: lo pagado al cancelar, el porcentaje que se acordó devolver, cuánto es, lo que se retiene, lo ya devuelto desde la cancelación y lo que falta. Las devoluciones en sí salen en `/devoluciones`. |
| `descuento` | `null`, o `{ porcentaje, monto, motivo }`: el descuento sobre la renta, en **porcentaje o en monto fijo** (pesos con IVA); uno de los dos viene en `null`. `esCortesia` / `esPromocion` dicen de qué tipo es. Ya está aplicado en `renta.total` y `total`. |
| `salones` | Los nombres de `espacios`, en el mismo orden. |
| `salonPrincipal` | `{ id, nombre }`: el **primero** de `espacios`, que es el que va en el código del evento (`…-CUPULA`). `null` en un evento sin salón (solo capilla, sesión de fotos). |
| `rentaPorSalon` | `[{ espacioId, salon, monto }]`: la renta repartida entre los salones del evento, en proporción a la renta de catálogo de cada uno (la misma regla que el plan de pagos). **Suma `renta.total`**, con horas extra, descuento y cargos que suben el contrato ya repartidos. Un evento importado con varios salones se reparte en partes iguales. Vacío en un evento sin salón (solo capilla, sesión de fotos): ahí la suma **no** cuadra con `renta.total`, porque no hay salón al cual cargarla. |
| `usaCapilla`, `capillaHorario` | La capilla es una marca del evento (no cobra ni bloquea); el horario es texto libre o `null`. |
| `desglose` | Lo vendido, renglón por renglón (ver abajo). Los de `bloque: "renta"` suman `renta.total` y los de `bloque: "otros"` suman `otros.total`, exacto. Los de `bloque: "banquetero"` **no suman a nada**. |

#### `desglose[]`

Cada renglón del desglose guardado con el evento, en datos y no en texto:

| Campo | Qué es |
|---|---|
| `id` | Fijo mientras el renglón exista: `{quoteId}:{tipo}[:{id}]`. Un cargo del punto de venta es `{quoteId}:cargo:{cargoId}`. |
| `bloque` | `renta` (lo cobra la hacienda), `otros` (alimentos y servicios) o `banquetero` (lo que pone el banquetero; informativo, fuera de los totales). |
| `tipo` | `rentaSalon`, `descuento`, `horasExtra`, `capilla`, `descuentoAlimentos`, `cargoContrato` (bloque renta); `alimentos`, `servicioCatalogo`, `djHoraExtra`, `servicioEvento`, `pactado` (bloque otros); `servicioBanquetero` (bloque banquetero). `pactado` es el renglón único de "alimentos y servicios" de un evento importado. `otro` = un renglón de un evento viejo que no se pudo identificar. |
| `clave` | La clave **fija** de lo vendido: el `espacioId` (`rentaSalon`), la `clave` del paquete (`alimentos`) o del servicio (`servicioCatalogo`) de `/catalogos`, el `producto` del punto de venta (`cargoContrato`). `null` en los demás, y en un `servicioEvento` (tecleado en el evento, sin catálogo). |
| `nombre`, `detalle` | Como se ven en el contrato. |
| `categoria` | La del servicio en el catálogo (puede ser `null`). Solo en `servicioCatalogo`. |
| `cantidad`, `unidad` | `unidad`: `evento`, `personas`, `horas` o `unidades`. |
| `precioUnitario` | Con IVA. Es el precio del catálogo **del evento** (cada evento se queda con su catálogo); no hay descuento por renglón. |
| `subtotal`, `total` | Sin IVA y con IVA. El último renglón de cada bloque absorbe los centavos de redondeo. |
| `origen` | `contrato`, o `puntoDeVenta` para un cargo que sube el contrato (`cargoId` trae el id del cargo de `/cargos`). |
| `proveedor`, `comision` | Solo en `servicioCatalogo` con proveedor: `{ clave, nombre }` y `{ porcentaje, monto }`. La comisión es un % sobre el **subtotal sin IVA** del renglón. `null` si no tiene. |
| `cobra` | Solo en `servicioCatalogo`: `proveedor` (el cliente le paga directo al proveedor, que le debe la comisión a la hacienda) o `hacienda` (la hacienda lo cobra y le paga al proveedor). `null` en los demás. |
| `banquetero` | Solo en `bloque: "banquetero"`: `{ id, nombre }`. `null` en los demás. |

**Proveedor, comisión y `cobra` se congelan con el evento**, igual que el precio: son los que tenía
el servicio cuando se guardó el evento. Si después la hacienda cambia el catálogo, los eventos ya
guardados no se mueven; al **reeditar** un evento, se recalcula con su catálogo (como el precio).
Los eventos guardados antes del 6-oct-2026 se congelaron al arrancar con lo que tenía el catálogo
ese día.

**`cobra: "hacienda"` es un dato, no cambia los cobros:** `/pagos` no cambia (ni destino ni
concepto), el plan de pagos sigue siendo solo de la renta, y el pago al proveedor no se registra
en el Cotizador.

**Lo que pone el banquetero** (`servicioBanquetero`): se captura en el evento, solo si tiene
banquetero. `nombre`, `cantidad` y `total` (lo que cobra el banquetero; puede ser `null`).
`precioUnitario` = `total / cantidad`, o `null`. `subtotal` siempre `null`. No hay IVA ni clave.
`id` = `{quoteId}:servicioBanquetero:{n}`, por posición.

```json
"desglose": [
  { "id": "cm…q:rentaSalon:cm…arcos", "bloque": "renta", "tipo": "rentaSalon", "clave": "cm…arcos", "nombre": "Renta Arcos", "detalle": null,
    "categoria": null, "cantidad": 1, "unidad": "evento", "precioUnitario": 108500, "subtotal": 93534.48, "total": 108500,
    "origen": "contrato", "cargoId": null, "proveedor": null, "comision": null },
  { "id": "cm…q:descuentoAlimentos", "bloque": "renta", "tipo": "descuentoAlimentos", "clave": null, "nombre": "Descuento por alimentos (5% renta)",
    "cantidad": 1, "unidad": "evento", "precioUnitario": -5425, "subtotal": -4676.72, "total": -5425, "origen": "contrato", "…": "…" },
  { "id": "cm…q:alimentos:cm…pkg", "bloque": "otros", "tipo": "alimentos", "clave": "cm…supreme", "nombre": "Alimentos SUPREME", "detalle": "200 × 999",
    "cantidad": 200, "unidad": "personas", "precioUnitario": 999, "subtotal": 172241.38, "total": 199800, "origen": "contrato", "…": "…" },
  { "id": "cm…q:servicioCatalogo:cm…a1", "bloque": "otros", "tipo": "servicioCatalogo", "clave": "cm…dulces", "nombre": "Mesa de dulces (por persona)",
    "detalle": "× 200", "categoria": "Dulces", "cantidad": 200, "unidad": "personas", "precioUnitario": 127.6, "subtotal": 22000, "total": 25520,
    "origen": "contrato", "cargoId": null, "proveedor": { "clave": "cm…prov", "nombre": "Dulces Lupita" }, "comision": { "porcentaje": 10, "monto": 2200 } },
  { "id": "cm…q:servicioEvento:1", "bloque": "otros", "tipo": "servicioEvento", "clave": null, "nombre": "Tornaboda", "detalle": null,
    "cantidad": 1, "unidad": "evento", "precioUnitario": 8000, "subtotal": 6896.55, "total": 8000, "origen": "contrato", "…": "…" }
]
```

- **Un servicio tecleado en el evento sigue siendo `servicioEvento`** aunque después se dé de alta
  en el catálogo: el renglón no se liga solo. Para ligarlo, se edita el evento y se cambia por el
  del catálogo (queda como `servicioCatalogo` con su `clave`, al precio del catálogo).
- No hay fecha ni autor por renglón. Lo agregado después de contratar sale de `/cambios`
  (`detalle.servicios` de cada `edicion`) y de `/cargos` (punto de venta).

> El historial empieza el 1-oct-2026 con el código que cada evento tenía ese día. Los
> cambios de antes no se pueden reconstruir: el código depende del nombre del cliente en ese
> momento, y ese dato no se guardó.

> `renta.subtotal` sale de la copia del desglose guardada con el evento. Los eventos creados
> **antes** de que el motor separara renta y "otros" no lo traen: para esos el campo llega
> como `null` explícito (no desaparece del JSON). `renta.total` y `total` siempre están.

### `GET /api/bi/pagos`

Pagos realmente recibidos, con su estado de facturación según el candado (el ingreso se
factura en el mes en que se recibe; pasado ese mes se va a la global de público en general).
Incluye los pagos anulados, marcados como tales — el BI decide si los descuenta.

- **Rango sobre:** `fecha` del pago (la fecha en que entró el dinero, no la del evento).
- **`concepto`** (etiquetas del BI desde el 5-oct-2026): `anticipo` = el primer pago; `finiquito` =
  el que deja lo que se debe del contrato en \$1,000 o menos por primera vez (si un solo pago lo
  cubre todo, es finiquito); `aCuenta` = los demás. Se recalcula con cada cambio de dinero (y
  cada reclasificación queda en `/cambios`). `complemento` ya no se usa; los hitos del plan de
  pagos (`/pagos-esperados`) sí conservan el suyo.
- **`idBI`**: el `idBI` con el que el pago llegó del BI (un pago de evento importado, o el abono de
  un apartado importado que se convirtió); `null` si **nació en el Cotizador**. Es la llave para no
  contar dos veces lo que el BI ya tiene: el folio solo no basta (hubo folios repetidos) ni la fecha
  (un recibo viejo capturado tarde es nuevo). `/ingresos` trae el mismo campo.

Real, de `GET /api/bi/pagos?desde=2026-08-01&hasta=2026-08-31`:

```json
{
    "desde": "2026-08-01",
    "hasta": "2026-08-31",
    "limit": 100,
    "siguienteCursor": null,
    "datos": [
        {
            "id": "cmsj6gmfg000fcbra8r9gqio5",
            "folio": 989,
            "quoteId": "cmsj6g0l70007cbraofce8yu1",
            "cliente": "Ejemplo Docs BI",
            "fecha": "2026-08-05",
            "monto": 50000,
            "metodo": "transferencia",
            "formas": [{ "forma": "transferencia", "monto": 50000 }],
            "pagoBanqueteroId": null,
            "folioTexto": "I 989",
            "concepto": "anticipo",
            "registradoPor": "Administrador",
            "anulado": false,
            "anuladoPor": null,
            "motivoAnulacion": null,
            "facturable": true,
            "motivoFactura": null,
            "facturadoAt": null,
            "facturaUuid": null
        }
    ]
}
```

`facturable: false` viene siempre acompañado de `motivoFactura` con el texto exacto que ve la
persona en la app: `"El pago está anulado."`, `"Ya se facturó este pago."` o
`"Cerró marzo sin CFDI: este pago se facturó a público en general."`.

> **Notas.** `/pagos` e `/ingresos` traen `notas`: lo que anotó quien registró el dinero para
> entenderlo ("pagó la tía", "el cheque se cobra el lunes"). Texto libre, puede ser `null`. Un
> pago que salió de repartir un depósito hereda las notas del depósito.

### `GET /api/bi/ingresos`

**Cada dinero que entró, una fila por folio.** Es la hoja foliada de la hacienda (serie
`I`), digitalizada: pagos directos, depósitos de banquetero y abonos directos a fechas
apartadas. Es lo que se concilia contra el banco y contra la caja.

- **Rango sobre:** `fecha` en que se recibió el dinero.
- **Diferencia con `/pagos`:** `/pagos` es una fila por *aplicación a un evento*. Un depósito
  de banquetero repartido en tres eventos es **una** fila aquí y **tres** en `/pagos`, las tres
  con el mismo `folio` y el mismo `pagoBanqueteroId`, y cada una con su `folioLetra` (`A`, `B`,
  `C`; `folioTexto` = `"I 5340-B"`). Sumar `/pagos` y `/ingresos` duplica.
- `id` va prefijado con el tipo (`pago:…`, `deposito:…`, `abono:…`); es el cursor.

```json
{
    "id": "deposito:cmuoh7x0a0002cbh9…",
    "tipo": "deposito",
    "folio": 5340,
    "folioTexto": "I 5340",
    "fecha": "2026-10-05",
    "monto": 100000,
    "metodo": "mixto",
    "formas": [
        { "forma": "transferencia", "monto": 90000 },
        { "forma": "cheque", "monto": 10000 }
    ],
    "referencia": null,
    "anulado": false,
    "de": "Banquetería Ramírez",
    "quoteId": null,
    "eventoFolio": null,
    "banqueteroId": "cmr…",
    "apartadoId": null
}
```

`folio: null` (`folioTexto: "sin folio"`) = un depósito o abono registrado antes de que
existiera el folio; nada se renumeró.

### `GET /api/bi/cargos`

Lo cargado al evento en el punto de venta **después de contratar**. Cada renglón trae
**`afectaContrato`** (decisión del dueño, 5-oct-2026):

- **`true`: sube el valor del contrato.** Hora extra de salón (`horaExtra`) e invitados extra,
  PAX (`invitadoExtra`). Se suman al desglose del evento: **ya están en `total` y en
  `renta.total` de `/eventos`**, mueven su saldo y su estatus (un evento liquidado vuelve a
  deber), y se cobran con pagos normales del evento (`destino: "evento"`). No sumarlos aparte.
- **`false`: cuenta aparte.** Hora extra de DJ, alimentos de invitados extra, PAX banquete
  (personas adicionales del banquetero, precio tecleado), daños, multas, gastos imprevistos y
  otros. **No** cambian `/eventos.total`; van en `cargosAdicionales: { total, pagado, saldo }`
  de `/eventos`, y se cobran con `destino: "cargos"`.

La lista con su `afectaContrato` está en `/catalogos.productosCargo`.

- **Rango sobre:** `fecha` del cargo (el día de la venta). Incluye los anulados, marcados.

```json
{
    "id": "cmuoib8py0007cbejiorzabcf",
    "quoteId": "cmsj93pl20002cbrfoex3bnxe",
    "eventoFolio": "26SEP-0007",
    "fechaEvento": "2031-04-12",
    "cliente": "Demo Candado D2",
    "fecha": "2026-09-30",
    "producto": "horaExtra",
    "productoNombre": "Hora extra de salón",
    "descripcion": "Hora extra de salón",
    "cantidad": 2,
    "precioUnitario": 5425,
    "total": 10850,
    "registradoPor": "Administrador",
    "anulado": false,
    "motivoAnulacion": null
}
```

`producto` es uno de `horaExtra`, `djHoraExtra`, `invitadoExtra` (su renta),
`invitadoExtraAlimentos` (sus alimentos, que se le pagan al proveedor), `danos`, `multa`,
`gastoImprevisto`, `otro`. Los montos traen IVA incluido.

### `GET /api/bi/devoluciones`

**Dinero que salió**: devoluciones a clientes y a banqueteros. No llevan folio de la serie I
(que numera lo que entra). Lo devuelto **ya viene descontado** de lo pagado en el estado de
cuenta de la hacienda, pero `/pagos` e `/ingresos` siguen trayendo el pago original tal cual:
para el neto, restar esto.

- **Rango sobre:** `fecha` (cuándo salió el dinero). Incluye las anuladas, marcadas.
- `de`: `evento` (de la renta), `cargos` (de la cuenta del punto de venta) o `banquetero`
  (de su saldo a favor; `depositoFolio` dice de qué depósito, `null` = del saldo que le
  liberaron sus apartados).
- `notaCreditoUuid`: la nota de crédito (CFDI de egreso), si el pago ya estaba facturado.

Cada renglón (todos los campos; los de evento son `null` en una devolución de banquetero):

```json
{
  "id": "cm…",
  "fecha": "2026-10-20",
  "monto": 15000,
  "metodo": "transferencia",
  "formas": [{ "forma": "transferencia", "monto": 15000 }],
  "de": "evento",
  "quoteId": "cm…",
  "eventoFolio": "26SEP-0151",
  "eventoCodigo": "14NOV26-JPEREZ-ARCOS",
  "cliente": "Juan Pérez",
  "banqueteroId": null,
  "depositoFolio": null,
  "motivo": "Cancelación: se devuelve el 50% de lo pagado",
  "referencia": "SPEI 0043128",
  "notaCreditoUuid": null,
  "registradoPor": "Administrador",
  "anulado": false,
  "motivoAnulacion": null
}
```

Una devolución de **banquetero** (de su saldo a favor, sin evento) trae `de: "banquetero"`,
**`quoteId`, `eventoFolio` y `eventoCodigo` en `null`**, `banqueteroId` con su id, `cliente` con
el nombre del banquetero y, si salió de un depósito, `depositoFolio`.

### Formas de pago

`metodo` es uno de `efectivo`, `cheque`, `transferencia`, `tarjetaDebito`,
`tarjetaCredito`, `mixto` (pago dividido) o `tarjeta` (pagos viejos, de antes de separar
débito y crédito). `formas` trae siempre las partes, que suman `monto`: un pago de una sola
forma trae una parte. Un pago que salió de un depósito dividido viene `mixto` con una sola
parte `mixto`: el detalle por forma vive en el depósito (en `/ingresos`).

Desde el 5-oct-2026 **la misma forma puede repetirse** (dos transferencias de bancos distintos en
un pago) y cada parte puede traer **`nota`** (texto libre, opcional: banco, referencia, quién
pagó): `{"forma": "transferencia", "monto": 6000, "nota": "BBVA"}`. Es interna: la página del
cliente no la muestra.

### `GET /api/bi/pagos-esperados`

Hitos de cobro **pendientes** (apartar, complemento, finiquito) del plan de pagos de los
eventos formalizados y complementados. Los hitos ya cubiertos no aparecen.

- **Rango sobre:** `venceISO`, la fecha de vencimiento del hito.
- **No pagina** (ver la sección de paginación).

Real, de `GET /api/bi/pagos-esperados?desde=2026-10-01&hasta=2026-12-31`:

```json
{
    "desde": "2026-10-01",
    "hasta": "2026-12-31",
    "limit": 100,
    "siguienteCursor": null,
    "datos": [
        {
            "quoteId": "cmsj6g0l70007cbraofce8yu1",
            "cliente": "Ejemplo Docs BI",
            "hito": "complemento",
            "etiqueta": "Complemento",
            "objetivo": 68500,
            "cubierto": 50000,
            "restante": 18500,
            "venceISO": "2026-11-07T16:46:58.810Z"
        }
    ]
}
```

`hito` es `apartar`, `complemento` o `finiquito`. `objetivo` es el acumulado que debe estar
pagado en esa fecha, `cubierto` lo que ya se pagó y `restante` la diferencia.

### `GET /api/bi/cambios`

La bitácora completa del evento. `tipo` es uno de: `creada`, `edicion` (contrato, fecha, salón,
invitados, notas de un pago, reclasificación de conceptos), `estatus`, `pago`, `pagoAnulado`,
`cargo`, `cargoAnulado`, `devolucion`, `devolucionAnulada`, `factura`, `fiscal`, `catalogo`,
`standby`, `cancelada`, `reprogramada`, `eliminada` (a la papelera) y `restaurada`. Es la fuente
para leer lo incremental (ver arriba). Incluye los de eventos que hoy están en la papelera, con
`eventoEnPapelera: true`.

- **Rango sobre:** `createdAt` del registro de bitácora (cuándo se hizo el cambio).

Real, de `GET /api/bi/cambios?desde=2026-08-07&hasta=2026-08-07&limit=2&cursor=cmsj6g0ld0009cbrac2kszkz6`:

```json
{
    "desde": "2026-08-07",
    "hasta": "2026-08-07",
    "limit": 2,
    "siguienteCursor": "cmsj6ggs9000dcbrayj5lesgn",
    "datos": [
        {
            "id": "cmsj6ggrr000bcbraac94lgz0",
            "quoteId": "cmsj6g0l70007cbraofce8yu1",
            "cliente": "Ejemplo Docs BI",
            "tipo": "edicion",
            "descripcion": "Edición en borrador: total 174000 → 174000",
            "detalle": {
                "fechaAntes": "2031-09-13",
                "totalAntes": 174000,
                "fechaDespues": "2031-09-13",
                "totalDespues": 174000,
                "espaciosAntes": ["cmrbk0ags0003cb6vhpboivie"],
                "invitadosAntes": 220,
                "espaciosDespues": ["cmrbk0ags0003cb6vhpboivie"],
                "rentaTotalAntes": 174000,
                "invitadosDespues": 240,
                "rentaTotalDespues": 174000
            },
            "actor": "Administrador",
            "fecha": "2026-08-07T16:46:58.792Z"
        },
        {
            "id": "cmsj6ggs9000dcbrayj5lesgn",
            "quoteId": "cmsj6g0l70007cbraofce8yu1",
            "cliente": "Ejemplo Docs BI",
            "tipo": "estatus",
            "descripcion": "Estatus: borrador → formalizada",
            "detalle": { "a": "formalizada", "de": "borrador" },
            "actor": "Administrador",
            "fecha": "2026-08-07T16:46:58.810Z"
        }
    ]
}
```

`tipo` es uno de `creada`, `estatus`, `pago`, `pagoAnulado`, `edicion`, `eliminada`,
`restaurada`. La forma de `detalle` depende del `tipo`; para `edicion` trae los pares
antes/después de invitados, espacios, fecha, total y renta. **Solo se escribe un `edicion` si
algo material cambió de verdad**: guardar sin tocar nada no ensucia la bitácora.

Si la edición agregó, quitó o cambió alimentos o servicios, `detalle.servicios` lo dice
(desde el 6-oct-2026):

```json
"servicios": {
  "agregados": [{ "tipo": "servicioEvento", "id": null, "clave": null, "nombre": "Barra libre", "detalle": { "tipoCobro": "fijo", "monto": 15000, "cantidad": 1 } }],
  "quitados":  [{ "tipo": "servicioCatalogo", "id": "cm…a1", "clave": "cm…dulces", "nombre": "Mesa de dulces (por persona)", "detalle": { "cantidad": 1 } }],
  "cambiados": [{ "tipo": "servicioEvento", "id": null, "clave": null, "nombre": "Tornaboda", "detalle": { "tipoCobro": "fijo", "monto": 9000, "cantidad": 1 }, "antes": { "tipoCobro": "fijo", "monto": 8000, "cantidad": 1 } }]
}
```

`tipo` es `alimentos`, `servicioCatalogo`, `servicioEvento` o `servicioBanquetero` (su `detalle`:
`{ cantidad, monto }`). Los tecleados y los del banquetero no tienen id: se emparejan por nombre.

`actor: null` significa que el cambio lo hizo el sistema, no una persona (por ejemplo el
vencimiento automático por vigencia).

### `GET /api/bi/catalogos`

Los valores fijos de las demás rutas, para traducir sin adivinar. Sin rango ni paginación:
`espacios` (`id`, `nombre`), `tiposEvento` (`id`, `nombre`, `slug`), `estatusEvento`,
`conceptosPago`, `destinosPago`, `productosCargo` (`producto`, `nombre`, `unidad`, `afectaContrato`),
`tiposIngreso`, `destinosDevolucion` y `tiposCambio`. `/eventos` además trae `salones` (los
nombres de `espacios`, en el mismo orden).

Y el catálogo de lo que se vende, **tal como lo tiene la hacienda** (todos los años):

- `catalogos`: `[{ id, nombre, anio, activo, capillaSabado, ivaRate }]`. Cada evento se queda con
  el suyo.
- `servicios`: `[{ id, clave, catalogoId, nombre, categoria, tipoCobro, unidad, cobra, precio,
  activo, proveedor, comisionPct }]`. `cobra`: `proveedor` o `hacienda` (ver `desglose[]`). `precio` es **sin IVA**. `id` cambia de un catálogo a otro; **`clave`
  es el mismo servicio en todos los años** (al clonar el catálogo se conserva). `tipoCobro`:
  `fijo`, `porPersona`, `porUnidad`. `proveedor`: `{ clave, nombre }` o `null`.
- `paquetesAlimentos`: `[{ id, clave, catalogoId, tipoEvento: { id, nombre }, nombre, ivaIncluido,
  incluye, precios: [{ min, max, precioPorPersona }] }]`. `clave` igual que en `servicios`.
- `proveedores`: `[{ clave, nombre, activo }]`.
- `tiposRenglon`: los `tipo` de `desglose[]`.

Un cambio al catálogo no sale en `/cambios`: el BI relee `/catalogos` en cada vuelta.

### `GET /api/bi/facturacion`

Los eventos marcados con `requiereFactura`, con los datos fiscales del cliente y la lista de
lo que todavía falta para poder timbrar.

- **Rango sobre:** `fechaEvento`.

Real, de `GET /api/bi/facturacion?desde=2031-01-01&hasta=2031-12-31`:

```json
{
    "desde": "2031-01-01",
    "hasta": "2031-12-31",
    "limit": 100,
    "siguienteCursor": null,
    "datos": [
        {
            "quoteId": "cmsj6fu670002cbravm6zi175",
            "fechaEvento": "2031-09-13",
            "total": 174000,
            "cliente": {
                "id": "cmsj6fu630000cbraxw735e3m",
                "nombre": "Ejemplo Docs BI",
                "rfc": "XAXX010101000",
                "razonSocial": null,
                "regimenFiscal": null,
                "cpFiscal": null,
                "usoCfdi": null,
                "correoFacturacion": "docs@ejemplo.mx"
            },
            "faltantes": [
                "Razón social",
                "Régimen fiscal",
                "Código postal fiscal",
                "Uso del CFDI"
            ]
        }
    ]
}
```

`faltantes` vacío significa que el cliente tiene todo lo que exige el CFDI 4.0.

### `GET /api/bi/apartados`

Las fechas apartadas (pagadas sin todos los datos del evento). Misma envoltura, parámetros y
paginación que `/eventos`; **el rango va sobre la fecha apartada**.

```json
{ "id": "cm…", "importadoBI": "09ENE27-CQUIROZ-CUPULA", "fecha": "2027-01-09", "salones": ["Cúpula"],
  "tipoEvento": "XV", "banquetero": null, "cliente": { "id": "cm…", "nombre": "…" }, "precioAcordado": 169000,
  "abonado": 25000, "estado": "vivo", "vence": "2027-01-09", "canceladoAt": null, "motivoCancelacion": null,
  "quoteId": null, "eventoFolio": null, "eventoCodigo": null, "eventoEnPapelera": false,
  "abonos": [ { "id": "cm…", "folio": 4467, "folioTexto": "I 4467", "fecha": "2025-11-25", "monto": 25000,
                "metodo": "transferencia", "formas": [], "referencia": null, "notas": null, "anulado": false, "paymentId": null } ],
  "createdAt": "2026-10-05T…" }
```

- `estado`: `vivo` (bloquea su fecha), `vencido`, `cancelado` o `convertido`.
- Al **convertirse en evento**, `quoteId`, `eventoFolio` y `eventoCodigo` dicen a cuál; el evento ya
  se lee en `/eventos`. Si ese evento se mandó a la papelera, `eventoEnPapelera: true` (y no sale
  en `/eventos`). Cada abono se vuelve un pago de ese evento con el mismo folio
  (`paymentId`), así que **no se suman dos veces**: lo abonado de un apartado convertido ya está
  en `/pagos` del evento.
- `importadoBI` es el `idBI` con el que llegó del BI (`null` si se apartó aquí). Cada abono trae su
  `idBI` y el apartado su `usaCapilla`.
- **El evento que sale de convertir un apartado importado hereda su `idBI`** en `/eventos` (con
  `origen: "bi"`); su código es el del Cotizador. Si el apartado traía `precioAcordado`, el evento
  queda con esa renta y precio pactado.

## Importar y conciliar (escritura, llave aparte)

El BI puede mandar eventos de **cualquier fecha**, sin corte:

- **Los que todavía no se celebran**, sin importar cuándo se contrataron. Entran como
  eventos normales: bloquean su fecha y sus pagos siguen aquí.
- **Los que ya pasaron**, de cualquier año, como historial. Se mandan igual, con sus pagos;
  al importarse quedan archivados en el Histórico y se les pueden cargar horas extra,
  multas, etc. desde el evento.

Llave: encabezado `x-api-key` con `BI_IMPORT_API_KEY` (distinta de `BI_API_KEY`). Sin esa
variable estas rutas no existen (404).

### `POST /api/bi/conciliar` — compara, **nunca escribe**

### `POST /api/bi/importar/eventos` — crea los nuevos y liga los indicados

Los dos reciben el mismo cuerpo y devuelven el mismo reporte. Lo recomendable: conciliar
primero, revisar, e importar después.

```json
{
  "pagosHasta": "2026-08-31",
  "completo": true,
  "eventos": [
    {
      "idBI": "EV-10233",
      "fechaContratacion": "2026-02-02",
      "fechaEvento": "2027-01-01",
      "tipoEvento": "Boda",
      "salones": ["Cúpula"],
      "invitados": 250,
      "cliente": { "nombre": "María López", "telefono": "5512345678", "correo": "maria@ejemplo.mx" },
      "banquetero": "Banquetería Ramírez",
      "festejado": "María y Juan",
      "vendedora": "Laura",
      "renta": { "total": 174000 },
      "otros": { "total": 210000 },
      "horaInicio": "18:00",
      "horaTermino": "02:00",
      "pagos": [
        { "idBI": "PG-1", "folio": 5101, "fecha": "2026-02-02", "monto": 25000, "metodo": "transferencia" },
        { "idBI": "PG-2", "folio": 5190, "fecha": "2026-06-15", "monto": 30000,
          "formas": [{ "forma": "tarjetaDebito", "monto": 10000 }, { "forma": "tarjetaCredito", "monto": 20000 }] }
      ]
    }
  ]
}
```

| Campo | Qué es |
|---|---|
| `idBI` | Id del evento en el BI. **Llave de idempotencia**: mandar el mismo evento dos veces no lo duplica. |
| `folioHSA` | Opcional. Folio de un evento que ya existe aquí (`26SEP-0184`), para ligarlo en vez de crearlo. |
| `codigo` | Opcional. El código con el que el evento ya circula (`04SEP26-HLANGRUEN-CUPULA`). Si aquí hay un evento que lo tiene **o lo tuvo**, se liga a ese. Si no hay ninguno, el evento nuevo nace con ese mismo código, para no cambiarle el nombre a algo que ya está en papel. |
| `fechaContratacion` | Cuándo se vendió. El folio del evento sale de este mes (`26FEB-…`), no de la fecha de importación. |
| `tipoEvento`, `salones` | Por nombre. Se comparan sin acentos ni mayúsculas y sin "Jardín/Salón/La/Los": `"Cúpula"` = `"Jardín La Cúpula"`. Lo que no coincide exacto **no se adivina**: el evento sale `invalido`. Tipos de evento: Boda, XV, Cumpleaños, Bautizo, Primera comunión, Empresarial, Fin de año, Renta, Graduación, Sesión de fotos, Team Building, Otros. |
| `salones: []` | Solo para un evento que **no ocupa salón**: uno solo de capilla (`usaCapilla: true`, código `…-CAPILLA`) o una **Sesión de fotos** (código `…-FOTOS`). No bloquea ningún salón ni sale `posibleDuplicado`. Cualquier otro evento sin salón sale `invalido`. |
| `usaCapilla`, `capillaHorario` | Opcionales. La capilla es una **marca del evento**, no otro evento: no cambia el precio pactado y **no bloquea** (varios eventos la usan el mismo día a horas distintas). Si el BI la manda, entra a `difiere` como campo `usaCapilla`; si no la manda, no se compara. |
| `banquetero`, `vendedora` | Por nombre. Si no se reconocen, el evento entra sin ellos y se avisa. |
| `renta.total` | Lo que cobra la hacienda, con IVA. Es el **precio pactado**. |
| `otros.total` | Alimentos y servicios (se pagan al proveedor), con IVA. |
| `pagos[].folio` | **Obligatorio**: el folio de la hoja foliada (serie I). Se conserva tal cual. |
| `pagos[].metodo` / `formas` | Igual que en `/pagos`: una forma, o las partes de un pago dividido (deben sumar `monto`). |
| `pagosHasta` | Hasta qué fecha tiene pagos el BI. Del lado de la hacienda solo se comparan los pagos hasta ese día: los de septiembre en adelante solo existen aquí y **es lo esperado**. |
| `completo` | `true` = el lote trae TODOS los eventos del BI. Solo así se reporta `soloEnHSA`. |

Hasta 200 eventos por llamada; para más, se manda por partes (todo es idempotente).

### El reporte

```json
{
  "resumen": { "nuevo": 1, "difiere": 1, "creados": 1 },
  "resultados": [
    { "idBI": "EV-10233", "estado": "nuevo", "accion": "creado", "folioHSA": "26FEB-0213", "codigoHSA": "13MAR27-JPEREZ-ARCOS", "quoteId": "cm…" },
    { "idBI": "EV-10240", "estado": "difiere", "folioHSA": "26AGO-0151",
      "diferencias": [
        { "campo": "invitados", "bi": 250, "hsa": 280 },
        { "campo": "folios", "bi": [5188], "hsa": [] }
      ] }
  ],
  "soloEnHSA": [
    { "quoteId": "cm…", "folioHSA": "26SEP-0190", "fechaEvento": "2027-03-13", "cliente": "Pérez", "idBI": null }
  ]
}
```

| `estado` | Qué pasó | Qué hacer |
|---|---|---|
| `nuevo` | No existe aquí. Con `importar` se **crea** (`accion: "creado"`). | Nada. |
| `igual` | Ya existe y cuadra. | Nada. |
| `difiere` | Ya existe y algo no cuadra (`diferencias`). **No se sobrescribe**: desde la importación la operación vive en la hacienda. | Cuadrarlo a mano en el sistema que esté mal. |
| `posibleDuplicado` | No está ligado, pero aquí ya hay algo esa fecha en ese salón (`candidatos`: un evento o un apartado). No se importa. | Si es el mismo evento, reenviarlo con `folioHSA` o `codigo` para ligarlo. Si no, es un empalme real. |
| `invalido` | Un salón o tipo de evento no reconocido, formas que no suman, folios repetidos… (`errores`). | Corregir en el BI y reenviar. |

`diferencias[].campo` es uno de `fechaEvento`, `salones`, `invitados`, `tipoEvento`,
`rentaTotal`, `pagado`, `folios` o `usaCapilla` (en `folios`, `bi` = folios que solo tiene el BI, `hsa` =
los que solo tiene la hacienda).

### Qué queda aquí de un evento importado

- Estatus **al menos formalizada** (es un evento vendido: bloquea su fecha); si sus pagos ya
  cruzaron un hito, sube solo, igual que con un pago capturado aquí.
- **Precio pactado**: su desglose son los montos del BI. Editarlo, moverlo de fecha o de
  catálogo **nunca** lo recotiza.
- Sus pagos con el folio de papel, y el concepto deducido del saldo.
- En `/eventos`: `origen: "bi"`, `idBI` y `contratadoEl`. Los vendidos aquí traen
  `origen: "hsa"`.
- **Evento de banquetero** (`banquetero` reconocido): el cliente **es el banquetero**. Se usa su ficha
  de cliente (por nombre; se crea con sus datos si no la tiene), así que todos sus eventos quedan
  con un solo cliente. El banquetero **nunca** se anota como festejado; el festejado solo es el
  campo `festejado`, si lo mandan. Si `cliente.nombre` no es el banquetero, el evento queda igual a
  nombre del banquetero y se avisa (`avisos`).
- **Evento directo**: el cliente se reutiliza solo si el **teléfono** coincide exacto; si no, se crea
  uno nuevo (uno por evento: dos personas con el mismo nombre nunca se mezclan).

### `POST /api/bi/conciliar/banqueteros` y `POST /api/bi/importar/banqueteros`

Dan de alta a los banqueteros del BI para que los eventos y apartados que se manden
después se liguen solos por el campo `banquetero`. Misma llave (`BI_IMPORT_API_KEY`).
`conciliar` **nunca escribe**; `importar` crea los que no existen. Es idempotente.

```json
{ "banqueteros": [ { "nombre": "Salvador Tenorio" }, { "nombre": "Carlos Barrera", "telefono": "5512345678" } ] }
```

| Campo | Regla |
|---|---|
| `nombre` | Obligatorio. Se compara como salones y tipos: sin acentos, mayúsculas ni puntuación. |
| `telefono`, `correo` | Opcionales. Solo se usan al **crear**; uno que ya existe no se toca. |

Hasta 200 por llamada. Respuesta:

```json
{
  "resumen": { "creado": 32, "existe": 1 },
  "resultados": [
    { "nombre": "Salvador Tenorio", "estado": "creado", "id": "cm…" },
    { "nombre": "Carlos Barrera", "estado": "existe", "id": "cm…" }
  ]
}
```

| `estado` | Qué pasó |
|---|---|
| `nuevo` | (Solo en `conciliar`.) No existe aquí; `importar` lo crearía. `id: null`. |
| `creado` | (Solo en `importar`.) Se dio de alta. |
| `existe` | Ya estaba (o venía antes en el mismo lote). No se tocó. |
| `ambiguo` | El nombre coincide con **dos o más** banqueteros de aquí (`coincidencias`). No se crea ni se liga: se resuelve a mano. |

Un banquetero sin teléfono ni correo puede tener eventos, pero para **convertir uno de sus
apartados** en evento la hacienda le tiene que capturar al menos uno de los dos (el
contrato los exige).

### `POST /api/bi/conciliar/apartados` y `POST /api/bi/importar/apartados`

Un **apartado** es una fecha pagada sin todos los datos del evento (falta el precio, los
invitados o los dos). Bloquea la fecha y el salón **como apartado**, no como vendido, y se
convierte en evento después, en la app. Misma llave; `conciliar` **nunca escribe**.

```json
{
  "pagosHasta": "2026-08-31",
  "apartados": [
    { "idBI": "15ENE28-VGONZALEZ-CUPULA", "fecha": "2028-01-15", "salones": ["Cúpula"],
      "tipoEvento": "Graduación", "banquetero": "Victor Gonzalez", "cliente": null, "precioAcordado": null,
      "pagos": [ { "idBI": "R-6054", "folio": 5009, "fecha": "2026-05-20", "monto": 25000, "metodo": "transferencia" } ] },
    { "idBI": "09ENE27-CQUIROZ-CUPULA", "fecha": "2027-01-09", "salones": ["Cúpula"],
      "tipoEvento": "XV", "banquetero": null, "cliente": { "nombre": "CAROLINA QUIROZ" }, "precioAcordado": 169000,
      "pagos": [ { "folio": 4467, "fecha": "2025-11-25", "monto": 25000, "metodo": "transferencia" } ] }
  ]
}
```

| Campo | Regla |
|---|---|
| `idBI` | Llave de idempotencia, igual que en eventos. |
| `fecha`, `salones` | Lo que se aparta. Mismas reglas de nombre que en eventos. |
| `banquetero` **o** `cliente` | Exactamente uno; con los dos o con ninguno se rechaza el lote entero (400). El banquetero tiene que estar dado de alta (`/importar/banqueteros`); si no, sale `invalido`. El cliente se reutiliza solo si el teléfono coincide exacto; si no, se crea. |
| `tipoEvento` | Opcional. Si no se reconoce, entra sin tipo y se avisa. Solo prellena la conversión. |
| `precioAcordado` | Opcional, pesos enteros. Es **la renta del salón** pactada (confirmado por el BI y el dueño). Al convertir, la renta por salón del contrato **se reemplaza por esta** (se quita el descuento de catálogo; horas extra, capilla y alimentos se quedan) y el evento queda con **precio pactado**: editarlo o moverlo no lo recotiza. |
| `usaCapilla` | Opcional. Marca de la fecha (no cobra ni bloquea); prellena la capilla al convertir. Entra a `difiere` solo si se manda. |
| `pagos[].idBI` | Se guarda en el abono y **pasa al pago del evento al convertir**; sale en `/pagos`, `/ingresos` y `/apartados`. |
| `pagos` | Igual que en eventos: folio de papel obligatorio, pesos enteros, `metodo` o `formas`. Entran como abonos a la fecha con su folio. Un folio que ya tiene otro dinero aquí vuelve el apartado `invalido`. |

Hasta 200 por llamada. Un apartado importado **no vence antes de su fecha** (uno capturado
aquí vence a los siete días hábiles). Estados del reporte:

| `estado` | Qué pasó |
|---|---|
| `nuevo` | No existe aquí; con `importar` se crea (`accion: "creado"`, `apartadoId`). |
| `igual` | Ya existe (por `idBI`) y cuadra. |
| `difiere` | Ya existe y algo no cuadra. `diferencias[].campo`: `fecha`, `salones`, `titular`, `precioAcordado`, `usaCapilla`, `pagado` o `folios`. No se sobrescribe. |
| `posibleDuplicado` | Ya hay un evento o un apartado vivo esa fecha en ese salón (`candidatos`). No se importa. |
| `invalido` | Salón no reconocido, banquetero sin dar de alta, formas que no suman, folios repetidos o ya usados (`errores`). |

En `/ingresos`, el abono de un apartado de cliente directo trae `de` = el nombre del cliente
y `banqueteroId: null`.
