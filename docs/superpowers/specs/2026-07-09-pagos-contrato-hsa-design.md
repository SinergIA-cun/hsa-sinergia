# Fase 5 — Pagos, Estado de Cuenta, Log y Contrato · Diseño

**Fecha:** 2026-07-09
**Contexto:** Extiende [2026-07-07-cotizador-apartado-hsa-design.md](./2026-07-07-cotizador-apartado-hsa-design.md).
App: monorepo pnpm (`@hsa/shared` motor puro · `@hsa/database` Prisma6/Postgres · `@hsa/api` Fastify5 · `@hsa/web` React18/Vite6).

**Objetivo:** Cerrar el ciclo de cobranza del cotizador — registrar pagos (fichas), estado de cuenta real, bitácora de actividad, edición controlada de cotizaciones ya comprometidas, y generación del contrato pre-llenado para firmas. Es la base de datos que luego alimentará los reportes contables/administrativos.

---

## Alcance y decisiones (acordadas con el usuario 2026-07-09)

### A. Regla de pagos REAL — por espacio (sección H del contrato)

La regla sembrada hoy ($5,000 + 30% de la renta, pareja) **queda obsoleta**. La real, tomada de la sección H del contrato, es **por espacio**:

| Espacio | Anticipo (apartar) | Complemento (% sobre el **total**) | Finiquito |
|---|---|---|---|
| Jardín Cúpula | $25,000 | 25% | 30 días antes del evento |
| Salón Arcos | $20,000 | 10% | 30 días antes del evento |
| Jardín Campos | $15,000 | 15% | 30 días antes del evento |

- El **complemento es % sobre el TOTAL** de la cotización (no sobre la renta) y varía por espacio.
- El complemento es **ADICIONAL al anticipo** (pagos secuenciales, como los lista el contrato). Nota: difiere de la regla anterior donde el apartado contaba a favor del porcentaje.
- Plazo del complemento: 3 meses después de contratar (informativo en el plan). **Base del plazo:** la fecha en que se apartó (fecha del primer pago o del cambio a `apartada`, lo primero que exista); fallback `createdAt` de la cotización.
- Los espacios **no listados** (Balcones, Pajaritos, Jardín del Caballo, Capilla): **sin regla por ahora** — el usuario conseguirá los números. El sistema debe manejarlos sin romperse: muestra "Plan de pagos pendiente de configurar" y no auto-sugiere estatus para esos.
- Cada cotización tiene **un solo espacio** (ya reforzado), así que la regla del espacio del quote determina su plan.

**Mapeo umbral → estatus (acumulado pagado vs objetivos):**
- `apartada`: pagado ≥ anticipo(espacio)
- `formalizada`: pagado ≥ anticipo + round(complementoPct × total)
- `liquidada`: pagado ≥ total

**Reglas de consistencia:**
- El estatus **nunca se degrada automáticamente**. Si una edición sube el total (o se anula un pago) y el acumulado ya no alcanza el umbral del estatus actual, el estatus se conserva y el estado de cuenta muestra un **aviso de desfase** ("el acumulado ya no cubre el hito de este estatus"). Corregirlo es decisión humana.
- Si el evento está a menos de `liquidarDiasAntes` días, el finiquito vence **de inmediato** (no en fecha pasada).

### B. Comprobante de pago → Google Drive (fuente de verdad)

- Cuenta **Google Workspace** + **Unidad Compartida** destino. Subida vía API de Drive con **cuenta de servicio** (credencial JSON como secreto en la API).
- La imagen **no** se guarda permanentemente en el VPS. La API **transmite** la imagen desde Drive para mostrarla in-app y en la página del cliente (sin exponer permisos/links de Drive).
- Detrás de una **interfaz `ComprobanteStorage`** con adaptador Drive. Si no hay credencial configurada, el pago se guarda igual y el comprobante queda marcado **"pendiente de subir"** (no bloquea).
- Si la subida falla (Drive caído/token vencido): se guarda el pago, se marca pendiente, se puede reintentar.

### C. Estatus auto-sugerido, confirmado por la vendedora

Al registrar un pago que cruza un umbral, la UI **sugiere** avanzar el estatus (ej. "El pago alcanza el complemento — ¿marcar como Formalizada?") con botón de confirmar. Nunca mueve el estatus sin el clic.

### D. Edición de apartadas/formalizadas + log

- Se relaja el candado: `apartada` y `formalizada` vuelven a ser **editables**. `liquidada` y `vencida` siguen bloqueadas.
- Cada edición en esos estatus escribe una entrada de log tipo `edicion` con el cambio de total ("$X → $Y") y el responsable. El desglose/saldo se recalculan.

### E. Log de actividad (interno, por cotización)

Eventos registrados: `creada` · `estatus` · `pago` · `pagoAnulado` · `edicion`.

El log es **interno** (vendedora/admin, en EditQuotePage). El **cliente NO lo ve** — su página pública solo muestra el estado de cuenta y sus pagos. Como cada entrada cuelga de una cotización y la cotización de un cliente, el historial por cliente se obtiene agregando sus cotizaciones (vista dedicada por cliente: fase posterior).

### E.2 Corrección de pagos: anulación, NO borrado

Un pago mal capturado no se edita ni se borra (trazabilidad contable). Se **anula**:
- `PATCH /api/quotes/:id/payments/:paymentId/anular` — **solo admin**, requiere `motivo`.
- El pago anulado conserva sus datos, queda marcado (`anuladoAt`, `anuladoBy`, `motivoAnulacion`) y se muestra tachado en la lista.
- Los pagos anulados se **excluyen** del acumulado/estado de cuenta.
- Escribe `ActivityLog` tipo `pagoAnulado` con el motivo.
- Si el monto era incorrecto: se anula y se captura uno nuevo con el monto correcto.

### F. Sección operativa (post-formalización) + hoja operativa (futuro)

- Al pasar a `formalizada` se habilita una **sección operativa** para capturar los **horarios** que pide el contrato: horario civil, hora de inicio, hora de término.
- Esta sección alimenta el contrato y **más adelante** la "hoja operativa" (fuera de alcance de esta fase, se revisa después).

### G. Contrato pre-llenado

- Método: **plantilla HTML + impresión del navegador** (mismo patrón que el PDF de la cotización). Se abre, se imprime/guarda PDF y se firma.
- 9 páginas; el texto legal (cláusulas, reglamento de proveedores, restricciones) es boilerplate reproducido tal cual. La **tabla de pagos de la pág. 3 se deja tal cual** (impresa).
- Campos automáticos desde cotización/cliente (ver mapeo abajo).

**Fuera de alcance de esta fase:** reportes contables/administrativos, hoja operativa completa, CFDI/SAT, conciliación bancaria.

---

## Modelo de datos (Prisma)

### Reemplazo de `PaymentRule` (de eventType → space)

`PaymentRule` actual está ligado a `EventType` y solo sembrado (no usado en lógica). Se **migra a por-espacio**:

```
model SpacePaymentRule {
  id              String  @id @default(cuid())
  space           Space   @relation(fields: [spaceId], references: [id])
  spaceId         String  @unique
  anticipo        Int              // monto fijo del apartado
  complementoPct  Float            // % sobre el TOTAL de la cotización
  liquidarDiasAntes Int  @default(30)
}
```

Sembrar Cúpula/Arcos/Campos. Los demás espacios sin fila → sin regla.

### Nuevo `Payment`

```
model Payment {
  id             String        @id @default(cuid())
  quote          Quote         @relation(fields: [quoteId], references: [id])
  quoteId        String
  monto          Int                         // pesos, igual que total/rentaTotal; > 0
  metodo         PaymentMethod               // efectivo|transferencia|tarjeta (enum ya existe)
  concepto       PaymentConcept              // anticipo|complemento|aCuenta|finiquito
  fecha          DateTime                    // fecha del pago (UTC medianoche, como fechaEvento);
                                             // puede ser pasada — permite capturar fichas históricas
  referencia     String?                     // folio de transferencia, etc.
  comprobanteUrl String?                     // link/id en Drive
  comprobantePendiente Boolean @default(false) // true si aún no se subió a Drive
  registradoBy   User?         @relation(fields: [registradoById], references: [id])
  registradoById String?
  // Anulación (corrección contable — nunca se borra):
  anuladoAt        DateTime?
  anuladoBy        User?     @relation("PaymentAnuladoBy", fields: [anuladoById], references: [id])
  anuladoById      String?
  motivoAnulacion  String?
  createdAt      DateTime      @default(now())
  @@index([quoteId])
}
```

Nota: al enum `PaymentConcept` existente (anticipo|aCuenta|finiquito) se le **agrega `complemento`** (migración) para que los conceptos coincidan con los hitos reales del contrato; `aCuenta` queda para abonos parciales libres.
Validación: `monto > 0`; si el monto excede el saldo se **avisa** pero se permite (ajustes/redondeos reales).

### Nuevo `ActivityLog`

```
enum ActivityType { creada  estatus  pago  pagoAnulado  edicion }

model ActivityLog {
  id          String       @id @default(cuid())
  quote       Quote        @relation(fields: [quoteId], references: [id])
  quoteId     String
  tipo        ActivityType
  descripcion String                        // texto legible
  meta        Json?                         // antes/después, monto, etc.
  actor       User?        @relation(fields: [actorId], references: [id])
  actorId     String?
  createdAt   DateTime     @default(now())
  @@index([quoteId])
}
```

### Campos operativos en `Quote` (nullable, se llenan al formalizar)

```
horaInicio   String?   // "18:00"
horaTermino  String?   // "01:00"
horarioCivil String?   // texto libre del horario civil
```

(Se dejan simples ahora; la hoja operativa crecerá sobre esto después.)

---

## Estado de cuenta (cálculo)

Reemplaza el `pagado = 0` hardcodeado en `getByToken`. Calculado en vivo tanto para `getByToken` (público) como para `getQuote` (interno):

- **pagado** = Σ `Payment.monto` de la cotización, **excluyendo anulados**
- **saldo** = `total − pagado`
- **plan de hitos** (si el espacio tiene `SpacePaymentRule`):
  1. **Apartar**: objetivo = `anticipo`
  2. **Formalizar (complemento)**: objetivo acumulado = `anticipo + round(complementoPct × total)`; vence 3 meses después de la fecha de apartado (ver base del plazo en §A)
  3. **Finiquito**: objetivo = `total`; vence `liquidarDiasAntes` antes del evento (si ya estamos dentro de ese margen: vence de inmediato)
  - cada hito: objetivo, cubierto, estado (pendiente/cubierto)
- si el espacio **no** tiene regla: plan = `null` con bandera "pendiente de configurar"; se muestra solo pagado/saldo y **no** se auto-sugiere estatus.
- **desfase**: bandera cuando el estatus actual implica un umbral que el acumulado ya no cubre (por edición al alza o anulación) — solo informativa, no degrada.

---

## API (nuevos endpoints, capa de servicio)

- `POST /api/quotes/:id/payments` — registrar ficha (vendedora/admin, con scoping ownership). Recibe monto/metodo/concepto/fecha/referencia y opcionalmente la imagen (multipart) → sube a Drive vía `ComprobanteStorage` → guarda `Payment`. Escribe `ActivityLog` tipo `pago`. Devuelve el pago + estado de cuenta recalculado + sugerencia de estatus si cruzó umbral.
- `GET /api/quotes/:id` — incluye `payments`, `activityLog`, estado de cuenta calculado.
- `PATCH /api/quotes/:id/payments/:paymentId/anular` — anula un pago (**solo admin**, requiere `motivo`). Escribe `ActivityLog` tipo `pagoAnulado`.
- `GET /api/c/:token` — estado de cuenta real (pagado/saldo/plan) + lista de pagos no anulados (sin datos internos de quién capturó).
- `GET /api/quotes/:id/comprobantes/:paymentId` — proxy interno que transmite la imagen desde Drive (requireAuth + scoping).
- `GET /api/c/:token/comprobantes/:paymentId` — proxy público para la página del cliente; valida que el `paymentId` pertenezca a la cotización de ese `token` y que no esté anulado.
- `PUT /api/quotes/:id` — se permite en `apartada`/`formalizada`; escribe `ActivityLog` tipo `edicion`.
- `PATCH /api/quotes/:id/status` — escribe `ActivityLog` tipo `estatus`.
- `POST /api/quotes/:id/operativa` — guarda horarios (al formalizar).
- `createQuote` — escribe `ActivityLog` tipo `creada`.

`ComprobanteStorage` (interfaz en `@hsa/api`): `upload(file) → { url }`, `stream(id) → ReadableStream`. Adaptador Drive con cuenta de servicio; si no hay credencial, `upload` marca pendiente.

---

## UI (React)

### EditQuotePage (vendedora/admin)
- **Panel Estado de cuenta**: total/pagado/saldo + plan de hitos (o aviso "pendiente de configurar").
- **Registrar pago**: monto, método, concepto, fecha, referencia, subir foto de comprobante (o pegar link si no hay Drive). Tras guardar, si cruza umbral → aviso de avanzar estatus (confirmar).
- **Lista de pagos** con su comprobante (miniatura vía proxy); los anulados aparecen tachados con su motivo; botón "Anular" visible solo para admin (pide motivo).
- **Bitácora** (timeline de ActivityLog).
- **Sección operativa** visible cuando `formalizada`: horarios.
- **Botón "Generar contrato"** (disponible desde `apartada`/`formalizada`) → abre la vista de contrato.

### PublicQuotePage (cliente)
- Estado de cuenta pasa a **real** (pagado/saldo + plan de hitos + sus pagos con fecha y comprobante). Sin log interno ni datos de quién capturó.

### ContratoPage (`/cotizaciones/:id/contrato`, vista de impresión)
- Plantilla HTML de 9 páginas con `@media print` (saltos de página), reproduce el contrato y llena los campos.

---

## Mapeo de campos del contrato

| Campo en el contrato | Fuente |
|---|---|
| Contratante (nombre) | `client.nombre` |
| Correo | `client.correo` |
| Tipo de evento | `eventType.nombre` |
| Número de invitados | `quote.invitados` |
| Fecha del evento | `quote.fechaEvento` (UTC) |
| Horario civil / inicio / término | `quote.horarioCivil` / `horaInicio` / `horaTermino` (sección operativa) |
| Instalaciones (`- LUGAR EVENTO -`) | nombre del espacio |
| Renta: espacio, descuento 5%, Capilla, Total de Renta | `quote.breakdown` / `rentaTotal` |
| Paquete (`-NOMBRE PAQUETE-`) + precio + invitados | `foodPackage` + total de alimentos |
| Total de Paquete | total de alimentos |
| Horas de evento que cubre la renta | `quote.horasEvento` |
| Fecha de firma (`-día- -mes- -año-`) | fecha de generación (o elegible) |
| Cliente / Vendedor (firmas) | `client.nombre` / `createdBy.nombre` |
| Tabla de pagos pág. 3 | **boilerplate impreso, tal cual** |

---

## Migración de datos en producción

- Filas de `PaymentRule` (eventType) actuales: descartar; sembrar `SpacePaymentRule` para Cúpula/Arcos/Campos.
- `Payment`/`ActivityLog`/campos operativos: nuevos, sin datos que migrar automáticamente.
- **OJO — cotizaciones ya apartadas/formalizadas en producción:** arrancarán con pagado=0, es decir **desfasadas** respecto a su estatus (mostrarán el aviso de desfase, no se degradan). Las vendedoras deben **capturar retroactivamente** las fichas históricas de esos eventos (`Payment.fecha` acepta fechas pasadas) para cuadrar el estado de cuenta. Comunicarlo al equipo al desplegar.

## Plan de ejecución sugerido (2 sub-planes)

1. **Pagos + estado de cuenta + log + edición + Drive** (el core de cobranza).
2. **Contrato + sección operativa** (depende de los horarios que captura la sección operativa).

Cada uno produce software funcional por sí mismo.
