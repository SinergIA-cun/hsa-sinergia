import { useQuery } from '@tanstack/react-query';
import { ExternalLink, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.ts';
import { formatMXN } from '../../lib/money.ts';
import { formatEventDate, formatFechaHora } from '../../lib/date.ts';
import { BreakdownGrouped } from '../BreakdownGrouped.tsx';
import { useAuth } from '../../auth/auth.tsx';
import { EliminarDelHistorico } from './EliminarDelHistorico.tsx';
import type { DetalleHistorico, FotoEvento } from '../../lib/types.ts';
import { FORMA_PAGO_LABEL, formatFolio, type MetodoPago } from '@hsa/shared';

function Dato({ label, valor }: { label: string; valor: React.ReactNode }) {
  if (valor == null || valor === '' || valor === false) return null;
  return (
    <div>
      <dt className="text-[0.65rem] uppercase tracking-wide text-charcoal-soft">{label}</dt>
      <dd className="text-sm text-ink">{valor === true ? 'Sí' : valor}</dd>
    </div>
  );
}

/** Los campos de la hoja operativa que sí tienen nombre legible. */
const CAMPOS_OPERATIVA: { llave: string; label: string }[] = [
  { llave: 'nombreFestejado', label: 'Festejado' },
  { llave: 'relacionCliente', label: 'Relación con el cliente' },
  { llave: 'banquetero', label: 'Banquetero' },
  { llave: 'horaMisa', label: 'Hora de misa' },
  { llave: 'estrado', label: 'Estrado' },
  { llave: 'pista', label: 'Pista' },
  { llave: 'personalHsa', label: 'Personal HSA' },
  { llave: 'personalSeguridadHora', label: 'Seguridad · hora' },
  { llave: 'personalSeguridadElementos', label: 'Seguridad · elementos' },
  { llave: 'habitacion', label: 'Habitación' },
  { llave: 'seQuedaEquipo', label: 'Se queda equipo' },
  { llave: 'anotaciones', label: 'Anotaciones' },
];

/**
 * La foto abierta.
 *
 * Se lee de arriba abajo como el acta de un evento: quién, dónde, con qué, cuánto
 * costó, cuánto se pagó y cómo se operó. Nada de esto consulta las tablas vivas —
 * todo viene copiado— para que siga significando lo mismo en diez años.
 */
export function FotoEventoVista({ id }: { id: string }) {
  const { user } = useAuth();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['historico-detalle', id],
    queryFn: () => api.get<DetalleHistorico>(`/api/historico/${id}`),
  });

  if (isLoading) return <p className="px-5 pb-5 text-sm text-charcoal-soft">Cargando…</p>;
  if (isError || !data) return <p className="px-5 pb-5 text-sm text-wine">No se pudo cargar.</p>;

  const f: FotoEvento = data.foto;
  const op = f.operativa ?? {};

  return (
    <div className="border-t border-cream-200 bg-cream-100/60 px-5 py-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-charcoal-soft">
          Foto tomada el {formatFechaHora(f.tomadaEnISO)}
          {data.versiones.length > 1 && ` · versión ${data.version} de ${data.versiones.length}`}
        </p>
        {/* La cotización viva sigue existiendo: los pagos se registran ahí. */}
        <span className="inline-flex items-center gap-4">
          <Link
            to={`/eventos/${data.quoteId}`}
            className="inline-flex items-center gap-1.5 text-xs text-ink underline hover:text-gold"
          >
            <ExternalLink size={13} /> Abrir el contrato vivo
          </Link>
          {user?.role === 'admin' && <EliminarDelHistorico quoteId={data.quoteId} cliente={data.foto.cliente.nombre} />}
        </span>
      </div>

      <dl className="mb-6 grid gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        <Dato label="Cliente" valor={f.cliente.nombre} />
        <Dato label="Teléfono" valor={f.cliente.telefono} />
        <Dato label="Correo" valor={f.cliente.correo} />
        <Dato label="Referencia" valor={f.cliente.referencia} />
        <Dato label="Banquetero" valor={f.banquetero} />
        <Dato label="Festejado" valor={f.festejado} />
        <Dato label="Vendedor" valor={f.vendedor} />
        <Dato label="Tipo de evento" valor={f.evento.tipo} />
        <Dato label="Espacios" valor={f.evento.espacios.join(' · ')} />
        <Dato label="Invitados" valor={f.evento.invitados} />
        <Dato label="Horas extra" valor={f.evento.horasExtra || null} />
        <Dato label="Horario" valor={[f.evento.horaInicio, f.evento.horaTermino].filter(Boolean).join(' – ')} />
        <Dato label="Capilla" valor={f.evento.usaCapilla ? (f.evento.capillaHorario ?? 'Sí') : null} />
        <Dato label="Catálogo" valor={f.evento.catalogo} />
        <Dato
          label="Descuento"
          valor={
            f.evento.descuentoPct || f.evento.descuentoMonto
              ? `${f.evento.esPromocion ? 'Promoción' : f.evento.esCortesia ? 'Cortesía' : ''} ${
                  f.evento.descuentoMonto ? formatMXN(f.evento.descuentoMonto) : `${f.evento.descuentoPct}%`
                } · ${f.evento.descuentoMotivo ?? ''}`.trim()
              : null
          }
        />
        <Dato label="RFC" valor={f.cliente.rfc} />
        <Dato label="Razón social" valor={f.cliente.razonSocial} />
      </dl>

      {f.desglose && (
        <section className="mb-6">
          <h4 className="mb-2 font-display text-lg text-ink">Lo que se cobró</h4>
          <div className="rounded-lg border border-cream-300 bg-white p-4">
            <BreakdownGrouped breakdown={f.desglose} />
          </div>
        </section>
      )}

      <section className="mb-6">
        <h4 className="mb-2 font-display text-lg text-ink">Pagos</h4>
        {f.pagos.length === 0 ? (
          <p className="text-sm text-charcoal-soft">No se registró ningún pago.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-cream-300 bg-white">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead>
                <tr className="text-[0.65rem] uppercase tracking-wide text-charcoal-soft">
                  <th className="px-3 py-2 font-medium">Folio</th>
                  <th className="px-3 py-2 font-medium">Fecha</th>
                  <th className="px-3 py-2 font-medium">Concepto</th>
                  <th className="px-3 py-2 font-medium">Método</th>
                  <th className="px-3 py-2 text-right font-medium">Monto</th>
                  <th className="px-3 py-2 font-medium">Registró</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-200">
                {/* Llave por posición: el folio ya no es único dentro de un evento
                    (dos pagos que salen del mismo depósito comparten el suyo). */}
                {f.pagos.map((p, i) => (
                  <tr key={i} className={p.anulado ? 'text-charcoal-soft line-through' : ''}>
                    <td className="px-3 py-1.5 font-mono text-xs">{formatFolio(p.folio, p.folioLetra)}</td>
                    <td className="px-3 py-1.5">{formatEventDate(p.fechaISO)}</td>
                    <td className="px-3 py-1.5">{p.concepto}</td>
                    <td className="px-3 py-1.5">{FORMA_PAGO_LABEL[p.metodo as MetodoPago] ?? p.metodo}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatMXN(p.monto)}</td>
                    <td className="px-3 py-1.5 text-xs text-charcoal-soft">
                      {p.registradoPor ?? '—'}
                      {p.facturado && ' · facturado'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-sm text-charcoal-soft">
          Pagado <strong className="text-ink">{formatMXN(f.totales.pagado)}</strong> · Saldo de la
          renta{' '}
          <strong className={f.totales.saldoRenta > 0 ? 'text-wine' : 'text-ink'}>
            {formatMXN(f.totales.saldoRenta)}
          </strong>
        </p>
      </section>

      {f.cargos && f.cargos.length > 0 && (
        <section className="mb-6">
          <h4 className="mb-2 font-display text-lg text-ink">Cuenta del evento</h4>
          <p className="mb-2 text-xs text-charcoal-soft">Lo que se cargó aparte de la renta: horas extra, multas, invitados de más.</p>
          <div className="overflow-x-auto rounded-lg border border-cream-300 bg-white">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead>
                <tr className="text-[0.65rem] uppercase tracking-wide text-charcoal-soft">
                  <th className="px-3 py-2 font-medium">Fecha</th>
                  <th className="px-3 py-2 font-medium">Concepto</th>
                  <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Registró</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-200">
                {f.cargos.map((c, i) => (
                  <tr key={i} className={c.anulado ? 'text-charcoal-soft line-through' : ''}>
                    <td className="px-3 py-1.5">{formatEventDate(c.fechaISO)}</td>
                    <td className="px-3 py-1.5">{c.descripcion}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {c.cantidad} × {formatMXN(c.precioUnitario)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatMXN(c.total)}</td>
                    <td className="px-3 py-1.5 text-xs text-charcoal-soft">{c.registradoPor ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {f.cuentaCargos && (
            <p className="mt-2 text-sm text-charcoal-soft">
              Cargado <strong className="text-ink">{formatMXN(f.cuentaCargos.total)}</strong> · Cobrado{' '}
              <strong className="text-ink">{formatMXN(f.cuentaCargos.pagado)}</strong> · Saldo de la cuenta{' '}
              <strong className={f.cuentaCargos.saldo > 0 ? 'text-wine' : 'text-ink'}>
                {formatMXN(f.cuentaCargos.saldo)}
              </strong>
            </p>
          )}
        </section>
      )}

      {Object.keys(op).length > 0 && (
        <section className="mb-2">
          <h4 className="mb-2 font-display text-lg text-ink">Hoja operativa</h4>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
            {CAMPOS_OPERATIVA.map(({ llave, label }) => (
              <Dato key={llave} label={label} valor={op[llave] as React.ReactNode} />
            ))}
          </dl>
        </section>
      )}

      {data.versiones.length > 1 && (
        <section className="mt-5 border-t border-cream-300 pt-4">
          <h4 className="mb-2 inline-flex items-center gap-2 font-display text-base text-ink">
            <History size={15} className="text-gold" /> Versiones de esta foto
          </h4>
          {/* Las versiones existen porque una corrección posterior NO sobrescribe:
              lo que decía antes sigue ahí, y eso es lo que la vuelve un archivo. */}
          <ul className="space-y-1 text-sm">
            {data.versiones.map((v) => (
              <li key={v.id} className={v.id === data.id ? 'font-medium text-ink' : 'text-charcoal-soft'}>
                v{v.version} · {v.motivo} · {formatFechaHora(v.tomadaEnISO)}
                {v.id === data.id && ' · la que estás viendo'}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
