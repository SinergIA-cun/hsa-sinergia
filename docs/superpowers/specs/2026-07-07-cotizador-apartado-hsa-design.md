# Cotizador + Apartado — Hacienda San Andrés (HSA)

**Fecha:** 2026-07-07
**Estado:** Diseño aprobado (pendiente revisión del spec)
**Autor:** Fernando Díaz + Claude
**Negocio:** Hacienda San Andrés — salón de eventos (Atlacomulco No. 1, Col. San Esteban, Naucalpan, Edo. Méx.)

## 1. Objetivo y contexto

Digitalizar la operación de HSA empezando por la **cotización** y el **apartado**. Hoy se cotiza con folletos PDF por tipo de evento (Boda, XV, Bautizo, Cumpleaños, Empresarial, Renta) y se aparta con un "Recibo Provisional" a mano que luego se fotografía, se sube a Drive y JRAJ concilia contra el estado de cuenta bancario, registrándolo en la hoja `Recibos_2026`.

Este primer entregable cubre: **cotizar → enviar al cliente (link + QR + PDF) → convertir a orden de pago → generar contrato pre-llenado → registrar pagos con comprobante → mostrar saldo/plan en vivo por QR.**

Referente técnico: es la **app hermana de Motipreca** (mismo stack y convenciones).

## 2. Alcance

**Dentro:**
- Cotizador con motor de precios manejado por catálogo.
- Entrega al cliente: link web personalizado con marca HSA + PDF.
- QR en cotización/recibo que abre el **estado de cuenta en vivo** (total, pagado, saldo, plan de pagos).
- Apartado digital: **Orden de pago** con folio automático + plan de pagos.
- **Contrato pre-llenado** (PDF) generado desde plantilla, listo para imprimir y firmar.
- Registro de pagos (monto, forma, concepto) con **foto de comprobante** adjunta.
- Recibo digital con folio por cada pago.
- Panel de Admin para editar el catálogo (precios por año, paquetes, add-ons, reglas, plantilla de contrato).
- Auth y roles: Vendedora / Admin.

**Fuera (fases futuras):**
- Conciliación bancaria contra estado de cuenta.
- Automatización de la hoja `Recibos_2026` (reportes de ventas/nuevos contratos).
- CRM / agenda de eventos / calendario de disponibilidad.
- Facturación CFDI/SAT.

## 3. Arquitectura

Monorepo pnpm + Turbo, idéntico en forma a Motipreca.

```
hacienda-san-andres/
├── apps/
│   ├── web/        # React 18 + Vite 6 + TS. Cotizador, apartado, admin, link público.
│   └── api/        # Fastify 5. Auth, cotizaciones, órdenes de pago, recibos, catálogo, PDF.
├── packages/
│   ├── database/   # Prisma 6 + Postgres (schema, migrations, seed del catálogo HSA).
│   ├── shared/     # Motor de precios (funciones puras) + tipos + zod schemas.
│   └── ui/         # Componentes + marca HSA.
```

**Stack (espejo de Motipreca):**
- **web:** React 18, Vite 6, TanStack Query, react-router-dom, react-hook-form + zod, zustand, Tailwind 4, lucide-react, `qrcode.react`.
- **api:** Fastify 5 (+cookie/cors/helmet/rate-limit), `@node-rs/argon2`, `jose` (JWT en cookie), ioredis, zod.
- **database:** Prisma 6 + Postgres (migrations + seed).
- **auth:** propia (argon2 + JWT en cookie httpOnly), sin librería externa.

**Decisiones clave:**
- El **motor de precios vive en `packages/shared` como funciones puras** (sin DB ni HTTP). API y link público calculan exactamente lo mismo. Se testea al 100% con casos derivados de los folletos.
- La API solo orquesta: lee catálogo de Postgres, valida con zod, persiste, genera PDF.
- **Ruta pública sin auth** `/c/:token` para el link/QR del cliente; el resto detrás de login.
- **PDF generado en la API** desde la misma cotización (una sola fuente de verdad). Plantilla HTML → PDF, estilo compartido entre cotización / contrato / recibo.

## 4. Modelo de dominio (Prisma/Postgres)

### Catálogo (editable por Admin, versionado por año)

- **`Space`** — Los Arcos, Jardín del Caballo, Los Campos, La Cúpula, Los Balcones, Los Pajaritos, Capilla. Capacidad y flags (carpa, pista máx., etc.).
- **`PriceList`** — versión/año con vigencia. Las cotizaciones emitidas conservan sus precios (snapshot), aunque cambie el catálogo.
- **`RentalPrice`** — matriz `space × rango de capacidad × tipo de día × precio` (con IVA). Tipo de día: `Viernes` / `ViernesEspecial` (mar–may, sep–oct) / `Sábado` / `Dom–Jue`.
- **`EventType`** — Boda, XV, Bautizo, Cumpleaños, Empresarial, Graduación, Renta, Otros.
- **`FoodPackage`** (por `EventType`) — nombre, IVA sí/no, **precio por persona por rango de capacidad**, servicios incluidos (texto para el folleto/PDF), regla de anticipo.
- **`AddOn`** — Valet ($/auto), DJ, Mesa de dulces, Cabina, Torna fiesta, Letras, etc. `tipo` = `fijo` | `porPersona` | `porUnidad`. Scope global o por evento.
- **`PricingRule`** — hora extra 5%, descuento 5% de renta si hay alimentos, y **regla de plan de pagos por tipo de evento**.

### Regla de plan de pagos (por `EventType`, editable)

Default para todos los eventos:
- **Apartar fecha:** `$5,000` (cuenta a favor del 30%).
- **Formalizar:** `30% de la RENTA` (menos lo ya apartado).
- **Liquidación:** `saldo restante` (resto de renta + alimentos + extras), con fecha = `fecha del evento − 30 días`.

Nota: el 5,000 y el 30% se calculan **sobre la renta del espacio**, no sobre el total. Configurable por Admin; la vendedora puede ajustar montos/fechas en casos especiales.

### Operación

- **`Client`** — nombre, teléfono, correo, empresa/agencia; **domicilio** e **identificación** (opcionales, solo para el contrato).
- **`Quote`** (Cotización) — cliente, tipo de evento, fecha/horas, invitados, espacio(s), día/temporada (derivado de la fecha), paquete de alimentos (opcional), add-ons, **desglose y totales congelados**, `publicToken`, estado, vigencia.
  - Estados: `borrador → enviada → aceptada → apartada (orden de pago) → liquidada`, + `vencida`.
- **`PaymentOrder`** (Orden de pago; antes "Reservation") — **folio automático**, ligada a la Quote, costo total, referencia al plan.
- **`PaymentPlan`** + **`PlannedInstallment[]`** — anticipo/formalización/liquidación con monto y fecha **sugeridos por la regla** y editables.
- **`Payment`** — monto, forma (efectivo / transferencia / tarjeta), concepto (anticipo / a cuenta / finiquito), fecha, **comprobante adjunto (foto)**, registrado por.
- **`ContractTemplate`** (texto con placeholders) → **`Contract`** generado (PDF congelado con datos del cliente/evento/plan).
- **Derivado:** `saldo = costo total − Σ pagos` (lo que muestra el QR).
- **`User`** — rol Vendedora | Admin (argon2 + JWT).

## 5. Motor de precios (`packages/shared`)

Función pura. Entrada: `{ tipoEvento, fecha, invitados, espacios[], horasExtra, paqueteAlimentos?, addOns[], catálogo }`. Salida: desglose línea por línea + totales.

Pasos:
1. **Renta** = `precio(espacio, rango(invitados), tipoDía(fecha, temporada))` con IVA. Suma si hay varios espacios.
2. **+ Horas extra** = 5% de renta por hora.
3. **+ Alimentos** = `precioPorPersona(rango) × invitados`. Agrega IVA si el paquete es sin IVA.
4. **− Descuento** 5% de renta si hay alimentos.
5. **+ Add-ons** = `fijo` | `porPersona × invitados` | `porUnidad × cantidad`; incluye Valet, DJ, etc.
6. **Totales**: subtotal, IVA, total. Desglose congelado en la `Quote`.

Derivación de `tipoDía`: a partir de la fecha (día de semana) y temporada (viernes especial en marzo–mayo y septiembre–octubre).

## 6. Flujos de usuario

**Vendedora:**
1. Nueva cotización — wizard: cliente → evento + fecha + invitados → espacio(s) → alimentos (opcional) → extras → revisión con **desglose en vivo**.
2. Guardar → Enviar: genera **link + QR + PDF** con marca HSA.
3. Cliente acepta → **Convertir a Orden de pago**: genera folio, plan de pagos y **contrato pre-llenado (PDF)**. La vendedora imprime y recaba firmas.
4. Registrar pago: monto/forma/concepto + **foto de comprobante** → **recibo con folio (PDF)** → actualiza saldo.

**Cliente (link/QR, sin login):**
- Vista 1: cotización con marca HSA (paquetes, fotos, total, condiciones).
- Vista 2: **estado de cuenta** — plan de pagos, pagos registrados, **saldo** ("debes $X").

**Admin:**
- CRUD del catálogo: espacios, **listas de precios por año**, tipos de evento, paquetes de alimentos, add-ons, reglas (5%, plan de pagos por evento) y **plantilla de contrato**.
- Ve todas las cotizaciones/órdenes/pagos.

## 7. No-funcionales

- Moneda **MXN**, **IVA 16%**, zona horaria `America/Mexico_City`.
- Almacenamiento de comprobantes/PDFs en volumen o S3-compatible.
- Deploy en EasyPanel/VPS con dominio propio (como Motipreca). Gotcha conocido: proxy en http, no https, en la config interna.
- **Pruebas:**
  - Unitarias del **motor de precios** con casos derivados de los folletos (Boda, Empresarial, Bautizo) — verificar precios exactos por rango/día/temporada.
  - Integración de API (auth, crear cotización, convertir a orden, registrar pago).
  - E2E del flujo crítico: cotizar → link → aceptar → orden + contrato → pago → saldo actualizado.

## 8. Dependencias / insumos pendientes

- **Plantilla de contrato actual de HSA** (Word/PDF) para mapear campos. Mientras tanto, arrancar con una plantilla genérica con placeholders.
- Confirmar textos legales/condiciones para cotización y recibo.
- Datos completos de precios 2027 de todos los tipos de evento (ya tenemos Boda, Empresarial, Bautizo; faltan XV, Cumpleaños, Renta, TB) para el seed del catálogo.

## 9. Preguntas resueltas (decisiones)

- **Alcance MVP:** cotizador + apartado (recibo digital con comprobante).
- **Entrega al cliente:** link web + PDF; el cliente puede apartar desde el link.
- **QR:** abre el estado de cuenta en vivo (saldo + plan de pagos).
- **Roles:** Vendedora + Admin; cliente sin login (link único).
- **Orden de pago:** $5,000 apartar / 30% renta formalizar / liquidación 30 días antes; **base = renta**; **regla configurable por tipo de evento**.
- **Contrato:** pre-llenado desde plantilla, se imprime para firmas.
- **Arquitectura:** app hermana de Motipreca (monorepo, mismo stack).
