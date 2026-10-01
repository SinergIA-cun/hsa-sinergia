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
curl -s -H "x-api-key: $BI_API_KEY" 'https://hsapi.somossinergia.com/api/bi/eventos?desde=2026-01-01&hasta=2026-12-31'
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

Un `limit` mayor a 500 se recorta a 500: un BI que pida 100000 recibe 500 filas, no un
timeout. Un `desde`/`hasta` con formato distinto a `YYYY-MM-DD` responde 400
(`{"error":"Parámetros inválidos"}`), no un rango silenciosamente mal interpretado.

## Paginación

Se repite la misma llamada pasando `cursor=<siguienteCursor>` hasta que `siguienteCursor`
venga `null`:

```bash
CURSOR=""
while :; do
  RESP=$(curl -s -H "x-api-key: $BI_API_KEY" \
    "https://hsapi.somossinergia.com/api/bi/eventos?desde=2026-01-01&hasta=2026-12-31&limit=500&cursor=$CURSOR")
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

**Otros ingresos del evento**: lo cargado a su cuenta en el punto de venta después de
contratar — horas extra, DJ extra, invitados de más, multas, daños y gastos imprevistos.
**No forman parte del valor del evento**: `/eventos.total` no cambia. Cada evento trae
además `cargosAdicionales: { total, pagado, saldo }` en `/eventos`, y los cobros llegan por
`/pagos` con `destino: "cargos"` (los de la renta traen `destino: "evento"`).

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

### Formas de pago

`metodo` es uno de `efectivo`, `cheque`, `transferencia`, `tarjetaDebito`,
`tarjetaCredito`, `mixto` (pago dividido) o `tarjeta` (pagos viejos, de antes de separar
débito y crédito). `formas` trae siempre las partes, que suman `monto`: un pago de una sola
forma trae una parte. Un pago que salió de un depósito dividido viene `mixto` con una sola
parte `mixto`: el detalle por forma vive en el depósito (en `/ingresos`).

### `GET /api/bi/pagos-esperados`

Hitos de cobro **pendientes** (anticipo, complemento, finiquito) del plan de pagos de los
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

La bitácora completa del evento: creación, cambios de estatus, ediciones, pagos, anulaciones,
borrados y restauraciones. Es de donde el BI saca los cambios de salón y de tamaño de evento.

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

`actor: null` significa que el cambio lo hizo el sistema, no una persona (por ejemplo el
vencimiento automático por vigencia).

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

## Importar y conciliar (escritura, llave aparte)

El BI tiene la historia completa: eventos de años anteriores y los pagos de este año hasta
agosto. La hacienda solo necesita **los eventos que todavía no se celebran**: los que caen
del **1 de octubre de 2026** en adelante, aunque se hayan contratado antes (un evento del
1-ene-2027 contratado el 2-feb-2026 entra). Los anteriores se quedan en el BI.

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
| `tipoEvento`, `salones` | Por nombre. Se comparan sin acentos ni mayúsculas y sin "Jardín/Salón/La/Los": `"Cúpula"` = `"Jardín La Cúpula"`. Lo que no coincide exacto **no se adivina**: el evento sale `invalido`. |
| `banquetero`, `vendedora` | Por nombre. Si no se reconocen, el evento entra sin ellos y se avisa. |
| `renta.total` | Lo que cobra la hacienda, con IVA. Es el **precio pactado**. |
| `otros.total` | Alimentos y servicios (se pagan al proveedor), con IVA. |
| `pagos[].folio` | **Obligatorio**: el folio de la hoja foliada (serie I). Se conserva tal cual. |
| `pagos[].metodo` / `formas` | Igual que en `/pagos`: una forma, o las partes de un pago dividido (deben sumar `monto`). |
| `pagosHasta` | Hasta qué fecha tiene pagos el BI. Del lado de la hacienda solo se comparan los pagos hasta ese día: los de septiembre en adelante solo existen aquí y **es lo esperado**. |
| `completo` | `true` = el lote trae TODOS los eventos del BI del corte en adelante. Solo así se reporta `soloEnHSA`. |

Hasta 200 eventos por llamada; para más, se manda por partes (todo es idempotente).

### El reporte

```json
{
  "corte": "2026-10-01",
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
| `fueraDeCorte` | Se celebra antes del 1-oct-2026. | Nada: se queda en el BI. |
| `invalido` | Un salón o tipo de evento no reconocido, formas que no suman, folios repetidos… (`errores`). | Corregir en el BI y reenviar. |

`diferencias[].campo` es uno de `fechaEvento`, `salones`, `invitados`, `tipoEvento`,
`rentaTotal`, `pagado` o `folios` (en `folios`, `bi` = folios que solo tiene el BI, `hsa` =
los que solo tiene la hacienda).

### Qué queda aquí de un evento importado

- Estatus **al menos formalizada** (es un evento vendido: bloquea su fecha); si sus pagos ya
  cruzaron un hito, sube solo, igual que con un pago capturado aquí.
- **Precio pactado**: su desglose son los montos del BI. Editarlo, moverlo de fecha o de
  catálogo **nunca** lo recotiza.
- Sus pagos con el folio de papel, y el concepto deducido del saldo.
- En `/eventos`: `origen: "bi"`, `idBI` y `contratadoEl`. Los vendidos aquí traen
  `origen: "hsa"`.
- El cliente se reutiliza solo si el **teléfono** coincide exacto; si no, se crea uno nuevo.
