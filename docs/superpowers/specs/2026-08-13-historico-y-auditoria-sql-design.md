# Histórico de eventos y auditoría a nivel base de datos

Diseño acordado con el dueño el 13-ago-2026. Dos features independientes que
comparten una idea: **separar el registro de lo que pasó, del cálculo de lo que
va a pasar.**

---

## Parte 1 · La bitácora que capta TODO

> **Estado: construido el 24-ago-2026.** Migración `20260824120000_auditoria_db`,
> puente del actor en `packages/database/src/`, consulta y pantalla en
> `apps/api/src/auditoria/` y `/admin/auditoria`.
>
> Dos cosas salieron distintas de lo diseñado, y las dos por lo mismo — el diseño
> trataba "sin actor" como sinónimo de "sospechoso":
>
> 1. **Hay tres orígenes, no dos.** Nuestros propios backfills y migraciones
>    tampoco traen persona. Marcarlos como externos habría hecho sonar la alarma
>    en cada despliegue con cientos de renglones, y una alarma que suena siempre
>    deja de mirarse. La frontera real es `application_name`: `persona` (app con
>    sesión), `sistema` (nuestro código sin persona) y `externo` (cualquier otro
>    cliente de base de datos).
> 2. **El trigger se engancha solo a las tablas nuevas.** La función
>    `asegurar_auditoria()` corre en cada arranque, así que una tabla que traiga
>    una migración futura no se escapa por olvido.
>
> La Parte 2 se construyó el 24-ago-2026 y esta bitácora registró su migración,
> que era justamente el punto de hacerla primero.

### El pedido

> "Quiero que la bitácora capte TODO, aún si yo inyecto algo o borro directo de
> SQL debería mostrarlo la bitácora."

### Por qué donde está hoy no puede

`logActivity` (`apps/api/src/quotes/activityLog.ts`) es código de la API. Un
`UPDATE` hecho por `psql` **nunca pasa por la API**, así que ninguna cantidad de
código de aplicación lo puede ver. Es pedirle a la recepción que registre a quien
entró por la ventana.

### La solución: triggers en Postgres

Un trigger se dispara **dentro de la base**, así que ve el cambio sin importar el
origen: la API, `psql`, una migración, la consola de EasyPanel.

```sql
CREATE TABLE "AuditoriaDb" (
  id          bigserial PRIMARY KEY,
  tabla       text        NOT NULL,
  operacion   text        NOT NULL,          -- INSERT | UPDATE | DELETE | TRUNCATE
  registroId  text,                          -- la PK de la fila afectada
  antes       jsonb,
  despues     jsonb,
  -- Contexto de ORIGEN: es lo que distingue la app de un SQL directo.
  usuarioDb   text        NOT NULL DEFAULT current_user,
  aplicacion  text,                          -- current_setting('application_name')
  direccionIp inet,                          -- inet_client_addr(): null si es local
  actorId     text,                          -- lo sella la API; NULL = no vino de la app
  txid        bigint      NOT NULL DEFAULT txid_current(),
  createdAt   timestamptz NOT NULL DEFAULT now()
);
```

### El puente elegante: la API sella quién es la persona

Dentro de su transacción, la API hace:

```sql
SET LOCAL app.actor_id = '<id del usuario>';
```

y el trigger lo lee con `current_setting('app.actor_id', true)`. Resultado:

- Cambio hecho desde la app → queda con **el nombre de la persona**.
- Cambio hecho por SQL directo → queda **sin actor**, que es exactamente la señal
  que se quiere: *esto no vino de la app*.

Es el mismo registro para los dos casos, y la ausencia del actor es la alarma.

### Los límites, aceptados a propósito

1. **`TRUNCATE` no dispara triggers de fila.** Se puede poner un trigger de
   sentencia para registrar que alguien truncó, pero no qué filas se fueron.
2. **Un superusuario puede desactivar el trigger o borrar de `AuditoriaDb`.** Se
   sube la barrera revocándole `DELETE` sobre esa tabla al usuario de la app, pero
   no se puede volver imposible para quien tiene las llaves del servidor.
3. **La tabla crece.** Necesita política de retención; el `jsonb` de un `UPDATE`
   guarda la fila completa dos veces.

> **La promesa honesta no es "imposible de burlar".** Es: capta todo lo accidental
> y lo rutinario, y obliga a que manipular algo a propósito requiera pasos extra y
> visibles. El 99% de los casos reales son un dedazo, no un sabotaje.

### Tablas a auditar

Las que mueven dinero o compromisos: `Quote`, `Payment`, `QuoteExtra`, `Client`,
`PriceList` y sus hijas (`RentalPrice`, `AddOn`, `FoodPackage`, `FoodPackagePrice`,
`DjHoraExtraPrice`), `SpacePaymentRule`, `Space`, y **`ActivityLog` misma** — para
que borrar un renglón de la bitácora narrativa también deje rastro.

### Dos bitácoras, y por qué está bien

| | Para qué | Quién la lee |
|---|---|---|
| `ActivityLog` (la de hoy) | Narrativa: "Estatus: borrador → formalizada" | El equipo, en el día a día |
| `AuditoriaDb` (nueva) | Forense: fila antes / fila después, con origen | Quien investiga algo raro |

> **Riesgo de duplicidad.** Es justo el patrón que los planes E1 y E2 estuvieron
> matando (dos caminos al mismo dato). Aquí se justifica porque **sirven a
> preguntas distintas**, pero hay que dejarlo escrito en la interfaz: la narrativa
> en la línea de tiempo del evento, la forense en una pantalla de admin aparte.
> Si alguna vez se fusionan, que sea a propósito.

---

## Parte 2 · Histórico de eventos con foto

> **Estado: construido el 24-ago-2026.** Migración `20260824180000_evento_historico`,
> archivo en `apps/api/src/historico/` y pantalla en `/historico`. El plan de
> ejecución y las desviaciones están en
> `docs/superpowers/plans/2026-08-24-historico-eventos.md`.

### El pedido

> "Un evento al pasar su fecha debe quedar en el historial, buscable con una 'foto'
> de lo que sucedió ese día. Puede volverse no editable, o desconectarlo de todo
> para que ya no sea dinámico, editable pero no dinámico."

### La mitad ya existe

La cotización **ya congela su desglose** (`Quote.breakdown`): es lo que hizo que la
lista, el contrato y la página del cliente no se rompieran cuando el catálogo
cambió. Lo que falta es la foto **completa y resuelta**.

### Qué lleva la foto

Todo lo que hoy se arma juntando tablas al vuelo, resuelto y aplanado:

- El desglose congelado y los totales.
- **Nombres** de los espacios, del tipo de evento, del catálogo y del banquetero
  (no sus ids: la foto tiene que ser legible en diez años sin las tablas vivas).
- Los pagos con sus folios, conceptos, fechas y estado de facturación.
- La hoja operativa: personal, horarios, banquetero, menú, invitados finales.
- Los datos fiscales del cliente **como estaban entonces**.
- El código de evento.

### La regla del negocio que define el diseño

**El evento no se hace si no está pagado** — el contrato lo dice. Lo que pasa en la
práctica es que ese mismo día pagan y el dinero no ha entrado al banco o el
efectivo no se ha capturado. O sea: **el pago tardío es rezago de captura, no
deuda.** La ventana es de días, no de meses.

### Decisión del dueño: foto al día siguiente, pero sigue cobrable

1. **Al día siguiente del evento** se toma la foto operativa y el evento **sale de
   la agenda**. Lo que pasó ese día ya no cambia.
2. **Los pagos se siguen registrando** hasta que se liquide, y la parte financiera
   de la foto se actualiza con cada uno.
3. **Al liquidar, la foto se congela completa.**

### Decisión del implementador: editable pero no dinámico

El dueño delegó la elección. Se elige **editable, no dinámico**: después de un
evento sí se corrigen cosas reales (el conteo final de personas, quién trabajó de
verdad), y bloquear todo obliga a mentir en otro lado. Concretamente:

- La cotización **deja de recalcular**: cambiar invitados o espacios ya no mueve el
  precio, porque el evento ya pasó.
- La hoja operativa **sigue editable**, con bitácora.
- La foto es **inmutable**; una corrección genera una versión nueva, no sobrescribe.

### Lo que esto resuelve de pasada

Al quitar `vencida` y el vencimiento automático (Plan G, punto 8), **nada saca los
eventos viejos de la agenda** — un costo que el dueño aceptó explícitamente. El
histórico es un reemplazo mejor: los eventos pasados salen de la agenda **por haber
pasado**, que es la razón correcta.

### La anomalía que el tablero debe gritar

Por la regla del negocio, **un evento pasado sin liquidar no debería existir**. Si
existe, es una de dos: alguien no capturó el pago, o el evento no se hizo. Las dos
requieren que un humano actúe, así que van al tablero como alerta, no como estado
silencioso.

### Restricción de infraestructura: no hay planificador

Los trabajos solo corren **al arrancar el contenedor** (`CMD` del Dockerfile:
migraciones, backfills y `reconcile-statuses`). No hay cron.

Por lo tanto: el archivado no puede depender de "a las 3am del día siguiente". Se
hace con un barrido idempotente que corre **al arrancar** y **bajo demanda**, y lo
que la interfaz muestre como "pasado" se **deriva de la fecha**, no de que un
trabajo haya corrido. Así una fecha que pasó se comporta como pasada aunque nadie
haya reiniciado el contenedor.

---

## Orden sugerido

La auditoría primero. Es independiente, no toca el motor de precios ni la
interfaz, y **una vez encendida registra todo lo que venga después** — incluida la
migración del histórico. Encenderla al final sería desperdiciar su propósito
justo en los cambios más grandes.
