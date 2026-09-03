import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import type { Quote, EstadoCuenta } from '../lib/types.ts';
import { MARCA } from '../lib/marca.ts';

interface PublicPago {
  id: string;
  folio: number;
  monto: number;
  concepto: string;
  metodo: string;
  fecha: string;
  tieneComprobante: boolean;
}

interface PublicResponse {
  quote: Quote;
  estadoCuenta: EstadoCuenta;
}

const CONCEPTO_LABEL: Record<string, string> = {
  anticipo: 'Anticipo',
  complemento: 'Complemento',
  aCuenta: 'Abono a cuenta',
  finiquito: 'Finiquito',
};
const METODO_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
};

/** Recibo imprimible de un pago, visible por el cliente (por token). */
export function ReciboPage() {
  const { token, paymentId } = useParams<{ token: string; paymentId: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-quote', token],
    queryFn: () => api.get<PublicResponse>(`/api/c/${token}`),
    retry: false,
  });

  if (isLoading) {
    return <div className="grid min-h-screen place-items-center text-ink-500">Cargando recibo…</div>;
  }
  const pago = (data?.estadoCuenta.pagos as PublicPago[] | undefined)?.find((p) => p.id === paymentId);
  if (isError || !data || !pago) {
    return <div className="grid min-h-screen place-items-center text-wine">Recibo no encontrado.</div>;
  }

  const { quote } = data;
  const hoy = new Date();

  return (
    <div className="recibo-root">
      <style>{`
        .recibo-root { background: #f3f3f0; color: #1a1a1a; font-family: Georgia, 'Times New Roman', serif; min-height: 100vh; }
        .recibo-toolbar { position: sticky; top: 0; z-index: 10; display: flex; justify-content: space-between; align-items: center;
          padding: 0.75rem 1.25rem; background: #14304d; color: #f7f2e8; }
        .recibo-btn { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; border-radius: 0.5rem;
          font-family: 'Archivo', system-ui, sans-serif; font-size: 0.85rem; cursor: pointer; }
        .recibo-doc { max-width: 40rem; margin: 2rem auto; background: #fff; padding: 3rem; box-shadow: 0 2px 12px rgba(0,0,0,0.12); }
        .recibo-doc .marca { text-align: center; font-size: 1.4rem; letter-spacing: 0.02em; }
        .recibo-doc .marca small { display: block; font-size: 0.6rem; letter-spacing: 0.35em; color: #b0894e; margin-top: 2px; }
        .recibo-title { text-align: center; margin: 1.5rem 0 0.25rem; font-size: 1.6rem; letter-spacing: 0.04em; }
        .recibo-folio { text-align: center; color: #b0894e; font-weight: 600; letter-spacing: 0.1em; margin-bottom: 1.5rem; }
        .recibo-monto { text-align: center; font-size: 2.6rem; margin: 1.5rem 0; }
        .recibo-rows { border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; padding: 1rem 0; margin: 1.5rem 0; }
        .recibo-row { display: flex; justify-content: space-between; padding: 0.35rem 0; font-size: 0.95rem; }
        .recibo-row span:first-child { color: #777; }
        .recibo-foto { margin-top: 1.5rem; text-align: center; }
        .recibo-foto img { max-width: 100%; max-height: 22rem; border: 1px solid #ddd; border-radius: 6px; }
        .recibo-foot { margin-top: 2rem; text-align: center; font-size: 0.7rem; color: #888; }
        @media print { .recibo-root { background: #fff; } .recibo-toolbar { display: none; } .recibo-doc { box-shadow: none; margin: 0; max-width: none; } }
      `}</style>

      <div className="recibo-toolbar">
        <Link to={`/c/${token}`} className="recibo-btn" style={{ border: '1px solid rgba(247,242,232,0.4)' }}>
          <ArrowLeft size={15} /> Volver
        </Link>
        <button onClick={() => window.print()} className="recibo-btn" style={{ background: '#b0894e', color: '#fff' }}>
          <Printer size={15} /> Imprimir / PDF
        </button>
      </div>

      <div className="recibo-doc">
        <div className="marca">{MARCA.nombre}<small>{MARCA.anio}</small></div>
        <div className="recibo-title">Recibo de pago</div>
        <div className="recibo-folio">N.º {pago.folio}</div>

        <div className="recibo-monto">{formatMXN(pago.monto)}</div>

        <div className="recibo-rows">
          <div className="recibo-row"><span>Concepto</span><span>{CONCEPTO_LABEL[pago.concepto] ?? pago.concepto}</span></div>
          <div className="recibo-row"><span>Método</span><span>{METODO_LABEL[pago.metodo] ?? pago.metodo}</span></div>
          <div className="recibo-row"><span>Fecha del pago</span><span>{formatEventDate(pago.fecha, 'long')}</span></div>
          <div className="recibo-row"><span>Cliente</span><span>{quote.client?.nombre}</span></div>
          {quote.client?.numeroReferencia != null && (
            <div className="recibo-row"><span>N.º de referencia</span><span>{quote.client.numeroReferencia}</span></div>
          )}
          <div className="recibo-row"><span>Evento</span><span>{quote.eventType?.nombre} · {formatEventDate(quote.fechaEvento)}</span></div>
          {/* El código de evento: es lo que se copia para referirse al evento en
              un correo o una transferencia, así que tiene que salir en el recibo. */}
          {quote.codigo && (
            <div className="recibo-row"><span>Código de evento</span><span>{quote.codigo}</span></div>
          )}
        </div>

        {pago.tieneComprobante && (
          <div className="recibo-foto">
            <img src={`/api/c/${token}/recibo/${pago.id}/imagen`} alt="Comprobante de pago" />
          </div>
        )}

        <div className="recibo-foot">
          Emitido el {formatEventDate(hoy.toISOString().slice(0, 10), 'long')} · {MARCA.razonSocial}
          <br />
          {MARCA.direccion}.
        </div>
      </div>
    </div>
  );
}
