# Batch de cambios (DJ, términos, papelera, auto-estatus, contrato) · Plan

**Goal:** 5 cambios acordados sobre el cotizador HSA. Rama `feat/fase5-contrato`.

**Referencia:** diseño aprobado en chat 2026-07-11.

---

## Task 1: DJ por horas
- **Data:** cambiar el add-on "DJ" de `kind: fijo` a `kind: porUnidad` (unidad = hora). Actualizar `seed.ts` (para DB nuevas) y correr un backfill idempotente en dev (cambiar el kind del add-on existente). Renombrar a "DJ (por hora)". Precio actual ($2,950) queda como por-hora, editable en Admin→Extras.
- **Front:** el `QuoteForm` ya renderiza selector de cantidad para `porUnidad` (valet). Verificar que DJ ahora muestra selector de horas. Etiqueta clara.
- Commit.

## Task 2: Términos de la renta (pie de la página del cliente)
- En `PublicQuotePage`, **quitar** el bloque "Condiciones de pago" de media página y agregar una sección **"Términos de la renta"** al fondo con viñetas:
  - a) Valet: "El valet parking se cobra según el total de vehículos del día (costo por automóvil $100)."
  - b) Horario: "La renta del salón incluye 30 minutos antes y 30 después de las {horasEvento} horas contratadas." (omitir horas si null)
  - c) Fechas de pago (de `estadoCuenta.plan`, solo si hay regla): apartado (monto), complemento ({pct}% del total = monto, antes de {fecha}), liquidación (total, {fecha}).
- Texto editable a futuro. Commit.

## Task 3: Papelera (soft-delete de cotizaciones)
- **Schema:** `Quote.deletedAt DateTime?` + índice. Migración manual (patrón migrate deploy).
- **API (`quotes/service.ts` + `routes.ts`):**
  - `softDeleteQuote(db, id, actor)`: solo si `status === 'borrador'` (si no → QuoteError 409), ownership; set `deletedAt = now`.
  - `restoreQuote(db, id, actor)`: set `deletedAt = null`.
  - `listTrash(db, actor)`: quotes con `deletedAt != null` y `deletedAt >= now-30d`; ordena por deletedAt desc.
  - `purgeExpired(db)`: hard-delete quotes con `deletedAt < now-30d` (borra payments/activityLog/quote/client si huérfano — o solo quote+deps). Llamar al inicio de `listQuotes` y `listTrash`.
  - `listQuotes`, `getAgenda`, `getAvailability` → filtrar `deletedAt: null`.
  - Rutas: `DELETE /quotes/:id`, `POST /quotes/:id/restore`, `GET /quotes/trash`.
- **Front:** botón "Eliminar" en `QuotesListPage` en filas `borrador` (con confirmación); página **Papelera** (`/papelera`, nav) con restaurar + días restantes; excluir eliminadas de la lista.
- Tests API (borrar borrador OK, borrar no-borrador 409, restore, trash list, exclusión). Commit.

## Task 4: Auto-estatus
- En `registerPayment` (payments/service.ts): tras calcular estadoCuenta, si `esUpgrade(quote.status, estadoCuenta.sugerido)`, **aplicar** el cambio: `db.quote.update({ status: sugerido })` + `logActivity(estatus, "automático por pago")`. Devolver el nuevo estatus (no `sugerenciaUpgrade` manual). Nunca baja (esUpgrade ya lo garantiza).
- `anularPayment`: NO cambia estatus (nunca auto-baja).
- **Front `PagosPanel`:** quitar el prompt "¿avanzar?"; el estatus se refleja tras refrescar. Ajustar test que esperaba `sugerenciaUpgrade`.
- Commit.

## Task 5: Contrato con datos reales (solo el salón apartado)
- En `ContratoPage`, la tabla de pagos de la pág. 3: **quitar las 3 filas fijas** (Cúpula/Arcos/Campos) y poner **una fila con el espacio de esta cotización** y los montos/fechas reales de `data.estadoCuenta.plan` (anticipo objetivo; complemento objetivo + `porcentaje`% + `venceISO`; finiquito objetivo + `venceISO`). Si el espacio no tiene regla (`planPendiente`), mostrar aviso/omitir montos.
- El `ContratoPage` ya recibe `estadoCuenta` en el `QuoteDetail`. Usarlo.
- Commit.

## Cierre
- `pnpm --filter @hsa/api run test` verde + ambos tsc limpios + E2E en navegador (papelera, auto-estatus con pago, contrato con la fila real, términos en la página del cliente, DJ con horas).
