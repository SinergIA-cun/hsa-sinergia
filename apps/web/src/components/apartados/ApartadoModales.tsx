import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, MessageCircle, PartyPopper, Phone, Unlock, X } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { apiErrorMessage } from '../admin/shared.tsx';
import { formatEventDate } from '../../lib/date.ts';
import { whatsappUrl } from '../../lib/share.ts';
import { Button, Card, Field, SelectInput, TextInput } from '../ui.tsx';
import type { ApartadoRapido } from '../../lib/types.ts';

/** El contador de días, del color de la urgencia. */
export function Contador({ dias, grande }: { dias: number; grande?: boolean }) {
  const color = dias <= 3 ? 'bg-wine text-cream' : dias <= 7 ? 'bg-gold text-ink' : 'bg-emerald-600 text-cream';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full font-semibold tabular-nums ${color} ${grande ? 'px-3 py-1 text-sm' : 'px-1.5 py-0.5 text-[0.65rem]'}`}
      title={`Quedan ${dias} ${dias === 1 ? 'día' : 'días'}`}
    >
      {dias} {grande ? (dias === 1 ? 'día' : 'días') : 'd'}
    </span>
  );
}

function Marco({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4" role="dialog" aria-modal="true" aria-label={titulo} onClick={onCerrar}>
      <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
      <Card className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-2xl text-ink">{titulo}</h2>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded p-1 text-charcoal-soft hover:bg-ink/5 hover:text-ink">
            <X size={18} />
          </button>
        </div>
        {children}
      </Card>
      </div>
    </div>
  );
}

/**
 * La captura rápida: nombre, teléfono y tipo de evento. La fecha es la del día
 * que se tocó. Al guardar arranca el contador de 15 días.
 */
export function NuevoApartadoModal({
  fecha,
  enFila,
  tope,
  tipos,
  onCerrar,
  onListo,
}: {
  fecha: string;
  enFila: number;
  tope: number;
  tipos: { id: string; nombre: string }[];
  onCerrar: () => void;
  onListo: () => Promise<void> | void;
}) {
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [tipo, setTipo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const llena = enFila >= tope;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/api/apartados-rapidos', { nombre, telefono: telefono.trim() || null, eventTypeId: tipo, fecha });
      await onListo();
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo apartar.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Marco titulo="Nuevo apartado" onCerrar={onCerrar}>
      <p className="text-sm text-charcoal">
        <strong className="text-ink">{formatEventDate(fecha, 'long')}</strong>
        {enFila > 0 ? ` · ya hay ${enFila} en fila (tope ${tope})` : ' · nadie en fila todavía'}
      </p>
      {llena ? (
        <p className="rounded-lg bg-wine/10 px-3 py-2 text-sm text-wine">La fila de ese día está llena ({tope} de {tope}).</p>
      ) : (
        <form onSubmit={guardar} className="space-y-3">
          <Field label="Nombre">
            <TextInput autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          </Field>
          <Field label="Teléfono (opcional)" hint="Se pide al convertirlo en evento.">
            <TextInput type="tel" inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="55 1234 5678" />
          </Field>
          <Field label="Tipo de evento">
            <SelectInput value={tipo} onChange={(e) => setTipo(e.target.value)} required>
              <option value="">Selecciona…</option>
              {tipos.map((t) => (
                <option key={t.id} value={t.id}>{t.nombre}</option>
              ))}
            </SelectInput>
          </Field>
          <p className="text-xs text-charcoal-soft">
            Se le guarda 15 días. Tres días antes te avisamos para confirmar con la persona; si no se confirma, la fecha se libera sola.
          </p>
          {error && <p role="alert" className="text-sm text-wine">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Apartando…' : `Apartar (lugar ${enFila + 1} en la fila)`}</Button>
            <Button type="button" variant="ghost" onClick={onCerrar}>Cancelar</Button>
          </div>
        </form>
      )}
    </Marco>
  );
}

/** Un apartado: quién, su lugar en la fila, el contador y qué hacer con él. */
export function ApartadoDetalleModal({
  apartado: a,
  onCerrar,
  onCambio,
}: {
  apartado: ApartadoRapido;
  onCerrar: () => void;
  onCambio: (mensaje: string) => Promise<void> | void;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [liberando, setLiberando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const wa = whatsappUrl(a.telefono, `Hola ${a.nombre}, le escribimos de Hacienda San Andrés sobre la fecha del ${formatEventDate(a.fecha, 'long')} que nos pidió.`);

  async function accion(url: string, body: unknown, mensaje: string) {
    setError('');
    setBusy(true);
    try {
      await api.post(url, body);
      await onCambio(mensaje);
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo.'));
    } finally {
      setBusy(false);
    }
  }

  const convertir = () =>
    navigate(
      `/eventos/nuevo?${new URLSearchParams({ fecha: a.fecha, nombre: a.nombre, ...(a.telefono ? { telefono: a.telefono } : {}), tipo: a.eventType.id, apartado: a.id }).toString()}`,
    );

  return (
    <Marco titulo={a.nombre} onCerrar={onCerrar}>
      <div className="flex flex-wrap items-center gap-2 text-sm text-charcoal">
        <Contador dias={a.diasRestantes} grande />
        <span>
          {a.posicion === 1 ? 'Primero en la fila' : `Lugar ${a.posicion} en la fila`} · {a.eventType.nombre}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-charcoal-soft">Fecha</dt>
        <dd className="text-ink">{formatEventDate(a.fecha, 'long')}</dd>
        <dt className="text-charcoal-soft">Teléfono</dt>
        <dd className="text-ink">{a.telefono ?? <span className="text-charcoal-soft">Sin teléfono (se pide al convertir)</span>}</dd>
        <dt className="text-charcoal-soft">Vence</dt>
        <dd className="text-ink">
          {formatEventDate(a.vence, 'long')}
          {a.extensiones > 0 && <span className="text-charcoal-soft"> · confirmado {a.extensiones}×</span>}
        </dd>
        <dt className="text-charcoal-soft">Lo capturó</dt>
        <dd className="text-ink">{a.createdBy.nombre}</dd>
      </dl>
      {a.porVencer && (
        <p className="rounded-lg bg-wine/10 px-3 py-2 text-sm text-wine">
          Vence pronto. Confirma con la persona: si sigue interesada, dale otros 15 días; si no, libérala para que pase el siguiente.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {wa && (
          <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-2 text-sm font-medium text-white hover:bg-[#1da851]">
            <MessageCircle size={15} /> WhatsApp
          </a>
        )}
        {a.telefono && (
          <a href={`tel:${a.telefono}`} className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 px-3 py-2 text-sm text-ink hover:bg-ink/5">
            <Phone size={15} /> Llamar
          </a>
        )}
      </div>
      {a.puedeGestionar ? (
        liberando ? (
          <div className="space-y-2">
            <Field label="¿Por qué se libera? (opcional)">
              <TextInput autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ej. ya no le interesa" />
            </Field>
            <div className="flex gap-2">
              <Button variant="outline" disabled={busy} onClick={() => accion(`/api/apartados-rapidos/${a.id}/liberar`, { motivo }, `Se liberó el apartado de ${a.nombre}.`)}>
                <Unlock size={15} /> Liberar la fecha
              </Button>
              <Button variant="ghost" onClick={() => setLiberando(false)}>No</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 border-t border-cream-200 pt-4">
            <Button variant="gold" disabled={busy} onClick={() => accion(`/api/apartados-rapidos/${a.id}/confirmar`, {}, `${a.nombre}: otros 15 días.`)}>
              <CheckCircle2 size={15} /> Confirmar (+15 días)
            </Button>
            <Button variant="primary" disabled={busy} onClick={convertir}>
              <PartyPopper size={15} /> Convertir a evento
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setLiberando(true)}>
              Liberar
            </Button>
          </div>
        )
      ) : (
        <p className="text-xs text-charcoal-soft">Solo {a.createdBy.nombre} o un admin pueden confirmarlo, convertirlo o liberarlo.</p>
      )}
      {error && <p role="alert" className="text-sm text-wine">{error}</p>}
    </Marco>
  );
}
