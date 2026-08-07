# Plan D · Porcentaje real, candado por factura y avisos de fecha empalmada

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el contrato imprima multiplicaciones exactas, que los datos fiscales se congelen al emitir la primera factura (y solo admin los mueva), y que apartar una fecha avise a los vendedores cuyas cotizaciones quedaron desplazadas.

**Architecture:** Tres cambios independientes sobre la rama `feat/planA-estatus-multisalon`. D1 es aritmética pura en `packages/shared` + presentación en el contrato, con **cero cambio de dinero** (se prorratea lo no atribuido para que la suma quede idéntica). D2 mueve el disparador del candado del corte de mes a la primera factura emitida y agrega la acción manual de "marcar facturado" que hoy falta. D3 detecta los empalmes **de forma derivada** (sin tabla nueva) y los muestra en la agenda y en el panel.

**Tech Stack:** pnpm + Turbo, Fastify 5, Prisma 6 + Postgres (docker `hsa-postgres`, puerto 5434), React 18 + Vite 6 + Tailwind 4 + TanStack Query, Vitest.

---

## Reglas de la rama (heredadas de los planes A/B/C)

- **`git commit --amend` está PROHIBIDO** en esta rama. Un subagente reescribió una vez un commit de docs de otra sesión. Siempre commits nuevos.
- Los tests de integración de la API corren con `fileParallelism: false`. **No correr dos suites de API a la vez**: el bloqueo de disponibilidad del servidor hace que colisionen por fecha.
- Nunca guardar archivos de trabajo en la raíz del repo.
- Nunca commitear `.env` ni llaves.

## Decisiones ya tomadas (no volver a preguntar)

1. **Base del porcentaje: la renta.** Ya era así en el código; no se mueve dinero. Lo que se corrige es la impresión y la atribución por salón.
2. **Candado fiscal: a partir de la primera factura emitida**, no al cierre de mes. Solo admin puede cambiar datos fiscales una vez congelados.
3. **Empalmes: avisar, nunca bloquear.** El pago siempre se registra. Aviso en el panel del vendedor + símbolo en la agenda.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `packages/shared/src/pricing/prorrateo.ts` (nuevo) | Repartir la renta no atribuida (horas extra, capilla) entre los salones, en proporción a su renta de catálogo. Función pura. |
| `packages/shared/src/facturacion/candado.ts` (modificar) | Separar "¿este pago es facturable?" (sigue con corte de mes, informativo) de "¿se pueden editar los datos fiscales?" (ahora: solo si no hay ninguna factura emitida). |
| `apps/api/src/quotes/estadoCuenta.ts` (modificar) | Complemento como suma exacta `Σ pct_i × rentaBase_i`; el hito lleva el desglose por salón en vez de un porcentaje global. |
| `apps/api/src/quotes/service.ts` (modificar) | Usar el prorrateo al armar `rentaBase`; permitir a admin editar datos fiscales congelados. |
| `apps/api/src/payments/service.ts` (modificar) | `marcarFacturado()` — acción de admin que sella `facturadoAt` y `facturaUuid`. |
| `apps/api/src/quotes/empalmes.ts` (nuevo) | Consulta derivada: cotizaciones no bloqueantes cuya fecha+espacio ya fue apartada por otra. |
| `apps/web/src/pages/ContratoPage.tsx` (modificar) | Tabla de pagos con renta prorrateada y monto exacto por salón; total sin porcentaje. |
| `apps/web/src/components/FacturacionSection.tsx` (modificar) | Motivo del candado nuevo; admin siempre puede editar. |
| `apps/web/src/components/AvisoEmpalmes.tsx` (nuevo) | Tarjeta del panel que lista las cotizaciones desplazadas del vendedor. |
| `apps/web/src/pages/AgendaPage.tsx` (modificar) | Símbolo en el chip desplazado. |
| `docs/EASYPANEL.md` (modificar) | Dominios reales: `hsa` y `hsaapi`, no `hsacotizador` y `hsapi`. |

---

# D1 · El porcentaje impreso es el porcentaje real

**Contexto.** `rentaTotal` = renta de espacios + horas extra + capilla, todo con IVA. Solo los renglones `Renta {spaceId}` traen `spaceId`, así que hoy `Σ rentaBase_i < rentaTotal` cuando hay horas extra o capilla en sábado. El motor calcula `pctPonderado × rentaTotal`. Si pasáramos a `Σ pct_i × rentaBase_i` sin prorratear, el complemento **bajaría** — y eso no fue lo que se decidió.

**La identidad que hay que preservar:** si `rentaBase_i = rentaTotal × (renta_i / Σ renta)`, entonces
`Σ pct_i × rentaBase_i = rentaTotal × Σ pct_i × (renta_i / Σ renta) = pctPonderado × rentaTotal`.
Idéntico a hoy, pero ahora cada renglón multiplica exacto por separado.

### Task 1: Prorrateo de la renta no atribuida

**Files:**
- Create: `packages/shared/src/pricing/prorrateo.ts`
- Test: `packages/shared/src/pricing/prorrateo.test.ts`
- Modify: `packages/shared/src/index.ts` (exportar)

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from 'vitest';
import { prorratearRenta } from './prorrateo.js';

describe('prorratearRenta', () => {
  it('reparte las horas extra en proporción a la renta de cada salón', () => {
    // Cúpula 174,000 + Arcos 108,500 = 282,500 de catálogo.
    // rentaTotal 300,000 → sobran 17,500 por repartir.
    const r = prorratearRenta(new Map([['cup', 174_000], ['arc', 108_500]]), 300_000);
    expect(r.get('cup')! + r.get('arc')!).toBe(300_000);
    // Cúpula pesa 174000/282500 = 0.615929…
    expect(r.get('cup')).toBeCloseTo(184_778.76, 2);
  });

  it('con un solo salón le asigna toda la renta', () => {
    const r = prorratearRenta(new Map([['cup', 174_000]]), 196_400);
    expect(r.get('cup')).toBe(196_400);
  });

  it('sin renta de catálogo reparte en partes iguales', () => {
    const r = prorratearRenta(new Map([['a', 0], ['b', 0]]), 100_000);
    expect(r.get('a')).toBe(50_000);
    expect(r.get('b')).toBe(50_000);
  });

  it('el último salón absorbe el centavo del redondeo', () => {
    const r = prorratearRenta(new Map([['a', 1], ['b', 1], ['c', 1]]), 100);
    expect(r.get('a')! + r.get('b')! + r.get('c')!).toBe(100);
  });

  it('sin salones devuelve un mapa vacío', () => {
    expect(prorratearRenta(new Map(), 100_000).size).toBe(0);
  });
});
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `pnpm --filter @hsa/shared test -- prorrateo`
Expected: FAIL — `Cannot find module './prorrateo.js'`

- [ ] **Step 3: Implementar**

```ts
/**
 * Reparte `rentaTotal` entre los salones en proporción a su renta de catálogo.
 *
 * `rentaTotal` incluye horas extra y capilla, que no traen `spaceId` y por eso
 * no se pueden atribuir directamente. Prorratearlas mantiene la identidad
 * `Σ pct_i × base_i == pctPonderado × rentaTotal`: el complemento total no se
 * mueve ni un peso, pero cada renglón del contrato ya multiplica exacto.
 *
 * El último salón absorbe la diferencia del redondeo para que la suma cierre.
 */
export function prorratearRenta(
  rentaCatalogo: Map<string, number>,
  rentaTotal: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const ids = [...rentaCatalogo.keys()];
  if (ids.length === 0) return out;

  const suma = ids.reduce((s, id) => s + (rentaCatalogo.get(id) ?? 0), 0);
  let acumulado = 0;
  ids.forEach((id, i) => {
    const esUltimo = i === ids.length - 1;
    if (esUltimo) {
      out.set(id, Math.round((rentaTotal - acumulado) * 100) / 100);
      return;
    }
    const peso = suma > 0 ? (rentaCatalogo.get(id) ?? 0) / suma : 1 / ids.length;
    const parte = Math.round(rentaTotal * peso * 100) / 100;
    acumulado += parte;
    out.set(id, parte);
  });
  return out;
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm --filter @hsa/shared test -- prorrateo`
Expected: PASS, 5 tests

- [ ] **Step 5: Exportar desde el índice**

En `packages/shared/src/index.ts` agregar junto a los otros export de pricing:

```ts
export * from './pricing/prorrateo.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/pricing/prorrateo.ts packages/shared/src/pricing/prorrateo.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): prorratear horas extra y capilla entre los salones"
```

### Task 2: El complemento se calcula salón por salón

**Files:**
- Modify: `apps/api/src/quotes/estadoCuenta.ts`
- Test: `apps/api/src/quotes/estadoCuenta.test.ts`

- [ ] **Step 1: Test de que el total no se mueve y aparece el desglose**

Agregar al final del describe existente:

```ts
describe('complemento por salón', () => {
  const reglas = [
    { spaceId: 'cup', rentaBase: 184_778.76, rule: { anticipo: 25_000, complementoPct: 0.25, liquidarDiasAntes: 30 } },
    { spaceId: 'arc', rentaBase: 115_221.24, rule: { anticipo: 20_000, complementoPct: 0.10, liquidarDiasAntes: 30 } },
  ];

  it('el complemento es la suma exacta de cada salón', () => {
    const ec = computeEstadoCuenta({
      total: 300_000,
      fechaEvento: new Date('2027-05-01T00:00:00Z'),
      status: 'borrador',
      rules: reglas,
      payments: [],
    });
    const comp = ec.plan!.find((h) => h.key === 'complemento')!;
    // 25% × 184,778.76 = 46,194.69 ; 10% × 115,221.24 = 11,522.12
    expect(comp.desglose).toEqual([
      { spaceId: 'cup', rentaBase: 184_778.76, pct: 0.25, monto: 46_195 },
      { spaceId: 'arc', rentaBase: 115_221.24, pct: 0.10, monto: 11_522 },
    ]);
    // objetivo = apartado (45,000) + 46,195 + 11,522
    expect(comp.objetivo).toBe(102_717);
  });

  it('con un solo salón el desglose tiene un renglón que multiplica exacto', () => {
    const ec = computeEstadoCuenta({
      total: 196_400,
      fechaEvento: new Date('2027-05-01T00:00:00Z'),
      status: 'borrador',
      rules: [{ spaceId: 'cup', rentaBase: 196_400, rule: { anticipo: 25_000, complementoPct: 0.25, liquidarDiasAntes: 30 } }],
      payments: [],
    });
    const comp = ec.plan!.find((h) => h.key === 'complemento')!;
    expect(comp.desglose).toEqual([{ spaceId: 'cup', rentaBase: 196_400, pct: 0.25, monto: 49_100 }]);
    expect(comp.objetivo).toBe(74_100); // 25,000 + 49,100
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm --filter @hsa/api test -- estadoCuenta`
Expected: FAIL — `desglose` no existe en `Milestone`

- [ ] **Step 3: Cambiar el tipo y el cálculo**

En `estadoCuenta.ts`, reemplazar el campo `porcentaje` del `Milestone`:

```ts
/** Un renglón del complemento: lo que aporta un salón, con su multiplicación a la vista. */
export interface ComplementoPorEspacio {
  spaceId: string;
  rentaBase: number;
  pct: number;
  monto: number;
}

export interface Milestone {
  key: 'apartar' | 'complemento' | 'finiquito';
  label: string;
  objetivo: number;
  cubierto: number;
  restante: number;
  completo: boolean;
  venceISO: string | null;
  /** Solo el complemento: qué aporta cada salón. `pct × rentaBase == monto`, exacto. */
  desglose?: ComplementoPorEspacio[];
}
```

Reemplazar el bloque del promedio ponderado (las líneas de `sumRenta` y `pctPonderado`) por:

```ts
  // Complemento: cada salón aporta el porcentaje de SU renta. La renta que se le
  // pasa aquí ya viene prorrateada (incluye su parte de horas extra y capilla),
  // así que la suma de los renglones es idéntica al viejo `pctPonderado × total`
  // pero cada renglón multiplica exacto y se puede imprimir en el contrato.
  const desglose: ComplementoPorEspacio[] = rules.map((r) => ({
    spaceId: r.spaceId,
    rentaBase: r.rentaBase,
    pct: r.rule.complementoPct,
    monto: Math.round(r.rule.complementoPct * r.rentaBase),
  }));
  const objComplemento = objApartar + desglose.reduce((s, d) => s + d.monto, 0);
```

Cambiar la firma del helper `hito` para que reciba `desglose` en vez de `porcentaje`:

```ts
  const hito = (
    key: Milestone['key'],
    label: string,
    objetivo: number,
    venceISO: string | null,
    desgloseHito?: ComplementoPorEspacio[],
  ): Milestone => {
    const cubierto = Math.min(pagado, objetivo);
    return { key, label, objetivo, cubierto, restante: Math.max(0, objetivo - cubierto), completo: pagado >= objetivo, venceISO, desglose: desgloseHito };
  };
```

Y la llamada del complemento:

```ts
    hito('complemento', 'Complemento', objComplemento, complementoVence?.toISOString() ?? null, desglose),
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm --filter @hsa/api test -- estadoCuenta`
Expected: PASS

- [ ] **Step 5: Correr TODA la suite de la API para cazar usos de `porcentaje`**

Run: `pnpm --filter @hsa/api test`
Expected: los tests que afirmaban `porcentaje` fallan. Ajustarlos al `desglose` nuevo — **no borrarlos**.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/quotes/estadoCuenta.ts apps/api/src/quotes/estadoCuenta.test.ts
git commit -m "feat(api): complemento como suma exacta por salón, con desglose"
```

### Task 3: El servicio prorratea antes de armar las reglas

**Files:**
- Modify: `apps/api/src/quotes/service.ts` (`rentaBasePorEspacio`, ~línea 162)

- [ ] **Step 1: Aplicar el prorrateo**

Reemplazar `rentaBasePorEspacio` por:

```ts
/**
 * Renta atribuida a cada espacio, con las horas extra y la capilla ya repartidas.
 *
 * Los renglones `Renta {spaceId}` del desglose son los únicos que traen `spaceId`;
 * horas extra y capilla entran a `rentaTotal` sin dueño. Se prorratean para que
 * la suma de las bases sea exactamente `rentaTotal` y el complemento no cambie.
 */
function rentaBasePorEspacio(breakdown: unknown, spaceIds: string[], rentaTotal: number): Map<string, number> {
  const lines = (breakdown as { lines?: { spaceId?: string; monto?: number }[] } | null)?.lines ?? [];
  const catalogo = new Map<string, number>();
  for (const id of spaceIds) catalogo.set(id, 0);
  for (const l of lines) {
    if (l.spaceId && typeof l.monto === 'number' && catalogo.has(l.spaceId)) {
      catalogo.set(l.spaceId, (catalogo.get(l.spaceId) ?? 0) + l.monto);
    }
  }
  return prorratearRenta(catalogo, rentaTotal);
}
```

Agregar el import arriba del archivo, junto a los otros de `@hsa/shared`:

```ts
import { prorratearRenta } from '@hsa/shared';
```

- [ ] **Step 2: Test de que la suma de bases es exactamente rentaTotal**

Agregar en `apps/api/src/quotes/quotes.test.ts`:

```ts
it('la suma de las rentas por espacio es exactamente la renta total', async () => {
  const q = await crearCotizacionMultiSalon(); // helper existente del Plan A
  const res = await app.inject({ method: 'GET', url: `/api/quotes/${q.id}`, cookies: authCookie });
  const comp = res.json().estadoCuenta.plan.find((h: { key: string }) => h.key === 'complemento');
  const sumaBases = comp.desglose.reduce((s: number, d: { rentaBase: number }) => s + d.rentaBase, 0);
  expect(Math.round(sumaBases * 100) / 100).toBe(res.json().rentaTotal);
});
```

- [ ] **Step 3: Correr**

Run: `pnpm --filter @hsa/api test -- quotes`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/quotes/service.ts apps/api/src/quotes/quotes.test.ts
git commit -m "feat(api): prorratear la renta antes de repartir el complemento"
```

### Task 4: El contrato imprime multiplicaciones verificables

**Files:**
- Modify: `apps/web/src/pages/ContratoPage.tsx` (tabla de pagos, ~líneas 260-295)
- Modify: `apps/web/src/lib/money.ts` (quitar `formatPct` si queda sin uso)

- [ ] **Step 1: Reescribir la tabla**

Encabezados nuevos: `Espacio | Renta | Apartado | Complemento | Finiquito`.

Renglón por salón (usar `hitoComplemento.desglose` para el monto, no recalcular en el front):

```tsx
{quote.spaceIds.map((id) => {
  const d = hitoComplemento?.desglose?.find((x) => x.spaceId === id);
  const regla = reglasById.get(id);
  return (
    <tr key={id}>
      <td>{espaciosById.get(id) ?? id}</td>
      <td>{d ? formatMXNCents(d.rentaBase) : '—'}</td>
      <td>{regla ? formatMXNCents(regla.anticipo) : 'por definir'}</td>
      <td>{d ? `${Math.round(d.pct * 100)}% = ${formatMXNCents(d.monto)}` : 'por definir'}</td>
      <td />
    </tr>
  );
})}
```

Renglón de total — **sin porcentaje**, es una suma:

```tsx
<tr>
  <td><b>{quote.spaceIds.length > 1 ? 'Total del evento' : 'Total'}</b></td>
  <td><b>{formatMXNCents(quote.rentaTotal)}</b></td>
  <td><b>{hitoApartar ? formatMXNCents(hitoApartar.objetivo) : '—'}</b></td>
  <td><b>{hitoComplemento?.desglose ? formatMXNCents(hitoComplemento.desglose.reduce((s, d) => s + d.monto, 0)) : '—'}</b></td>
  <td>
    {hitoFiniquito ? formatMXNCents(hitoFiniquito.objetivo) : '—'}, cubierto{' '}
    {hitoFiniquito?.venceISO ? `el ${formatEventDate(hitoFiniquito.venceISO, 'long')}` : '30 días antes del evento'}.
  </td>
</tr>
```

- [ ] **Step 2: Nota al pie que explica el acumulado**

Debajo de la tabla, para que nadie confunda el complemento con el acumulado:

```tsx
<p className="nota">
  El complemento es adicional al apartado. Al cubrirlo, lo pagado acumulado
  suma {hitoComplemento ? formatMXNCents(hitoComplemento.objetivo) : '—'}.
</p>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hsa/web typecheck`
Expected: sin errores. Si `formatPct` quedó huérfano, borrarlo de `money.ts` y de su test.

- [ ] **Step 4: Verificar en el navegador con números a mano**

Abrir un contrato de un salón y uno de dos. Confirmar a mano que `pct × renta == monto` en cada renglón y que el renglón de total es la suma de los de arriba.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ContratoPage.tsx apps/web/src/lib/money.ts
git commit -m "fix(web): el contrato imprime el complemento exacto por salón"
```

---

# D2 · El candado fiscal se cierra con la primera factura

**Contexto.** Hoy `datosFiscalesEditables` se cierra cuando **todos** los pagos dejaron de ser facturables — incluido por corte de mes. La decisión es otra: los datos se congelan cuando **ya se emitió una factura con ellos**, y solo admin los mueve. El corte de mes se queda, pero como **información del pago** ("ya no es facturable"), no como candado de los datos.

**Sin PAC no hay disparador.** `facturadoAt` no lo escribe nadie hoy. Sin la acción manual de admin, el candado sería código muerto. Por eso la Task 6 es obligatoria, no opcional.

### Task 5: Separar "pago facturable" de "datos editables"

**Files:**
- Modify: `packages/shared/src/facturacion/candado.ts`
- Modify: `packages/shared/src/facturacion/candado.test.ts`

- [ ] **Step 1: Reescribir los tests de `datosFiscalesEditables`**

Reemplazar el describe existente de `datosFiscalesEditables` por:

```ts
describe('datosFiscalesEditables', () => {
  const hoy = new Date(Date.UTC(2026, 7, 7));

  it('sin pagos, editables', () => {
    expect(datosFiscalesEditables([]).editable).toBe(true);
  });

  it('con pagos pero ninguno facturado, editables', () => {
    const pagos = [{ fecha: new Date(Date.UTC(2026, 2, 10)) }];
    expect(datosFiscalesEditables(pagos).editable).toBe(true);
  });

  it('un mes cerrado SIN factura ya no congela los datos', () => {
    // Marzo cerró y el pago se fue a público en general: el pago no es
    // facturable, pero los datos del cliente siguen siendo suyos y editables.
    const pagos = [{ fecha: new Date(Date.UTC(2026, 2, 10)) }];
    expect(estadoFacturaPago(pagos[0], hoy).facturable).toBe(false);
    expect(datosFiscalesEditables(pagos).editable).toBe(true);
  });

  it('una sola factura emitida congela los datos', () => {
    const pagos = [
      { fecha: new Date(Date.UTC(2026, 6, 10)), facturadoAt: new Date(Date.UTC(2026, 6, 11)) },
      { fecha: new Date(Date.UTC(2026, 7, 1)) },
    ];
    const r = datosFiscalesEditables(pagos);
    expect(r.editable).toBe(false);
    expect(r.motivo).toContain('factura');
  });

  it('una factura de un pago anulado no congela nada', () => {
    const pagos = [{
      fecha: new Date(Date.UTC(2026, 6, 10)),
      facturadoAt: new Date(Date.UTC(2026, 6, 11)),
      anuladoAt: new Date(Date.UTC(2026, 6, 20)),
    }];
    expect(datosFiscalesEditables(pagos).editable).toBe(true);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm --filter @hsa/shared test -- candado`
Expected: FAIL — la firma sigue pidiendo `hoy` y la regla es la vieja.

- [ ] **Step 3: Reescribir la función**

Reemplazar `datosFiscalesEditables` completa por:

```ts
/**
 * ¿Se pueden todavía tocar los datos fiscales del cliente?
 *
 * Se congelan en cuanto existe UNA factura emitida con ellos: el CFDI ya salió
 * con ese RFC y esa razón social, y cambiarlos por debajo desalinea lo timbrado.
 * Un admin sí puede moverlos (el rol se verifica en la API, no aquí).
 *
 * El corte de mes NO congela: un pago que se fue a la factura global dejó de ser
 * facturable, pero nunca llevó los datos del cliente a ningún CFDI.
 *
 * No recibe `hoy` a propósito: esta regla no depende del calendario.
 */
export function datosFiscalesEditables(pagos: PagoParaCandado[]): EstadoEdicionFiscal {
  const facturado = pagos.some((p) => !p.anuladoAt && p.facturadoAt);
  if (!facturado) return { editable: true, motivo: null };
  return {
    editable: false,
    motivo: 'Ya se emitió una factura con estos datos. Solo un administrador puede cambiarlos.',
  };
}
```

- [ ] **Step 4: Correr**

Run: `pnpm --filter @hsa/shared test -- candado`
Expected: PASS

- [ ] **Step 5: Arreglar las llamadas rotas**

Run: `pnpm typecheck`
Buscar todos los `datosFiscalesEditables(` que sigan pasando `hoy` y quitarles el segundo argumento.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/facturacion/candado.ts packages/shared/src/facturacion/candado.test.ts
git commit -m "feat(shared): el candado fiscal se cierra con la primera factura, no con el mes"
```

### Task 6: Marcar un pago como facturado (admin)

**Files:**
- Modify: `apps/api/src/payments/service.ts`
- Modify: `apps/api/src/payments/routes.ts`
- Test: `apps/api/src/payments/payments.test.ts`

- [ ] **Step 1: Tests**

```ts
describe('marcar facturado', () => {
  it('un admin sella el pago y queda en la bitácora', async () => {
    const { quoteId, paymentId } = await crearPagoDePrueba();
    const res = await app.inject({
      method: 'POST',
      url: `/api/quotes/${quoteId}/payments/${paymentId}/facturado`,
      cookies: adminCookie,
      payload: { facturaUuid: '11111111-2222-3333-4444-555555555555' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().facturadoAt).not.toBeNull();

    const logs = await db.activityLog.findMany({ where: { quoteId, tipo: 'factura' } });
    expect(logs).toHaveLength(1);
  });

  it('un vendedor no puede', async () => {
    const { quoteId, paymentId } = await crearPagoDePrueba();
    const res = await app.inject({
      method: 'POST',
      url: `/api/quotes/${quoteId}/payments/${paymentId}/facturado`,
      cookies: vendedorCookie,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('no se puede facturar dos veces', async () => {
    const { quoteId, paymentId } = await crearPagoDePrueba();
    await app.inject({ method: 'POST', url: `/api/quotes/${quoteId}/payments/${paymentId}/facturado`, cookies: adminCookie, payload: {} });
    const res = await app.inject({ method: 'POST', url: `/api/quotes/${quoteId}/payments/${paymentId}/facturado`, cookies: adminCookie, payload: {} });
    expect(res.statusCode).toBe(409);
  });

  it('un pago anulado no se puede facturar', async () => {
    const { quoteId, paymentId } = await crearPagoAnulado();
    const res = await app.inject({ method: 'POST', url: `/api/quotes/${quoteId}/payments/${paymentId}/facturado`, cookies: adminCookie, payload: {} });
    expect(res.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan (404, la ruta no existe)**

Run: `pnpm --filter @hsa/api test -- payments`

- [ ] **Step 3: Implementar el servicio**

En `apps/api/src/payments/service.ts`, junto a `desbloquearFactura`:

```ts
export const marcarFacturadoSchema = z.object({
  facturaUuid: z.string().uuid().nullish(),
});

/**
 * Sella un pago como facturado. Mientras no exista el PAC, este es el único
 * disparador del candado de datos fiscales, y por eso es de admin.
 */
export async function marcarFacturado(
  db: PrismaClient,
  quoteId: string,
  paymentId: string,
  input: z.infer<typeof marcarFacturadoSchema>,
  actor: Actor,
) {
  await findOwnedQuote(db, quoteId, actor); // pertenencia + no está en papelera
  const pago = await db.payment.findFirst({ where: { id: paymentId, quoteId } });
  if (!pago) throw new QuoteError(404, 'Pago no encontrado');
  if (pago.anuladoAt) throw new QuoteError(409, 'El pago está anulado.');
  if (pago.facturadoAt) throw new QuoteError(409, 'Este pago ya está facturado.');

  const actualizado = await db.payment.update({
    where: { id: paymentId },
    data: { facturadoAt: new Date(), facturaUuid: input.facturaUuid ?? null, desbloqueoAt: null },
  });
  await logActivity(db, {
    quoteId,
    tipo: 'factura',
    descripcion: `Pago marcado como facturado${input.facturaUuid ? ` (UUID ${input.facturaUuid})` : ''}`,
    meta: { paymentId, facturaUuid: input.facturaUuid ?? null },
    actorId: actor.id,
  });
  return actualizado;
}
```

- [ ] **Step 4: Registrar la ruta**

En `apps/api/src/payments/routes.ts`, siguiendo el patrón de `desbloquearFactura`:

```ts
app.post<{ Params: { id: string; paymentId: string } }>(
  '/quotes/:id/payments/:paymentId/facturado',
  { preHandler: requireAdmin },
  async (req, reply) => {
    const parsed = marcarFacturadoSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    try {
      return await marcarFacturado(app.db, req.params.id, req.params.paymentId, parsed.data, req.actor);
    } catch (e) {
      if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  },
);
```

- [ ] **Step 5: Correr**

Run: `pnpm --filter @hsa/api test -- payments`
Expected: PASS, 4 tests nuevos

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/payments/
git commit -m "feat(api): admin puede marcar un pago como facturado"
```

### Task 7: Admin puede editar datos fiscales congelados

**Files:**
- Modify: `apps/api/src/quotes/service.ts` (la guardia fiscal de `updateQuote`)
- Test: `apps/api/src/quotes/quotes.test.ts`

- [ ] **Step 1: Tests**

```ts
it('un vendedor no puede cambiar el RFC después de facturar', async () => {
  const { quoteId, paymentId } = await crearPagoDePrueba();
  await marcarFacturadoComoAdmin(quoteId, paymentId);
  const res = await app.inject({
    method: 'PATCH', url: `/api/quotes/${quoteId}`, cookies: vendedorCookie,
    payload: { client: { rfc: 'XAXX010101000' } },
  });
  expect(res.statusCode).toBe(409);
});

it('un admin sí puede, y queda en la bitácora', async () => {
  const { quoteId, paymentId } = await crearPagoDePrueba();
  await marcarFacturadoComoAdmin(quoteId, paymentId);
  const res = await app.inject({
    method: 'PATCH', url: `/api/quotes/${quoteId}`, cookies: adminCookie,
    payload: { client: { rfc: 'XAXX010101000' } },
  });
  expect(res.statusCode).toBe(200);
  const logs = await db.activityLog.findMany({ where: { quoteId, tipo: 'fiscal' } });
  expect(logs.length).toBeGreaterThan(0);
});

it('editar solo los invitados sigue funcionando con datos congelados', async () => {
  const { quoteId, paymentId } = await crearPagoDePrueba();
  await marcarFacturadoComoAdmin(quoteId, paymentId);
  const res = await app.inject({
    method: 'PATCH', url: `/api/quotes/${quoteId}`, cookies: vendedorCookie,
    payload: { invitados: 180 },
  });
  expect(res.statusCode).toBe(200);
});
```

> El tercer test es el que protege contra el bug que ya apareció una vez: la
> guardia debe comparar **valores**, no presencia de llave — el formulario manda
> siempre los seis campos fiscales, aunque no hayas tocado ninguno.

- [ ] **Step 2: Correr y verificar que el de admin falla**

Run: `pnpm --filter @hsa/api test -- quotes`

- [ ] **Step 3: Dejar pasar a admin**

En la guardia fiscal de `updateQuote`, antes de lanzar el 409:

```ts
  // Un admin sí puede corregir datos ya facturados (típicamente tras cancelar
  // el CFDI). Queda en la bitácora por el log 'fiscal' de más abajo.
  if (cambiaAlgoFiscal && !editable.editable && actor.role !== 'admin') {
    throw new QuoteError(409, editable.motivo ?? 'Los datos fiscales están bloqueados.');
  }
```

Y registrar el cambio siempre que haya cambio fiscal:

```ts
  if (cambiaAlgoFiscal) {
    await logActivity(db, {
      quoteId: id,
      tipo: 'fiscal',
      descripcion: `Datos fiscales actualizados${!editable.editable ? ' (desbloqueo de admin)' : ''}`,
      meta: { campos: camposFiscalesCambiados },
      actorId: actor.id,
    });
  }
```

- [ ] **Step 4: Correr**

Run: `pnpm --filter @hsa/api test -- quotes`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/quotes/
git commit -m "feat(api): solo admin cambia datos fiscales ya facturados"
```

### Task 8: Interfaz del candado y del sellado

**Files:**
- Modify: `apps/web/src/components/FacturacionSection.tsx`
- Modify: la lista de pagos del detalle de la cotización

- [ ] **Step 1: Motivo nuevo y excepción de admin**

En `FacturacionSection`, el bloqueo de solo lectura pasa a:

```tsx
const soloLectura = !editable.editable && !esAdmin;
```

Y el aviso, cuando está congelado pero eres admin:

```tsx
{!editable.editable && esAdmin && (
  <p className="aviso-admin">
    Ya se facturó con estos datos. Puedes cambiarlos porque eres administrador;
    quedará registrado en la bitácora.
  </p>
)}
```

- [ ] **Step 2: Botón de marcar facturado**

En cada renglón de pago no anulado y no facturado, visible solo para admin:

```tsx
{esAdmin && !pago.anuladoAt && !pago.facturadoAt && (
  <button type="button" onClick={() => setPagoAFacturar(pago)}>Marcar facturado</button>
)}
{pago.facturadoAt && <span className="sello-facturado" title={pago.facturaUuid ?? undefined}>Facturado</span>}
```

El modal pide el UUID (opcional) y hace `POST .../facturado`, invalidando la query de la cotización al terminar.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hsa/web typecheck`

- [ ] **Step 4: Verificar en el navegador**

Como admin: marcar un pago facturado → el sello aparece y la sección fiscal pasa a aviso de admin. Como vendedor: los campos quedan de solo lectura con el motivo.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): sellar pagos como facturados y candado fiscal por factura"
```

---

# D3 · Aviso cuando una fecha se aparta bajo otras cotizaciones

**Contexto.** Cotizar la misma fecha a varios prospectos es normal. Cuando uno aparta, los demás quedan **desplazados**: hay que moverlos de fecha o devolverles el dinero. Hoy nadie se entera.

**Derivado, sin tabla nueva.** El empalme se calcula al vuelo: no se puede quedar obsoleto, no necesita migración, y no debería poder "descartarse" — desaparece solo cuando el vendedor resuelve la cotización.

### Task 9: Consulta de cotizaciones desplazadas

**Files:**
- Create: `apps/api/src/quotes/empalmes.ts`
- Test: `apps/api/src/quotes/empalmes.test.ts`

- [ ] **Step 1: Tests**

```ts
describe('cotizacionesDesplazadas', () => {
  it('lista los borradores cuya fecha y espacio ya fueron apartados por otro', async () => {
    const bloqueante = await crearCotizacion({ fecha: '2027-03-20', spaceIds: ['cup'], status: 'formalizada' });
    const desplazada = await crearCotizacion({ fecha: '2027-03-20', spaceIds: ['cup'], status: 'borrador' });
    const r = await cotizacionesDesplazadas(db, adminActor);
    expect(r.map((x) => x.id)).toEqual([desplazada.id]);
    expect(r[0].bloqueadaPor.id).toBe(bloqueante.id);
  });

  it('no lista la que sí ganó la fecha', async () => {
    await crearCotizacion({ fecha: '2027-03-21', spaceIds: ['cup'], status: 'formalizada' });
    const r = await cotizacionesDesplazadas(db, adminActor);
    expect(r).toHaveLength(0);
  });

  it('otro espacio el mismo día no es empalme', async () => {
    await crearCotizacion({ fecha: '2027-03-22', spaceIds: ['cup'], status: 'formalizada' });
    await crearCotizacion({ fecha: '2027-03-22', spaceIds: ['arc'], status: 'borrador' });
    expect(await cotizacionesDesplazadas(db, adminActor)).toHaveLength(0);
  });

  it('un vendedor solo ve las suyas', async () => {
    await crearCotizacion({ fecha: '2027-03-23', spaceIds: ['cup'], status: 'formalizada', ownerId: 'otro' });
    await crearCotizacion({ fecha: '2027-03-23', spaceIds: ['cup'], status: 'borrador', ownerId: 'otro' });
    expect(await cotizacionesDesplazadas(db, vendedorActor)).toHaveLength(0);
  });

  it('las de la papelera no cuentan', async () => {
    await crearCotizacion({ fecha: '2027-03-24', spaceIds: ['cup'], status: 'formalizada' });
    await crearCotizacion({ fecha: '2027-03-24', spaceIds: ['cup'], status: 'borrador', trashedAt: new Date() });
    expect(await cotizacionesDesplazadas(db, adminActor)).toHaveLength(0);
  });

  it('las vencidas no cuentan', async () => {
    await crearCotizacion({ fecha: '2027-03-25', spaceIds: ['cup'], status: 'formalizada' });
    await crearCotizacion({ fecha: '2027-03-25', spaceIds: ['cup'], status: 'vencida' });
    expect(await cotizacionesDesplazadas(db, adminActor)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm --filter @hsa/api test -- empalmes`

- [ ] **Step 3: Implementar**

> **Símbolos verificados antes de escribir esto:** `ownershipWhere` y el tipo
> `Actor` se exportan desde `./service.js` (NO de `../auth/types.js`, que no
> existe). `logActivity` vive en `./activityLog.js`. Y **`folio` es de `Payment`,
> no de `Quote`** — una cotización solo tiene `id`, así que el aviso se identifica
> con el nombre del cliente y la fecha.

```ts
import type { PrismaClient } from '@hsa/database';
import { ownershipWhere, type Actor } from './service.js';

/** Estatus que ocupan la fecha de verdad. Debe seguir a `BLOQUEO` de availability. */
const BLOQUEANTES = ['formalizada', 'complementada', 'liquidada'] as const;
/** Estatus que todavía esperan respuesta y por lo tanto pueden quedar desplazados. */
const VIVAS = ['borrador', 'enviada', 'aceptada'] as const;

export interface Desplazada {
  id: string;
  clienteNombre: string;
  fechaEvento: Date;
  spaceIds: string[];
  bloqueadaPor: { id: string; clienteNombre: string };
}

/**
 * Cotizaciones vivas cuya fecha y espacio ya fueron apartados por otra.
 *
 * Derivado a propósito: no hay tabla de avisos que se pueda quedar obsoleta, y
 * el aviso desaparece solo cuando el vendedor mueve la fecha o cancela.
 * Un vendedor ve las suyas; un admin, todas.
 */
export async function cotizacionesDesplazadas(db: PrismaClient, actor: Actor): Promise<Desplazada[]> {
  const vivas = await db.quote.findMany({
    where: { status: { in: [...VIVAS] }, trashedAt: null, ...ownershipWhere(actor) },
    select: { id: true, fechaEvento: true, spaceIds: true, client: { select: { nombre: true } } },
  });
  if (vivas.length === 0) return [];

  const bloqueantes = await db.quote.findMany({
    where: {
      status: { in: [...BLOQUEANTES] },
      trashedAt: null,
      fechaEvento: { in: [...new Set(vivas.map((v) => v.fechaEvento.getTime()))].map((t) => new Date(t)) },
    },
    select: { id: true, fechaEvento: true, spaceIds: true, client: { select: { nombre: true } } },
  });
  if (bloqueantes.length === 0) return [];

  const out: Desplazada[] = [];
  for (const v of vivas) {
    const choque = bloqueantes.find(
      (b) =>
        b.id !== v.id &&
        b.fechaEvento.getTime() === v.fechaEvento.getTime() &&
        b.spaceIds.some((s) => v.spaceIds.includes(s)),
    );
    if (!choque) continue;
    out.push({
      id: v.id,
      clienteNombre: v.client.nombre,
      fechaEvento: v.fechaEvento,
      spaceIds: v.spaceIds,
      bloqueadaPor: { id: choque.id, clienteNombre: choque.client.nombre },
    });
  }
  return out;
}
```

- [ ] **Step 4: Correr**

Run: `pnpm --filter @hsa/api test -- empalmes`
Expected: PASS, 6 tests

- [ ] **Step 5: Exponer la ruta**

En `apps/api/src/quotes/routes.ts`:

```ts
app.get('/quotes/desplazadas', { preHandler: requireAuth }, async (req) => ({
  items: await cotizacionesDesplazadas(app.db, req.actor),
}));
```

> **Ojo con el orden de rutas en Fastify:** registrar esta ANTES de
> `/quotes/:id`, o `desplazadas` se interpretará como un id.

- [ ] **Step 6: Test de la ruta y commit**

```ts
it('GET /quotes/desplazadas responde la lista, no un 404 de :id', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/quotes/desplazadas', cookies: authCookie });
  expect(res.statusCode).toBe(200);
  expect(Array.isArray(res.json().items)).toBe(true);
});
```

```bash
git add apps/api/src/quotes/empalmes.ts apps/api/src/quotes/empalmes.test.ts apps/api/src/quotes/routes.ts
git commit -m "feat(api): detectar cotizaciones desplazadas por una fecha apartada"
```

### Task 10: Aviso en el panel del vendedor

**Files:**
- Create: `apps/web/src/components/AvisoEmpalmes.tsx`
- Modify: la página del panel/dashboard

- [ ] **Step 1: Componente**

```tsx
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { formatEventDate } from '../lib/date.ts';

interface Desplazada {
  id: string; clienteNombre: string; fechaEvento: string;
  bloqueadaPor: { id: string; clienteNombre: string };
}

export function AvisoEmpalmes() {
  const { data } = useQuery({
    queryKey: ['quotes', 'desplazadas'],
    queryFn: () => api.get<{ items: Desplazada[] }>('/quotes/desplazadas'),
  });
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section className="aviso-empalmes" aria-labelledby="empalmes-title">
      <h2 id="empalmes-title">
        {items.length === 1 ? 'Una cotización perdió su fecha' : `${items.length} cotizaciones perdieron su fecha`}
      </h2>
      <p>Hay que moverlas de fecha o avisarle al cliente. El espacio ya está apartado por otro evento.</p>
      <ul>
        {items.map((d) => (
          <li key={d.id}>
            <Link to={`/cotizaciones/${d.id}`}>{d.clienteNombre}</Link>
            {' — '}{formatEventDate(d.fechaEvento, 'long')}
            {' · apartada por '}{d.bloqueadaPor.clienteNombre}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Montarlo arriba del panel**

Insertar `<AvisoEmpalmes />` como primer bloque del dashboard, antes de las tarjetas de métricas: es lo primero que hay que resolver en el día.

- [ ] **Step 3: Typecheck y verificación**

Run: `pnpm --filter @hsa/web typecheck`
Crear dos cotizaciones en la misma fecha/espacio, formalizar una, recargar el panel y confirmar que aparece la otra.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/AvisoEmpalmes.tsx apps/web/src/pages/
git commit -m "feat(web): aviso de cotizaciones desplazadas en el panel"
```

### Task 11: Símbolo en la agenda y confirmación al formalizar

**Files:**
- Modify: `apps/web/src/pages/AgendaPage.tsx`
- Modify: el flujo de cambio de estatus a `formalizada`

- [ ] **Step 1: Marcar el chip**

Consumir la misma query `['quotes','desplazadas']` (ya cacheada por el panel), armar un `Set` de ids y en `ChipArrastrable`:

```tsx
{desplazada && <span className="chip-alerta" title="El espacio ya fue apartado por otro evento" aria-label="Fecha ya apartada">⚠</span>}
```

> No agregar el símbolo con `::before` de CSS: tiene que ser texto real para que
> un lector de pantalla lo anuncie.

- [ ] **Step 2: Confirmación al formalizar sobre un espacio ocupado**

Antes de mandar el cambio a `formalizada`, consultar la disponibilidad de la fecha/espacios. Si ya está bloqueada, mostrar un modal:

```
El {fecha} el {espacio} ya está apartado por {cliente}.
Formalizar de todos modos deja dos eventos comprometidos el mismo día.
[Cancelar]  [Formalizar de todos modos]
```

Si confirma, se manda igual — **el pago siempre se registra**. Confirmar que el cambio de estatus quede en la bitácora (ya lo hace `updateStatus`).

- [ ] **Step 3: Typecheck y verificación en navegador**

Run: `pnpm --filter @hsa/web typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): símbolo de empalme en la agenda y confirmación al formalizar"
```

---

# D4 · Dejar el deploy listo

**Contexto.** La app **sí está desplegada** en `hsa.somossinergia.com` / `hsaapi.somossinergia.com`, pero sirviendo un build anterior al Plan A (el bundle todavía dice "Apartada" y "Valet"). El `Dockerfile` de la API ya corre `migrate:deploy` y todos los backfills al arrancar, así que no hay pasos manuales de base de datos.

### Task 12: Corregir la documentación de despliegue

**Files:**
- Modify: `docs/EASYPANEL.md`

- [ ] **Step 1: Dominios reales**

Reemplazar `hsacotizador.somossinergia.com` → `hsa.somossinergia.com` y `hsapi.somossinergia.com` → `hsaapi.somossinergia.com` en todo el documento, incluidos los ejemplos de `curl`, `PUBLIC_WEB_URL` y `VITE_API_URL`.

- [ ] **Step 2: Advertencia del volumen**

Agregar en la sección de la API, como nota destacada:

```markdown
> **Volumen persistente obligatorio.** `COMPROBANTES_DIR` guarda las fotos de
> comprobante **y** las Constancias de Situación Fiscal. Sin un volumen montado,
> cada redeploy las borra. Montar el volumen en la ruta que apunte esa variable.
```

- [ ] **Step 3: Checklist de este despliegue**

```markdown
## Checklist para subir los planes A/B/C/D

1. Mergear `feat/planA-estatus-multisalon` a la rama que construye EasyPanel.
2. Reconstruir **las dos** imágenes. La de web es obligatoria: `VITE_API_URL`
   se hornea en build-time.
3. Verificar el volumen de `COMPROBANTES_DIR` antes del primer redeploy.
4. Opcional: `BI_API_KEY` (mínimo 32 caracteres). Sin ella, `/api/bi` responde
   404 a propósito.
5. Verificar:
   - `curl https://hsaapi.somossinergia.com/health` → `{"ok":true}`
   - El bundle ya no debe contener "Apartada" ni "Valet".
```

- [ ] **Step 4: Commit**

```bash
git add docs/EASYPANEL.md
git commit -m "docs: dominios reales, volumen persistente y checklist de despliegue"
```

### Task 13: Cierre

- [ ] **Step 1: Suite completa**

```bash
pnpm typecheck && pnpm test
```
Expected: typecheck 4/4 y toda la suite en verde. Anotar los totales.

- [ ] **Step 2: Verificación a mano de la aritmética del contrato**

Abrir un contrato de un salón y uno de dos. Para **cada renglón**, comprobar con calculadora que `pct × renta == monto`, y que el renglón de total es la suma exacta de los de arriba.

- [ ] **Step 3: Confirmar que el complemento no se movió**

Comparar el objetivo del complemento de una cotización existente contra el valor previo al Plan D. **Debe ser idéntico** — si cambió, el prorrateo está mal.

- [ ] **Step 4: Commit final y push**

```bash
git push origin feat/planA-estatus-multisalon
```

- [ ] **Step 5: Actualizar la memoria del proyecto**

Anotar en `hacienda-san-andres-project.md`: la app **sí está desplegada** (con sus dominios reales), que `rentaTotal` es el bloque de renta y no el total del evento, el prorrateo y su identidad, el disparador nuevo del candado, y que los empalmes son derivados a propósito.
