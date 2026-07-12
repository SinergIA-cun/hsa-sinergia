import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '../lib/api.ts';

export interface ClienteLite {
  id: string;
  nombre: string;
  telefono: string | null;
  correo: string | null;
  empresa: string | null;
  numeroReferencia: number;
}

/** Buscador de clientes existentes para reutilizarlos (evita duplicados). */
export function ClienteSearch({ onPick }: { onPick: (c: ClienteLite) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim();
  const { data } = useQuery({
    queryKey: ['clients', needle],
    queryFn: () => api.get<{ clients: ClienteLite[] }>(`/api/clients?q=${encodeURIComponent(needle)}`),
    enabled: needle.length >= 2,
  });
  const results = data?.clients ?? [];

  return (
    <div>
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar cliente existente por nombre, teléfono o correo…"
          className="w-full rounded-lg border border-ink/15 bg-white/70 py-2.5 pl-9 pr-3 text-sm text-charcoal placeholder:text-charcoal-soft/60 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
        />
      </div>
      {needle.length >= 2 && results.length > 0 && (
        <ul className="mt-1 divide-y divide-cream-200 overflow-hidden rounded-lg border border-cream-300 bg-white shadow-sm">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(c);
                  setQ('');
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-cream-100"
              >
                <span className="font-medium text-ink">{c.nombre}</span>
                <span className="text-xs text-charcoal-soft">
                  {[c.telefono, c.correo].filter(Boolean).join(' · ')} · ref {c.numeroReferencia}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {needle.length >= 2 && results.length === 0 && (
        <p className="mt-1 text-xs text-charcoal-soft">Sin coincidencias — al guardar se creará un cliente nuevo.</p>
      )}
    </div>
  );
}
