# Banqueteros · Cuenta corriente, apartados sin precio y reventa

Diseño acordado con el dueño el 13-ago-2026. Sustituye el manejo actual, en que
`Banquetero` es una etiqueta (nombre, teléfono, activo) colgada de la cotización.

---

## El problema, en los términos del negocio

Tres cosas que pasan hoy y que el sistema **no puede representar**:

1. **Un banquetero compra 3 o 4 eventos y luego los revende él.**
2. **Opera 3 o 4 eventos a la vez.** Hace un pago de, digamos, $323,345 y después
   dice cómo se reparte: 55,000 al evento A, 55,000 al B, el resto al C.
3. **Son los que más graduaciones venden** y piden fechas muy adelantadas. Hoy
   están pidiendo 2028 y **pagando fechas sin que existan precios**.

### Por qué hoy no cabe

- `Payment.quoteId` es **obligatorio**: un pago pertenece a exactamente una
  cotización. El pago de $323,345 solo se puede meter partiéndolo a mano en tres
  pagos inventados, perdiendo el rastro del depósito real y su comprobante.
- No hay forma de apartar una fecha **sin precio**: `createQuote` exige un catálogo
  y calcula un total.
- `Quote.client` es obligatorio y único, así que no se puede distinguir *quién
  compró* de *quién festeja*.

**Consecuencia: los tres casos viven hoy en la cabeza de alguien y en un hilo de
WhatsApp, no en el sistema.** Ese es el problema a resolver, más que agregar una
pantalla.

---

## Decisiones del dueño (no volver a preguntar)

1. **En la reventa, el banquetero firma y se le factura a él.** Es el cliente de la
   hacienda. El cliente final es dato **operativo** (el festejado, para la hoja del
   evento), no la contraparte del contrato. La hacienda no se mete en la reventa.
2. **Sección interna con enlace compartible de solo lectura.** El equipo administra
   desde Admin; el banquetero recibe un enlace con su estado de cuenta, igual que ya
   se le manda la cotización a un cliente. Sin usuarios externos, sin contraseñas.
3. **El saldo sin asignar es legítimo y visible.** Se registra el pago completo
   aunque solo se sepa el destino de una parte. Refleja la realidad: el dinero llega
   antes que la instrucción de cómo repartirlo.

---

## Idea 1 · Cuenta corriente del banquetero

**La pieza central.** El pago entra a la cuenta del banquetero, no al evento;
después se distribuye.

```
PagoBanquetero            monto, fecha, método, referencia, comprobante
   └── asigna a ─────►    Payment (uno por evento, con su folio de recibo)
saldo sin asignar    =    monto − Σ asignado
```

### El detalle que lo hace elegante

Cada asignación **genera un `Payment` real en la cotización**, con su folio. Así el
estado de cuenta, los hitos del plan de pagos, el candado de facturación y el API
del BI siguen funcionando **sin cambiar una línea**. El `Payment` gana un
`pagoBanqueteroId` opcional que es la liga hacia el depósito madre.

Ventaja contable: hay un solo depósito con su comprobante, y recibos por evento.

### Lo que te da y hoy no tienes

**El saldo sin asignar.** "Ramírez trae $158,345 sin repartir." Hoy ese número no
se puede decir sin sentarse a sumar, y es exactamente el número por el que después
hay discusiones.

### Reglas

- Asignar **no puede exceder** el saldo sin asignar del depósito.
- Anular una asignación devuelve el monto al saldo (y anula el `Payment`, con el
  camino de anulación que ya existe).
- Anular el depósito completo exige que no tenga asignaciones vivas.
- El saldo sin asignar **no cuenta como pagado** en ninguna cotización. Es dinero
  de la hacienda sin destino, y así debe verse en el tablero.

---

## Idea 2 · Apartar una fecha sin precio

Para el caso 3. Un **apartado** que bloquea fecha y espacios para un banquetero,
con su depósito, **antes de que exista cotización o catálogo**.

```
ApartadoFecha   banquetero, fecha, espacios, depósito, vence, catálogo (opcional)
      └── al convertir ─────►  Quote  +  el depósito pasa como pago
```

### Lo que ya tenemos y no se ha usado

**El tramo 1 del Plan E resolvió la mitad de esto.** Se puede crear el catálogo 2028
hoy clonando 2027 con el incremento que se negocie, y **amarrar el apartado a ese
catálogo**. Entonces el banquetero no paga a ciegas: se le vende **precio
garantizado** — "te congelo 2027 más ocho por ciento".

Eso convierte un problema administrativo en un argumento de venta.

### Reglas

- El apartado **bloquea la disponibilidad igual que una cotización formalizada**: es
  dinero real sobre una fecha. Tiene que aparecer en la agenda y en los colores del
  selector de espacios.
- **Vence.** Un apartado que no se convierte ni se sigue pagando expira y libera la
  fecha. Sin esto, apartan 2029 gratis.
- Al convertirse, hereda su catálogo si tiene uno; si no, toma el activo.
- Un apartado **sin precio no tiene total**: no debe aparecer en reportes de ingreso
  comprometido como si fuera una venta cerrada.

---

## Idea 3 · La reventa

Con la decisión 1, es simple: el banquetero **es** el cliente de la cotización
(su `Client`, con sus datos fiscales). El cliente final se captura como dato
operativo del evento.

`Quote` gana `festejado` (nombre y contacto del cliente final). El contrato y la
factura leen el cliente —el banquetero—; la hoja operativa lee el festejado.

> **Ojo con el candado fiscal (Planes C y D):** los datos fiscales se congelan al
> emitir la primera factura, y son del **cliente**. Como aquí el cliente es el
> banquetero y sus datos se reusan en todos sus eventos, congelarlos por una
> factura de un evento los congela para todos. Es correcto —son los mismos datos—
> pero hay que verificar que el aviso de la interfaz no confunda, porque hoy dice
> "esta cotización" y aquí aplica a toda la cartera del banquetero.

---

## Idea 4 · Estado de cuenta compartible

Un enlace de solo lectura, con el patrón que ya existe para las cotizaciones de
cliente: todos sus eventos, sus depósitos, cómo se repartieron, su saldo sin
asignar y lo que vence pronto.

**Esto solo mata el hilo de WhatsApp.**

---

## Idea 5 · Lo que el tablero debe gritar

Cosas hoy invisibles que un banquetero activo produce:

- **Saldo sin asignar** por banquetero. Dinero sin destino.
- **Fechas apartadas sin revender**, con su vencimiento. Tiene cuatro, revendió una,
  y el vencimiento se acerca.
- **Apartados por vencer** en los próximos N días.
- **Tope de fechas en firme** por banquetero, para que uno solo no acapare los
  sábados de graduación de 2029.
- **Eventos comprometidos sin catálogo**, o sea fechas pagadas cuyo precio sigue sin
  definirse. Es el riesgo del caso 3 hecho número.

---

## Lo que este diseño NO hace

- **No mete a la hacienda en la reventa.** No se registra a qué precio revende el
  banquetero ni se calcula su margen. Es su negocio.
- **No da acceso propio al banquetero.** Decisión 2: enlace de solo lectura. El
  modelo queda listo para agregarlo después sin rehacer.
- **No toca el motor de precios.** Un apartado sin precio no pasa por el motor; una
  cotización convertida pasa exactamente como cualquier otra.

---

## Riesgos que hay que aceptar a propósito

1. **Un apartado bloquea una fecha sin tener precio.** Si nunca se convierte y el
   vencimiento se administra mal, se pierde inventario de fechas buenas. El
   vencimiento y la alerta del tablero son la mitigación; no la eliminan.
2. **El saldo sin asignar es una cuenta por aplicar.** Contablemente es dinero
   recibido sin ingreso reconocido por evento, y el candado de facturación del Plan C
   corre por **pago**: un depósito de marzo sin asignar sigue siendo de marzo para el
   SAT. Hay que verificar que el candado mire la fecha del **depósito**, no la de la
   asignación. **Esto es lo primero que debe cubrir un test.**
3. **El banquetero como cliente único** significa que sus datos fiscales, y su
   candado, son compartidos por toda su cartera. Correcto, pero la interfaz tiene que
   decirlo con claridad.
