import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bookmark } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAuth } from '../auth/auth.tsx';
import { ArrowDivider } from '../components/ui.tsx';
import { ApartadoRow } from '../components/banqueteros/ApartadosPanel.tsx';
import type { ApartadoFecha, Catalog } from '../lib/types.ts';

/**
 * La ficha de una fecha apartada suelta.
 *
 * Los apartados de banquetero viven en su cuenta. Los de un cliente directo
 * (los trae el BI desde el 5-oct-2026) no tienen esa casa, así que la agenda los
 * abre aquí: lo apartado, lo abonado, y de aquí se convierten o se cancelan.
 */
export function ApartadoPage() {
  const { apartadoId } = useParams<{ apartadoId: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const apartadoQ = useQuery({
    queryKey: ['apartado', apartadoId],
    queryFn: () => api.get<{ apartado: ApartadoFecha }>(`/api/apartados/${apartadoId}`),
  });
  const catalogQ = useQuery({ queryKey: ['catalog', 'activo'], queryFn: () => api.get<Catalog>('/api/catalog') });
  const nombreEspacio = (id: string) => catalogQ.data?.spaces.find((s) => s.id === id)?.nombre ?? id;

  const a = apartadoQ.data?.apartado;
  const volver = (
    <Link
      to={a?.banqueteroId ? `/banqueteros/${a.banqueteroId}` : '/agenda'}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-charcoal-soft hover:text-ink"
    >
      <ArrowLeft size={15} /> {a?.banqueteroId ? 'Cuenta del banquetero' : 'Agenda'}
    </Link>
  );

  if (apartadoQ.isLoading) return <p className="text-charcoal-soft">Cargando el apartado…</p>;
  if (!a) {
    return (
      <div>
        {volver}
        <p className="text-wine">No se encontró ese apartado.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      {volver}
      <ArrowDivider>Fecha apartada</ArrowDivider>
      <h1 className="mb-6 mt-2 flex items-center gap-2 font-display text-4xl text-ink">
        <Bookmark size={26} className="text-gold" /> {a.banquetero?.nombre ?? a.client?.nombre ?? 'Apartado'}
      </h1>
      <ApartadoRow
        apartado={a}
        banqueteroId={a.banqueteroId}
        nombreEspacio={nombreEspacio}
        isAdmin={user?.role === 'admin'}
        mostrarTitular
        onCambio={async () => {
          await Promise.all([
            qc.invalidateQueries({ queryKey: ['apartado', apartadoId] }),
            qc.invalidateQueries({ queryKey: ['agenda'] }),
          ]);
        }}
      />
    </div>
  );
}
