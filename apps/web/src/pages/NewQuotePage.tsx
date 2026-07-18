import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api.ts';
import { ArrowDivider } from '../components/ui.tsx';
import { QuoteForm, type QuotePayload } from '../components/QuoteForm.tsx';
import type { Catalog, Quote } from '../lib/types.ts';

export function NewQuotePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: catalog, isLoading } = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<Catalog>('/api/catalog'),
  });

  const [error, setError] = useState('');

  // Al crear entramos directo al contrato: ahí se comparte el QR/enlace y se
  // registran pagos y bitácora, sin sacar al usuario del contrato.
  async function handleSubmit(payload: QuotePayload) {
    setError('');
    try {
      const res = await api.post<{ quote: Quote }>('/api/quotes', payload);
      await qc.invalidateQueries({ queryKey: ['quotes'] });
      navigate(`/cotizaciones/${res.quote.id}?creado=1`);
    } catch {
      setError('No se pudo guardar. Revisa los datos.');
    }
  }

  if (isLoading) return <p className="text-charcoal-soft">Cargando catálogo…</p>;
  if (!catalog) return <p className="text-wine">No se pudo cargar el catálogo.</p>;

  return (
    <div>
      <Link
        to="/cotizaciones"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-charcoal-soft hover:text-ink"
      >
        <ArrowLeft size={15} /> Contratos
      </Link>
      <ArrowDivider>Nuevo</ArrowDivider>
      <h1 className="mb-8 mt-2 font-display text-4xl text-ink">Armar contrato</h1>
      <QuoteForm
        catalog={catalog}
        submitLabel="Crear contrato"
        onSubmit={handleSubmit}
        errorMsg={error}
        enableClientSearch
      />
    </div>
  );
}
