import { useState } from 'react';
import { Field, MoneyInput, TextInput } from '../../ui.tsx';
import type { CatalogoContenido } from '../../../lib/types.ts';
import { BarraGuardar, useGuardar } from './guardado.tsx';

type Params = CatalogoContenido['priceList'];

export interface ParametrosPatch {
  ivaRate?: number;
  extraHourRate?: number;
  foodDiscountRate?: number;
  capillaSabado?: number;
}

/** Las tres tasas, capturadas en PORCENTAJE. La cuarta es un precio en pesos. */
const TASAS = [
  { campo: 'ivaRate', label: 'IVA (%)', hint: 'El de siempre: 16.' },
  { campo: 'extraHourRate', label: 'Hora extra (%)', hint: 'Porcentaje de la renta, por hora.' },
  {
    campo: 'foodDiscountRate',
    label: 'Descuento por alimentos (%)',
    hint: 'Se descuenta de la renta cuando el evento lleva alimentos.',
  },
] as const;

type CampoTasa = (typeof TASAS)[number]['campo'];

/**
 * Una tasa se captura en porcentaje y se guarda como fracción.
 *
 * La API rechaza cualquier cosa arriba de 1 justamente porque un IVA capturado
 * como "16" en vez de "0.16" multiplicaría toda la cotización por cien. Aquí la
 * conversión es explícita para que la pantalla pueda pedir el número que la gente
 * dice en voz alta.
 */
const aPct = (fraccion: number): string => String(Math.round(fraccion * 10000) / 100);
const aFraccion = (pct: number): number => pct / 100;

/**
 * Los parámetros del catálogo: IVA, hora extra, descuento por alimentos y la
 * tarifa de capilla en sábado.
 *
 * Son DEL CATÁLOGO, no globales. El singleton `PricingConfig` que los guardaba
 * era la última fuente capaz de represiar toda cotización con solo reeditarla, y
 * la pantalla vieja de "Configuración" —que escribía sobre el catálogo activo—
 * era un segundo camino al mismo dato. Editar los de 2028 no toca los de 2027.
 */
export function ParametrosSeccion({
  params,
  onGuardar,
}: {
  params: Params;
  onGuardar: (datos: ParametrosPatch) => Promise<unknown>;
}) {
  const [tasas, setTasas] = useState<Record<CampoTasa, string>>({
    ivaRate: aPct(params.ivaRate),
    extraHourRate: aPct(params.extraHourRate),
    foodDiscountRate: aPct(params.foodDiscountRate),
  });
  const [capilla, setCapilla] = useState(String(params.capillaSabado));
  const [invalido, setInvalido] = useState('');
  const { correr, pendiente, error, ok, limpiar } = useGuardar('No se pudieron guardar los parámetros.');

  /** Un porcentaje válido: número entre 0 y 100. La API lo recibe como 0..1. */
  function leerPct(v: string): number | null {
    const n = Number(v);
    if (v.trim() === '' || Number.isNaN(n) || n < 0 || n > 100) return null;
    return n;
  }

  const patch: ParametrosPatch = {};
  let malo = false;
  for (const { campo } of TASAS) {
    const pct = leerPct(tasas[campo]);
    if (pct === null) {
      malo = true;
      continue;
    }
    // La comparación va en PORCENTAJE normalizado, no en la fracción: `7.3/100`
    // y el `0.073` guardado pueden diferir en el último bit de coma flotante, y
    // eso dejaría un "1 parámetro sin guardar" que nadie puede quitar.
    if (String(pct) !== aPct(params[campo])) patch[campo] = aFraccion(pct);
  }
  const capillaNum = Number(capilla);
  if (capilla.trim() === '' || !Number.isInteger(capillaNum) || capillaNum < 0) {
    malo = true;
  } else if (capillaNum !== params.capillaSabado) {
    patch.capillaSabado = capillaNum;
  }
  const cambios = Object.keys(patch).length;

  function descartar() {
    setTasas({
      ivaRate: aPct(params.ivaRate),
      extraHourRate: aPct(params.extraHourRate),
      foodDiscountRate: aPct(params.foodDiscountRate),
    });
    setCapilla(String(params.capillaSabado));
    setInvalido('');
    limpiar();
  }

  async function guardar() {
    if (malo) {
      setInvalido('Las tasas van de 0 a 100 (por ciento) y la capilla en pesos enteros.');
      return;
    }
    setInvalido('');
    await correr(() => onGuardar(patch), 'Parámetros guardados.');
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-charcoal-soft">
        Estos parámetros son de <strong>{params.nombre}</strong>. Editarlos no toca los de ningún otro
        catálogo, y las cotizaciones ya guardadas conservan su total.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TASAS.map(({ campo, label, hint }) => (
          <Field key={campo} label={label} hint={hint}>
            <TextInput
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={tasas[campo]}
              onChange={(e) => {
                limpiar();
                setInvalido('');
                setTasas((prev) => ({ ...prev, [campo]: e.target.value }));
              }}
            />
          </Field>
        ))}
        <Field label="Capilla en sábado (MXN)" hint="Entre semana es cortesía; el sábado se cobra.">
          <MoneyInput
            value={capilla}
            onValue={(v) => {
              limpiar();
              setInvalido('');
              setCapilla(v);
            }}
          />
        </Field>
      </div>
      <BarraGuardar
        cambios={cambios}
        pendiente={pendiente}
        error={invalido || error}
        ok={ok}
        onGuardar={() => void guardar()}
        onDescartar={descartar}
        etiqueta="Guardar parámetros"
        unidad="parámetro"
      />
    </div>
  );
}
