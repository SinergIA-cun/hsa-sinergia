import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { computeQuote, type QuoteBreakdown } from '@hsa/shared';
import { Sparkles, RotateCcw, AlertTriangle, CheckCircle2, Ban, UserCheck, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN, formatMXNCents } from '../lib/money.ts';
import { Button, Card, Field, TextInput, SelectInput } from './ui.tsx';
import { ClienteSearch, type ClienteLite } from './ClienteSearch.tsx';
import type { Catalog, Availability, SpaceAvailability } from '../lib/types.ts';

const DEFAULT_VALET_RATIO = 2.5; // 1 auto por cada 2.5 personas (fallback si no llega de catálogo)

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
  /** Si se reutiliza un cliente existente, su id (el backend lo prioriza sobre `client`). */
  clientId?: string;
}

interface Props {
  catalog: Catalog;
  initial?: Partial<QuoteFormInitial>;
  submitLabel: string;
  onSubmit: (payload: QuotePayload) => Promise<void>;
  errorMsg?: string;
  /** Al editar, excluye la propia cotización del chequeo de disponibilidad. */
  excludeQuoteId?: string;
  /** Habilita el buscador de clientes existentes (solo al crear). */
  enableClientSearch?: boolean;
}

export function QuoteForm({
  catalog,
  initial,
  submitLabel,
  onSubmit,
  errorMsg,
  excludeQuoteId,
  enableClientSearch = false,
}: Props) {
  const valetAddOn = catalog.addOns.find((a) => a.nombre.toLowerCase().includes('valet'));
  const valetRatio = catalog.config?.valetRatio ?? DEFAULT_VALET_RATIO;

  const [nombre, setNombre] = useState(initial?.nombre ?? '');
  const [telefono, setTelefono] = useState(initial?.telefono ?? '');
  const [correo, setCorreo] = useState(initial?.correo ?? '');
  // Cliente reutilizado: si viene de una búsqueda, guardamos su id; si el usuario
  // edita cualquier dato del cliente, se "desvincula" y se tratará como nuevo.
  const [pickedClientId, setPickedClientId] = useState<string | undefined>(undefined);
  const [pickedRef, setPickedRef] = useState<number | null>(null);

  function pickCliente(c: ClienteLite) {
    setNombre(c.nombre);
    setTelefono(c.telefono ?? '');
    setCorreo(c.correo ?? '');
    setPickedClientId(c.id);
    setPickedRef(c.numeroReferencia);
  }
  function desvincular() {
    setPickedClientId(undefined);
    setPickedRef(null);
  }
  const [eventTypeId, setEventTypeId] = useState(initial?.eventTypeId ?? '');
  const [fecha, setFecha] = useState(initial?.fecha ?? '');
  const [invitados, setInvitados] = useState(initial?.invitados ?? 150);
  const [spaceIds, setSpaceIds] = useState<string[]>(initial?.spaceIds ?? []);
  const [foodPackageId, setFoodPackageId] = useState(initial?.foodPackageId ?? '');
  const [horasExtra, setHorasExtra] = useState(initial?.horasExtra ?? 0);
  const [addOns, setAddOns] = useState<Record<string, number>>(initial?.addOns ?? {});
  const [busy, setBusy] = useState(false);

  // Valet: sugerencia = ceil(invitados / 2.5). Se recalcula al cambiar invitados
  // mientras ventas no lo haya ajustado a mano.
  const valetManual = useRef(false);
  const valetSuggestion = Math.ceil(invitados / valetRatio);
  useEffect(() => {
    if (!valetAddOn) return;
    if (valetAddOn.id in addOns && !valetManual.current) {
      setAddOns((prev) => ({ ...prev, [valetAddOn.id]: valetSuggestion }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitados, valetRatio]);

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

  // Preview del plan de pago según la regla del espacio seleccionado (sección H
  // del contrato): anticipo fijo + complemento % sobre el TOTAL + finiquito.
  const selectedSpace = catalog.spaces.find((s) => s.id === spaceIds[0]);
  const plan = useMemo(() => {
    const rule = selectedSpace?.paymentRule;
    if (!breakdown || !rule) return null;
    const apartar = rule.anticipo;
    const formalizar = Math.round(breakdown.total * rule.complementoPct);
    const liquidacion = Math.round(breakdown.total) - apartar - formalizar;
    const liqFecha = fecha ? new Date(`${fecha}T00:00:00.000Z`) : null;
    if (liqFecha) liqFecha.setUTCDate(liqFecha.getUTCDate() - rule.liquidarDiasAntes);
    return { apartar, formalizar, liquidacion, liqFecha, dias: rule.liquidarDiasAntes };
  }, [breakdown, selectedSpace, fecha]);

  const spaceNameById = new Map(catalog.spaces.map((s) => [s.id, s.nombre]));
  const lineLabel = (concepto: string): string => {
    const m = /^Renta (.+)$/.exec(concepto);
    const nombreEsp = m ? spaceNameById.get(m[1]!) : undefined;
    return nombreEsp ? `Renta ${nombreEsp}` : concepto;
  };

  // Disponibilidad del espacio en la fecha (global, todo el equipo de ventas).
  const spaceId = spaceIds[0];
  const { data: availability } = useQuery({
    queryKey: ['availability', fecha, spaceId, excludeQuoteId],
    queryFn: () =>
      api.get<Availability>(
        `/api/availability?fecha=${fecha}&spaceIds=${spaceId}` +
          (excludeQuoteId ? `&excludeQuoteId=${excludeQuoteId}` : ''),
      ),
    enabled: Boolean(fecha && spaceId),
  });
  const avail = availability?.spaces[0];
  const blocked = availability?.blocked ?? false;

  const canSave = Boolean(
    nombre && eventTypeId && fecha && spaceIds.length === 1 && breakdown && !calcError && !blocked,
  );

  // Un solo espacio por evento: seleccionar reemplaza; volver a hacer clic deselecciona.
  function selectSpace(id: string) {
    setSpaceIds((prev) => (prev[0] === id ? [] : [id]));
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
        clientId: pickedClientId,
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

          {enableClientSearch && !pickedClientId && <ClienteSearch onPick={pickCliente} />}

          {pickedClientId && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-sm">
              <span className="inline-flex items-center gap-2 text-ink">
                <UserCheck size={15} className="text-gold" />
                Cliente existente{pickedRef != null && ` · ref ${pickedRef}`}
              </span>
              <button type="button" onClick={desvincular} className="inline-flex items-center gap-1 text-xs text-charcoal-soft hover:text-ink">
                <X size={13} /> Usar otro / nuevo
              </button>
            </div>
          )}

          <Field label="Nombre">
            <TextInput
              value={nombre}
              onChange={(e) => {
                setNombre(e.target.value);
                desvincular();
              }}
              placeholder="Nombre del cliente"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Teléfono">
              <TextInput
                value={telefono}
                onChange={(e) => {
                  setTelefono(e.target.value);
                  desvincular();
                }}
                placeholder="Opcional"
              />
            </Field>
            <Field label="Correo">
              <TextInput
                type="email"
                value={correo}
                onChange={(e) => {
                  setCorreo(e.target.value);
                  desvincular();
                }}
                placeholder="Opcional"
              />
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
          <h2 className="font-display text-xl text-ink">Espacio</h2>
          <p className="-mt-1 text-xs text-charcoal-soft">Un solo espacio por evento.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {catalog.spaces.map((s) => {
              const active = spaceIds[0] === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectSpace(s.id)}
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
          <AvailabilityBanner avail={avail} fecha={fecha} />
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
                      {a.kind === 'porUnidad' &&
                        (a.nombre.toLowerCase().includes('hora') ? ' /hora' : ' /unidad')}
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
                          title={`Sugerir ${valetSuggestion} (1 auto por ${valetRatio} personas)`}
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
                        <span className="text-charcoal-soft">Complemento (formalizar)</span>
                        <span className="tabular-nums">{formatMXN(plan.formalizar)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-charcoal-soft">
                          Liquidación{' '}
                          {plan.liqFecha
                            ? `(${plan.liqFecha.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: 'UTC' })})`
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

function AvailabilityBanner({
  avail,
  fecha,
}: {
  avail?: SpaceAvailability;
  fecha: string;
}) {
  if (!fecha || !avail) return null;

  if (avail.level === 'bloqueada') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-wine/30 bg-wine/10 px-3 py-2.5 text-sm text-wine">
        <Ban size={16} className="mt-0.5 shrink-0" />
        <span>
          <strong>{avail.nombre}</strong> ya está{' '}
          {avail.counts.liquidadas > 0 ? 'liquidado' : 'formalizado'} en esta fecha. No se puede
          cotizar este espacio para el {fecha}.
        </span>
      </div>
    );
  }
  if (avail.level === 'apartada') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2.5 text-sm text-gold">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>
          Ya hay un <strong>apartado</strong> para <strong>{avail.nombre}</strong> en esta fecha
          (aún sin formalizar el 30%). Confirma con coordinación antes de comprometerlo.
        </span>
      </div>
    );
  }
  if (avail.level === 'cotizaciones') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-ink/15 bg-ink/5 px-3 py-2.5 text-sm text-ink-500">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>
          Hay {avail.counts.cotizaciones} cotización(es) para <strong>{avail.nombre}</strong> en
          esta fecha, ninguna apartada aún.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-emerald-600/20 bg-emerald-600/5 px-3 py-2.5 text-sm text-emerald-700">
      <CheckCircle2 size={16} className="shrink-0" />
      <span>
        <strong>{avail.nombre}</strong> está disponible el {fecha}.
      </span>
    </div>
  );
}
