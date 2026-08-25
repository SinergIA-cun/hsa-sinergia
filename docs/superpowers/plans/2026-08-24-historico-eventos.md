# Histórico de eventos con foto — plan

Ejecuta la **Parte 2** del diseño de `docs/superpowers/specs/2026-08-13-historico-y-auditoria-sql-design.md`.
La Parte 1 (bitácora forense) quedó construida el 24-ago-2026.

**Meta:** que un evento, al pasar su fecha, quede archivado con una foto legible
de lo que sucedió ese día, buscable, y que deje de comportarse como un evento
futuro.

---

## Las decisiones que ya están tomadas (del diseño)

- **Foto al día siguiente**, el evento sale de las listas de trabajo.
- **Los pagos se siguen registrando** hasta liquidar, y la parte financiera de la
  foto se actualiza con cada uno. **Al liquidar, se congela.**
- **Editable pero no dinámico**: la cotización deja de recalcular precio, la hoja
  operativa sigue editable, y la foto es **inmutable** — una corrección genera una
  versión nueva, no sobrescribe.
- **No hay planificador.** Lo que la interfaz muestre como "pasado" se **deriva de
  la fecha**, no de que un trabajo haya corrido. El barrido es la red de
  seguridad, no la fuente de verdad.

## Las decisiones que faltaban, y cómo se resuelven

### 1. ¿Qué se archiva? Todo lo que pasó, no solo lo que se realizó

Un borrador cuya fecha pasó **también** entra al histórico, marcado
`seRealizo: false`. Dos razones: sacarlo de la lista activa sin dejarlo en
ningún lado lo desaparecería, y "cotizamos esto para el 5 de mayo y no se cerró"
es historia útil. La foto de un borrador es la cotización que nunca se cobró.

### 2. ¿Cuándo se toma una versión nueva? Cuando el contenido cambia

`archivarEvento` arma la foto, la compara contra la última versión y **solo
escribe si difiere**. Es la misma disciplina del trigger de auditoría: un cambio
que no cambia nada no es noticia, y una lista de versiones idénticas esconde las
que sí importan.

Se llama desde cuatro lugares, todos idempotentes:

| Cuándo | Por qué |
|---|---|
| Barrido al arrancar | Red de seguridad: eventos que pasaron sin que nadie mirara |
| Al registrar o anular un pago | La parte financiera se mantiene al día sin esperar un reinicio |
| Al editar la hoja operativa | "Una corrección genera una versión nueva" |
| `POST /admin/historico/barrer` | Bajo demanda, sin reiniciar el contenedor |

### 3. El congelamiento es emergente, no una bandera

Al liquidar, nada vuelve a cambiar, así que ninguna llamada posterior encuentra
diferencia y no se escribe versión nueva. No hace falta una columna `congelada`
que alguien tenga que recordar poner: la ausencia de cambios ya es el
congelamiento. Lo que la interfaz enseña como "cerrada" se deriva de
`liquidado`.

### 4. "Sale de la agenda" = sale de las listas de trabajo

La agenda es un calendario por mes: ver agosto en septiembre es correcto y no hay
nada que esconder ahí. Lo que se ensucia son **las listas de contratos**, que
antes limpiaba el estatus `vencida` retirado en el Plan G. Así que los eventos
pasados salen de las cuatro secciones de `/cotizaciones` y la página apunta al
histórico.

**Siguen siendo alcanzables y cobrables**: el tablero ya grita los pasados sin
liquidar (`pasadosSinLiquidar`, Plan H) y cada renglón del histórico lleva a su
cotización viva.

### 5. "No dinámico" = deja de recalcular, no deja de editarse

`updateQuote` sobre un evento cuya fecha pasó **guarda los campos pero conserva
el desglose y los totales**. Corregir el conteo final de personas es real y hay
que poder hacerlo; que ese conteo mueva el precio de un evento que ya se dio, no.

---

## Estructura

| Archivo | Responsabilidad |
|---|---|
| `packages/database/prisma/migrations/…_evento_historico/` | Tabla `EventoHistorico` |
| `packages/shared/src/texto.ts` | `normalizaTexto` (búsqueda sin acentos, la usan API y web) |
| `apps/api/src/historico/foto.ts` | Arma la foto: nombres, no ids |
| `apps/api/src/historico/archivar.ts` | `archivarEvento` + `barridoHistorico` |
| `apps/api/src/historico/consulta.ts` | Búsqueda y detalle |
| `apps/api/src/historico/routes.ts` | `GET /historico`, `GET /historico/:id`, `POST /admin/historico/barrer` |
| `apps/web/src/pages/HistoricoPage.tsx` | Lista buscable |
| `apps/web/src/components/historico/FotoEvento.tsx` | La foto abierta |

## Tareas

1. Modelo + migración de `EventoHistorico`.
2. `normalizaTexto` en shared; `apps/web/src/lib/buscar.ts` pasa a usarlo.
3. `armarFoto` — resuelve nombres, pagos, operativa, totales.
4. `archivarEvento` (versiona solo si cambia) + `barridoHistorico`.
5. Enganches: barrido al arrancar, pagos, hoja operativa, ruta bajo demanda.
6. `updateQuote` deja de recalcular cuando la fecha pasó.
7. Consulta y rutas de lectura.
8. Web: página, buscador, foto, y el corte de las listas de contratos.
9. Pruebas.

## Lo que este plan NO hace

- No toca la agenda: un calendario tiene que poder enseñar agosto.
- No borra ni bloquea nada: no hay estatus nuevo ni pérdida de acceso.
- No archiva lo que está en la papelera: eso es evidencia de otra cosa.

---

## Lo que cambió al construirlo

Tres cosas que el plan no había previsto y que salieron de probarlas:

1. **Comparar fotos con `JSON.stringify` a secas no funciona.** Postgres guarda
   `jsonb` con las llaves reordenadas, así que la foto que vuelve de la base
   nunca sale igual a la recién armada. Sin una comparación con llaves ordenadas,
   cada llamada escribía una versión nueva de todo y el archivo se llenaba de
   copias idénticas. Lo cazó una prueba, no producción.

2. **"Quedó debiendo" excluye lo que nunca se cerró.** Un borrador pasado tiene
   el total completo como saldo, pero ahí no hay nada que cobrar. Sin ese
   filtro, la lista de cobros perdidos se habría convertido en la lista —mucho
   más larga— de cotizaciones que no prosperaron.

3. **La purga de la papelera tenía que aprender del histórico.** La llave foránea
   es `RESTRICT` para que el archivo no se borre por accidente, y
   `purgeExpiredTrash` se traga sus errores en silencio: sin borrar las fotos
   primero, la papelera habría dejado de vaciarse para siempre sin que nadie se
   enterara. Se pueden borrar sin remordimiento porque a la papelera solo llegan
   borradores sin pagos.

## Limitación aceptada

Un evento pasado **no recalcula precio**, punto. Si después del evento hubiera
que cobrar algo extra —un servicio consumido de más—, agregarlo a la cotización
cambia el registro pero no el total. Es lo que pidió el diseño ("el precio es un
hecho, no una previsión") y queda dicho en la bitácora cuando pasa, no en
silencio. Si el dueño necesita cobros posteriores al evento, es una conversación
nueva y un mecanismo distinto.
