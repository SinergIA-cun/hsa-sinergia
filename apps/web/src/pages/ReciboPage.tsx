import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import type { Quote, EstadoCuenta } from '../lib/types.ts';
import { MARCA } from '../lib/marca.ts';
import { FORMA_PAGO_LABEL, formatFolio, partesDePago, type MetodoPago } from '@hsa/shared';

interface PublicPago {
  id: string;
  folio: number;
  folioLetra?: string | null;
  monto: number;
  concepto: string;
  metodo: string;
  /** Las partes si el pago vino dividido ("débito $6,000 · crédito $4,000"). */
  formas: unknown;
  fecha: string;
  tieneComprobante: boolean;
  /** `cargos` = cobro de la cuenta del punto de venta, no de la renta. */
  destino?: 'evento' | 'cargos';
}

interface PublicResponse {
  quote: Quote;
  estadoCuenta: EstadoCuenta;
  cuenta?: { pagos: PublicPago[] };
}

const CONCEPTO_LABEL: Record<string, string> = {
  anticipo: 'Anticipo',
  complemento: 'Complemento',
  aCuenta: 'Abono a cuenta',
  finiquito: 'Finiquito',
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
  // El pago puede ser de la renta o de la cuenta del punto de venta.
  const pago = [
    ...((data?.estadoCuenta.pagos as PublicPago[] | undefined) ?? []),
    ...(data?.cuenta?.pagos ?? []),
  ].find((p) => p.id === paymentId);
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
        {/* La serie I de las hojas foliadas: el recibo sigue la misma numeración
            que el papel, así que es el número que se busca en la carpeta. */}
        <div className="recibo-folio">Folio {formatFolio(pago.folio, pago.folioLetra)}</div>

        <div className="recibo-monto">{formatMXN(pago.monto)}</div>

        <div className="recibo-rows">
          <div className="recibo-row"><span>Concepto</span><span>{pago.destino === 'cargos' ? 'Cargos adicionales del evento' : (CONCEPTO_LABEL[pago.concepto] ?? pago.concepto)}</span></div>
          {/* Un pago dividido lista cada forma con su monto: es lo que el cliente
              coteja contra los dos vouchers de sus tarjetas. */}
          {partesDePago(pago).map((p, i) => (
            <div key={i} className="recibo-row">
              <span>{i === 0 ? 'Forma de pago' : ''}</span>
              <span>
                {FORMA_PAGO_LABEL[p.forma as MetodoPago] ?? p.forma}
                {partesDePago(pago).length > 1 ? ` · ${formatMXN(p.monto)}` : ''}
              </span>
            </div>
          ))}
          <div className="recibo-row"><span>Fecha del pago</span><span>{formatEventDate(pago.fecha, 'long')}</span></div>
          <div className="recibo-row"><span>Cliente</span><span>{quote.client?.nombre}</span></div>
          {quote.client?.numeroReferencia != null && (
            <div className="recibo-row"><span>N.º de referencia</span><span>{quote.client.numeroReferencia}</span></div>
          )}
          <div className="recibo-row"><span>Evento</span><span>{quote.eventType?.nombre} · {formatEventDate(quote.fechaEvento)}</span></div>
          {/* El código del evento, que es el principal: cómo estaba el evento el
              día que se imprimió. Si el evento se mueve, el próximo recibo dirá
              otro, y el sistema sabe que los dos son el mismo evento (guarda cada
              código que tuvo). El folio interno amarra el recibo aunque cambie. */}
          {quote.etiqueta && (
            <div className="recibo-row"><span>Código del evento</span><span>{quote.etiqueta}</span></div>
          )}
          <div className="recibo-row"><span>Folio interno</span><span>{quote.folio}</span></div>
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
