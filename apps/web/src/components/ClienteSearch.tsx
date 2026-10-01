import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, UserPlus } from 'lucide-react';
import { api } from '../lib/api.ts';

export interface ClienteLite {
  id: string;
  nombre: string;
  telefono: string | null;
  correo: string | null;
  empresa: string | null;
  numeroReferencia: number;
  rfc?: string | null;
  razonSocial?: string | null;
  regimenFiscal?: string | null;
  cpFiscal?: string | null;
  usoCfdi?: string | null;
  correoFacturacion?: string | null;
}

const MIN_CARACTERES = 2;

/**
 * El campo del nombre del cliente ES el buscador.
 *
 * Antes eran dos: un buscador arriba y el nombre abajo, y quien tenía prisa se
 * saltaba el buscador, tecleaba el nombre y duplicaba al cliente (con otro número
 * de referencia SPEI). Ahora se teclea una sola vez: mientras se escribe aparecen
 * los clientes que ya existen con ese nombre, teléfono o correo; si se elige uno
 * se reutiliza, y si no, lo tecleado es el nombre del cliente nuevo.
 *
 * Con `readOnly` (el nombre lo pone el banquetero) no se teclea nada, pero sí se
 * enseñan las fichas que ya existen con ese nombre, para no duplicarle la suya.
 */
export function ClienteCombobox({
  label,
  value,
  onChange,
  onPick,
  buscar,
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (nombre: string) => void;
  onPick: (c: ClienteLite) => void;
  /** Sin búsqueda (al editar un evento) es un campo de texto normal. */
  buscar: boolean;
  readOnly?: boolean;
}) {
  const id = useId();
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(-1);
  const needle = value.trim();
  const { data } = useQuery({
    queryKey: ['clients', needle],
    queryFn: () => api.get<{ clients: ClienteLite[] }>(`/api/clients?q=${encodeURIComponent(needle)}`),
    enabled: buscar && needle.length >= MIN_CARACTERES,
  });
  const resultados = data?.clients ?? [];
  const lista = buscar && (readOnly || abierto) && needle.length >= MIN_CARACTERES;

  function elegir(c: ClienteLite) {
    onPick(c);
    setAbierto(false);
    setActivo(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!lista || resultados.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActivo((i) => (i + 1) % resultados.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActivo((i) => (i <= 0 ? resultados.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activo >= 0) {
      e.preventDefault();
      elegir(resultados[activo]!);
    } else if (e.key === 'Escape') {
      setAbierto(false);
    }
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
        {label}
      </label>
      <div className="relative">
        {buscar && !readOnly && (
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft" />
        )}
        <input
          id={id}
          value={value}
          readOnly={readOnly}
          role={buscar ? 'combobox' : undefined}
          aria-expanded={buscar ? lista && resultados.length > 0 : undefined}
          aria-controls={buscar ? `${id}-lista` : undefined}
          aria-autocomplete={buscar ? 'list' : undefined}
          aria-activedescendant={activo >= 0 ? `${id}-op-${activo}` : undefined}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value);
            setAbierto(true);
            setActivo(-1);
          }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setAbierto(false)}
          onKeyDown={onKeyDown}
          placeholder={buscar ? 'Escribe el nombre, teléfono o correo…' : 'Nombre del cliente'}
          className={`w-full rounded-lg border border-ink/15 bg-white/70 py-2.5 pr-3 text-sm text-charcoal placeholder:text-charcoal-soft/60 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30 read-only:bg-ink/[0.03] ${
            buscar && !readOnly ? 'pl-9' : 'pl-3'
          }`}
        />
      </div>

      {lista && resultados.length > 0 && (
        <div
          className={
            readOnly
              ? 'mt-2'
              : 'absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-cream-300 bg-white shadow-lg'
          }
        >
          <p className="px-3 pt-2 text-[0.7rem] font-semibold uppercase tracking-wide text-charcoal-soft">
            {readOnly ? 'Ya tiene ficha de cliente — úsala para no duplicarla' : 'Clientes que ya existen'}
          </p>
          <ul id={`${id}-lista`} role="listbox" className="divide-y divide-cream-200">
            {resultados.map((c, i) => (
              <li key={c.id} id={`${id}-op-${i}`} role="option" aria-selected={i === activo}>
                <button
                  type="button"
                  // mousedown y no click: el click llega después del blur, cuando
                  // la lista ya se cerró.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    elegir(c);
                  }}
                  className={`flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-left text-sm hover:bg-cream-100 ${
                    i === activo ? 'bg-cream-100' : ''
                  }`}
                >
                  <span className="font-medium text-ink">{c.nombre}</span>
                  <span className="text-xs text-charcoal-soft">
                    {[c.telefono, c.correo].filter(Boolean).join(' · ') || 'sin contacto'} · ref {c.numeroReferencia}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!readOnly && (
            <p className="flex items-center gap-1.5 border-t border-cream-200 bg-cream-100/60 px-3 py-2 text-xs text-charcoal-soft">
              <UserPlus size={13} /> ¿No es ninguno? Sigue escribiendo: se guardará como cliente nuevo.
            </p>
          )}
        </div>
      )}
      {lista && !readOnly && needle.length >= MIN_CARACTERES && data && resultados.length === 0 && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-charcoal-soft">
          <UserPlus size={13} /> Cliente nuevo: no hay nadie registrado así.
        </p>
      )}
    </div>
  );
}
