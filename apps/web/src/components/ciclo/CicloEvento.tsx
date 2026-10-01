import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarClock, CalendarOff, RotateCcw } from 'lucide-react';
import { formatMXN } from '../../lib/money.ts';
import { formatEventDate, formatTimestamp } from '../../lib/date.ts';
import { DESPLAZADAS_KEY } from '../../lib/desplazadas.ts';
import { STATUS_LABEL } from '../../lib/status.ts';
import { Button, Card } from '../ui.tsx';
import type { Quote, ResumenCancelacion } from '../../lib/types.ts';
import { CancelarEventoModal } from './CancelarEventoModal.tsx';
import { ReprogramarModal } from './ReprogramarModal.tsx';
import { StandbyModal } from './StandbyModal.tsx';

type Abierto = 'mover' | 'standby' | 'cancelar' | null;

/**
 * Lo que se puede hacer con el evento fuera del camino normal: moverlo de fecha,
 * dejarlo sin fecha (standby) o cancelarlo. Si ya está en standby o cancelado,
 * lo dice arriba de todo y ofrece cómo salir.
 */
export function CicloEvento({
  quote,
  pagado,
  cancelacion,
  isAdmin,
}: {
  quote: Quote;
  /** Lo pagado (neto) a la renta: es la base de lo que se devuelve al cancelar. */
  pagado: number;
  cancelacion: ResumenCancelacion | null | undefined;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState<Abierto>(null);

  async function alTerminar() {
    setAbierto(null);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['quote', quote.id] }),
      qc.invalidateQueries({ queryKey: ['quotes'] }),
      qc.invalidateQueries({ queryKey: ['sin-fecha'] }),
      qc.invalidateQueries({ queryKey: ['agenda'] }),
      // Soltar o tomar una fecha cambia quién queda desplazado.
      qc.invalidateQueries({ queryKey: DESPLAZADAS_KEY }),
    ]);
  }

  const enStandby = quote.status === 'standby';
  const cancelado = quote.status === 'cancelada';
  // Con pagos solo cancela un admin (la API lo exige igual).
  const puedeCancelar = !cancelado && (pagado === 0 || isAdmin);

  return (
    <>
      {enStandby && (
        <Franja tono="standby" icono={<CalendarOff size={18} />}>
          <p className="font-medium">
            En standby: sin fecha{quote.standbyDesde && ` desde el ${formatTimestamp(quote.standbyDesde)}`}.
          </p>
          <p className="mt-0.5 text-sm">
            Tenía el {formatEventDate(quote.fechaEvento, 'long')}, que ya quedó libre para otro evento.
            {quote.standbyMotivo && <> Motivo: {quote.standbyMotivo}</>}
          </p>
          <p className="mt-0.5 text-xs opacity-80">
            Su dinero sigue aquí. Al reprogramar vuelve a{' '}
            {quote.statusPrevio ? STATUS_LABEL[quote.statusPrevio].toLowerCase() : 'borrador'}.
          </p>
        </Franja>
      )}

      {cancelado && (
        <Franja tono="cancelado" icono={<Ban size={18} />}>
          <p className="font-medium">
            Evento cancelado{cancelacion && ` el ${formatTimestamp(cancelacion.fecha)}`}.
            {cancelacion?.motivo && <span className="font-normal"> Motivo: {cancelacion.motivo}</span>}
          </p>
          {cancelacion && cancelacion.pagado > 0 && (
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <Dato etiqueta="Pagado">{formatMXN(cancelacion.pagado)}</Dato>
              <Dato etiqueta={`Se devuelve (${cancelacion.porcentaje}%)`}>{formatMXN(cancelacion.devolver)}</Dato>
              <Dato etiqueta="Ya devuelto">{formatMXN(cancelacion.devuelto)}</Dato>
              <Dato etiqueta="Se retiene">{formatMXN(cancelacion.retenido)}</Dato>
            </dl>
          )}
          {cancelacion && cancelacion.pendiente > 0 && (
            <p className="mt-2 text-sm font-medium">
              Falta devolver {formatMXN(cancelacion.pendiente)}: regístralo abajo, en Devoluciones.
            </p>
          )}
        </Franja>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {enStandby && (
          <Button variant="gold" onClick={() => setAbierto('mover')}>
            <CalendarClock size={15} /> Reprogramar
          </Button>
        )}
        {cancelado && isAdmin && (
          <Button variant="outline" onClick={() => setAbierto('mover')}>
            <RotateCcw size={15} /> Reactivar
          </Button>
        )}
        {!enStandby && !cancelado && (
          <>
            <Button variant="outline" onClick={() => setAbierto('mover')}>
              <CalendarClock size={15} /> Mover fecha
            </Button>
            <Button variant="outline" onClick={() => setAbierto('standby')}>
              <CalendarOff size={15} /> Poner en standby
            </Button>
          </>
        )}
        {puedeCancelar && (
          <Button variant="outline" onClick={() => setAbierto('cancelar')} className="text-wine hover:border-wine/50">
            <Ban size={15} /> Cancelar evento
          </Button>
        )}
      </div>

      {abierto === 'mover' && (
        <ReprogramarModal
          quote={quote}
          titulo={enStandby ? 'Reprogramar' : cancelado ? 'Reactivar el evento' : 'Mover fecha'}
          onClose={() => setAbierto(null)}
          onDone={alTerminar}
        />
      )}
      {abierto === 'standby' && <StandbyModal quote={quote} onClose={() => setAbierto(null)} onDone={alTerminar} />}
      {abierto === 'cancelar' && (
        <CancelarEventoModal quote={quote} pagado={pagado} onClose={() => setAbierto(null)} onDone={alTerminar} />
      )}
    </>
  );
}

function Franja({ tono, icono, children }: { tono: 'standby' | 'cancelado'; icono: ReactNode; children: ReactNode }) {
  const estilo = tono === 'standby' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-wine/30 bg-wine/5 text-wine';
  return (
    <div role="status" className={`mb-4 flex gap-3 rounded-xl border px-4 py-3 ${estilo}`}>
      <span className="mt-0.5 shrink-0">{icono}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[0.7rem] uppercase tracking-wide opacity-75">{etiqueta}</dt>
      <dd className="font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

/** El marco de los tres modales: fondo, tarjeta, título y cierre con Escape. */
export function Modal({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/40 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <Card className="w-full max-w-lg space-y-4 p-6">
        <h2 className="font-display text-xl text-ink">{titulo}</h2>
        {children}
      </Card>
    </div>
  );
}

/** Mensaje de la API, o uno genérico. */
export function mensajeDeError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

