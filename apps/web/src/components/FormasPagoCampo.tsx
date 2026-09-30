import { Plus, X } from 'lucide-react';
import { FORMAS_PAGO, FORMA_PAGO_LABEL, type FormaPago, type PartePago } from '@hsa/shared';
import { formatMXN } from '../lib/money.ts';
import { Field, MoneyInput, SelectInput } from './ui.tsx';

/**
 * La forma de pago de un cobro, con la opción de dividirlo.
 *
 * El caso que la motiva es de todos los días en el mostrador: "toma mi tarjeta
 * de débito y mi tarjeta de crédito, a cada una cóbrale tanto". Es UN pago con
 * UN folio, así que la división se captura aquí, dentro del mismo pago, y no
 * registrando dos.
 *
 * Por omisión se ve como siempre —un solo selector— para no estorbarle a la
 * mayoría de los cobros, que son de una sola forma.
 */

export interface FormasCaptura {
  dividido: boolean;
  /** La forma cuando NO está dividido. */
  forma: FormaPago;
  /** Las partes cuando sí; los montos son dígitos, igual que `MoneyInput`. */
  partes: { forma: FormaPago; monto: string }[];
  /**
   * Mientras nadie toque el monto del PRIMER renglón, ése absorbe la diferencia:
   * se teclean $4,000 en crédito y débito queda solo en $6,000. Es como se dicta
   * en el mostrador ("cóbrale cuatro a ésta y el resto a la otra").
   */
  primeraAutomatica?: boolean;
}

export function formasIniciales(forma: FormaPago = 'transferencia'): FormasCaptura {
  return { dividido: false, forma, partes: [] };
}

/** Cuánto suman las partes capturadas. */
function sumaPartes(c: FormasCaptura): number {
  return c.partes.reduce((s, p) => s + (Number(p.monto) || 0), 0);
}

/**
 * Por qué no se puede guardar todavía, o `null` si cuadra. El servidor valida lo
 * mismo; esto es para decirlo antes de mandar.
 */
export function errorFormas(c: FormasCaptura, monto: number): string | null {
  if (!c.dividido) return null;
  if (c.partes.length < 2) return 'Un pago dividido lleva al menos dos formas.';
  if (c.partes.some((p) => !(Number(p.monto) > 0))) return 'Cada forma necesita su monto.';
  if (new Set(c.partes.map((p) => p.forma)).size !== c.partes.length) {
    return 'Cada forma va una sola vez: si son dos tarjetas de crédito, súmalas.';
  }
  const suma = sumaPartes(c);
  if (suma !== monto) {
    return suma < monto
      ? `Faltan ${formatMXN(monto - suma)} por repartir entre las formas.`
      : `Las formas se pasan del pago por ${formatMXN(suma - monto)}.`;
  }
  return null;
}

/** Lo que viaja al servidor: `metodo` si es una sola forma, `formas` si está dividido. */
export function formasParaEnviar(c: FormasCaptura): { metodo?: FormaPago; formas?: PartePago[] } {
  if (!c.dividido) return { metodo: c.forma };
  return { formas: c.partes.map((p) => ({ forma: p.forma, monto: Number(p.monto) })) };
}

/** Lo mismo, dentro de un FormData (el campo `formas` va como JSON). */
export function formasEnFormData(fd: FormData, c: FormasCaptura) {
  const envio = formasParaEnviar(c);
  if (envio.metodo) fd.set('metodo', envio.metodo);
  if (envio.formas) fd.set('formas', JSON.stringify(envio.formas));
}

export function FormasPagoCampo({
  value,
  onChange,
  monto,
}: {
  value: FormasCaptura;
  onChange: (c: FormasCaptura) => void;
  /** El total del pago, para decir cuánto falta por repartir. */
  monto: number;
}) {
  if (!value.dividido) {
    return (
      <Field label="Forma de pago">
        <SelectInput value={value.forma} onChange={(e) => onChange({ ...value, forma: e.target.value as FormaPago })}>
          {FORMAS_PAGO.map((f) => (
            <option key={f} value={f}>
              {FORMA_PAGO_LABEL[f]}
            </option>
          ))}
        </SelectInput>
        <button
          type="button"
          onClick={(e) => {
            // El botón vive dentro del <label> de Field: sin esto el clic también
            // enfoca el selector y abre su lista en la tablet.
            e.preventDefault();
            const otra = FORMAS_PAGO.find((f) => f !== value.forma) ?? 'efectivo';
            onChange({
              ...value,
              dividido: true,
              primeraAutomatica: true,
              partes: [
                { forma: value.forma, monto: monto > 0 ? String(monto) : '' },
                { forma: otra, monto: '' },
              ],
            });
          }}
          className="mt-1.5 text-xs font-medium text-gold hover:underline"
        >
          Dividir en varias formas
        </button>
      </Field>
    );
  }

  const suma = sumaPartes(value);
  const restante = monto - suma;
  const conPrimeraAjustada = (c: FormasCaptura): FormasCaptura => {
    if (!c.primeraAutomatica || c.partes.length === 0) return c;
    const otras = c.partes.slice(1).reduce((s, p) => s + (Number(p.monto) || 0), 0);
    const resto = monto - otras;
    return {
      ...c,
      partes: c.partes.map((p, j) => (j === 0 ? { ...p, monto: resto > 0 ? String(resto) : '' } : p)),
    };
  };
  const setParte = (i: number, cambio: Partial<{ forma: FormaPago; monto: string }>) => {
    const partes = value.partes.map((p, j) => (j === i ? { ...p, ...cambio } : p));
    // Tocar el monto del primero lo vuelve manual: a partir de ahí nadie lo pisa.
    const primeraAutomatica = value.primeraAutomatica && !(i === 0 && cambio.monto !== undefined);
    onChange(conPrimeraAjustada({ ...value, partes, primeraAutomatica }));
  };
  const hayVacia = value.partes.some((p) => !(Number(p.monto) > 0));
  const libres = FORMAS_PAGO.filter((f) => !value.partes.some((p) => p.forma === f));

  return (
    <fieldset className="sm:col-span-2 rounded-lg border border-cream-300 bg-cream-50 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
        Formas de pago
      </legend>
      <ul className="space-y-2">
        {value.partes.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <SelectInput
              aria-label={`Forma ${i + 1}`}
              value={p.forma}
              onChange={(e) => setParte(i, { forma: e.target.value as FormaPago })}
              className="flex-1"
            >
              {FORMAS_PAGO.map((f) => (
                <option key={f} value={f}>
                  {FORMA_PAGO_LABEL[f]}
                </option>
              ))}
            </SelectInput>
            <MoneyInput
              aria-label={`Monto con ${FORMA_PAGO_LABEL[p.forma]}`}
              value={p.monto}
              onValue={(m) => setParte(i, { monto: m })}
              placeholder="Monto"
              className="w-36"
            />
            <button
              type="button"
              aria-label={`Quitar ${FORMA_PAGO_LABEL[p.forma]}`}
              onClick={() =>
                onChange(conPrimeraAjustada({ ...value, partes: value.partes.filter((_, j) => j !== i) }))
              }
              disabled={value.partes.length <= 2}
              className="rounded p-1.5 text-charcoal-soft hover:bg-ink/5 hover:text-wine disabled:opacity-30"
            >
              <X size={15} />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex gap-3">
          {libres.length > 0 && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  partes: [...value.partes, { forma: libres[0]!, monto: restante > 0 ? String(restante) : '' }],
                })
              }
              className="inline-flex items-center gap-1 font-medium text-gold hover:underline"
            >
              <Plus size={13} /> Otra forma
            </button>
          )}
          <button
            type="button"
            onClick={() => onChange({ ...value, dividido: false, forma: value.partes[0]?.forma ?? value.forma })}
            className="text-charcoal-soft hover:underline"
          >
            Una sola forma
          </button>
        </div>
        <span
          className={
            restante === 0 && monto > 0 && !hayVacia ? 'font-medium text-emerald-700' : 'font-medium text-wine'
          }
          aria-live="polite"
        >
          {monto <= 0
            ? 'Captura primero el monto del pago'
            : hayVacia
              ? 'Falta el monto de una forma'
              : restante === 0
              ? `✓ Suma ${formatMXN(suma)}`
              : restante > 0
                ? `Faltan ${formatMXN(restante)}`
                : `Se pasa por ${formatMXN(-restante)}`}
        </span>
      </div>
    </fieldset>
  );
}
