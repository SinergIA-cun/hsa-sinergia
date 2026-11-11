import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GIROS_PROVEEDOR } from '@hsa/shared';
import { api } from '../../lib/api.ts';
import { formatMXN } from '../../lib/money.ts';
import { PROVEEDORES_LISTA_KEY } from '../../lib/proveedores.ts';
import { PROVEEDORES_KEY } from '../admin/ProveedoresSection.tsx';
import { apiErrorMessage } from '../admin/shared.tsx';
import { Button, Field, TextInput } from '../ui.tsx';
import { ProductosProveedor } from './ProductosProveedor.tsx';
import type { ProveedorConProductos } from '../../lib/types.ts';

/** Los datos de la ficha que se editan. */
export interface DatosFicha {
  nombre: string;
  giro: string;
  contacto: string;
  telefono: string;
  correo: string;
  razonSocial: string;
  rfc: string;
  notas: string;
}

export const fichaVacia: DatosFicha = { nombre: '', giro: '', contacto: '', telefono: '', correo: '', razonSocial: '', rfc: '', notas: '' };

const desdeProveedor = (p: ProveedorConProductos): DatosFicha => ({
  nombre: p.nombre,
  giro: p.giro ?? '',
  contacto: p.contacto ?? '',
  telefono: p.telefono ?? '',
  correo: p.correo ?? '',
  razonSocial: p.razonSocial ?? '',
  rfc: p.rfc ?? '',
  notas: p.notas ?? '',
});

/** Los campos de la ficha. La datalist de giros solo sugiere: el giro es texto libre. */
export function CamposFicha({ d, set, disabled }: { d: DatosFicha; set: (p: Partial<DatosFicha>) => void; disabled: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Nombre">
        <TextInput value={d.nombre} onChange={(e) => set({ nombre: e.target.value })} disabled={disabled} />
      </Field>
      <Field label="Giro">
        <TextInput value={d.giro} onChange={(e) => set({ giro: e.target.value })} list="giros-proveedor" placeholder="Flores, Sonido, DJ…" disabled={disabled} />
      </Field>
      <Field label="Contacto">
        <TextInput value={d.contacto} onChange={(e) => set({ contacto: e.target.value })} placeholder="Con quién se habla" disabled={disabled} />
      </Field>
      <Field label="Teléfono">
        <TextInput type="tel" value={d.telefono} onChange={(e) => set({ telefono: e.target.value })} disabled={disabled} />
      </Field>
      <Field label="Correo">
        <TextInput type="email" value={d.correo} onChange={(e) => set({ correo: e.target.value })} disabled={disabled} />
      </Field>
      <Field label="RFC">
        <TextInput value={d.rfc} onChange={(e) => set({ rfc: e.target.value.toUpperCase() })} maxLength={13} disabled={disabled} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Razón social">
          <TextInput value={d.razonSocial} onChange={(e) => set({ razonSocial: e.target.value })} disabled={disabled} />
        </Field>
      </div>
      <div className="sm:col-span-2">
      <Field label="Notas">
        <textarea
          value={d.notas}
          onChange={(e) => set({ notas: e.target.value })}
          rows={2}
          disabled={disabled}
          className="w-full rounded-lg border border-ink/15 bg-white/70 px-3.5 py-2.5 text-sm text-charcoal focus:border-gold focus:outline-none"
        />
      </Field>
      </div>
      <datalist id="giros-proveedor">
        {GIROS_PROVEEDOR.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
    </div>
  );
}

/** Lo que se manda a la API: vacío = sin dato. */
export const cuerpoFicha = (d: DatosFicha) => ({
  nombre: d.nombre.trim(),
  giro: d.giro.trim(),
  contacto: d.contacto.trim(),
  telefono: d.telefono.trim(),
  correo: d.correo.trim(),
  razonSocial: d.razonSocial.trim(),
  rfc: d.rfc.trim(),
  notas: d.notas.trim(),
});

/**
 * El detalle de un proveedor: su ficha, sus productos con comisión pactada y los
 * servicios del catálogo vigente que da. Un admin edita; los demás consultan.
 */
export function FichaProveedor({ proveedor, esAdmin }: { proveedor: ProveedorConProductos; esAdmin: boolean }) {
  const qc = useQueryClient();
  const [d, setD] = useState<DatosFicha>(() => desdeProveedor(proveedor));
  const [error, setError] = useState('');
  const original = desdeProveedor(proveedor);
  const cambio = JSON.stringify(d) !== JSON.stringify(original);
  const refrescar = async () => {
    await qc.invalidateQueries({ queryKey: PROVEEDORES_LISTA_KEY });
    await qc.invalidateQueries({ queryKey: PROVEEDORES_KEY });
  };
  const guardar = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/api/admin/proveedores/${proveedor.id}`, data),
    onSuccess: async () => {
      setError('');
      await refrescar();
    },
    onError: (e) => setError(apiErrorMessage(e, 'No se pudo guardar el proveedor.')),
  });

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.15fr]">
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-charcoal-soft">Datos</h3>
        <CamposFicha d={d} set={(p) => setD((x) => ({ ...x, ...p }))} disabled={!esAdmin || guardar.isPending} />
        {esAdmin && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => guardar.mutate({ activo: !proveedor.activo })}
              disabled={guardar.isPending}
              className="text-xs text-charcoal-soft hover:text-ink hover:underline"
            >
              {proveedor.activo ? 'Desactivar proveedor' : 'Reactivar proveedor'}
            </button>
            {cambio && (
              <span className="flex gap-2">
                <Button variant="ghost" onClick={() => setD(original)} disabled={guardar.isPending}>
                  Descartar
                </Button>
                <Button variant="gold" onClick={() => guardar.mutate(cuerpoFicha(d))} disabled={guardar.isPending || !d.nombre.trim()}>
                  Guardar datos
                </Button>
              </span>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-sm text-wine">{error}</p>}
      </div>

      <div className="space-y-6">
        <ProductosProveedor proveedorId={proveedor.id} productos={proveedor.productos} esAdmin={esAdmin} />
        {proveedor.serviciosCatalogo.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-charcoal-soft">En el catálogo {proveedor.serviciosCatalogo[0]!.catalogo}</h3>
            <ul className="space-y-1 text-sm">
              {proveedor.serviciosCatalogo.map((s) => (
                <li key={s.id} className={`flex flex-wrap justify-between gap-2 ${s.activo ? 'text-ink' : 'text-charcoal-soft line-through'}`}>
                  <span>{s.nombre}</span>
                  <span className="text-charcoal-soft">
                    {formatMXN(s.price)} sin IVA · {s.comisionPct != null ? `${s.comisionPct}%` : 'sin comisión'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-charcoal-soft">Se editan en Admin → Catálogos → Servicios.</p>
          </div>
        )}
      </div>
    </div>
  );
}
