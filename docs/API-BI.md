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

No hay ningún endpoint de escritura. `POST`, `PATCH` y `DELETE` sobre estas rutas responden
404, y hay una prueba automatizada que se pone en rojo si alguien agrega uno.

## Envoltura de respuesta

Los cinco endpoints devuelven la misma envoltura. Ejemplo real de
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
