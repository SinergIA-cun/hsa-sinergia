import { useEffect, useMemo, useRef, useState } from 'react';
import { computeQuote, type QuoteBreakdown } from '@hsa/shared';
import { Sparkles, RotateCcw } from 'lucide-react';
import { formatMXN, formatMXNCents } from '../lib/money.ts';
import { Button, Card, Field, TextInput, SelectInput } from './ui.tsx';
import type { Catalog } from '../lib/types.ts';

const VALET_RATIO = 2.5; // 1 auto por cada 2.5 personas

export interface QuoteFormInitial {
  nombre: string;
  telefono: string;
  correo: string;
  eventTypeId: string;
  fecha: string;
  invitados: number;
  spaceIds: string[];
  foodPackageId: string;
  horasExtra: number;
  addOns: Record<string, number>;
}

export interface QuotePayload {
  fecha: string;
  invitados: number;
  spaceIds: string[];
  horasExtra: number;
  foodPackageId?: string;
  addOns: { addOnId: string; cantidad: number }[];
  eventTypeId: string;
  client: { nombre: string; telefono?: string; correo?: string };
}

interface Props {
  catalog: Catalog;
  initial?: Partial<QuoteFormInitial>;
  submitLabel: string;
  onSubmit: (payload: QuotePayload) => Promise<void>;
  errorMsg?: string;
}

export function QuoteForm({ catalog, initial, submitLabel, onSubmit, errorMsg }: Props) {
  const valetAddOn = catalog.addOns.find((a) => a.nombre.toLowerCase().includes('valet'));

  const [nombre, setNombre] = useState(initial?.nombre ?? '');
  const [telefono, setTelefono] = useState(initial?.telefono ?? '');
  const [correo, setCorreo] = useState(initial?.correo ?? '');
  const [eventTypeId, setEventTypeId] = useState(initial?.eventTypeId ?? '');
  const [fecha, setFecha] = useState(initial?.fecha ?? '');
  const [invitados, setInvitados] = useState(initial?.invitados ?? 150);
  const [spaceIds, setSpaceIds] = useState<string[]>(initial?.spaceIds ?? []);
  const [foodPackageId, setFoodPackageId] = useState(initial?.foodPackageId ?? '');
  const [horasExtra, setHorasExtra] = useState(initial?.horasExtra ?? 0);
  const [addOns, setAddOns] = useState<Record<string, number>>(initial?.addOns ?? {});
  const [busy, setBusy] = useState(false);

  // Valet: sugerencia = ceil(invitados / 2.5). Se recalcula al cambiar invitados
  // mientras la vendedora no lo haya ajustado a mano.
  const valetManual = useRef(false);
  const valetSuggestion = Math.ceil(invitados / VALET_RATIO);
  useEffect(() => {
    if (!valetAddOn) return;
    if (valetAddOn.id in addOns && !valetManual.current) {
      setAddOns((prev) => ({ ...prev, [valetAddOn.id]: valetSuggestion }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitados]);

  const eventType = catalog.eventTypes.find((e) => e.id === eventTypeId);
  const foodPackages = eventType?.foodPackages ?? [];

  const selection = useMemo(
    () => ({
      fecha: fecha || '2027-01-01',
      invitados,
      spaceIds,
      horasExtra,
      foodPackageId: foodPackageId || undefined,
      addOns: Object.entries(addOns).map(([addOnId, cantidad]) => ({ addOnId, cantidad })),
    }),
    [fecha, invitados, spaceIds, horasExtra, foodPackageId, addOns],
  );

  const { breakdown, calcError } = useMemo(() => {
    if (spaceIds.length === 0) return { breakdown: null as QuoteBreakdown | null, calcError: '' };
    try {
      return { breakdown: computeQuote(catalog.engine, selection), calcError: '' };
    } catch (e) {
      return { breakdown: null, calcError: e instanceof Error ? e.message : 'No se pudo calcular' };
    }
  }, [catalog, selection, spaceIds.length]);

  const plan = useMemo(() => {
    if (!breakdown || !eventType?.paymentRule) return null;
    const rule = eventType.paymentRule;
    const apartar = rule.apartarMonto;
    const formalizar = Math.max(0, Math.round(breakdown.rentaTotal * rule.formalizarPct) - apartar);
    const liquidacion = Math.round(breakdown.total) - apartar - formalizar;
    const liqFecha = fecha ? new Date(`${fecha}T00:00:00`) : null;
    if (liqFecha) liqFecha.setDate(liqFecha.getDate() - rule.liquidarDias);
    return { apartar, formalizar, liquidacion, liqFecha, dias: rule.liquidarDias };
  }, [breakdown, eventType, fecha]);

  const spaceNameById = new Map(catalog.spaces.map((s) => [s.id, s.nombre]));
  const lineLabel = (concepto: string): string => {
    const m = /^Renta (.+)$/.exec(concepto);
    const nombreEsp = m ? spaceNameById.get(m[1]!) : undefined;
    return nombreEsp ? `Renta ${nombreEsp}` : concepto;
  };

  const canSave = Boolean(nombre && eventTypeId && fecha && spaceIds.length > 0 && breakdown && !calcError);

  function toggleSpace(id: string) {
    setSpaceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function toggleAddOn(id: string, kind: string) {
    setAddOns((prev) => {
      const next = { ...prev };
      if (id in next) {
        delete next[id];
        if (valetAddOn && id === valetAddOn.id) valetManual.current = false;
      } else {
        next[id] = valetAddOn && id === valetAddOn.id ? valetSuggestion : kind === 'porUnidad' ? 1 : 1;
      }
      return next;
    });
  }

  async function handleSubmit() {
    setBusy(true);
    try {
      await onSubmit({
        fecha,
        invitados,
        spaceIds,
        horasExtra,
        foodPackageId: foodPackageId || undefined,
        addOns: Object.entries(addOns).map(([addOnId, cantidad]) => ({ addOnId, cantidad })),
        eventTypeId,
        client: { nombre, telefono: telefono || undefined, correo: correo || undefined },
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
      {/* Formulario */}
      <div className="space-y-6">
        <Card className="space-y-4 p-6">
          <h2 className="font-display text-xl text-ink">Cliente</h2>
          <Field label="Nombre">
            <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del cliente" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Teléfono">
              <TextInput value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Opcional" />
            </Field>
            <Field label="Correo">
              <TextInput type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="Opcional" />
            </Field>
          </div>
        </Card>

        <Card className="space-y-4 p-6">
          <h2 className="font-display text-xl text-ink">Evento</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo de evento">
              <SelectInput
                value={eventTypeId}
                onChange={(e) => {
                  setEventTypeId(e.target.value);
                  setFoodPackageId('');
                }}
              >
                <option value="">Selecciona…</option>
                {catalog.eventTypes.map((et) => (
                  <option key={et.id} value={et.id}>
                    {et.nombre}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Fecha del evento">
              <TextInput type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </Field>
            <Field label="Invitados">
              <TextInput type="number" min={1} value={invitados} onChange={(e) => setInvitados(Number(e.target.value))} />
            </Field>
            <Field label="Horas extra" hint="5% de la renta por hora">
              <TextInput type="number" min={0} value={horasExtra} onChange={(e) => setHorasExtra(Number(e.target.value))} />
            </Field>
          </div>
        </Card>

        <Card className="space-y-3 p-6">
          <h2 className="font-display text-xl text-ink">Espacio(s)</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {catalog.spaces.map((s) => {
              const active = spaceIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleSpace(s.id)}
                  className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                    active ? 'border-gold bg-gold/10 text-ink' : 'border-ink/12 bg-white/50 text-charcoal hover:border-ink/30'
                  }`}
                >
                  <span className="font-medium">{s.nombre}</span>
                  {s.capacidadMax && <span className="text-xs text-charcoal-soft">hasta {s.capacidadMax}</span>}
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="space-y-3 p-6">
          <h2 className="font-display text-xl text-ink">Alimentos</h2>
          <SelectInput value={foodPackageId} onChange={(e) => setFoodPackageId(e.target.value)} disabled={!eventType}>
            <option value="">Sin alimentos</option>
            {foodPackages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </SelectInput>
          {!eventType && <p className="text-xs text-charcoal-soft">Selecciona un tipo de evento primero.</p>}
          {foodPackageId && (
            <p className="inline-flex items-center gap-1.5 text-xs text-gold">
              <Sparkles size={13} /> Contratar alimentos da 5% de descuento en la renta.
            </p>
          )}
        </Card>

        <Card className="space-y-3 p-6">
          <h2 className="font-display text-xl text-ink">Servicios adicionales</h2>
          <div className="space-y-2">
            {catalog.addOns.map((a) => {
              const active = a.id in addOns;
              const isValet = valetAddOn?.id === a.id;
              return (
                <div
                  key={a.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm ${
                    active ? 'border-gold/60 bg-gold/5' : 'border-ink/10'
                  }`}
                >
                  <label className="flex flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleAddOn(a.id, a.kind)}
                      className="h-4 w-4 accent-[var(--color-gold)]"
                    />
                    <span className="font-medium text-charcoal">{a.nombre}</span>
                    <span className="text-xs text-charcoal-soft">
                      {formatMXN(a.price)}
                      {a.kind === 'porPersona' && ' /persona'}
                      {a.kind === 'porUnidad' && ' /unidad'}
                    </span>
                  </label>
                  {active && a.kind === 'porUnidad' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={addOns[a.id]}
                        onChange={(e) => {
                          if (isValet) valetManual.current = true;
                          setAddOns((prev) => ({ ...prev, [a.id]: Number(e.target.value) }));
                        }}
                        className="w-20 rounded-md border border-ink/15 px-2 py-1 text-sm"
                      />
                      {isValet && (
                        <button
                          type="button"
                          title={`Sugerir ${valetSuggestion} (1 auto por ${VALET_RATIO} personas)`}
                          onClick={() => {
                            valetManual.current = false;
                            setAddOns((prev) => ({ ...prev, [a.id]: valetSuggestion }));
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-ink/15 px-2 py-1 text-xs text-ink-500 hover:bg-ink/5"
                        >
                          <RotateCcw size={12} /> {valetSuggestion}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Desglose en vivo */}
      <div className="lg:sticky lg:top-24 lg:self-start">
        <Card className="overflow-hidden">
          <div className="bg-ink px-6 py-4 text-cream">
            <p className="text-xs uppercase tracking-[0.2em] text-gold-200">Desglose en vivo</p>
            <p className="mt-1 font-display text-3xl">{breakdown ? formatMXN(breakdown.total) : '—'}</p>
          </div>
          <div className="p-6">
            {calcError && (
              <p className="rounded-lg bg-wine/10 px-3 py-2 text-xs text-wine">Ajusta los datos: {calcError}</p>
            )}
            {!breakdown && !calcError && (
              <p className="text-sm text-charcoal-soft">Selecciona espacio, fecha e invitados para ver el cálculo.</p>
            )}
            {breakdown && (
              <>
                <ul className="space-y-2 text-sm">
                  {breakdown.lines.map((l, i) => (
                    <li key={i} className="flex justify-between gap-4">
                      <span className="text-charcoal-soft">
                        {lineLabel(l.concepto)}
                        {l.detalle && <span className="ml-1 text-xs text-charcoal-soft/60">({l.detalle})</span>}
                      </span>
                      <span className="tabular-nums text-charcoal">{formatMXNCents(l.monto)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 space-y-1 border-t border-cream-300 pt-4 text-sm">
                  <div className="flex justify-between text-charcoal-soft">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatMXNCents(breakdown.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-charcoal-soft">
                    <span>IVA</span>
                    <span className="tabular-nums">{formatMXNCents(breakdown.iva)}</span>
                  </div>
                  <div className="flex justify-between pt-1 font-display text-xl text-ink">
                    <span>Total</span>
                    <span className="tabular-nums">{formatMXN(breakdown.total)}</span>
                  </div>
                </div>
                {plan && (
                  <div className="mt-5 rounded-lg bg-cream-200/70 p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                      Plan de pagos sugerido
                    </p>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-charcoal-soft">Apartar fecha</span>
                        <span className="tabular-nums">{formatMXN(plan.apartar)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-charcoal-soft">Formalizar (30% renta)</span>
                        <span className="tabular-nums">{formatMXN(plan.formalizar)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-charcoal-soft">
                          Liquidación{' '}
                          {plan.liqFecha
                            ? `(${plan.liqFecha.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })})`
                            : `(${plan.dias}d antes)`}
                        </span>
                        <span className="tabular-nums">{formatMXN(plan.liquidacion)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            <Button variant="gold" disabled={!canSave || busy} onClick={handleSubmit} className="mt-6 w-full py-3">
              {busy ? 'Guardando…' : submitLabel}
            </Button>
            {errorMsg && <p className="mt-2 text-center text-xs text-wine">{errorMsg}</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
