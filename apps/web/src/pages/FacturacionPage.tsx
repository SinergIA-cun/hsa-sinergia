import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ChevronDown, Receipt, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXN } from '../lib/money.ts';
import { formatFechaHora } from '../lib/date.ts';
import { apiErrorMessage } from '../components/admin/shared.tsx';
import { ArrowDivider, Button, Card } from '../components/ui.tsx';
import {
  FilaFacturado,
  FilaFueraDeLaApp,
  FilaPendiente,
  type EstadoEnvio,
  type FilaPago,
  type VistaPac,
} from '../components/facturacion/FilasFacturacion.tsx';

interface Panel {
  mes: string;
  pacConfigurado: boolean;
  facturados: { cantidad: number; monto: number; montoFueraDeLaApp: number; pagos: FilaPago[] };
  pendientes: { cantidad: number; monto: number; pagos: FilaPago[] };
  noSeFacturan: FilaPago[];
  fueraDeLaApp: VistaPac[];
  ultimaRevision: { inicio: string; ok: boolean; nuevas: number; actualizadas: number; error: string | null } | null;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** El mes en curso en Cancún, "2026-11". */
const mesDeHoy = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 7);

function moverMes(mes: string, delta: number): string {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

const nombreMes = (mes: string) => {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  return `${MESES[m - 1]} ${y}`;
};

/**
 * Facturación (26-nov-2026). Solo entra quien tenga el permiso. Primero lo
 * facturado y luego lo pendiente; el efectivo no aparece porque no se factura.
 * "Facturar todo" hace una factura por pago, una tras otra: nunca agrupa.
 */
export function FacturacionPage() {
  const qc = useQueryClient();
  const [mes, setMes] = useState(mesDeHoy);
  const [estados, setEstados] = useState<Record<string, EstadoEnvio>>({});
  const [facturandoTodo, setFacturandoTodo] = useState<{ hecho: number; total: number } | null>(null);
  const [confirmarTodo, setConfirmarTodo] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [verNoSe, setVerNoSe] = useState(false);

  const key = ['facturacion-panel', mes] as const;
  const { data, isLoading, isError, error } = useQuery({
    queryKey: key,
    queryFn: () => api.get<Panel>(`/api/facturacion/panel?mes=${mes}`),
  });
  const refrescar = () => qc.invalidateQueries({ queryKey: ['facturacion-panel'] });

  const ponerEstado = (id: string, e: EstadoEnvio) => setEstados((prev) => ({ ...prev, [id]: e }));

  async function facturarUno(id: string): Promise<boolean> {
    ponerEstado(id, { tipo: 'enCurso' });
    try {
      const r = await api.post<{ uuid: string }>(`/api/facturacion/pagos/${id}/facturar`);
      ponerEstado(id, { tipo: 'ok', uuid: r.uuid });
      return true;
    } catch (e) {
      ponerEstado(id, { tipo: 'error', mensaje: apiErrorMessage(e, 'No se pudo facturar.') });
      return false;
    }
  }

  async function facturarEste(id: string) {
    await facturarUno(id);
    await refrescar();
  }

  /** Uno por uno, en orden: si uno falla, se sigue con los demás. */
  async function facturarTodo() {
    if (!data) return;
    setConfirmarTodo(false);
    const ids = data.pendientes.pagos.map((p) => p.pagoId).filter((id) => estados[id]?.tipo !== 'ok');
    setFacturandoTodo({ hecho: 0, total: ids.length });
    let fallidos = 0;
    for (const [i, id] of ids.entries()) {
      if (!(await facturarUno(id))) fallidos++;
      setFacturandoTodo({ hecho: i + 1, total: ids.length });
    }
    setFacturandoTodo(null);
    setAviso(fallidos ? `Listo: ${ids.length - fallidos} facturados, ${fallidos} con error (revisa cada uno).` : `Listo: ${ids.length} facturas, una por pago.`);
    await refrescar();
  }

  async function revisarAhora() {
    setRevisando(true);
    setAviso('');
    try {
      const r = await api.post<{ ok: boolean; nuevas: number; actualizadas: number; error: string | null }>('/api/facturacion/revisar');
      setAviso(r.ok ? `PAC revisado: ${r.nuevas} nuevas, ${r.actualizadas} actualizadas.` : `No se pudo revisar el PAC: ${r.error}`);
    } catch (e) {
      setAviso(apiErrorMessage(e, 'No se pudo revisar el PAC.'));
    } finally {
      setRevisando(false);
      await refrescar();
    }
  }

  const ocupado = facturandoTodo != null || revisando;
  const pendientesVivos = data?.pendientes.pagos.filter((p) => estados[p.pagoId]?.tipo !== 'ok') ?? [];
  const rev = data?.ultimaRevision;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <ArrowDivider>Administración</ArrowDivider>
          <h1 className="mt-2 font-display text-4xl text-ink">Facturación</h1>
          <p className="mt-1 max-w-2xl text-sm text-charcoal-soft">
            Lo facturado y lo pendiente de facturar del mes. Cada pago se factura por sí solo. El efectivo no se factura y no
            aparece aquí.
          </p>
        </div>
        <nav className="flex items-center gap-1 rounded-full border border-ink/15 bg-white/70 p-1" aria-label="Mes">
          <button type="button" className="rounded-full p-2 text-ink hover:bg-ink/5" aria-label="Mes anterior" onClick={() => setMes((m) => moverMes(m, -1))}>
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[9.5rem] text-center font-display text-lg capitalize text-ink">{nombreMes(mes)}</span>
          <button
            type="button"
            className="rounded-full p-2 text-ink hover:bg-ink/5 disabled:opacity-30"
            aria-label="Mes siguiente"
            disabled={mes >= mesDeHoy()}
            onClick={() => setMes((m) => moverMes(m, 1))}
          >
            <ChevronRight size={16} />
          </button>
        </nav>
      </header>

      {isLoading && <p className="text-sm text-charcoal-soft">Cargando…</p>}
      {isError && <p className="text-sm text-wine">{apiErrorMessage(error, 'No se pudo cargar la facturación.')}</p>}

      {data && (
        <>
          <section className="grid gap-4 md:grid-cols-[1fr_1fr_minmax(0,1.1fr)]">
            <Card className="p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Facturado</p>
              <p className="mt-1 font-display text-4xl tabular-nums text-ink">{formatMXN(data.facturados.monto)}</p>
              <p className="text-sm text-charcoal-soft">{data.facturados.cantidad} {data.facturados.cantidad === 1 ? 'factura' : 'facturas'}</p>
              {data.facturados.montoFueraDeLaApp > 0 && (
                <p className="text-xs text-charcoal-soft">incluye {formatMXN(data.facturados.montoFueraDeLaApp)} hechas directo en el PAC</p>
              )}
            </Card>
            <Card className={`p-5 ${data.pendientes.cantidad > 0 ? 'ring-1 ring-gold/50' : ''}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">Pendiente de facturar</p>
              <p className="mt-1 font-display text-4xl tabular-nums text-ink">{formatMXN(data.pendientes.monto)}</p>
              <p className="text-sm text-charcoal-soft">{data.pendientes.cantidad} {data.pendientes.cantidad === 1 ? 'pago' : 'pagos'}</p>
            </Card>
            <Card className="flex flex-col justify-between gap-3 p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-charcoal-soft">Revisión del PAC</p>
                <p className="mt-1 text-sm text-charcoal">
                  {rev ? (
                    <>
                      Última: {formatFechaHora(rev.inicio)}{' '}
                      {rev.ok ? <span className="text-emerald-700">· bien</span> : <span className="text-wine">· falló</span>}
                    </>
                  ) : (
                    'Todavía no se ha revisado.'
                  )}
                </p>
                <p className="text-xs text-charcoal-soft">Se revisa sola a las 8:00, 13:00 y 19:00 (Cancún).</p>
              </div>
              <Button type="button" variant="outline" className="self-start px-3 py-1.5 text-xs" disabled={ocupado || !data.pacConfigurado} onClick={revisarAhora}>
                <RefreshCw size={13} className={revisando ? 'animate-spin' : ''} /> Revisar ahora
              </Button>
            </Card>
          </section>

          {!data.pacConfigurado && (
            <p className="rounded-lg border border-wine/30 bg-wine/5 px-4 py-3 text-sm text-wine">
              El PAC no está configurado en el servidor: no se puede facturar ni revisar.
            </p>
          )}
          {aviso && <p className="rounded-lg bg-ink/[0.04] px-4 py-3 text-sm text-charcoal" role="status">{aviso}</p>}

          <Card className="p-6">
            <h2 className="font-display text-2xl text-ink">Facturado</h2>
            {data.facturados.pagos.length === 0 ? (
              <p className="mt-3 text-sm text-charcoal-soft">Nada facturado en {nombreMes(mes)}.</p>
            ) : (
              <ul className="mt-2 divide-y divide-cream-300">
                {data.facturados.pagos.map((p) => (
                  <FilaFacturado key={p.pagoId} p={p} />
                ))}
              </ul>
            )}
            {data.fueraDeLaApp.length > 0 && (
              <div className="mt-6 border-t border-cream-300 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-charcoal-soft">Hechas directo en el PAC</h3>
                <p className="text-xs text-charcoal-soft">
                  Facturas de este mes que no salen de ningún pago registrado en la app. Los complementos de pago y las notas de
                  crédito se listan pero no suman.
                </p>
                <ul className="mt-1 divide-y divide-cream-300">
                  {data.fueraDeLaApp.map((f) => (
                    <FilaFueraDeLaApp key={f.uuid} f={f} />
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl text-ink">Pendiente de facturar</h2>
              {pendientesVivos.length > 0 && !confirmarTodo && (
                <Button type="button" variant="gold" disabled={ocupado || !data.pacConfigurado} onClick={() => setConfirmarTodo(true)}>
                  <Receipt size={16} />
                  {facturandoTodo ? `Facturando ${facturandoTodo.hecho} de ${facturandoTodo.total}…` : `Facturar todo (${pendientesVivos.length})`}
                </Button>
              )}
            </div>
            {confirmarTodo && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-ink">
                <span>
                  Se harán <strong>{pendientesVivos.length} facturas</strong>, una por cada pago, por{' '}
                  <strong>{formatMXN(pendientesVivos.reduce((s, p) => s + p.montoFacturable, 0))}</strong>. ¿Seguir?
                </span>
                <Button type="button" variant="gold" className="px-3 py-1.5 text-xs" onClick={facturarTodo}>
                  Sí, facturar
                </Button>
                <Button type="button" variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setConfirmarTodo(false)}>
                  Cancelar
                </Button>
              </div>
            )}
            {data.pendientes.pagos.length === 0 ? (
              <p className="mt-3 text-sm text-charcoal-soft">No hay pagos pendientes de facturar en {nombreMes(mes)}.</p>
            ) : (
              <ul className="mt-2 divide-y divide-cream-300">
                {data.pendientes.pagos.map((p) => (
                  <FilaPendiente
                    key={p.pagoId}
                    p={p}
                    estado={estados[p.pagoId]}
                    bloqueado={ocupado || !data.pacConfigurado}
                    onFacturar={() => void facturarEste(p.pagoId)}
                  />
                ))}
              </ul>
            )}

            {data.noSeFacturan.length > 0 && (
              <div className="mt-6 border-t border-cream-300 pt-4">
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-charcoal-soft hover:text-ink"
                  aria-expanded={verNoSe}
                  onClick={() => setVerNoSe((v) => !v)}
                >
                  <ChevronDown size={14} className={`transition-transform ${verNoSe ? 'rotate-180' : ''}`} />
                  No se pueden facturar desde aquí ({data.noSeFacturan.length})
                </button>
                {verNoSe && (
                  <ul className="mt-2 divide-y divide-cream-300">
                    {data.noSeFacturan.map((p) => (
                      <li key={p.pagoId} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-sm">
                        <span className="text-ink">
                          {p.eventoCodigo ?? 'Evento'} · Recibo {p.folioTexto} · {formatMXN(p.montoFacturable)}
                        </span>
                        <span className="text-xs text-charcoal-soft">{p.motivo}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
