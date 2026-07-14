import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import type { QuoteDetail } from '../lib/types.ts';

const si = (v?: boolean) => (v ? 'SÍ' : 'NO');
const dash = (v?: string | number | null) => (v == null || v === '' ? '—' : String(v));

/** Hoja operativa imprimible por evento (interna). Mismo dato que el correo diario y el ERP. */
export function HojaOperativaPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['quote', id],
    queryFn: () => api.get<QuoteDetail>(`/api/quotes/${id}`),
    retry: false,
  });

  if (isLoading) return <div className="grid min-h-screen place-items-center text-ink-500">Cargando…</div>;
  if (isError || !data) return <div className="grid min-h-screen place-items-center text-wine">No encontrada.</div>;

  const { quote } = data;
  const hoja = quote.operativa ?? {};
  const espacio =
    quote.breakdown.lines.find((l) => l.concepto.startsWith('Renta '))?.concepto.replace('Renta ', '') ?? '—';
  const costoHoraExtra = Math.round(quote.rentaTotal * 0.05);
  const evento = `${quote.eventType?.nombre ?? 'Evento'}${hoja.nombreFestejado ? ` · ${hoja.nombreFestejado}` : ''}`;
  const cliente = `${quote.client?.nombre ?? 'Cliente'}${hoja.relacionCliente ? ` — ${hoja.relacionCliente}` : ''}`;

  return (
    <div className="ho-root">
      <style>{`
        .ho-root { background: #f3f3f0; color: #1a1a1a; font-family: Georgia, 'Times New Roman', serif; min-height: 100vh; }
        .ho-toolbar { position: sticky; top: 0; z-index: 10; display: flex; justify-content: space-between; align-items: center;
          padding: 0.75rem 1.25rem; background: #14304d; color: #f7f2e8; }
        .ho-btn { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; border-radius: 0.5rem;
          font-family: 'Archivo', system-ui, sans-serif; font-size: 0.85rem; cursor: pointer; }
        .ho-doc { max-width: 46rem; margin: 1.5rem auto; background: #fff; padding: 2.5rem 3rem; box-shadow: 0 2px 12px rgba(0,0,0,0.12); }
        .ho-doc h1 { text-align: center; font-size: 1.4rem; letter-spacing: 0.02em; margin: 0; }
        .ho-doc h1 small { display: block; font-size: 0.6rem; letter-spacing: 0.35em; color: #b0894e; }
        .ho-title { text-align: center; margin: 0.75rem 0 1.5rem; font-size: 1.1rem; letter-spacing: 0.15em; text-transform: uppercase; }
        .ho-doc table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.9rem; }
        .ho-doc td, .ho-doc th { border: 1px solid #bbb; padding: 0.45rem 0.6rem; vertical-align: top; }
        .ho-doc th { background: #f0ece3; text-align: left; width: 30%; font-weight: 600; }
        .ho-pre { white-space: pre-wrap; font-family: inherit; margin: 0; }
        @media print { .ho-root { background: #fff; } .ho-toolbar { display: none; } .ho-doc { box-shadow: none; margin: 0; max-width: none; } }
      `}</style>

      <div className="ho-toolbar">
        <Link to={`/cotizaciones/${quote.id}`} className="ho-btn" style={{ border: '1px solid rgba(247,242,232,0.4)' }}>
          <ArrowLeft size={15} /> Volver
        </Link>
        <button onClick={() => window.print()} className="ho-btn" style={{ background: '#b0894e', color: '#fff' }}>
          <Printer size={15} /> Imprimir / PDF
        </button>
      </div>

      <div className="ho-doc">
        <h1>Hacienda San Andrés<small>1894</small></h1>
        <div className="ho-title">Hoja operativa</div>

        <table>
          <tbody>
            <tr><th>Fecha</th><td>{formatEventDate(quote.fechaEvento, 'long')}</td></tr>
            <tr><th>No. invitados</th><td>{quote.invitados}</td></tr>
            <tr><th>Evento</th><td>{evento}</td></tr>
            <tr><th>Cliente</th><td>{cliente}</td></tr>
            <tr><th>Lugar</th><td>{espacio} · Capilla: {si(quote.usaCapilla ?? hoja.capilla)}</td></tr>
          </tbody>
        </table>

        <table>
          <tbody>
            <tr><th>Horario · Misa</th><td>{dash(hoja.horaMisa)}</td></tr>
            <tr><th>Inicio · Término</th><td>{dash(quote.horaInicio)} — {dash(quote.horaTermino)}</td></tr>
            <tr><th>Horas del evento</th><td>{dash(quote.horasEvento)}</td></tr>
            <tr><th>Fotografía</th><td>{si(hoja.fotografia)}</td></tr>
            <tr><th>Costo × hora extra</th><td>{formatMXN(costoHoraExtra)}</td></tr>
          </tbody>
        </table>

        <table>
          <tbody>
            <tr><th>Banquetero</th><td>{dash(hoja.banquetero)}{hoja.banqueteroPaqHsa ? ' · Paq. HSA' : ''}</td></tr>
            <tr><th>Equipo · Estrado</th><td>{dash(hoja.estrado)}</td></tr>
            <tr><th>Equipo · Pista</th><td>{dash(hoja.pista)}</td></tr>
            <tr><th>Personal HSA</th><td><p className="ho-pre">{dash(hoja.personalHsa)}</p></td></tr>
            <tr><th>Personal de seguridad</th><td>{dash(hoja.personalSeguridadHora)} · {dash(hoja.personalSeguridadElementos)} elementos</td></tr>
          </tbody>
        </table>

        <table>
          <tbody>
            <tr><th>Limpieza nocturna y profunda</th><td>{si(hoja.limpiezaNocturna)}</td></tr>
            <tr><th>Habitación</th><td>{dash(hoja.habitacion)}</td></tr>
            <tr><th>Se queda equipo</th><td>{dash(hoja.seQuedaEquipo)}</td></tr>
            <tr><th>Maniobras</th><td>{dash(hoja.maniobras)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
