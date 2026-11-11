import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { formatMXN } from '../../lib/money.ts';
import { PROVEEDORES_LISTA_KEY, textoComision } from '../../lib/proveedores.ts';
import { apiErrorMessage } from '../admin/shared.tsx';
import { Button, MoneyInput, SelectInput, TextInput } from '../ui.tsx';
import type { ProductoProveedor } from '../../lib/types.ts';

type Modo = 'ninguna' | 'pct' | 'monto';

interface Borrador {
  nombre: string;
  precio: string;
  modo: Modo;
  valor: string;
}

const vacio: Borrador = { nombre: '', precio: '', modo: 'pct', valor: '' };

const desdeProducto = (p: ProductoProveedor): Borrador => ({
  nombre: p.nombre,
  precio: p.precio != null ? String(p.precio) : '',
  modo: p.comisionMonto != null ? 'monto' : p.comisionPct != null ? 'pct' : 'ninguna',
  valor: p.comisionMonto != null ? String(p.comisionMonto) : p.comisionPct != null ? String(p.comisionPct) : '',
});

/** Lo que manda la API: la comisión es % o monto, nunca las dos. */
function cuerpo(b: Borrador) {
  const n = Number(b.valor);
  return {
    nombre: b.nombre.trim(),
    precio: b.precio.trim() === '' ? null : Number(b.precio),
    comisionPct: b.modo === 'pct' && b.valor.trim() !== '' ? n : null,
    comisionMonto: b.modo === 'monto' && b.valor.trim() !== '' ? n : null,
  };
}

/** Los campos de un producto: nombre, precio sugerido y comisión pactada. */
function CamposProducto({ b, set, disabled }: { b: Borrador; set: (p: Partial<Borrador>) => void; disabled: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_9rem_10rem_8rem]">
      <TextInput value={b.nombre} onChange={(e) => set({ nombre: e.target.value })} placeholder="Ej.: Centro de mesa" aria-label="Nombre del producto" disabled={disabled} />
      <MoneyInput value={b.precio} onValue={(v) => set({ precio: v })} placeholder="Precio (opcional)" aria-label="Precio sugerido con IVA" disabled={disabled} />
      <SelectInput value={b.modo} onChange={(e) => set({ modo: e.target.value as Modo, valor: '' })} aria-label="Tipo de comisión" disabled={disabled}>
        <option value="pct">Comisión en %</option>
        <option value="monto">Comisión en monto</option>
        <option value="ninguna">Sin comisión</option>
      </SelectInput>
      {b.modo === 'pct' ? (
        <TextInput type="number" min={0} max={100} step={0.5} value={b.valor} onChange={(e) => set({ valor: e.target.value })} placeholder="%" aria-label="Porcentaje de comisión" disabled={disabled} />
      ) : b.modo === 'monto' ? (
        <MoneyInput value={b.valor} onValue={(v) => set({ valor: v })} placeholder="Monto" aria-label="Monto de comisión" disabled={disabled} />
      ) : (
        <span />
      )}
    </div>
  );
}

/**
 * Los productos de un proveedor con su comisión pactada (11-nov-2026). Se
 * escogen al vender un servicio del evento o un cargo: llenan nombre, precio y
 * comisión, que se copian al renglón. Cambiarlos aquí no represia lo vendido.
 */
export function ProductosProveedor({
  proveedorId,
  productos,
  esAdmin,
}: {
  proveedorId: string;
  productos: ProductoProveedor[];
  esAdmin: boolean;
}) {
  const qc = useQueryClient();
  const [nuevo, setNuevo] = useState<Borrador | null>(null);
  const [editando, setEditando] = useState<{ id: string; b: Borrador } | null>(null);
  const [error, setError] = useState('');
  const refrescar = () => qc.invalidateQueries({ queryKey: PROVEEDORES_LISTA_KEY });

  const crear = useMutation({
    mutationFn: (b: Borrador) => api.post(`/api/admin/proveedores/${proveedorId}/productos`, cuerpo(b)),
    onSuccess: async () => {
      setNuevo(null);
      setError('');
      await refrescar();
    },
    onError: (e) => setError(apiErrorMessage(e, 'No se pudo agregar el producto.')),
  });
  const editar = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/api/admin/proveedores/${proveedorId}/productos/${id}`, data),
    onSuccess: async () => {
      setEditando(null);
      setError('');
      await refrescar();
    },
    onError: (e) => setError(apiErrorMessage(e, 'No se pudo guardar el producto.')),
  });
  const ocupado = crear.isPending || editar.isPending;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-charcoal-soft">Productos y comisión pactada</h3>
        {esAdmin && !nuevo && (
          <button type="button" onClick={() => setNuevo(vacio)} className="inline-flex items-center gap-1 text-sm text-gold hover:underline">
            <Plus size={14} /> Agregar producto
          </button>
        )}
      </div>

      {productos.length === 0 && !nuevo && (
        <p className="text-sm text-charcoal-soft">
          {esAdmin ? 'Aún no tiene productos. Agrega lo que vende y lo que le paga a la hacienda por cada uno.' : 'Aún no tiene productos.'}
        </p>
      )}

      {productos.length > 0 && (
        <ul className="divide-y divide-cream-200 rounded-lg border border-ink/10">
          {productos.map((p) =>
            editando?.id === p.id ? (
              <li key={p.id} className="space-y-2 bg-cream-200/50 px-3 py-3">
                <CamposProducto b={editando.b} set={(x) => setEditando({ id: p.id, b: { ...editando.b, ...x } })} disabled={ocupado} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setEditando(null)} disabled={ocupado}>Cancelar</Button>
                  <Button variant="gold" onClick={() => editar.mutate({ id: p.id, data: cuerpo(editando.b) })} disabled={ocupado || !editando.b.nombre.trim()}>
                    Guardar
                  </Button>
                </div>
              </li>
            ) : (
              <li key={p.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm ${p.activo ? '' : 'text-charcoal-soft'}`}>
                <span className={`min-w-0 flex-1 font-medium ${p.activo ? 'text-ink' : 'line-through'}`}>{p.nombre}</span>
                <span className="tabular-nums text-charcoal-soft">{p.precio != null ? formatMXN(p.precio) : 'precio al vender'}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.comisionPct != null || p.comisionMonto != null ? 'bg-gold/15 text-gold' : 'bg-ink/5 text-charcoal-soft'}`}>
                  comisión {textoComision(p)}
                </span>
                {esAdmin && (
                  <span className="flex items-center gap-3">
                    {p.activo && (
                      <button type="button" onClick={() => setEditando({ id: p.id, b: desdeProducto(p) })} aria-label={`Editar ${p.nombre}`} className="text-charcoal-soft hover:text-ink">
                        <Pencil size={14} />
                      </button>
                    )}
                    <button type="button" onClick={() => editar.mutate({ id: p.id, data: { activo: !p.activo } })} className="text-xs text-charcoal-soft hover:text-ink hover:underline" disabled={ocupado}>
                      {p.activo ? 'Desactivar' : 'Reactivar'}
                    </button>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {nuevo && (
        <div className="space-y-2 rounded-lg border border-dashed border-gold/50 bg-gold/5 px-3 py-3">
          <CamposProducto b={nuevo} set={(x) => setNuevo({ ...nuevo, ...x })} disabled={ocupado} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNuevo(null)} disabled={ocupado}>Cancelar</Button>
            <Button variant="gold" onClick={() => crear.mutate(nuevo)} disabled={ocupado || !nuevo.nombre.trim()}>
              Agregar
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-wine">{error}</p>}
    </div>
  );
}
