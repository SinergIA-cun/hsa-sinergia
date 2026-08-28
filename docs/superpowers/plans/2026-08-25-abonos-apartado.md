# Abonos sobre una fecha apartada — plan

## El pedido, en las palabras del dueño

> "Imagina que quiero una fecha del 2029, tú todavía no tienes precios, a mí no me
> molesta. Te la pido apartada, pero todavía no sé si voy a venderla a una boda o
> a una graduación. Solo tengo Fecha y Salón. No tengo nombre de cliente, no tengo
> PAX, voy poco a poco abonando durante el 2027 y en el 2028 puedo hasta
> liquidarlo pero seguir sin muchas cosas claras."

Y el otro medio del pedido: poder abonar **tanto desde el saldo a favor del
banquetero como con un pago directo a esa fecha**.

## Por qué el modelo de hoy no lo aguanta

`ApartadoFecha` tiene **un** `deposito` con su método y su fecha. Un solo número.
Abonar tres veces durante 2027 no cabe: o se pisa el monto anterior —y se pierde
la fecha en que entró cada peso, que es lo que el SAT mira— o no se registra.

## El diseño

### Un apartado es una cuenta, no un depósito

Nace `AbonoApartado`: cada entrada de dinero sobre esa fecha, con **su propia
fecha de recepción**, su forma de pago, su comprobante y su rastro de quién lo
registró. Las tres columnas `deposito*` desaparecen y su contenido se convierte en
el primer abono. Un solo camino para decir "entró dinero a esta fecha".

### Dos orígenes, un mismo renglón

| De dónde viene | Cómo entra |
|---|---|
| Pago directo a la fecha | `POST /banqueteros/apartados/:id/abonos` |
| Saldo a favor del banquetero | El reparto de un depósito ahora también ofrece sus apartados |

La segunda es la que el dueño describe primero, y por eso **no** estrena pantalla:
va en el mismo modal de "repartir depósito" que ya existe, junto a sus eventos. Un
segundo lugar para repartir el mismo dinero sería el patrón que este proyecto
lleva meses eliminando.

### El saldo sin asignar tiene que contar los dos

`saldoSinAsignar` hoy resta las asignaciones (`Payment`) de un depósito. Ahora
también resta los abonos que salieron de él. Y cuando el apartado se convierte,
cada abono se vuelve un `Payment`: a partir de ahí lo que cuenta es el pago, no el
abono, o el mismo dinero se restaría dos veces.

Se resuelve con un puntero: `AbonoApartado.paymentId`. Un abono **ya convertido**
deja de contar contra el depósito, porque su `Payment` ya lo hace.

### No hay total, y está bien

Un apartado de 2029 no tiene precio: no hay catálogo, no hay PAX, no hay tipo de
evento. Así que **no hay saldo pendiente ni plan de pagos**: lo que hay es un
acumulado a favor de esa fecha. "Liquidarlo" no es un estado del sistema, es una
conversación entre el banquetero y la hacienda.

Cuando la fecha se convierte en cotización aparece el precio, todos los abonos se
vuelven pagos **con la fecha en que entró cada uno** —no la de la conversión, que
es el mismo error fiscal que ya se corrigió dos veces en este proyecto— y a partir
de ahí manda el plan de pagos de siempre.

## Estructura

| Archivo | Qué cambia |
|---|---|
| `…/migrations/…_abonos_apartado/` | Tabla `AbonoApartado`, backfill del depósito y baja de las tres columnas |
| `apps/api/src/banqueteros/abonos.ts` | Registrar, anular y listar abonos |
| `apps/api/src/banqueteros/cuenta.ts` | `saldoSinAsignar` cuenta abonos; el reparto acepta apartados |
| `apps/api/src/banqueteros/apartados.ts` | Crear escribe el primer abono; convertir vuelve pagos todos los abonos |
| `apps/web/…/ApartadosPanel.tsx` | La lista de abonos y el alta de uno nuevo |
| `apps/web/…/RepartirDepositoModal.tsx` | Los apartados como destino del reparto |

## Lo que este plan NO hace

- No le inventa un total al apartado. Sin precio no hay deuda.
- No toca el plan de pagos: ése empieza cuando hay cotización.
- No permite abonar a un apartado cancelado o ya convertido.
