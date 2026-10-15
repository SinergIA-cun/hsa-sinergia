import {
  forwardRef,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn.ts';

type Variant = 'primary' | 'gold' | 'outline' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-cream hover:bg-ink-700 shadow-sm',
  gold: 'bg-gold text-cream hover:bg-gold-400 shadow-sm',
  outline: 'border border-ink/25 text-ink hover:border-ink/50 hover:bg-ink/5',
  ghost: 'text-ink hover:bg-ink/5',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
>(function Button({ className, variant = 'primary', ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium tracking-wide',
        'transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-cream',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
        {label}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-charcoal-soft">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-wine">{error}</span>}
    </label>
  );
}

const inputBase =
  'w-full rounded-lg border border-ink/15 bg-white/70 px-3.5 py-2.5 text-sm text-charcoal ' +
  'placeholder:text-charcoal-soft/60 transition-colors ' +
  'focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30 ' +
  // Sin esto un campo deshabilitado se ve idéntico a uno editable: el fondo propio
  // pisa el gris que el navegador aplicaría por omisión.
  'disabled:cursor-not-allowed disabled:bg-ink/5 disabled:text-charcoal-soft';

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return <input ref={ref} className={cn(inputBase, className)} {...props} />;
  },
);

/** Solo los dígitos, sin ceros a la izquierda. Es el valor que viaja al estado. */
function soloDigitos(v: unknown): string {
  return String(v ?? '')
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '');
}

/**
 * Lo que se tecleó, limpio: dígitos y, con centavos, un punto con a lo más dos
 * decimales ("7,850.505" → "7850.50"). Las comas son de millar: se quitan.
 */
export function limpiarMonto(v: unknown, conCentavos = true): string {
  if (!conCentavos) return soloDigitos(v);
  const texto = String(v ?? '').replace(/[^\d.]/g, '');
  const punto = texto.indexOf('.');
  if (punto === -1) return soloDigitos(texto);
  const entero = soloDigitos(texto.slice(0, punto)) || '0';
  const decimales = texto.slice(punto + 1).replace(/\./g, '').slice(0, 2);
  return `${entero}.${decimales}`;
}

/**
 * Campo de dinero con signo de pesos y comas de millar.
 *
 * `125300` y `125,300` se leen distinto, y el segundo es el que evita teclear un
 * cero de más sin notarlo. El estado guarda la cifra pelona ("7850.50"): quien lo
 * usa la convierte con `Number()`.
 *
 * Acepta centavos (Jorge, 15-oct-2026) salvo con `enteros`, que es para lo que va
 * en pesos enteros por regla: los precios del catálogo y los folios.
 *
 * No es `type="number"`: ese no admite comas y además trae la ruedita del ratón,
 * que sobre un campo de dinero cambia el monto por accidente con solo pasar el
 * cursor. `inputMode="decimal"` conserva el teclado numérico (con punto) en
 * tablet, que es donde se captura la mayoría de los pagos.
 *
 * El cursor se queda donde estaba: se cuenta cuántos caracteres SIGNIFICATIVOS
 * (dígitos y el punto) quedaban a su izquierda y se recoloca después de esos
 * mismos. Sin eso, corregir una cifra a la mitad manda el cursor al final en
 * cada tecla.
 */
export const MoneyInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
    value: string | number;
    onValue: (cifra: string) => void;
    /** Solo pesos enteros (catálogo, folios). */
    enteros?: boolean;
  }
>(function MoneyInput({ className, value, onValue, enteros = false, ...props }, ref) {
  const propio = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);

  const cifra = limpiarMonto(value, !enteros);
  const [entero, decimales] = cifra.split('.');
  const visible =
    cifra === '' ? '' : `${Number(entero).toLocaleString('es-MX')}${decimales !== undefined ? `.${decimales}` : ''}`;

  useEffect(() => {
    const el = propio.current;
    const pendientes = caret.current;
    if (!el || pendientes == null) return;
    caret.current = null;
    const significativo = enteros ? /\d/ : /[\d.]/;
    // Después de N caracteres significativos contando desde la izquierda, ¿en
    // qué posición del texto con comas queda el cursor?
    let vistos = 0;
    let pos = el.value.length;
    for (let i = 0; i < el.value.length; i++) {
      if (significativo.test(el.value[i] ?? '')) vistos++;
      if (vistos === pendientes) {
        pos = i + 1;
        break;
      }
    }
    if (pendientes === 0) pos = 0;
    el.setSelectionRange(pos, pos);
  }, [visible, enteros]);

  // El "$" va fuera del valor: es un adorno, así que copiar el monto o leerlo
  // con lector de pantalla sigue dando solo la cifra. El `pl-7` va al final para
  // que ningún `px-*` de quien lo usa lo tape.
  return (
    <span className="relative block">
      <span
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-charcoal-soft"
      >
        $
      </span>
      <input
        ref={(el) => {
          propio.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        type="text"
        inputMode={enteros ? 'numeric' : 'decimal'}
        autoComplete="off"
        value={visible}
        onChange={(e) => {
          const hastaElCursor = e.target.value.slice(0, e.target.selectionStart ?? 0);
          const significativo = enteros ? /\d/ : /[\d.]/;
          caret.current = hastaElCursor.split('').filter((c) => significativo.test(c)).length;
          onValue(limpiarMonto(e.target.value, !enteros));
        }}
        className={cn(inputBase, 'tabular-nums', className, 'pl-6')}
        {...props}
      />
    </span>
  );
});

/** Normaliza un valor de hora a HH:MM (rellena "2:30" → "02:30") para <input type="time">. */
function toTimeValue(v: unknown): string {
  if (typeof v !== 'string') return '';
  const m = v.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const hh = (m[1] ?? '').padStart(2, '0');
  return `${hh}:${m[2] ?? ''}`;
}

/** Selector de hora nativo (rueda en tablet/móvil): no pide capturar ":" ni AM/PM. */
export const TimeInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TimeInput({ className, value, ...props }, ref) {
    return (
      <input
        ref={ref}
        type="time"
        value={toTimeValue(value)}
        className={cn(inputBase, className)}
        {...props}
      />
    );
  },
);

export const SelectInput = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function SelectInput({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(inputBase, 'appearance-none pr-9', className)} {...props}>
        {children}
      </select>
    );
  },
);

export function Card({
  className,
  children,
  onClick,
}: {
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-[var(--radius-card)] border border-cream-300/80 bg-white/80 backdrop-blur',
        'shadow-[var(--shadow-card)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ArrowDivider({ children }: { children: ReactNode }) {
  return <div className="divider-arrow text-[0.7rem] uppercase tracking-[0.25em]">{children}</div>;
}
