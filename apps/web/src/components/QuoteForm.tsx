import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { computeQuote, type DatosFiscales, type QuoteBreakdown, type QuoteLine } from '@hsa/shared';
import { Sparkles, AlertTriangle, CheckCircle2, Ban, UserCheck, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { Button, Card, Field, TextInput, SelectInput } from './ui.tsx';
import { ClienteSearch, type ClienteLite } from './ClienteSearch.tsx';
import { FacturacionSection } from './FacturacionSection.tsx';
import { BreakdownGrouped } from './BreakdownGrouped.tsx';
import type { Catalog, Availability, SpaceAvailability } from '../lib/types.ts';

const MAX_ESPACIOS = 3; // Hay graduaciones que juntan salones; el tope es 3.

const vacioANull = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
};

/**
 * Normaliza los datos fiscales para mandarlos: lo vacío viaja como `null`.
 *
 * Los seis campos van SIEMPRE en el payload. Omitir uno dejaría el valor
 * anterior intacto en el cliente, así que borrar un RFC mal capturado no
 * surtiría efecto y la corrección se perdería en silencio.
 */
function fiscalesParaGuardar(d: DatosFiscales): DatosFiscales {
  return {
    rfc: vacioANull(d.rfc),
    razonSocial: vacioANull(d.razonSocial),
    regimenFiscal: vacioANull(d.regimenFiscal),
    cpFiscal: vacioANull(d.cpFiscal),
    usoCfdi: vacioANull(d.usoCfdi),
    correoFacturacion: vacioANull(d.correoFacturacion),
  };
}

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
  usaCapilla: boolean;
  capillaHorario: string;
  esCortesia: boolean;
  usaDjHoraExtra: boolean;
  addOns: Record<string, number>;
  requiereFactura: boolean;
  fiscales: DatosFiscales;
}

export interface QuotePayload {
  fecha: string;
  invitados: number;
  spaceIds: string[];
  horasExtra: number;
  usaCapilla: boolean;
  capillaHorario?: string | null;
  esCortesia: boolean;
  usaDjHoraExtra: boolean;
  foodPackageId?: string;
  addOns: { addOnId: string; cantidad: number }[];
  eventTypeId: string;
  requiereFactura: boolean;
  /** Los datos fiscales viajan dentro del cliente: son suyos, no del evento. */
  client: { nombre: string; telefono?: string; correo?: string } & DatosFiscales;
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
  /**
   * Candado de facturación del evento. Solo lo manda la edición: una cotización
   * nueva no tiene pagos, así que sus datos fiscales siempre son capturables.
   */
  fiscalEditable?: { editable: boolean; motivo: string | null };
  /** Un admin puede corregir datos fiscales ya congelados por una factura emitida. */
  isAdmin?: boolean;
}

export function QuoteForm({
  catalog,
  initial,
  submitLabel,
  onSubmit,
  errorMsg,
  excludeQuoteId,
  enableClientSearch = false,
  fiscalEditable,
  isAdmin = false,
}: Props) {
  const [nombre, setNombre] = useState(initial?.nombre ?? '');
  const [telefono, setTelefono] = useState(initial?.telefono ?? '');
  const [correo, setCorreo] = useState(initial?.correo ?? '');
  // Cliente reutilizado: si viene de una búsqueda, guardamos su id; si el usuario
  // edita cualquier dato del cliente, se "desvincula" y se tratará como nuevo.
  const [pickedClientId, setPickedClientId] = useState<string | undefined>(undefined);
  const [pickedRef, setPickedRef] = useState<number | null>(null);
  const [requiereFactura, setRequiereFactura] = useState(initial?.requiereFactura ?? false);
  const [fiscales, setFiscales] = useState<DatosFiscales>(initial?.fiscales ?? {});

  function pickCliente(c: ClienteLite) {
    setNombre(c.nombre);
    setTelefono(c.telefono ?? '');
    setCorreo(c.correo ?? '');
    setPickedClientId(c.id);
    setPickedRef(c.numeroReferencia);
    // Los datos fiscales son del cliente: al reutilizarlo no hay que recapturarlos.
    setFiscales({
      rfc: c.rfc,
      razonSocial: c.razonSocial,
      regimenFiscal: c.regimenFiscal,
      cpFiscal: c.cpFiscal,
      usoCfdi: c.usoCfdi,
      correoFacturacion: c.correoFacturacion,
    });
  }
  function desvincular() {
    // El guard no es cosmético: esto corre en CADA tecla del nombre, teléfono y
    // correo. Sin él, capturar los datos fiscales de un cliente nuevo y luego
    // corregir una letra de su nombre los borraría.
    if (!pickedClientId) return;
    setPickedClientId(undefined);
    setPickedRef(null);
    // Desvincular significa "este es otro cliente": sus datos fiscales se van
    // con él, o acabaríamos guardando el RFC del anterior en el nuevo.
    setFiscales({});
  }
  const [eventTypeId, setEventTypeId] = useState(initial?.eventTypeId ?? '');
  const [fecha, setFecha] = useState(initial?.fecha ?? '');
  const [invitados, setInvitados] = useState(initial?.invitados ?? 150);
  const [spaceIds, setSpaceIds] = useState<string[]>(initial?.spaceIds ?? []);
  const [foodPackageId, setFoodPackageId] = useState(initial?.foodPackageId ?? '');
  const [horasExtra, setHorasExtra] = useState(initial?.horasExtra ?? 0);
  const [usaCapilla, setUsaCapilla] = useState(initial?.usaCapilla ?? false);
  const [capillaHorario, setCapillaHorario] = useState(initial?.capillaHorario ?? '');
  const [esCortesia, setEsCortesia] = useState(initial?.esCortesia ?? false);
  const [usaDjHoraExtra, setUsaDjHoraExtra] = useState(initial?.usaDjHoraExtra ?? false);
  const [addOns, setAddOns] = useState<Record<string, number>>(initial?.addOns ?? {});
  const [busy, setBusy] = useState(false);

  const eventType = catalog.eventTypes.find((e) => e.id === eventTypeId);
  const foodPackages = eventType?.foodPackages ?? [];
  // Precio del DJ por hora extra según el tipo de evento (undefined = no aplica).
  const djPrecio = eventTypeId ? catalog.engine.djHoraExtraByEventType[eventTypeId] : undefined;

  const selection = useMemo(
    () => ({
      fecha: fecha || '2027-01-01',
      invitados,
      spaceIds,
      horasExtra,
      usaCapilla,
      usaDjHoraExtra,
      eventTypeId: eventTypeId || undefined,
      foodPackageId: foodPackageId || undefined,
      addOns: Object.entries(addOns).map(([addOnId, cantidad]) => ({ addOnId, cantidad })),
    }),
    [fecha, invitados, spaceIds, horasExtra, usaCapilla, usaDjHoraExtra, eventTypeId, foodPackageId, addOns],
  );

  const { breakdown, calcError } = useMemo(() => {
    if (spaceIds.length === 0) return { breakdown: null as QuoteBreakdown | null, calcError: '' };
    try {
      return { breakdown: computeQuote(catalog.engine, selection), calcError: '' };
    } catch (e) {
      return { breakdown: null, calcError: e instanceof Error ? e.message : 'No se pudo calcular' };
    }
  }, [catalog, selection, spaceIds.length]);

  // Preview del plan de pago. Se calcula sobre la RENTA (lo único que cobra y
  // rastrea HSA) y replica la fórmula del servidor: los anticipos se suman y el
  // porcentaje del complemento pesa según la renta que aporta cada espacio.
  const plan = useMemo(() => {
    if (!breakdown || spaceIds.length === 0) return null;
    const reglas = spaceIds.map((id) => catalog.spaces.find((s) => s.id === id)?.paymentRule ?? null);
    if (reglas.some((r) => !r)) return null; // un espacio sin regla ⇒ plan pendiente

    const rentaPorEspacio = new Map<string, number>();
    for (const l of breakdown.lines) {
      if (l.spaceId) rentaPorEspacio.set(l.spaceId, (rentaPorEspacio.get(l.spaceId) ?? 0) + l.monto);
    }
    const sumRenta = [...rentaPorEspacio.values()].reduce((s, v) => s + v, 0);

    const base = Math.round(breakdown.rentaTotal);
    const apartar = reglas.reduce((s, r) => s + r!.anticipo, 0);
    const pct =
      sumRenta > 0
        ? spaceIds.reduce((s, id, i) => s + reglas[i]!.complementoPct * ((rentaPorEspacio.get(id) ?? 0) / sumRenta), 0)
        : Math.max(...reglas.map((r) => r!.complementoPct));
    const formalizar = Math.round(pct * base);
    const liquidacion = base - apartar - formalizar;

    const dias = Math.max(...reglas.map((r) => r!.liquidarDiasAntes));
    const liqFecha = fecha ? new Date(`${fecha}T00:00:00.000Z`) : null;
    if (liqFecha) liqFecha.setUTCDate(liqFecha.getUTCDate() - dias);
    return { apartar, formalizar, liquidacion, liqFecha, dias };
  }, [breakdown, spaceIds, catalog.spaces, fecha]);

  const spaceNameById = new Map(catalog.spaces.map((s) => [s.id, s.nombre]));
  const lineLabel = (line: QuoteLine): string => {
    const nombre = line.spaceId ? spaceNameById.get(line.spaceId) : undefined;
    return nombre ? `Renta ${nombre}` : line.concepto;
  };

  // Disponibilidad de TODOS los espacios en la fecha (global, todo el equipo de
  // ventas), en una sola llamada: así el selector puede pintarse con colores sin
  // que haya que hacer clic para descubrir que un salón está ocupado.
  const todosLosEspacios = catalog.spaces.map((s) => s.id).join(',');
  const { data: availability } = useQuery({
    queryKey: ['availability', fecha, todosLosEspacios, excludeQuoteId],
    queryFn: () =>
      api.get<Availability>(
        `/api/availability?fecha=${fecha}&spaceIds=${todosLosEspacios}` +
          (excludeQuoteId ? `&excludeQuoteId=${excludeQuoteId}` : ''),
      ),
    enabled: Boolean(fecha && todosLosEspacios),
  });

  const availBySpace = useMemo(
    () => new Map((availability?.spaces ?? []).map((s) => [s.spaceId, s])),
    [availability],
  );
  // OJO: `blocked` se mide SOLO sobre los espacios seleccionados. Si se usara el
  // `blocked` global de la respuesta, cualquier fecha con un evento en cualquier
  // salón impediría guardar.
  const blocked = spaceIds.some((id) => availBySpace.get(id)?.level === 'bloqueada');
  // La capilla la pueden usar varios eventos el mismo día: solo se informa quién más.
  const capillaEventos = availability?.capillaEventos ?? [];

  const canSave = Boolean(
    nombre && eventTypeId && fecha && spaceIds.length >= 1 && spaceIds.length <= MAX_ESPACIOS &&
    breakdown && !calcError && !blocked,
  );

  // Hasta 3 espacios por evento (hay graduaciones que juntan salones).
  function toggleSpace(id: string) {
    setSpaceIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_ESPACIOS) return prev;
      return [...prev, id];
    });
  }

  function toggleAddOn(id: string) {
    setAddOns((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = 1;
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
        usaCapilla,
        capillaHorario: usaCapilla ? capillaHorario || null : null,
        esCortesia,
        usaDjHoraExtra,
        foodPackageId: foodPackageId || undefined,
        addOns: Object.entries(addOns).map(([addOnId, cantidad]) => ({ addOnId, cantidad })),
        eventTypeId,
        requiereFactura,
        client: {
          nombre,
          telefono: telefono || undefined,
          correo: correo || undefined,
          ...fiscalesParaGuardar(fiscales),
        },
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
          <p className="-mt-1 text-xs text-charcoal-soft">
            Hasta {MAX_ESPACIOS} espacios por evento. {fecha ? 'El color indica la disponibilidad.' : 'Elige la fecha para ver disponibilidad.'}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {catalog.spaces.map((s) => {
              const active = spaceIds.includes(s.id);
              const av = fecha ? availBySpace.get(s.id) : undefined;
              const ocupado = av?.level === 'bloqueada';
              const topeAlcanzado = !active && spaceIds.length >= MAX_ESPACIOS;

              const estado = !av
                ? 'border-ink/12 bg-white/50 text-charcoal hover:border-ink/30'
                : av.level === 'bloqueada'
                  ? 'border-wine/30 bg-wine/10 text-wine/70 line-through'
                  : av.level === 'cotizaciones'
                    ? 'border-amber-500/40 bg-amber-500/10 text-charcoal hover:border-amber-500/70'
                    : 'border-emerald-600/30 bg-emerald-600/5 text-charcoal hover:border-emerald-600/60';

              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={ocupado || topeAlcanzado}
                  onClick={() => toggleSpace(s.id)}
                  title={
                    ocupado
                      ? `${s.nombre} ya tiene un evento comprometido el ${fecha}`
                      : topeAlcanzado
                        ? `Máximo ${MAX_ESPACIOS} espacios`
                        : undefined
                  }
                  className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors disabled:cursor-not-allowed ${
                    active ? 'border-gold bg-gold/10 text-ink' : estado
                  } ${topeAlcanzado && !ocupado ? 'opacity-50' : ''}`}
                >
                  <span className="font-medium">{s.nombre}</span>
                  <span className="text-right text-xs">
                    {ocupado ? (
                      <span className="text-wine">
                        {av!.quotes[0]?.cliente ? `apartado · ${av!.quotes[0]!.cliente}` : 'apartado'}
                      </span>
                    ) : av?.level === 'cotizaciones' ? (
                      <span className="text-amber-700">{av.counts.cotizaciones} cotización(es)</span>
                    ) : (
                      s.capacidadMax && <span className="text-charcoal-soft">hasta {s.capacidadMax}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {fecha && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-charcoal-soft">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />Disponible</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" />Con cotizaciones</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-wine" />Apartado</span>
            </div>
          )}
          {spaceIds.map((id) => (
            <AvailabilityBanner key={id} avail={availBySpace.get(id)} fecha={fecha} />
          ))}

          {/* Capilla: cortesía (entre semana) / $5,000 sábado. La comparten varios eventos el día. */}
          <div className={`mt-1 rounded-lg border px-4 py-3 text-sm transition-colors ${usaCapilla ? 'border-gold bg-gold/10' : 'border-ink/12 bg-white/50'}`}>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={usaCapilla}
                onChange={(e) => setUsaCapilla(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]"
              />
              <span className="flex-1">
                <span className="font-medium text-ink">Usar la Capilla</span>
                <span className="block text-xs text-charcoal-soft">
                  Cortesía entre semana · $5,000 en sábado. Aparece en la hoja operativa.
                </span>
              </span>
            </label>

            {usaCapilla && (
              <div className="mt-3 flex items-center gap-2 pl-7">
                <span className="text-xs font-medium text-charcoal-soft">Horario de la capilla</span>
                <TextInput
                  type="time"
                  value={capillaHorario}
                  onChange={(e) => setCapillaHorario(e.target.value)}
                  className="w-32"
                />
              </div>
            )}

            {capillaEventos.length > 0 && (
              <div className="mt-3 rounded-md bg-ink/[0.04] px-3 py-2 pl-3 text-xs text-charcoal-soft">
                <span className="font-medium text-ink">La capilla ya está apartada este día por:</span>
                <ul className="mt-1 space-y-0.5">
                  {capillaEventos.map((c) => (
                    <li key={c.quoteId}>
                      • {c.cliente}
                      {c.horario ? ` — ${c.horario}` : ' — horario por definir'}
                    </li>
                  ))}
                </ul>
                <span className="mt-1 block italic">Coordina el horario para no encimarse.</span>
              </div>
            )}
          </div>

          {/* Cortesía familiar: marca el evento en verde en la agenda. */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
              esCortesia ? 'border-emerald-600 bg-emerald-600/10' : 'border-ink/12 bg-white/50 hover:border-ink/30'
            }`}
          >
            <input
              type="checkbox"
              checked={esCortesia}
              onChange={(e) => setEsCortesia(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-emerald-600"
            />
            <span className="flex-1">
              <span className="font-medium text-ink">Cortesía familiar</span>
              <span className="block text-xs text-charcoal-soft">
                Marca el evento en verde en la agenda. No afecta el precio.
              </span>
            </span>
          </label>
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

          {/* DJ Hora extra: precio por tipo de evento × horas extra (manual). */}
          {djPrecio != null && (
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
                usaDjHoraExtra ? 'border-gold bg-gold/10' : 'border-ink/12 bg-white/50 hover:border-ink/30'
              }`}
            >
              <input
                type="checkbox"
                checked={usaDjHoraExtra}
                onChange={(e) => setUsaDjHoraExtra(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]"
              />
              <span className="flex-1">
                <span className="font-medium text-ink">DJ Hora extra</span>
                <span className="block text-xs text-charcoal-soft">
                  {formatMXN(djPrecio)} por hora extra. Con alimentos, el DJ de las horas base ya viene incluido.
                </span>
                {usaDjHoraExtra && horasExtra === 0 && (
                  <span className="mt-1 block text-xs font-medium text-gold">
                    Agrega horas extra arriba para que se cobre el DJ.
                  </span>
                )}
              </span>
            </label>
          )}

          <div className="space-y-2">
            {catalog.addOns.map((a) => {
              const active = a.id in addOns;
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
                      onChange={() => toggleAddOn(a.id)}
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
                        onChange={(e) => setAddOns((prev) => ({ ...prev, [a.id]: Number(e.target.value) }))}
                        className="w-20 rounded-md border border-ink/15 px-2 py-1 text-sm"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <FacturacionSection
          requiereFactura={requiereFactura}
          onRequiereFactura={setRequiereFactura}
          datos={fiscales}
          onChange={(patch) => setFiscales((prev) => ({ ...prev, ...patch }))}
          editable={fiscalEditable?.editable ?? true}
          motivoBloqueo={fiscalEditable?.motivo}
          esAdmin={isAdmin}
        />
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
                <BreakdownGrouped breakdown={breakdown} lineLabel={lineLabel} />
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
                        <span className="text-charcoal-soft">Complemento</span>
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
          <strong>{avail.nombre}</strong> ya tiene un evento comprometido en esta fecha. No se
          puede cotizar este espacio para el {fecha}.
        </span>
      </div>
    );
  }
  if (avail.level === 'cotizaciones') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-ink/15 bg-ink/5 px-3 py-2.5 text-sm text-ink-500">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>
          Hay {avail.counts.cotizaciones} contrato(s) para <strong>{avail.nombre}</strong> en
          esta fecha, ninguno con pago aún.
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
