import { useState, type ReactNode } from 'react';
import { API_BASE } from '../lib/api.ts';
import { formatFolio } from '@hsa/shared';
import { Button, MoneyInput, TextInput, SelectInput, Field } from './ui.tsx';
import { FormasPagoCampo, errorFormas, formasEnFormData, formasIniciales } from './FormasPagoCampo.tsx';
import { STATUS_LABEL } from '../lib/status.ts';
import { FolioPapelCampo, folioPapelParaEnviar } from './FolioPapelCampo.tsx';
import { NotasCampo } from './NotasPago.tsx';
import type { Payment, PaymentConcept, QuoteStatus } from '../lib/types.ts';

/**
 * Los conceptos que se pueden elegir, con la etiqueta que ve la vendedora. Son
 * los del BI (5-oct-2026): sin "complemento", que solo sigue en la etiqueta de
 * pagos viejos.
 */
export const CONCEPTOS: { value: PaymentConcept; label: string }[] = [
  { value: 'anticipo', label: 'Anticipo' },
  { value: 'aCuenta', label: 'A cuenta' },
  { value: 'finiquito', label: 'Finiquito' },
];

/**
 * El formulario de registrar un pago. Es el mismo para la renta y para el
 * banquete (Jorge, 15-oct-2026: "otra sección idéntica"); cambia a qué cuenta va.
 *
 * Se envía multipart (FormData) para poder anexar la foto de comprobante
 * (cámara en tablet o archivo). El backend acepta multipart y JSON.
 */
export function RegistrarPagoForm({
  quoteId,
  isAdmin,
  destino,
  titulo,
  pie,
  onListo,
}: {
  quoteId: string;
  isAdmin: boolean;
  /** `evento` = la renta; `banquete` = alimentos y servicios. */
  destino: 'evento' | 'banquete';
  /** Sin título cuando ya lo pone la sección plegable que lo envuelve. */
  titulo?: ReactNode;
  /** Algo bajo el título (p. ej. el saldo del banquete). */
  pie?: ReactNode;
  onListo: (mensaje: string) => Promise<void> | void;
}) {
  const [monto, setMonto] = useState('');
  const [formas, setFormas] = useState(() => formasIniciales());
  const [concepto, setConcepto] = useState('anticipo');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [referencia, setReferencia] = useState('');
  const [notas, setNotas] = useState('');
  const [folioPapel, setFolioPapel] = useState('');
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const esBanquete = destino === 'banquete';

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const errorDeFormas = errorFormas(formas, Number(monto) || 0);
    if (errorDeFormas) {
      setErr(errorDeFormas);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('monto', monto);
      formasEnFormData(fd, formas);
      fd.set('concepto', concepto);
      fd.set('fecha', fecha);
      if (esBanquete) fd.set('destino', 'banquete');
      if (referencia) fd.set('referencia', referencia);
      if (notas.trim()) fd.set('notas', notas.trim());
      const folio = isAdmin ? folioPapelParaEnviar(folioPapel) : undefined;
      if (folio) fd.set('folioPapel', String(folio));
      if (comprobante) fd.set('comprobante', comprobante);

      const res = await fetch(`${API_BASE}/api/quotes/${quoteId}/payments`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) {
        const cuerpo = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(cuerpo?.error ?? 'No se pudo registrar el pago. Revisa los datos.');
      }
      const body = (await res.json()) as { nuevoEstatus: QuoteStatus | null; payment: Payment };

      setMonto(''); setReferencia(''); setNotas(''); setFolioPapel(''); setComprobante(null); setFileKey((k) => k + 1);
      setFormas(formasIniciales(formas.dividido ? 'transferencia' : formas.forma));
      await onListo(
        `Pago ${esBanquete ? 'del banquete ' : ''}registrado con el folio ${formatFolio(body.payment.folio, body.payment.folioLetra)}.` +
          (body.nuevoEstatus ? ` Estatus actualizado automáticamente a ${STATUS_LABEL[body.nuevoEstatus]}.` : ''),
      );
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : 'No se pudo registrar el pago. Revisa los datos.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {titulo && <h3 className="mb-1 font-display text-xl text-ink">{titulo}</h3>}
      {pie && <div className="mb-4">{pie}</div>}
      <form onSubmit={registrar} className="grid gap-4 sm:grid-cols-2">
        <Field label="Monto (MXN)"><MoneyInput value={monto} onValue={setMonto} required /></Field>
        <Field label="Fecha"><TextInput type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></Field>
        <FormasPagoCampo value={formas} onChange={setFormas} monto={Number(monto) || 0} />
        {/* El concepto se DEDUCE del saldo. En la renta, lo que se elige aquí solo
            se usa en los eventos SIN plan de pagos; en el banquete siempre se
            deduce (el primero es anticipo; el que lo completa, finiquito). */}
        {esBanquete ? (
          <Field label="Concepto" hint="Se deduce solo: el primero es anticipo y el que completa el banquete, finiquito.">
            <TextInput value="Se deduce del saldo del banquete" disabled readOnly />
          </Field>
        ) : (
          <Field
            label="Concepto"
            hint="Se deduce del saldo. Solo se usa tal cual si el evento no tiene plan de pagos."
          >
            <SelectInput value={concepto} onChange={(e) => setConcepto(e.target.value)}>
              {CONCEPTOS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </SelectInput>
          </Field>
        )}
        <Field label="Referencia (opcional)"><TextInput value={referencia} onChange={(e) => setReferencia(e.target.value)} /></Field>
        <Field label="Comprobante (foto, opcional)" hint="En tablet abre la cámara.">
          <input
            key={fileKey}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setComprobante(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-charcoal file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-2 file:text-sm file:text-cream hover:file:bg-ink-700"
          />
        </Field>
        {isAdmin && <FolioPapelCampo value={folioPapel} onChange={setFolioPapel} />}
        <div className="sm:col-span-2">
          <NotasCampo value={notas} onChange={setNotas} />
        </div>
        <div className="sm:col-span-2">
          {err && <p className="mb-2 text-sm text-wine">{err}</p>}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Guardando…' : esBanquete ? 'Guardar pago del banquete' : 'Guardar pago'}
          </Button>
        </div>
      </form>
    </>
  );
}
