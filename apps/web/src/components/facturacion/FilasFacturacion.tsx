import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileDown, Loader2, Receipt, XCircle } from 'lucide-react';
import { formatMXN } from '../../lib/money.ts';
import { formatEventDate } from '../../lib/date.ts';
import { Button } from '../ui.tsx';

/** Lo que el PAC dice de una factura (sincronizado 3 veces al día). */
export interface VistaPac {
  uuid: string;
  fecha: string;
  serieFolio: string | null;
  total: number;
  receptorRfc: string | null;
  receptorNombre: string | null;
  estatus: string | null;
  cancelada: boolean;
  origen: string;
  tipoComprobante: string | null;
}

export interface FilaPago {
  pagoId: string;
  quoteId: string;
  eventoCodigo: string | null;
  cliente: string | null;
  folioTexto: string;
  fecha: string;
  destino: string;
  montoPago: number;
  montoFacturable: number;
  receptor: { tipo: 'cliente' | 'publicoGeneral'; rfc: string; nombre: string };
  pidioFactura: boolean;
  faltantes: string[];
  facturaUuid: string | null;
  facturadoAt: string | null;
  motivo: string | null;
  pac?: VistaPac | null;
}

/** Estado de un pago mientras se factura desde esta pantalla. */
export type EstadoEnvio = { tipo: 'enCurso' } | { tipo: 'ok'; uuid: string } | { tipo: 'error'; mensaje: string };

const DESTINO: Record<string, string> = { evento: 'Renta', cargos: 'Cuenta del evento', banquete: 'Banquete' };

const pdfDe = (uuid: string) => `/api/facturacion/facturas/${encodeURIComponent(uuid)}/pdf`;

function Evento({ p }: { p: FilaPago }) {
  return (
    <div className="min-w-0">
      <Link to={`/eventos/${p.quoteId}`} className="block truncate font-medium text-ink underline-offset-2 hover:underline">
        {p.eventoCodigo ?? 'Evento'}
      </Link>
      <p className="truncate text-xs text-charcoal-soft">
        {p.cliente ?? '—'} · Recibo {p.folioTexto} · {DESTINO[p.destino] ?? p.destino}
      </p>
    </div>
  );
}

/** "de $5,000, sin $1,000 en efectivo" cuando el pago fue mixto. */
function Monto({ p }: { p: FilaPago }) {
  const efectivo = Math.round((p.montoPago - p.montoFacturable) * 100) / 100;
  return (
    <div className="text-right tabular-nums">
      <p className="font-display text-lg text-ink">{formatMXN(p.montoFacturable)}</p>
      {efectivo > 0 && <p className="text-[0.7rem] text-charcoal-soft">sin {formatMXN(efectivo)} en efectivo</p>}
    </div>
  );
}

function AQuien({ p }: { p: FilaPago }) {
  if (p.receptor.tipo === 'cliente') {
    return (
      <p className="text-xs text-charcoal">
        <span className="font-medium">{p.receptor.nombre}</span> · {p.receptor.rfc}
      </p>
    );
  }
  return (
    <div className="text-xs text-charcoal">
      Público en general
      {p.pidioFactura && p.faltantes.length > 0 && (
        <p className="mt-0.5 flex items-start gap-1 text-wine">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          Pidió factura pero faltan: {p.faltantes.join(', ')}
        </p>
      )}
    </div>
  );
}

/** Un pago ya facturado, con lo que dice el PAC. */
export function FilaFacturado({ p }: { p: FilaPago }) {
  const cancelada = p.pac?.cancelada;
  return (
    <li className="grid gap-3 py-4 sm:grid-cols-[6.5rem_minmax(0,1.5fr)_minmax(0,1fr)_8rem_auto] sm:items-center">
      <p className="text-xs tabular-nums text-charcoal-soft">{formatEventDate(p.fecha)}</p>
      <Evento p={p} />
      <div>
        {p.pac ? (
          <p className="text-xs text-charcoal">
            <span className="font-medium">{p.pac.receptorNombre ?? p.receptor.nombre}</span> · {p.pac.receptorRfc ?? p.receptor.rfc}
          </p>
        ) : (
          <AQuien p={p} />
        )}
        <p className="mt-0.5 flex items-center gap-1 text-[0.7rem]">
          {cancelada ? (
            <span className="inline-flex items-center gap-1 font-semibold text-wine">
              <XCircle size={12} /> Cancelada en el PAC
            </span>
          ) : p.pac ? (
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <CheckCircle2 size={12} /> {p.pac.serieFolio ? `${p.pac.serieFolio} · ` : ''}vigente
            </span>
          ) : (
            <span className="text-charcoal-soft">Sellada a mano; aún no la vemos en el PAC</span>
          )}
        </p>
      </div>
      <Monto p={p} />
      {p.facturaUuid ? (
        <a
          href={pdfDe(p.facturaUuid)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 justify-self-start rounded-lg px-2 py-1 text-xs font-medium text-ink hover:bg-ink/5 sm:justify-self-end"
          title={`Folio fiscal ${p.facturaUuid}`}
        >
          <FileDown size={14} /> PDF
        </a>
      ) : (
        <span />
      )}
    </li>
  );
}

/** Un pago pendiente, con su botón "Facturar este pago". */
export function FilaPendiente({
  p,
  estado,
  bloqueado,
  onFacturar,
}: {
  p: FilaPago;
  estado: EstadoEnvio | undefined;
  bloqueado: boolean;
  onFacturar: () => void;
}) {
  return (
    <li
      className={`grid gap-3 py-4 transition-colors sm:grid-cols-[6.5rem_minmax(0,1.5fr)_minmax(0,1fr)_8rem_11rem] sm:items-center ${
        estado?.tipo === 'ok' ? 'opacity-60' : ''
      }`}
    >
      <p className="text-xs tabular-nums text-charcoal-soft">{formatEventDate(p.fecha)}</p>
      <Evento p={p} />
      <AQuien p={p} />
      <Monto p={p} />
      <div className="sm:text-right">
        {estado?.tipo === 'enCurso' && (
          <span className="inline-flex items-center gap-1.5 text-xs text-charcoal-soft">
            <Loader2 size={14} className="animate-spin" /> Facturando…
          </span>
        )}
        {estado?.tipo === 'ok' && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <CheckCircle2 size={14} /> Facturado
          </span>
        )}
        {(!estado || estado.tipo === 'error') && (
          <Button type="button" variant="outline" className="px-3 py-1.5 text-xs" disabled={bloqueado} onClick={onFacturar}>
            <Receipt size={13} /> Facturar este pago
          </Button>
        )}
        {estado?.tipo === 'error' && <p className="mt-1 text-[0.7rem] text-wine" role="alert">{estado.mensaje}</p>}
      </div>
    </li>
  );
}

/** Factura que el PAC tiene y que no sale de ningún pago de la app. */
export function FilaFueraDeLaApp({ f }: { f: VistaPac }) {
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[6.5rem_minmax(0,1fr)_8rem_auto] sm:items-center">
      <p className="text-xs tabular-nums text-charcoal-soft">{formatEventDate(f.fecha.slice(0, 10))}</p>
      <div className="min-w-0 text-xs text-charcoal">
        <p className="truncate font-medium">{f.receptorNombre ?? '—'} · {f.receptorRfc ?? '—'}</p>
        <p className="text-[0.7rem] text-charcoal-soft">
          {f.serieFolio ?? 'Sin serie'} · {f.cancelada ? <span className="font-semibold text-wine">Cancelada</span> : 'vigente'}
          {f.tipoComprobante && !/^(ingreso|factura)$/i.test(f.tipoComprobante) && (
            <span className="ml-1 rounded bg-ink/10 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-ink">
              {f.tipoComprobante === 'Pago' ? 'Complemento de pago' : f.tipoComprobante === 'Egreso' ? 'Nota de crédito' : f.tipoComprobante}
            </span>
          )}
        </p>
      </div>
      <p className="text-right font-display text-lg tabular-nums text-ink">{formatMXN(f.total)}</p>
      <a
        href={pdfDe(f.uuid)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 justify-self-start rounded-lg px-2 py-1 text-xs font-medium text-ink hover:bg-ink/5 sm:justify-self-end"
      >
        <FileDown size={14} /> PDF
      </a>
    </li>
  );
}
