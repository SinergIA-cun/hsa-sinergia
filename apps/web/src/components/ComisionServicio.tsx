import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { normalizaTexto } from '@hsa/shared';
import { MoneyInput, SelectInput, TextInput } from './ui.tsx';
import { formatMXN } from '../lib/money.ts';
import { api } from '../lib/api.ts';
import { productosParaVender, textoComision, useProveedoresLista, type ProductoParaVender } from '../lib/proveedores.ts';

/** Proveedor y comisión de un servicio: lo que le paga a la hacienda (% o monto, uno u otro). */
export interface DatosComision {
  proveedor?: string | null;
  /** Escogidos de "Proveedores" (11-nov-2026). */
  proveedorId?: string | null;
  productoProveedorId?: string | null;
  comisionPct?: number | null;
  comisionMonto?: number | null;
}

type Modo = 'ninguna' | 'pct' | 'monto';

const IVA = 1.16;

/**
 * Quién da un servicio y cuánto le paga a la hacienda (11-nov-2026: el grupo
 * musical de un evento). La comisión es en % del subtotal sin IVA o en monto
 * fijo. La usan los servicios del evento y los cargos del punto de venta.
 *
 * Se puede escoger un producto de "Proveedores": llena proveedor y comisión
 * pactada (y, con `onProducto`, el nombre y el precio del renglón). O teclear
 * el proveedor: si es uno de "Proveedores", queda ligado por su id.
 */
export function ComisionServicio({
  valor,
  base,
  onChange,
  onProducto,
  disabled = false,
}: {
  valor: DatosComision;
  /** Lo que cuesta el servicio, con IVA: para decir cuánto deja el porcentaje. */
  base: number;
  onChange: (patch: DatosComision) => void;
  /** Al escoger un producto: para llenar el nombre y el precio del renglón. */
  onProducto?: (p: ProductoParaVender) => void;
  disabled?: boolean;
}) {
  const listaId = useId();
  const { data: proveedores } = useProveedoresLista();
  const productos = productosParaVender(proveedores);
  const porProveedor = [...new Set(productos.map((p) => p.proveedorNombre))];
  const proveedorPorNombre = new Map((proveedores ?? []).filter((p) => p.activo).map((p) => [normalizaTexto(p.nombre), p]));
  function elegirProducto(id: string) {
    const p = productos.find((x) => x.id === id);
    if (!p) {
      onChange({ productoProveedorId: null });
      return;
    }
    onChange({
      proveedor: p.proveedorNombre,
      proveedorId: p.proveedorId,
      productoProveedorId: p.id,
      comisionPct: p.comisionPct,
      comisionMonto: p.comisionMonto,
    });
    onProducto?.(p);
  }
  // El producto escogido que ya no se ofrece (desactivado): se enseña para no perderlo.
  const productoFuera = valor.productoProveedorId && !productos.some((p) => p.id === valor.productoProveedorId);
  // Prof. Evento: si el proveedor es uno de ellos, el BI lo recibe como agencia
  // (con su id) y, sin comisión capturada, con la de su ficha.
  const { data } = useQuery({
    queryKey: ['banqueteros'],
    queryFn: () => api.get<{ banqueteros: { id: string; nombre: string; comisionPct?: number }[] }>('/api/banqueteros'),
    staleTime: 5 * 60_000,
  });
  const profesionales = data?.banqueteros ?? [];
  const ligado = valor.proveedor
    ? profesionales.find((p) => normalizaTexto(p.nombre) === normalizaTexto(valor.proveedor!))
    : undefined;
  const modo: Modo = valor.comisionMonto != null ? 'monto' : valor.comisionPct != null ? 'pct' : 'ninguna';
  const deja =
    modo === 'monto' ? valor.comisionMonto! : modo === 'pct' ? Math.round((base / IVA) * valor.comisionPct!) / 100 : null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-ink/10 pt-2 sm:col-span-full">
      {(productos.length > 0 || productoFuera) && (
        <SelectInput
          value={valor.productoProveedorId ?? ''}
          onChange={(e) => elegirProducto(e.target.value)}
          aria-label="Producto de un proveedor"
          className="w-full sm:w-auto sm:min-w-[16rem]"
          disabled={disabled}
        >
          <option value="">Escoger producto de un proveedor…</option>
          {productoFuera && <option value={valor.productoProveedorId!}>(producto desactivado)</option>}
          {porProveedor.map((nombre) => (
            <optgroup key={nombre} label={nombre}>
              {productos
                .filter((p) => p.proveedorNombre === nombre)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                    {p.precio != null ? ` · ${formatMXN(p.precio)}` : ''} · comisión {textoComision(p)}
                  </option>
                ))}
            </optgroup>
          ))}
        </SelectInput>
      )}
      <TextInput
        value={valor.proveedor ?? ''}
        onChange={(e) => {
          // Teclear otro nombre suelta el producto; si es uno de "Proveedores", lo liga.
          const texto = e.target.value;
          const prov = proveedorPorNombre.get(normalizaTexto(texto));
          onChange({ proveedor: texto || null, proveedorId: prov?.id ?? null, productoProveedorId: null });
        }}
        placeholder="Proveedor (opcional)"
        aria-label="Proveedor del servicio"
        list={listaId}
        className="min-w-[11rem] flex-1 sm:max-w-64"
        disabled={disabled}
      />
      <datalist id={listaId}>
        {[...proveedorPorNombre.values()].map((p) => (
          <option key={p.id} value={p.nombre} />
        ))}
        {profesionales.map((p) => (
          <option key={p.id} value={p.nombre} />
        ))}
      </datalist>
      <SelectInput
        value={modo}
        onChange={(e) => {
          const m = e.target.value as Modo;
          onChange(
            m === 'pct'
              ? { comisionPct: valor.comisionPct ?? 10, comisionMonto: null }
              : m === 'monto'
                ? { comisionMonto: valor.comisionMonto ?? 0, comisionPct: null }
                : { comisionPct: null, comisionMonto: null },
          );
        }}
        aria-label="Comisión para la hacienda"
        className="w-44"
        disabled={disabled}
      >
        <option value="ninguna">Sin comisión</option>
        <option value="pct">Comisión en %</option>
        <option value="monto">Comisión en monto</option>
      </SelectInput>
      {modo === 'pct' && (
        <TextInput
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={String(valor.comisionPct ?? '')}
          onChange={(e) => onChange({ comisionPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
          aria-label="Porcentaje de comisión"
          className="w-24"
          disabled={disabled}
        />
      )}
      {modo === 'monto' && (
        <MoneyInput
          value={valor.comisionMonto ? String(valor.comisionMonto) : ''}
          onValue={(v) => onChange({ comisionMonto: Number(v) || 0 })}
          placeholder="Monto"
          aria-label="Monto de la comisión"
          className="w-32"
          disabled={disabled}
        />
      )}
      {deja != null && deja > 0 && (
        <span className="text-xs text-charcoal-soft">
          Le deja a la hacienda <span className="font-medium text-ink">{formatMXN(deja)}</span>
        </span>
      )}
      {valor.proveedorId && (
        <span className="w-full text-xs text-emerald-700">De Proveedores: el BI lo recibe con su ficha.</span>
      )}
      {ligado && (
        <span className="w-full text-xs text-emerald-700">
          De Prof. Evento: el BI lo ve como agencia
          {modo === 'ninguna' && ligado.comisionPct != null ? `, con la comisión de su ficha (${ligado.comisionPct}%)` : ''}.
        </span>
      )}
    </div>
  );
}
