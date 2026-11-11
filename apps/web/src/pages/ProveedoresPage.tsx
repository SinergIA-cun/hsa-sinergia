import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Phone, Plus, Search } from 'lucide-react';
import { coincideTexto } from '@hsa/shared';
import { useAuth } from '../auth/auth.tsx';
import { api } from '../lib/api.ts';
import { PROVEEDORES_LISTA_KEY, textoComision, useProveedoresLista } from '../lib/proveedores.ts';
import { PROVEEDORES_KEY } from '../components/admin/ProveedoresSection.tsx';
import { apiErrorMessage } from '../components/admin/shared.tsx';
import { ArrowDivider, Button, Card, TextInput } from '../components/ui.tsx';
import { CamposFicha, FichaProveedor, cuerpoFicha, fichaVacia, type DatosFicha } from '../components/proveedores/FichaProveedor.tsx';

/**
 * Proveedores (11-nov-2026): flores, sonido, DJ, pista de baile… con sus datos y
 * la comisión pactada por producto. Vive junto a Prof. Evento porque es cartera,
 * no configuración: ventas escoge de aquí al vender. Dar de alta y cambiar
 * comisiones es de admin.
 */
export function ProveedoresPage() {
  const { user } = useAuth();
  const esAdmin = user?.role === 'admin';
  const qc = useQueryClient();
  const { data: proveedores = [], isLoading } = useProveedoresLista();
  const [busqueda, setBusqueda] = useState('');
  const [giro, setGiro] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [alta, setAlta] = useState<DatosFicha | null>(null);
  const [error, setError] = useState('');

  // Los giros que de verdad se usan, para filtrar con un toque.
  const giros = useMemo(
    () => [...new Set(proveedores.map((p) => p.giro?.trim()).filter((g): g is string => Boolean(g)))].sort((a, b) => a.localeCompare(b)),
    [proveedores],
  );
  const visibles = proveedores.filter(
    (p) =>
      (verInactivos || p.activo) &&
      (!giro || p.giro === giro) &&
      (!busqueda.trim() || coincideTexto([p.nombre, p.giro, p.contacto, ...p.productos.map((x) => x.nombre)], busqueda)),
  );

  const crear = useMutation({
    mutationFn: (d: DatosFicha) => api.post<{ proveedor: { id: string } }>('/api/admin/proveedores', cuerpoFicha(d)),
    onSuccess: async (r) => {
      setAlta(null);
      setError('');
      await qc.invalidateQueries({ queryKey: PROVEEDORES_LISTA_KEY });
      await qc.invalidateQueries({ queryKey: PROVEEDORES_KEY });
      setAbierto(r.proveedor.id);
    },
    onError: (e) => setError(apiErrorMessage(e, 'No se pudo dar de alta el proveedor.')),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <ArrowDivider>Cartera</ArrowDivider>
          <h1 className="mt-2 font-display text-4xl text-ink">Proveedores</h1>
          <p className="mt-1 max-w-2xl text-sm text-charcoal-soft">
            Quién da las flores, el sonido, el DJ, la pista… y lo que le paga a la hacienda por cada producto. Al vender un
            servicio del evento o un cargo, se escoge el producto y la comisión pactada se llena sola.
          </p>
        </div>
        {esAdmin && !alta && (
          <Button variant="gold" onClick={() => setAlta(fichaVacia)}>
            <Plus size={16} /> Nuevo proveedor
          </Button>
        )}
      </div>

      {alta && (
        <Card className="space-y-4 border-gold/40 p-6">
          <h2 className="font-display text-xl text-ink">Nuevo proveedor</h2>
          <CamposFicha d={alta} set={(p) => setAlta((x) => (x ? { ...x, ...p } : x))} disabled={crear.isPending} />
          <p className="text-xs text-charcoal-soft">Después de darlo de alta le agregas sus productos y la comisión de cada uno.</p>
          {error && <p role="alert" className="text-sm text-wine">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAlta(null)} disabled={crear.isPending}>Cancelar</Button>
            <Button variant="gold" onClick={() => crear.mutate(alta)} disabled={crear.isPending || !alta.nombre.trim()}>
              Dar de alta
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft" />
          <TextInput value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar proveedor o producto" className="pl-9" aria-label="Buscar proveedor" />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por giro">
          {['', ...giros].map((g) => (
            <button
              key={g || 'todos'}
              type="button"
              onClick={() => setGiro(g)}
              aria-pressed={giro === g}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                giro === g ? 'border-ink bg-ink text-cream-100' : 'border-ink/15 bg-white/60 text-charcoal hover:border-ink/40'
              }`}
            >
              {g || 'Todos'}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm text-charcoal-soft">
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} className="h-4 w-4 accent-[var(--color-gold)]" />
          Ver inactivos
        </label>
      </div>

      {isLoading ? (
        <p className="text-sm text-charcoal-soft">Cargando…</p>
      ) : visibles.length === 0 ? (
        <Card className="p-8 text-center text-sm text-charcoal-soft">
          {proveedores.length === 0
            ? esAdmin
              ? 'Aún no hay proveedores. Da de alta al de flores, sonido, DJ, pista de baile…'
              : 'Aún no hay proveedores dados de alta.'
            : 'Ningún proveedor coincide con la búsqueda.'}
        </Card>
      ) : (
        <ul className="space-y-3">
          {visibles.map((p) => {
            const abiertoAqui = abierto === p.id;
            const activos = p.productos.filter((x) => x.activo);
            return (
              <li key={p.id}>
                <Card className={`overflow-hidden transition-shadow ${abiertoAqui ? 'shadow-md' : 'hover:shadow-md'} ${p.activo ? '' : 'opacity-70'}`}>
                  <button
                    type="button"
                    onClick={() => setAbierto(abiertoAqui ? null : p.id)}
                    aria-expanded={abiertoAqui}
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-xl text-ink">{p.nombre}</span>
                        {p.giro && <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-medium text-gold">{p.giro}</span>}
                        {!p.activo && <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs text-charcoal-soft">Inactivo</span>}
                      </span>
                      <span className="mt-0.5 block text-sm text-charcoal-soft">
                        {activos.length === 0
                          ? 'Sin productos'
                          : activos
                              .slice(0, 3)
                              .map((x) => `${x.nombre} (comisión ${textoComision(x)})`)
                              .join(' · ') + (activos.length > 3 ? ` · y ${activos.length - 3} más` : '')}
                      </span>
                    </span>
                    {(p.contacto || p.telefono) && (
                      <span className="flex items-center gap-1.5 text-sm text-charcoal-soft">
                        <Phone size={14} /> {[p.contacto, p.telefono].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    <ChevronDown size={18} className={`text-charcoal-soft transition-transform ${abiertoAqui ? 'rotate-180' : ''}`} />
                  </button>
                  {abiertoAqui && (
                    <div className="border-t border-cream-300 px-5 py-5">
                      <FichaProveedor key={`${p.id}-${p.nombre}`} proveedor={p} esAdmin={esAdmin} />
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
