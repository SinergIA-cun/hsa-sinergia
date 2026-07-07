# Fase 1 — Fundación (monorepo + database + motor de precios) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar el monorepo de Hacienda San Andrés (HSA) en pie con el paquete `database` (Prisma + seed de precios 2027) y el paquete `shared` con el **motor de precios** como funciones puras, verificado con TDD contra los números reales de los folletos.

**Architecture:** Monorepo pnpm + Turbo, espejo de Motipreca. `packages/shared` contiene tipos, esquemas zod y el motor de precios (sin DB ni HTTP). `packages/database` contiene el esquema Prisma (catálogo + operación) y un seed con los precios 2027. El motor es la única fuente de cálculo; se testea de forma aislada.

**Tech Stack:** pnpm 9+, Turbo 2, TypeScript 5.5, Prisma 6 + Postgres, Vitest (unit tests), zod 3.

**Referencia:** el repo `../motiprecaPOS` es la app hermana. Copiar sus convenciones de config (`tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `turbo.json`, `pnpm-workspace.yaml`) salvo los nombres (`@motipreca/*` → `@hsa/*`).

**Prerrequisito:** Postgres local disponible (o Docker). Node ≥ 22, pnpm ≥ 9.

---

## Datos de referencia (de los folletos — usar en seed y tests)

**Renta 2027 (con IVA), 6 horas.** Columnas: Viernes / ViernesEspecial\* / Sábado / Dom–Jue.
\*ViernesEspecial = viernes de marzo–mayo y septiembre–octubre.

Salón Los Arcos **o** Jardín Los Campos:
| Capacidad | Viernes | Vie.Especial | Sábado | Dom–Jue |
|---|---|---|---|---|
| Hasta 50 | 34,500 | 17,250 | 42,000 | 30,000 |
| 51–100 | 70,000 | 35,000 | 76,000 | 58,500 |
| 101–200 | 86,000 | 43,000 | 93,500 | 74,000 |
| 201–300 | 100,000 | 50,000 | 108,500 | 90,500 |
| 301–400 | 116,500 | 58,250 | 123,000 | 105,500 |

Jardín La Cúpula:
| Capacidad | Viernes | Vie.Especial | Sábado | Dom–Jue |
|---|---|---|---|---|
| 50–300 | 157,000 | 78,500 | 174,000 | 139,000 |
| 301–500 | 170,000 | 85,000 | 194,000 | 150,000 |
| 501–650 | 197,500 | 98,750 | 218,500 | 170,000 |
| 651–800 | 210,500 | 105,250 | 233,500 | 183,000 |

La Capilla: Sábado 5,000; Viernes/Vie.Especial/Dom–Jue = cortesía (0).

**Alimentos (precio por persona, SIN IVA en tabla).**
Boda — SUPREME / SUPREME plus:
| Capacidad | SUPREME | SUPREMEplus |
|---|---|---|
| Hasta 50 | 1,459 | 1,729 |
| 51–100 | 1,019 | 1,199 |
| 101–150 | 999 | 1,179 |
| 151–200 | 849 | 969 |
| 201–300 | 799 | 899 |
| 301+ | 679 | 789 |

Empresarial — 3 Tiempos / 4 Tiempos / Buffet Mexicano / Casino / Kermesse / Fiesta Vaquera / Parrillada (usar 3 Tiempos y Buffet Mexicano en tests):
| Capacidad | 3 Tiempos | Buffet Mexicano |
|---|---|---|
| Hasta 50 | 680 | 670 |
| 51–100 | 660 | 630 |
| 101–200 | 630 | 580 |
| 201–300 | 620 | 565 |
| 301–400 | 610 | 555 |

Bautizo — 3 Tiempos / Taquiza:
| Capacidad | 3 Tiempos | Taquiza |
|---|---|---|
| 50–99 | 1,230 | 1,210 |
| 100–150 | 945 | 935 |
| 151–200 | 930 | 920 |
| 201–300 | 920 | 910 |

**Reglas:** hora extra = 5% de renta por hora; descuento = 5% de renta si hay paquete de alimentos; IVA = 16%. Add-ons ejemplo: Valet 100 (porUnidad/auto), DJ 2,950 (fijo, Boda) / 2,750 (Bautizo).

---

## Estructura de archivos (Fase 1)

```
hacienda-san-andres/
├── package.json                 # Crear: root, scripts turbo
├── pnpm-workspace.yaml          # Crear
├── turbo.json                   # Crear
├── tsconfig.base.json           # Crear
├── eslint.config.js             # Crear
├── .prettierrc.json             # Crear
├── .nvmrc / .npmrc              # Crear
├── .env.example                 # Crear
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts         # tipos del catálogo y del cálculo
│   │       ├── schemas.ts       # zod schemas de entrada
│   │       └── pricing/
│   │           ├── brackets.ts  # capacityBracket()
│   │           ├── day-type.ts  # dayType(fecha)
│   │           ├── engine.ts    # computeQuote()
│   │           ├── brackets.test.ts
│   │           ├── day-type.test.ts
│   │           └── engine.test.ts
│   └── database/
│       ├── package.json
│       ├── tsconfig.json
│       ├── prisma/
│       │   ├── schema.prisma
│       │   └── seed.ts
│       └── src/index.ts
```

---

### Task 0: Scaffold del monorepo

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.nvmrc`, `.npmrc`, `.env.example`

- [ ] **Step 1: Copiar configs base de Motipreca**

Copiar de `../motiprecaPOS` y renombrar el paquete raíz. Ejecutar desde `hacienda-san-andres/`:

```bash
cp ../motiprecaPOS/pnpm-workspace.yaml .
cp ../motiprecaPOS/turbo.json .
cp ../motiprecaPOS/tsconfig.base.json .
cp ../motiprecaPOS/eslint.config.js .
cp ../motiprecaPOS/.prettierrc.json .
cp ../motiprecaPOS/.nvmrc . 2>/dev/null; cp ../motiprecaPOS/.npmrc . 2>/dev/null
```

- [ ] **Step 2: Crear `package.json` raíz**

```json
{
  "name": "hacienda-san-andres",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Cotizador y apartado de Hacienda San Andrés (SinergIA)",
  "packageManager": "pnpm@11.6.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "lint": "eslint .",
    "format": "prettier --write .",
    "db:generate": "pnpm --filter @hsa/database run generate",
    "db:migrate": "pnpm --filter @hsa/database run migrate",
    "db:seed": "pnpm --filter @hsa/database run seed",
    "db:studio": "pnpm --filter @hsa/database run studio"
  },
  "devDependencies": {
    "@eslint/js": "^9.0.0",
    "dotenv-cli": "^7.4.0",
    "eslint": "^9.0.0",
    "globals": "^15.0.0",
    "prettier": "^3.3.0",
    "turbo": "^2.0.0",
    "typescript": "^5.5.0",
    "typescript-eslint": "^8.0.0"
  }
}
```

- [ ] **Step 3: Crear `.env.example`**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/hsa?schema=public"
```

- [ ] **Step 4: Verificar workspace**

Run: `pnpm install`
Expected: instala sin errores; crea `pnpm-lock.yaml`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold del monorepo HSA (espejo de Motipreca)"
```

---

### Task 1: `packages/shared` — tipos y esquemas del catálogo/cálculo

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`, `packages/shared/src/index.ts`, `packages/shared/src/types.ts`, `packages/shared/src/schemas.ts`

- [ ] **Step 1: Crear `packages/shared/package.json`**

```json
{
  "name": "@hsa/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^3.23.0" },
  "devDependencies": { "typescript": "^5.5.0", "vitest": "^2.0.0" }
}
```

- [ ] **Step 2: Crear `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Crear `packages/shared/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
```

- [ ] **Step 4: Crear `packages/shared/src/types.ts`**

```ts
export type DayType = 'viernes' | 'viernesEspecial' | 'sabado' | 'domAJue';

/** Rango de capacidad: [min, max] inclusivo. max = null => sin tope. */
export interface CapacityBracket {
  min: number;
  max: number | null;
}

export interface RentalPriceRow extends CapacityBracket {
  spaceId: string;
  prices: Record<DayType, number>; // con IVA, en pesos
}

export interface FoodPackageRow extends CapacityBracket {
  packageId: string;
  pricePerPerson: number; // sin IVA
}

export interface FoodPackage {
  id: string;
  eventTypeId: string;
  name: string;
  ivaIncluded: boolean; // en la tabla; si false, se agrega IVA
  brackets: FoodPackageRow[];
}

export type AddOnKind = 'fijo' | 'porPersona' | 'porUnidad';

export interface AddOn {
  id: string;
  name: string;
  kind: AddOnKind;
  price: number; // sin IVA
}

export interface Catalog {
  ivaRate: number;              // 0.16
  extraHourRate: number;        // 0.05 de la renta por hora
  foodDiscountRate: number;     // 0.05 de la renta si hay alimentos
  rentalPrices: RentalPriceRow[];
  foodPackages: FoodPackage[];
  addOns: AddOn[];
}

export interface QuoteSelection {
  fecha: string;                // ISO 'YYYY-MM-DD'
  invitados: number;
  spaceIds: string[];
  horasExtra: number;
  foodPackageId?: string;
  addOns: { addOnId: string; cantidad: number }[];
}

export interface QuoteLine {
  concepto: string;
  detalle?: string;
  monto: number;                // sin IVA salvo renta (que ya trae IVA)
  ivaIncluido: boolean;
}

export interface QuoteBreakdown {
  lines: QuoteLine[];
  subtotal: number;             // suma de montos sin IVA (bases)
  iva: number;
  total: number;
  rentaTotal: number;           // renta con IVA (para el plan de pagos)
}
```

- [ ] **Step 5: Crear `packages/shared/src/schemas.ts`**

```ts
import { z } from 'zod';

export const quoteSelectionSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  invitados: z.number().int().positive(),
  spaceIds: z.array(z.string()).min(1),
  horasExtra: z.number().int().min(0).default(0),
  foodPackageId: z.string().optional(),
  addOns: z
    .array(z.object({ addOnId: z.string(), cantidad: z.number().int().positive() }))
    .default([]),
});
```

- [ ] **Step 6: Crear `packages/shared/src/index.ts`**

```ts
export * from './types.js';
export * from './schemas.js';
export * from './pricing/brackets.js';
export * from './pricing/day-type.js';
export * from './pricing/engine.js';
```

- [ ] **Step 7: Instalar y typecheck**

Run: `pnpm install && pnpm --filter @hsa/shared run typecheck`
Expected: falla en imports de `./pricing/*` (aún no existen) — se resuelve en Tasks 2–4. Continuar.

- [ ] **Step 8: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): tipos y esquemas del catálogo y cálculo"
```

---

### Task 2: Motor — `capacityBracket()` y `dayType()`

**Files:**
- Create: `packages/shared/src/pricing/brackets.ts`, `brackets.test.ts`, `day-type.ts`, `day-type.test.ts`

- [ ] **Step 1: Test de `capacityBracket` (falla)**

`packages/shared/src/pricing/brackets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findBracket } from './brackets.js';
import type { CapacityBracket } from '../types.js';

const rows: (CapacityBracket & { v: number })[] = [
  { min: 1, max: 50, v: 42000 },
  { min: 51, max: 100, v: 76000 },
  { min: 201, max: 300, v: 108500 },
];

describe('findBracket', () => {
  it('encuentra el rango que contiene el número de invitados', () => {
    expect(findBracket(rows, 30)?.v).toBe(42000);
    expect(findBracket(rows, 100)?.v).toBe(76000);
    expect(findBracket(rows, 250)?.v).toBe(108500);
  });
  it('devuelve undefined si ningún rango aplica', () => {
    expect(findBracket(rows, 500)).toBeUndefined();
  });
  it('respeta max=null como sin tope', () => {
    expect(findBracket([{ min: 301, max: null, v: 679 }], 800)?.v).toBe(679);
  });
});
```

- [ ] **Step 2: Correr — debe fallar**

Run: `pnpm --filter @hsa/shared exec vitest run src/pricing/brackets.test.ts`
Expected: FAIL ("findBracket is not defined" / módulo no encontrado).

- [ ] **Step 3: Implementar `brackets.ts`**

```ts
import type { CapacityBracket } from '../types.js';

export function findBracket<T extends CapacityBracket>(
  rows: T[],
  invitados: number,
): T | undefined {
  return rows.find(
    (r) => invitados >= r.min && (r.max === null || invitados <= r.max),
  );
}
```

- [ ] **Step 4: Correr — debe pasar**

Run: `pnpm --filter @hsa/shared exec vitest run src/pricing/brackets.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Test de `dayType` (falla)**

`packages/shared/src/pricing/day-type.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dayType } from './day-type.js';

describe('dayType', () => {
  it('sábado => sabado', () => {
    expect(dayType('2027-05-08')).toBe('sabado'); // sábado
  });
  it('domingo a jueves => domAJue', () => {
    expect(dayType('2027-05-09')).toBe('domAJue'); // domingo
    expect(dayType('2027-05-13')).toBe('domAJue'); // jueves
  });
  it('viernes normal => viernes', () => {
    expect(dayType('2027-01-08')).toBe('viernes'); // viernes enero
  });
  it('viernes de temporada especial (mar-may, sep-oct) => viernesEspecial', () => {
    expect(dayType('2027-05-07')).toBe('viernesEspecial'); // viernes mayo
    expect(dayType('2027-09-03')).toBe('viernesEspecial'); // viernes septiembre
  });
});
```

- [ ] **Step 6: Correr — debe fallar**

Run: `pnpm --filter @hsa/shared exec vitest run src/pricing/day-type.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implementar `day-type.ts`**

```ts
import type { DayType } from '../types.js';

const MESES_ESPECIALES = new Set([3, 4, 5, 9, 10]); // marzo-mayo, sep-oct

export function dayType(fechaISO: string): DayType {
  // Interpretar como fecha local sin desfase de zona.
  const [y, m, d] = fechaISO.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dow = date.getDay(); // 0=dom ... 6=sab
  if (dow === 6) return 'sabado';
  if (dow !== 5) return 'domAJue'; // dom-jue
  return MESES_ESPECIALES.has(m) ? 'viernesEspecial' : 'viernes';
}
```

- [ ] **Step 8: Correr — debe pasar**

Run: `pnpm --filter @hsa/shared exec vitest run src/pricing/day-type.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/pricing
git commit -m "feat(shared): findBracket y dayType con tests"
```

---

### Task 3: Motor — `computeQuote()`

**Files:**
- Create: `packages/shared/src/pricing/engine.ts`, `engine.test.ts`

- [ ] **Step 1: Test del motor con casos reales de folletos (falla)**

`packages/shared/src/pricing/engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeQuote } from './engine.js';
import type { Catalog } from '../types.js';

const catalog: Catalog = {
  ivaRate: 0.16,
  extraHourRate: 0.05,
  foodDiscountRate: 0.05,
  rentalPrices: [
    // Los Arcos (id 'arcos')
    { spaceId: 'arcos', min: 1, max: 50, prices: { viernes: 34500, viernesEspecial: 17250, sabado: 42000, domAJue: 30000 } },
    { spaceId: 'arcos', min: 201, max: 300, prices: { viernes: 100000, viernesEspecial: 50000, sabado: 108500, domAJue: 90500 } },
    // La Cúpula (id 'cupula')
    { spaceId: 'cupula', min: 50, max: 300, prices: { viernes: 157000, viernesEspecial: 78500, sabado: 174000, domAJue: 139000 } },
    // Capilla (id 'capilla')
    { spaceId: 'capilla', min: 1, max: 170, prices: { viernes: 0, viernesEspecial: 0, sabado: 5000, domAJue: 0 } },
  ],
  foodPackages: [
    {
      id: 'boda-supreme', eventTypeId: 'boda', name: 'SUPREME', ivaIncluded: false,
      brackets: [
        { packageId: 'boda-supreme', min: 201, max: 300, pricePerPerson: 799 },
      ],
    },
  ],
  addOns: [
    { id: 'valet', name: 'Valet parking', kind: 'porUnidad', price: 100 },
    { id: 'dj', name: 'DJ', kind: 'fijo', price: 2950 },
  ],
};

describe('computeQuote', () => {
  it('renta simple sábado (Los Arcos, 250 pax) = 108,500 con IVA', () => {
    const r = computeQuote(catalog, {
      fecha: '2027-05-08', invitados: 250, spaceIds: ['arcos'],
      horasExtra: 0, addOns: [],
    });
    expect(r.rentaTotal).toBe(108500);
    expect(r.total).toBe(108500); // renta ya trae IVA, sin más conceptos
  });

  it('renta + alimentos aplica 5% de descuento en renta y agrega IVA a alimentos', () => {
    const r = computeQuote(catalog, {
      fecha: '2027-05-08', invitados: 250, spaceIds: ['arcos'],
      horasExtra: 0, foodPackageId: 'boda-supreme', addOns: [],
    });
    // Renta 108500; descuento 5% = 5425 => renta neta 103075 (con IVA)
    // Alimentos 799*250 = 199750 sin IVA; IVA 16% = 31960 => 231710
    // total = 103075 + 231710 = 334785
    const alimentosBase = 799 * 250;
    const descuento = 108500 * 0.05;
    const rentaNeta = 108500 - descuento;
    const alimentosConIva = alimentosBase * 1.16;
    expect(r.total).toBeCloseTo(rentaNeta + alimentosConIva, 2);
  });

  it('hora extra = 5% de la renta por hora', () => {
    const r = computeQuote(catalog, {
      fecha: '2027-05-08', invitados: 250, spaceIds: ['arcos'],
      horasExtra: 2, addOns: [],
    });
    expect(r.total).toBeCloseTo(108500 + 2 * 0.05 * 108500, 2);
  });

  it('add-ons: valet porUnidad e IVA; DJ fijo con IVA', () => {
    const r = computeQuote(catalog, {
      fecha: '2027-05-08', invitados: 250, spaceIds: ['arcos'],
      horasExtra: 0, addOns: [{ addOnId: 'valet', cantidad: 50 }, { addOnId: 'dj', cantidad: 1 }],
    });
    const addonBase = 100 * 50 + 2950;
    expect(r.total).toBeCloseTo(108500 + addonBase * 1.16, 2);
  });

  it('capilla en sábado cuesta 5,000; suma de espacios', () => {
    const r = computeQuote(catalog, {
      fecha: '2027-05-08', invitados: 250, spaceIds: ['arcos', 'capilla'],
      horasExtra: 0, addOns: [],
    });
    expect(r.rentaTotal).toBe(108500 + 5000);
  });

  it('lanza error si el espacio no tiene rango para los invitados', () => {
    expect(() =>
      computeQuote(catalog, { fecha: '2027-05-08', invitados: 700, spaceIds: ['arcos'], horasExtra: 0, addOns: [] }),
    ).toThrow(/rango/i);
  });
});
```

- [ ] **Step 2: Correr — debe fallar**

Run: `pnpm --filter @hsa/shared exec vitest run src/pricing/engine.test.ts`
Expected: FAIL (computeQuote no existe).

- [ ] **Step 3: Implementar `engine.ts`**

```ts
import type {
  Catalog, QuoteSelection, QuoteBreakdown, QuoteLine,
} from '../types.js';
import { findBracket } from './brackets.js';
import { dayType } from './day-type.js';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeQuote(
  catalog: Catalog,
  sel: QuoteSelection,
): QuoteBreakdown {
  const dt = dayType(sel.fecha);
  const lines: QuoteLine[] = [];

  // 1. Renta (con IVA) — suma de espacios
  let rentaTotal = 0;
  for (const spaceId of sel.spaceIds) {
    const rows = catalog.rentalPrices.filter((r) => r.spaceId === spaceId);
    const row = findBracket(rows, sel.invitados);
    if (!row) {
      throw new Error(
        `El espacio ${spaceId} no tiene rango de renta para ${sel.invitados} invitados`,
      );
    }
    const monto = row.prices[dt];
    rentaTotal += monto;
    lines.push({ concepto: `Renta ${spaceId}`, monto, ivaIncluido: true });
  }

  // 2. Horas extra (5% de renta por hora, con IVA porque es sobre la renta)
  if (sel.horasExtra > 0) {
    const monto = rentaTotal * catalog.extraHourRate * sel.horasExtra;
    rentaTotal += monto;
    lines.push({
      concepto: 'Horas extra',
      detalle: `${sel.horasExtra} × 5% renta`,
      monto,
      ivaIncluido: true,
    });
  }

  // 3. Alimentos (sin IVA en tabla => se agrega después) + descuento 5% renta
  let alimentosBase = 0;
  if (sel.foodPackageId) {
    const pkg = catalog.foodPackages.find((p) => p.id === sel.foodPackageId);
    if (!pkg) throw new Error(`Paquete de alimentos ${sel.foodPackageId} no existe`);
    const row = findBracket(pkg.brackets, sel.invitados);
    if (!row) {
      throw new Error(
        `El paquete ${pkg.name} no tiene rango para ${sel.invitados} invitados`,
      );
    }
    alimentosBase = row.pricePerPerson * sel.invitados;
    lines.push({
      concepto: `Alimentos ${pkg.name}`,
      detalle: `${sel.invitados} × ${row.pricePerPerson}`,
      monto: alimentosBase,
      ivaIncluido: pkg.ivaIncluded,
    });

    const descuento = rentaTotal * catalog.foodDiscountRate;
    rentaTotal -= descuento;
    lines.push({
      concepto: 'Descuento por alimentos (5% renta)',
      monto: -descuento,
      ivaIncluido: true,
    });
  }

  // 4. Add-ons (sin IVA => se agrega)
  let addonsBase = 0;
  for (const a of sel.addOns) {
    const addon = catalog.addOns.find((x) => x.id === a.addOnId);
    if (!addon) throw new Error(`Add-on ${a.addOnId} no existe`);
    let monto: number;
    if (addon.kind === 'fijo') monto = addon.price;
    else if (addon.kind === 'porPersona') monto = addon.price * sel.invitados;
    else monto = addon.price * a.cantidad; // porUnidad
    addonsBase += monto;
    lines.push({
      concepto: addon.name,
      detalle: addon.kind === 'fijo' ? undefined : `× ${addon.kind === 'porPersona' ? sel.invitados : a.cantidad}`,
      monto,
      ivaIncluido: false,
    });
  }

  // 5. Totales.
  // rentaTotal ya incluye IVA. Las bases sin IVA (alimentos, add-ons) reciben IVA.
  const baseSinIva = alimentosBase + addonsBase;
  const ivaSobreBases = baseSinIva * catalog.ivaRate;
  const total = round2(rentaTotal + baseSinIva + ivaSobreBases);

  return {
    lines,
    subtotal: round2(rentaTotal + baseSinIva),
    iva: round2(ivaSobreBases),
    total,
    rentaTotal: round2(rentaTotal),
  };
}
```

- [ ] **Step 4: Correr — debe pasar**

Run: `pnpm --filter @hsa/shared exec vitest run src/pricing/engine.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck del paquete completo**

Run: `pnpm --filter @hsa/shared run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/pricing/engine.ts packages/shared/src/pricing/engine.test.ts
git commit -m "feat(shared): motor computeQuote con TDD sobre precios de folletos"
```

---

### Task 4: `packages/database` — esquema Prisma

**Files:**
- Create: `packages/database/package.json`, `packages/database/tsconfig.json`, `packages/database/prisma/schema.prisma`, `packages/database/src/index.ts`

- [ ] **Step 1: Crear `packages/database/package.json`**

```json
{
  "name": "@hsa/database",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "prisma": { "seed": "tsx prisma/seed.ts" },
  "scripts": {
    "generate": "prisma generate",
    "migrate": "dotenv -e ../../.env -- prisma migrate dev",
    "migrate:deploy": "prisma migrate deploy",
    "seed": "dotenv -e ../../.env -- prisma db seed",
    "studio": "dotenv -e ../../.env -- prisma studio",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "@prisma/client": "^6.0.0" },
  "devDependencies": {
    "dotenv-cli": "^7.4.0",
    "prisma": "^6.0.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Crear `packages/database/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Crear `packages/database/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum DayType {
  viernes
  viernesEspecial
  sabado
  domAJue
}

enum AddOnKind {
  fijo
  porPersona
  porUnidad
}

enum UserRole {
  vendedora
  admin
}

enum QuoteStatus {
  borrador
  enviada
  aceptada
  apartada
  liquidada
  vencida
}

enum PaymentMethod {
  efectivo
  transferencia
  tarjeta
}

enum PaymentConcept {
  anticipo
  aCuenta
  finiquito
}

model PriceList {
  id        String   @id @default(cuid())
  anio      Int
  vigencia  DateTime?
  activa    Boolean  @default(true)
  createdAt DateTime @default(now())
  rentalPrices RentalPrice[]
}

model Space {
  id           String        @id @default(cuid())
  nombre       String
  capacidadMax Int?
  activo       Boolean       @default(true)
  rentalPrices RentalPrice[]
}

model RentalPrice {
  id          String    @id @default(cuid())
  priceList   PriceList @relation(fields: [priceListId], references: [id])
  priceListId String
  space       Space     @relation(fields: [spaceId], references: [id])
  spaceId     String
  min         Int
  max         Int?
  viernes         Int
  viernesEspecial Int
  sabado          Int
  domAJue         Int
  @@index([priceListId, spaceId])
}

model EventType {
  id           String        @id @default(cuid())
  nombre       String
  slug         String        @unique
  foodPackages FoodPackage[]
  paymentRule  PaymentRule?
}

model FoodPackage {
  id          String            @id @default(cuid())
  eventType   EventType         @relation(fields: [eventTypeId], references: [id])
  eventTypeId String
  nombre      String
  ivaIncluido Boolean           @default(false)
  incluye     String?           // texto para el folleto/PDF
  brackets    FoodPackagePrice[]
}

model FoodPackagePrice {
  id             String      @id @default(cuid())
  package        FoodPackage @relation(fields: [packageId], references: [id])
  packageId      String
  min            Int
  max            Int?
  pricePerPerson Int
}

model AddOn {
  id     String    @id @default(cuid())
  nombre String
  kind   AddOnKind
  price  Int
  activo Boolean   @default(true)
}

model PricingConfig {
  id               String @id @default("default")
  ivaRate          Float  @default(0.16)
  extraHourRate    Float  @default(0.05)
  foodDiscountRate Float  @default(0.05)
}

model PaymentRule {
  id            String    @id @default(cuid())
  eventType     EventType @relation(fields: [eventTypeId], references: [id])
  eventTypeId   String    @unique
  apartarMonto  Int       @default(5000)
  formalizarPct Float     @default(0.30) // sobre la renta
  liquidarDias  Int       @default(30)   // días antes del evento
}

model User {
  id        String   @id @default(cuid())
  nombre    String
  email     String   @unique
  passwordHash String
  role      UserRole @default(vendedora)
  activo    Boolean  @default(true)
  createdAt DateTime @default(now())
}
```

> Nota: los modelos de operación (Client, Quote, PaymentOrder, PaymentPlan, Payment, Contract) se agregan en la Fase 2 junto con la API. La Fase 1 solo necesita catálogo + User para tener la base migrando y seedeable.

- [ ] **Step 4: Crear `packages/database/src/index.ts`**

```ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
export * from '@prisma/client';
```

- [ ] **Step 5: Instalar, generar cliente y crear migración**

Run:
```bash
pnpm install
cp .env.example .env   # ajustar DATABASE_URL si hace falta
pnpm --filter @hsa/database run generate
pnpm --filter @hsa/database run migrate -- --name init
```
Expected: crea `prisma/migrations/*_init/` y aplica el esquema en Postgres sin errores.

- [ ] **Step 6: Commit**

```bash
git add packages/database
git commit -m "feat(database): esquema Prisma del catálogo + User + migración init"
```

---

### Task 5: Seed del catálogo 2027

**Files:**
- Create: `packages/database/prisma/seed.ts`

- [ ] **Step 1: Escribir `seed.ts` con precios reales**

`packages/database/prisma/seed.ts`:

```ts
import { PrismaClient, AddOnKind } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Config global
  await prisma.pricingConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', ivaRate: 0.16, extraHourRate: 0.05, foodDiscountRate: 0.05 },
  });

  // Lista de precios 2027
  const priceList = await prisma.priceList.create({
    data: { anio: 2027, activa: true },
  });

  // Espacios
  const arcos = await prisma.space.create({ data: { nombre: 'Salón Los Arcos', capacidadMax: 400 } });
  const campos = await prisma.space.create({ data: { nombre: 'Jardín Los Campos', capacidadMax: 400 } });
  const cupula = await prisma.space.create({ data: { nombre: 'Jardín La Cúpula', capacidadMax: 800 } });
  const capilla = await prisma.space.create({ data: { nombre: 'La Capilla', capacidadMax: 170 } });

  // Renta Los Arcos / Los Campos (misma tabla)
  const arcosCampos = [
    { min: 1, max: 50, viernes: 34500, viernesEspecial: 17250, sabado: 42000, domAJue: 30000 },
    { min: 51, max: 100, viernes: 70000, viernesEspecial: 35000, sabado: 76000, domAJue: 58500 },
    { min: 101, max: 200, viernes: 86000, viernesEspecial: 43000, sabado: 93500, domAJue: 74000 },
    { min: 201, max: 300, viernes: 100000, viernesEspecial: 50000, sabado: 108500, domAJue: 90500 },
    { min: 301, max: 400, viernes: 116500, viernesEspecial: 58250, sabado: 123000, domAJue: 105500 },
  ];
  for (const spaceId of [arcos.id, campos.id]) {
    await prisma.rentalPrice.createMany({
      data: arcosCampos.map((r) => ({ ...r, priceListId: priceList.id, spaceId })),
    });
  }

  // Renta La Cúpula
  await prisma.rentalPrice.createMany({
    data: [
      { min: 50, max: 300, viernes: 157000, viernesEspecial: 78500, sabado: 174000, domAJue: 139000 },
      { min: 301, max: 500, viernes: 170000, viernesEspecial: 85000, sabado: 194000, domAJue: 150000 },
      { min: 501, max: 650, viernes: 197500, viernesEspecial: 98750, sabado: 218500, domAJue: 170000 },
      { min: 651, max: 800, viernes: 210500, viernesEspecial: 105250, sabado: 233500, domAJue: 183000 },
    ].map((r) => ({ ...r, priceListId: priceList.id, spaceId: cupula.id })),
  });

  // Renta Capilla
  await prisma.rentalPrice.create({
    data: { priceListId: priceList.id, spaceId: capilla.id, min: 1, max: 170, viernes: 0, viernesEspecial: 0, sabado: 5000, domAJue: 0 },
  });

  // Tipos de evento + paquetes de alimentos
  const boda = await prisma.eventType.create({ data: { nombre: 'Boda', slug: 'boda' } });
  const empresarial = await prisma.eventType.create({ data: { nombre: 'Empresarial', slug: 'empresarial' } });
  const bautizo = await prisma.eventType.create({ data: { nombre: 'Bautizo', slug: 'bautizo' } });

  // Regla de pago por evento (default 5000/30%/30 días)
  for (const et of [boda, empresarial, bautizo]) {
    await prisma.paymentRule.create({ data: { eventTypeId: et.id } });
  }

  // Boda: SUPREME / SUPREME plus
  const supreme = await prisma.foodPackage.create({ data: { eventTypeId: boda.id, nombre: 'SUPREME', ivaIncluido: false } });
  const supremePlus = await prisma.foodPackage.create({ data: { eventTypeId: boda.id, nombre: 'SUPREME plus', ivaIncluido: false } });
  await prisma.foodPackagePrice.createMany({
    data: [
      { packageId: supreme.id, min: 1, max: 50, pricePerPerson: 1459 },
      { packageId: supreme.id, min: 51, max: 100, pricePerPerson: 1019 },
      { packageId: supreme.id, min: 101, max: 150, pricePerPerson: 999 },
      { packageId: supreme.id, min: 151, max: 200, pricePerPerson: 849 },
      { packageId: supreme.id, min: 201, max: 300, pricePerPerson: 799 },
      { packageId: supreme.id, min: 301, max: null, pricePerPerson: 679 },
      { packageId: supremePlus.id, min: 1, max: 50, pricePerPerson: 1729 },
      { packageId: supremePlus.id, min: 51, max: 100, pricePerPerson: 1199 },
      { packageId: supremePlus.id, min: 101, max: 150, pricePerPerson: 1179 },
      { packageId: supremePlus.id, min: 151, max: 200, pricePerPerson: 969 },
      { packageId: supremePlus.id, min: 201, max: 300, pricePerPerson: 899 },
      { packageId: supremePlus.id, min: 301, max: null, pricePerPerson: 789 },
    ],
  });

  // Bautizo: 3 Tiempos / Taquiza
  const bautizo3t = await prisma.foodPackage.create({ data: { eventTypeId: bautizo.id, nombre: '3 Tiempos', ivaIncluido: false } });
  const taquiza = await prisma.foodPackage.create({ data: { eventTypeId: bautizo.id, nombre: 'Taquiza', ivaIncluido: false } });
  await prisma.foodPackagePrice.createMany({
    data: [
      { packageId: bautizo3t.id, min: 50, max: 99, pricePerPerson: 1230 },
      { packageId: bautizo3t.id, min: 100, max: 150, pricePerPerson: 945 },
      { packageId: bautizo3t.id, min: 151, max: 200, pricePerPerson: 930 },
      { packageId: bautizo3t.id, min: 201, max: 300, pricePerPerson: 920 },
      { packageId: taquiza.id, min: 50, max: 99, pricePerPerson: 1210 },
      { packageId: taquiza.id, min: 100, max: 150, pricePerPerson: 935 },
      { packageId: taquiza.id, min: 151, max: 200, pricePerPerson: 920 },
      { packageId: taquiza.id, min: 201, max: 300, pricePerPerson: 910 },
    ],
  });

  // Add-ons de ejemplo
  await prisma.addOn.createMany({
    data: [
      { nombre: 'Valet parking', kind: AddOnKind.porUnidad, price: 100 },
      { nombre: 'DJ', kind: AddOnKind.fijo, price: 2950 },
      { nombre: 'Mesa de dulces (por persona)', kind: AddOnKind.porPersona, price: 110 },
    ],
  });

  console.log('Seed HSA 2027 completado.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Correr el seed**

Run: `pnpm --filter @hsa/database run seed`
Expected: imprime "Seed HSA 2027 completado." sin errores.

- [ ] **Step 3: Verificar en Studio (manual, opcional)**

Run: `pnpm --filter @hsa/database run studio`
Expected: `RentalPrice` tiene 5+5+4+1 = 15 filas; `FoodPackagePrice` 12+8 = 20 filas; `AddOn` 3.

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/seed.ts
git commit -m "feat(database): seed del catálogo HSA 2027 (renta, alimentos, add-ons)"
```

---

### Task 6: Verificación de la fase completa

- [ ] **Step 1: Correr toda la batería**

Run: `pnpm test`
Expected: `@hsa/shared` PASS (todos los tests del motor).

- [ ] **Step 2: Typecheck global**

Run: `pnpm typecheck`
Expected: PASS en `shared` y `database`.

- [ ] **Step 3: Commit final de fase (si hay pendientes)**

```bash
git add -A
git commit -m "chore: Fase 1 (fundación) completa — monorepo, database+seed, motor de precios"
```

---

## Self-review (cobertura del spec)

- **Motor de precios (spec §5):** Tasks 2–3 — renta por espacio/rango/día/temporada, horas extra 5%, alimentos por persona, descuento 5%, add-ons, IVA. ✅
- **Catálogo versionado por año (spec §4):** Task 4 (`PriceList`) + Task 5 (seed 2027). ✅
- **Reglas de plan de pagos por evento (spec §4):** Task 4 (`PaymentRule`, default 5000/30%/30 días) + seed. La *generación* del plan se implementa en Fase 5; aquí solo se persisten las reglas. ✅
- **Espacios, tipos de evento, paquetes, add-ons (spec §4):** Tasks 4–5. ✅
- **Modelos de operación (Client/Quote/PaymentOrder/Payment/Contract):** intencionalmente diferidos a Fase 2 (necesitan la API). Documentado en Task 4. ✅
- **Pruebas unitarias del motor con casos de folletos (spec §7):** Task 3. ✅

**Fuera de esta fase (por diseño):** API, auth runtime, web, PDF, QR, link público, contrato — Fases 2–6.
