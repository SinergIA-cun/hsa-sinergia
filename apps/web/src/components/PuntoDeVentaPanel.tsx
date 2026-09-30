import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Receipt, ShoppingBag } from 'lucide-react';
import { describirFormasPago, formatFolio, PRODUCTO_INFO } from '@hsa/shared';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import { Button, Card, Field, MoneyInput, TextInput } from './ui.tsx';
import { FormasPagoCampo, errorFormas, formasEnFormData, formasIniciales } from './FormasPagoCampo.tsx';
import { apiErrorMessage } from './admin/shared.tsx';
import type { CuentaEvento, ProductoPuntoDeVenta } from '../lib/types.ts';

/**
 * El punto de venta del evento.
 *
 * Lo que se vende después de contratar se carga aquí, como en una caja: "durante
 * el evento quieren extender, entonces agrego un producto a su cuenta que es
 * horas extras y pongo cuántas fueron" (el dueño). Multas, daños, invitados de
 * más y gastos imprevistos, igual.
 *
 * NO cambia el valor del evento: el contrato y su plan de pagos quedan como se
 * firmaron. La cuenta tiene su propio saldo y sus propios cobros, cada uno con
 * su folio de la serie I, y todo le llega al BI.
 */

const hoy = () => new Date().toISOString().slice(0, 10);

export function PuntoDeVentaPanel({
  quoteId,
  publicToken,
  cuenta,
  productos,
  isAdmin,
  readOnly = false,
}: {
  quoteId: string;
  publicToken: string;
  cuenta: CuentaEvento;
  productos: ProductoPuntoDeVenta[];
  isAdmin: boolean;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const refrescar = async () => {
    await qc.invalidateQueries({ queryKey: ['quote', quoteId] });
    await qc.invalidateQueries({ queryKey: ['quotes'] });
  };

  const cargosVivos = cuenta.cargos.filter((c) => !c.anuladoAt);

  async function anular(cargoId: string) {
    const motivo = window.prompt('Motivo de la anulación:');
    if (!motivo) return;
    try {
      await api.patch(`/api/quotes/${quoteId}/cargos/${cargoId}/anular`, { motivo });
      await refrescar();
    } catch (e) {
      window.alert(apiErrorMessage(e, 'No se pudo anular el cargo.'));
    }
  }

  async function anularCobro(paymentId: string) {
    const motivo = window.prompt('Motivo de la anulación del cobro:');
    if (!motivo) return;
    try {
      await api.patch(`/api/quotes/${quoteId}/payments/${paymentId}/anular`, { motivo });
      await refrescar();
    } catch (e) {
      window.alert(apiErrorMessage(e, 'No se pudo anular el cobro.'));
    }
  }

  return (
    <Card className="mt-8 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 font-display text-xl text-ink">
            <ShoppingBag size={18} className="text-gold" /> Punto de venta · cuenta del evento
          </h3>
          <p className="mt-1 max-w-xl text-sm text-charcoal-soft">
            Lo que se agrega después de contratar: horas extra, invitados de más, multas, daños,
            gastos imprevistos. <strong>No cambia el valor del evento</strong>; se cobra aparte.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <Cifra etiqueta="Cargado" valor={cuenta.total} />
          <Cifra etiqueta="Cobrado" valor={cuenta.pagado} />
          <Cifra etiqueta="Por cobrar" valor={cuenta.saldo} resaltar />
        </div>
      </div>

      {!readOnly && <AgregarCargo quoteId={quoteId} productos={productos} onListo={refrescar} />}

      {cuenta.cargos.length > 0 && (
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-cream-300 text-left text-[0.65rem] uppercase tracking-wide text-charcoal-soft">
              <th className="py-2 font-medium">Fecha</th>
              <th className="py-2 font-medium">Concepto</th>
              <th className="py-2 text-right font-medium">Cantidad</th>
              <th className="py-2 text-right font-medium">Precio</th>
              <th className="py-2 text-right font-medium">Total</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-cream-200">
            {cuenta.cargos.map((c) => (
              <tr key={c.id} className={c.anuladoAt ? 'text-charcoal-soft line-through' : ''}>
                <td className="py-2 pr-3">{formatEventDate(c.fecha)}</td>
                <td className="py-2 pr-3">
                  {c.descripcion}
                  {c.descripcion !== PRODUCTO_INFO[c.producto].nombre && (
                    <span className="block text-xs text-charcoal-soft">{PRODUCTO_INFO[c.producto].nombre}</span>
                  )}
                  {c.anuladoAt && c.motivoAnulacion && (
                    <span className="block text-xs text-wine no-underline">Anulado: {c.motivoAnulacion}</span>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">{c.cantidad}</td>
                <td className="py-2 text-right tabular-nums">{formatMXN(c.precioUnitario)}</td>
                <td className="py-2 text-right tabular-nums">{formatMXN(c.total)}</td>
                <td className="py-2 pl-3 text-right">
                  {isAdmin && !readOnly && !c.anuladoAt && (
                    <button type="button" onClick={() => anular(c.id)} className="text-xs text-wine hover:underline">
                      Anular
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!readOnly && cargosVivos.length > 0 && cuenta.saldo > 0 && (
        // `key`: al cambiar el saldo (otro cargo, un cobro) el formulario se arma
        // de nuevo con el monto pendiente, en vez de quedarse con el anterior.
        <CobrarCuenta key={cuenta.saldo} quoteId={quoteId} saldo={cuenta.saldo} onListo={refrescar} />
      )}

      {cuenta.pagos.length > 0 && (
        <div className="mt-6">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">Cobros de la cuenta</h4>
          <ul className="divide-y divide-cream-200 text-sm">
            {cuenta.pagos.map((p) => (
              <li
                key={p.id}
                className={`flex flex-wrap items-center justify-between gap-2 py-2 ${p.anuladoAt ? 'line-through opacity-50' : ''}`}
              >
                <span>
                  <span className="font-medium text-charcoal-soft">{formatFolio(p.folio)}</span> ·{' '}
                  {formatEventDate(p.fecha)} · {describirFormasPago(p)}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{formatMXN(p.monto)}</span>
                  {!p.anuladoAt && (
                    <a
                      href={`/c/${publicToken}/recibo/${p.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-gold hover:underline"
                    >
                      <Receipt size={12} /> Ver recibo
                    </a>
                  )}
                  {isAdmin && !readOnly && !p.anuladoAt && (
                    <button type="button" onClick={() => anularCobro(p.id)} className="text-xs text-wine hover:underline">
                      Anular
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Cifra({ etiqueta, valor, resaltar = false }: { etiqueta: string; valor: number; resaltar?: boolean }) {
  return (
    <div>
      <p className="text-[0.65rem] uppercase tracking-wide text-charcoal-soft">{etiqueta}</p>
      <p className={`font-display text-xl tabular-nums ${resaltar && valor > 0 ? 'text-gold' : 'text-ink'}`}>
        {formatMXN(valor)}
      </p>
    </div>
  );
}

/** Elegir el producto, cuántos y a qué precio. El precio sugerido se puede corregir. */
function AgregarCargo({
  quoteId,
  productos,
  onListo,
}: {
  quoteId: string;
  productos: ProductoPuntoDeVenta[];
  onListo: () => Promise<void>;
}) {
  const [elegido, setElegido] = useState<ProductoPuntoDeVenta | null>(null);
  const [cantidad, setCantidad] = useState('1');
  const [precio, setPrecio] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function elegir(p: ProductoPuntoDeVenta) {
    setElegido(p);
    setCantidad('1');
    setPrecio(p.precioSugerido != null ? String(p.precioSugerido) : '');
    setDescripcion('');
    setError('');
  }

  const total = (Number(cantidad) || 0) * (Number(precio) || 0);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!elegido) return;
    setError('');
    if (!(Number(cantidad) > 0) || !(Number(precio) > 0)) {
      setError('Captura cuántos y el precio.');
      return;
    }
    if (elegido.pideDescripcion && !descripcion.trim()) {
      setError('Describe qué pasó: sin descripción no se puede cobrar ni aclarar después.');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/quotes/${quoteId}/cargos`, {
        producto: elegido.producto,
        cantidad: Number(cantidad),
        precioUnitario: Number(precio),
        descripcion: descripcion.trim() || undefined,
        fecha,
      });
      setElegido(null);
      await onListo();
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo agregar a la cuenta.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-2">
        {productos.map((p) => (
          <button
            key={p.producto}
            type="button"
            onClick={() => elegir(p)}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
              elegido?.producto === p.producto
                ? 'border-gold bg-gold/10 text-ink'
                : 'border-ink/12 bg-white/60 text-ink hover:border-ink/30'
            }`}
          >
            <span className="block font-medium">{p.nombre}</span>
            <span className="block text-xs text-charcoal-soft">
              {p.precioSugerido != null ? `${formatMXN(p.precioSugerido)} c/u` : 'Precio a capturar'}
            </span>
          </button>
        ))}
      </div>

      {elegido && (
        <form onSubmit={guardar} className="mt-4 grid gap-3 rounded-lg border border-cream-300 bg-cream-50 p-4 sm:grid-cols-4">
          <Field label={`Cuántos (${elegido.unidad})`}>
            <TextInput
              inputMode="numeric"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field
            label="Precio c/u (con IVA)"
            hint={elegido.precio === 'horaDeRenta' ? 'Sugerido: 5% de la renta del evento.' : undefined}
          >
            <MoneyInput value={precio} onValue={setPrecio} />
          </Field>
          <Field label="Fecha">
            <TextInput type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <p className="font-display text-2xl tabular-nums text-ink">{formatMXN(total)}</p>
          </div>
          <div className="sm:col-span-4">
            <Field label={elegido.pideDescripcion ? 'Qué pasó' : 'Descripción (opcional)'}>
              <TextInput
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder={elegido.pideDescripcion ? 'ej. Rompieron dos sillas Tiffany' : elegido.nombre}
              />
            </Field>
          </div>
          {error && <p className="text-sm text-wine sm:col-span-4">{error}</p>}
          <div className="flex gap-2 sm:col-span-4">
            <Button type="submit" variant="gold" disabled={busy}>
              {busy ? 'Agregando…' : 'Agregar a la cuenta'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setElegido(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Cobrar lo que debe la cuenta, con las mismas formas de pago que cualquier cobro. */
function CobrarCuenta({ quoteId, saldo, onListo }: { quoteId: string; saldo: number; onListo: () => Promise<void> }) {
  const [monto, setMonto] = useState(String(saldo));
  const [formas, setFormas] = useState(() => formasIniciales('tarjetaCredito'));
  const [fecha, setFecha] = useState(hoy);
  const [referencia, setReferencia] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

  async function cobrar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setOk('');
    const n = Number(monto);
    if (!(n > 0)) {
      setError('Captura el monto a cobrar.');
      return;
    }
    const errorDeFormas = errorFormas(formas, n);
    if (errorDeFormas) {
      setError(errorDeFormas);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('monto', String(n));
      fd.set('fecha', fecha);
      fd.set('destino', 'cargos');
      formasEnFormData(fd, formas);
      if (referencia.trim()) fd.set('referencia', referencia.trim());
      const res = await fetch(`${apiBase}/api/quotes/${quoteId}/payments`, { method: 'POST', credentials: 'include', body: fd });
      const cuerpo = (await res.json().catch(() => null)) as { error?: string; payment?: { folio: number } } | null;
      if (!res.ok) throw new Error(cuerpo?.error ?? 'No se pudo registrar el cobro.');
      setOk(`Cobro registrado con el folio ${formatFolio(cuerpo?.payment?.folio)}.`);
      setFormas(formasIniciales('tarjetaCredito'));
      setReferencia('');
      await onListo();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el cobro.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={cobrar} className="mt-6 grid gap-3 border-t border-cream-200 pt-5 sm:grid-cols-2">
      <h4 className="font-display text-lg text-ink sm:col-span-2">Cobrar la cuenta</h4>
      <Field label="Monto" hint={`Debe ${formatMXN(saldo)}.`}>
        <MoneyInput value={monto} onValue={setMonto} />
      </Field>
      <Field label="Fecha">
        <TextInput type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </Field>
      <FormasPagoCampo value={formas} onChange={setFormas} monto={Number(monto) || 0} />
      <Field label="Referencia (opcional)">
        <TextInput value={referencia} onChange={(e) => setReferencia(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-wine sm:col-span-2">{error}</p>}
      {ok && <p className="text-sm text-emerald-700 sm:col-span-2">{ok}</p>}
      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Cobrando…' : 'Cobrar'}
        </Button>
      </div>
    </form>
  );
}
