import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { computeQuote, type QuoteBreakdown } from '@hsa/shared';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, ArrowLeft, Sparkles } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN, formatMXNCents } from '../lib/money.ts';
import { Button, Card, Field, TextInput, SelectInput, ArrowDivider } from '../components/ui.tsx';
import type { Catalog, Quote } from '../lib/types.ts';

interface AddOnSel {
  [addOnId: string]: number; // cantidad
}

export function NewQuotePage() {
  const { data: catalog, isLoading } = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<Catalog>('/api/catalog'),
  });

  // Selección
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [correo, setCorreo] = useState('');
  const [eventTypeId, setEventTypeId] = useState('');
  const [fecha, setFecha] = useState('');
  const [invitados, setInvitados] = useState(150);
  const [spaceIds, setSpaceIds] = useState<string[]>([]);
  const [foodPackageId, setFoodPackageId] = useState('');
  const [horasExtra, setHorasExtra] = useState(0);
  const [addOns, setAddOns] = useState<AddOnSel>({});

  const [saved, setSaved] = useState<Quote | null>(null);
  const [copied, setCopied] = useState(false);

  const eventType = catalog?.eventTypes.find((e) => e.id === eventTypeId);
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
    if (!catalog || spaceIds.length === 0) {
      return { breakdown: null as QuoteBreakdown | null, calcError: '' };
    }
    try {
      return { breakdown: computeQuote(catalog.engine, selection), calcError: '' };
    } catch (e) {
      return {
        breakdown: null,
        calcError: e instanceof Error ? e.message : 'No se pudo calcular',
      };
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

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ quote: Quote }>('/api/quotes', {
        ...selection,
        eventTypeId,
        client: { nombre, telefono: telefono || undefined, correo: correo || undefined },
      }),
    onSuccess: (res) => setSaved(res.quote),
  });

  const canSave =
    Boolean(nombre && eventTypeId && fecha && spaceIds.length > 0 && breakdown && !calcError);

  function toggleSpace(id: string) {
    setSpaceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function toggleAddOn(id: string, kind: string) {
    setAddOns((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = kind === 'porUnidad' ? 10 : 1;
      return next;
    });
  }

  const publicUrl = saved ? `${window.location.origin}/c/${saved.publicToken}` : '';

  if (isLoading) return <p className="text-charcoal-soft">Cargando catálogo…</p>;
  if (!catalog) return <p className="text-wine">No se pudo cargar el catálogo.</p>;

  const spaceNameById = new Map(catalog.spaces.map((s) => [s.id, s.nombre]));
  const lineLabel = (concepto: string): string => {
    const m = /^Renta (.+)$/.exec(concepto);
    const nombre = m ? spaceNameById.get(m[1]!) : undefined;
    return nombre ? `Renta ${nombre}` : concepto;
  };

  // ── Pantalla de éxito con link + QR ──────────────────────────────
  if (saved) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-gold/15 text-gold">
          <Check size={28} />
        </div>
        <ArrowDivider>Cotización creada</ArrowDivider>
        <h1 className="mt-3 font-display text-4xl text-ink">{formatMXN(saved.total)}</h1>
        <p className="mt-1 text-sm text-charcoal-soft">
          Comparte el link o el código QR con tu cliente. Podrá ver la cotización y su estado de
          cuenta en vivo.
        </p>

        <Card className="mt-8 p-8">
          <div className="mx-auto w-fit rounded-xl bg-white p-4 shadow-sm">
            <QRCodeSVG value={publicUrl} size={168} fgColor="#14304d" bgColor="#ffffff" />
          </div>
          <div className="mt-6 flex items-center gap-2">
            <TextInput readOnly value={publicUrl} className="text-center text-xs" />
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(publicUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </Button>
          </div>
        </Card>

        <div className="mt-6 flex justify-center gap-3">
          <a href={publicUrl} target="_blank" rel="noreferrer">
            <Button variant="gold">Ver como cliente</Button>
          </a>
          <Link to="/cotizaciones">
            <Button variant="outline">Ir a cotizaciones</Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── Wizard ───────────────────────────────────────────────────────
  return (
    <div>
      <Link
        to="/cotizaciones"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-charcoal-soft hover:text-ink"
      >
        <ArrowLeft size={15} /> Cotizaciones
      </Link>
      <ArrowDivider>Nueva</ArrowDivider>
      <h1 className="mt-2 font-display text-4xl text-ink">Armar cotización</h1>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
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
                <TextInput
                  type="number"
                  min={1}
                  value={invitados}
                  onChange={(e) => setInvitados(Number(e.target.value))}
                />
              </Field>
              <Field label="Horas extra" hint="5% de la renta por hora">
                <TextInput
                  type="number"
                  min={0}
                  value={horasExtra}
                  onChange={(e) => setHorasExtra(Number(e.target.value))}
                />
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
                      active
                        ? 'border-gold bg-gold/10 text-ink'
                        : 'border-ink/12 bg-white/50 text-charcoal hover:border-ink/30'
                    }`}
                  >
                    <span className="font-medium">{s.nombre}</span>
                    {s.capacidadMax && (
                      <span className="text-xs text-charcoal-soft">hasta {s.capacidadMax}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="space-y-3 p-6">
            <h2 className="font-display text-xl text-ink">Alimentos</h2>
            <SelectInput
              value={foodPackageId}
              onChange={(e) => setFoodPackageId(e.target.value)}
              disabled={!eventType}
            >
              <option value="">Sin alimentos</option>
              {foodPackages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </SelectInput>
            {!eventType && (
              <p className="text-xs text-charcoal-soft">Selecciona un tipo de evento primero.</p>
            )}
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
                return (
                  <div
                    key={a.id}
                    className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm ${
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
                      <input
                        type="number"
                        min={1}
                        value={addOns[a.id]}
                        onChange={(e) =>
                          setAddOns((prev) => ({ ...prev, [a.id]: Number(e.target.value) }))
                        }
                        className="w-20 rounded-md border border-ink/15 px-2 py-1 text-sm"
                      />
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
              <p className="mt-1 font-display text-3xl">
                {breakdown ? formatMXN(breakdown.total) : '—'}
              </p>
            </div>
            <div className="p-6">
              {calcError && (
                <p className="rounded-lg bg-wine/10 px-3 py-2 text-xs text-wine">
                  Ajusta los datos: {calcError}
                </p>
              )}
              {!breakdown && !calcError && (
                <p className="text-sm text-charcoal-soft">
                  Selecciona espacio, fecha e invitados para ver el cálculo.
                </p>
              )}
              {breakdown && (
                <>
                  <ul className="space-y-2 text-sm">
                    {breakdown.lines.map((l, i) => (
                      <li key={i} className="flex justify-between gap-4">
                        <span className="text-charcoal-soft">
                          {lineLabel(l.concepto)}
                          {l.detalle && (
                            <span className="ml-1 text-xs text-charcoal-soft/60">({l.detalle})</span>
                          )}
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
                              ? `(${plan.liqFecha.toLocaleDateString('es-MX', {
                                  day: '2-digit',
                                  month: 'short',
                                })})`
                              : `(${plan.dias}d antes)`}
                          </span>
                          <span className="tabular-nums">{formatMXN(plan.liquidacion)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              <Button
                variant="gold"
                disabled={!canSave || mutation.isPending}
                onClick={() => mutation.mutate()}
                className="mt-6 w-full py-3"
              >
                {mutation.isPending ? 'Guardando…' : 'Guardar y generar link'}
              </Button>
              {mutation.isError && (
                <p className="mt-2 text-center text-xs text-wine">
                  No se pudo guardar. Revisa los datos.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
