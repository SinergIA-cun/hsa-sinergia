import { useState, type FormEvent } from 'react';
import { AlertTriangle, Copy } from 'lucide-react';
import { STATUS_LABEL } from '../../../lib/status.ts';
import { Button, Field, TextInput } from '../../ui.tsx';
import type { ImpactoCatalogo, PriceList, QuoteStatus } from '../../../lib/types.ts';
import { apiErrorMessage } from '../shared.tsx';

/** Los estatus que ya tienen dinero encima. Espeja `ESTATUS_COMPROMETIDOS` de la API. */
const COMPROMETIDOS: QuoteStatus[] = ['formalizada', 'complementada', 'liquidada'];

type Renglon = { status: QuoteStatus; n: number; comprometida: boolean };

/** El desglose ordenado: primero las comprometidas, que son las que duelen. */
function renglones(impacto: ImpactoCatalogo): Renglon[] {
  const entradas = Object.entries(impacto.porEstatus) as [QuoteStatus, number][];
  return entradas
    .filter(([, n]) => n > 0)
    .map(([status, n]) => ({ status, n, comprometida: COMPROMETIDOS.includes(status) }))
    .sort((a, b) => Number(b.comprometida) - Number(a.comprometida) || b.n - a.n);
}

/**
 * El aviso de impacto de editar un catálogo en uso.
 *
 * **No bloquea nada**: el dueño eligió la flexibilidad a conciencia. Lo que hace
 * es que la elección sea informada, y para eso el total no alcanza —represiar un
 * borrador es rutina; represiar una liquidada es un problema con un cliente que
 * ya pagó—, así que enseña el DESGLOSE POR ESTATUS y ofrece la salida (clonar)
 * en el mismo lugar donde se toma la decisión.
 *
 * Y dice la parte que nadie adivina: los totales guardados NO se mueven. El
 * represiado solo ocurre si alguien reedita la cotización después.
 */
export function AvisoImpacto({
  impacto,
  onClonar,
}: {
  impacto: ImpactoCatalogo;
  onClonar: (datos: { nombre: string; anio: number; incrementoPct?: number }) => Promise<PriceList>;
}) {
  const [abierto, setAbierto] = useState(false);

  if (impacto.total === 0) {
    return (
      <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        Ninguna cotización usa <strong>{impacto.nombre}</strong> todavía. Puedes editarlo con toda
        libertad: no hay nada que represiar.
      </p>
    );
  }

  const desglose = renglones(impacto);
  const sueltas = impacto.total - impacto.comprometidas;

  return (
    <div className="space-y-3 rounded-lg border border-gold/40 bg-gold/5 px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-gold" />
        <div className="space-y-2 text-sm text-ink">
          <p>
            Este catálogo lo usan <strong>{impacto.total}</strong>{' '}
            {impacto.total === 1 ? 'cotización' : 'cotizaciones'}.
          </p>
          <ul className="space-y-0.5">
            {desglose.map((r) => (
              <li
                key={r.status}
                className={r.comprometida ? 'font-medium text-wine' : 'text-charcoal-soft'}
              >
                {/* El respaldo no es cosmético: un estatus nuevo en la base y
                    todavía no en el front dejaría `undefined.toLowerCase()`. */}
                {r.n} {(STATUS_LABEL[r.status] ?? r.status).toLowerCase()}
                {r.comprometida ? ' — ya tiene dinero encima' : ''}
              </li>
            ))}
          </ul>
          {impacto.comprometidas > 0 ? (
            <p>
              <strong>{impacto.comprometidas}</strong>{' '}
              {impacto.comprometidas === 1 ? 'está comprometida' : 'están comprometidas'}{' '}
              (formalizada, con complemento o liquidada)
              {sueltas > 0 && `; las otras ${sueltas} todavía no`}.
            </p>
          ) : (
            <p>Ninguna está comprometida: cambiar precios aquí es rutina.</p>
          )}
          {/* Es lo que nadie adivina, y lo que hace que el aviso no sea una
              amenaza sino una advertencia: nada cambia solo. */}
          <p className="rounded bg-cream-200/80 px-2.5 py-2">
            Sus totales guardados <strong>no cambian</strong>. Pero si alguien reedita una de ellas,
            se recalculará con los precios nuevos. Si lo que quieres es corregir el catálogo del año
            que viene, <strong>clónalo</strong> en vez de editar este.
          </p>
        </div>
      </div>

      {abierto ? (
        <ClonarForm impacto={impacto} onClonar={onClonar} onCancelar={() => setAbierto(false)} />
      ) : (
        <Button
          type="button"
          variant="outline"
          className="px-2.5 py-1.5 text-xs"
          onClick={() => setAbierto(true)}
        >
          <Copy size={13} /> Clonar este catálogo en vez de editarlo
        </Button>
      )}
    </div>
  );
}

/** La salida que ofrece el aviso, ahí mismo: un catálogo nuevo clonado de este. */
function ClonarForm({
  impacto,
  onClonar,
  onCancelar,
}: {
  impacto: ImpactoCatalogo;
  onClonar: (datos: { nombre: string; anio: number; incrementoPct?: number }) => Promise<PriceList>;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [anio, setAnio] = useState('');
  const [incrementoPct, setIncrementoPct] = useState('');
  const [error, setError] = useState('');
  const [pendiente, setPendiente] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const anioNum = Number(anio);
    if (!nombre.trim() || !Number.isInteger(anioNum) || anioNum < 2000 || anioNum > 2100) {
      setError('Pon un nombre y un año entre 2000 y 2100.');
      return;
    }
    if (incrementoPct.trim() && Number.isNaN(Number(incrementoPct))) {
      setError('El porcentaje debe ser un número.');
      return;
    }
    setError('');
    setPendiente(true);
    try {
      await onClonar({
        nombre: nombre.trim(),
        anio: anioNum,
        ...(incrementoPct.trim() ? { incrementoPct: Number(incrementoPct) } : {}),
      });
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo clonar el catálogo.'));
    } finally {
      setPendiente(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg bg-cream-100 px-3 py-3">
      <p className="text-xs text-charcoal-soft">
        Se copia todo lo de <strong>{impacto.nombre}</strong> a un catálogo nuevo e{' '}
        <strong>inactivo</strong>, y el editor se pasa a él. Las {impacto.total} cotizaciones de{' '}
        {impacto.nombre} quedan intactas.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Nombre">
          <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="2029" />
        </Field>
        <Field label="Año">
          <TextInput
            type="number"
            min={2000}
            max={2100}
            value={anio}
            onChange={(e) => setAnio(e.target.value)}
            placeholder="2029"
          />
        </Field>
        <Field label="Incremento (%)">
          <TextInput
            type="number"
            step="0.01"
            value={incrementoPct}
            onChange={(e) => setIncrementoPct(e.target.value)}
            placeholder="0"
          />
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-xs text-wine">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          className="px-2.5 py-1.5 text-xs"
          onClick={onCancelar}
          disabled={pendiente}
        >
          Cancela
        </Button>
        <Button type="submit" variant="gold" className="px-2.5 py-1.5 text-xs" disabled={pendiente}>
          <Copy size={13} /> {pendiente ? 'Clonando…' : 'Clonar y editar el nuevo'}
        </Button>
      </div>
    </form>
  );
}
