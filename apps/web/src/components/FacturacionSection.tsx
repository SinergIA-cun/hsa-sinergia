import { Check, X, FileText } from 'lucide-react';
import { REGIMENES_FISCALES, USOS_CFDI, requisitosFactura, type DatosFiscales } from '@hsa/shared';
import { Card, Field, TextInput, SelectInput } from './ui.tsx';

interface Props {
  requiereFactura: boolean;
  onRequiereFactura: (v: boolean) => void;
  datos: DatosFiscales;
  onChange: (patch: Partial<DatosFiscales>) => void;
}

/**
 * Datos fiscales del cliente (CFDI 4.0) y la lista de lo que falta para poder
 * facturarle. Los datos viven en el CLIENTE, no en el evento: se capturan una
 * vez y se reaprovechan en todos sus eventos.
 */
export function FacturacionSection({ requiereFactura, onRequiereFactura, datos, onChange }: Props) {
  const requisitos = requisitosFactura(datos);
  const faltan = requisitos.filter((r) => !r.ok).length;

  return (
    <Card className="space-y-4 p-6">
      <h2 className="font-display text-xl text-ink">Facturación</h2>

      <label
        className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
          requiereFactura ? 'border-gold bg-gold/10' : 'border-ink/12 bg-white/50 hover:border-ink/30'
        }`}
      >
        <input
          type="checkbox"
          checked={requiereFactura}
          onChange={(e) => onRequiereFactura(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]"
        />
        <span className="flex-1">
          <span className="font-medium text-ink">Requiere factura</span>
          <span className="block text-xs text-charcoal-soft">
            Los datos fiscales se guardan en el cliente y se reutilizan en sus próximos eventos.
          </span>
        </span>
      </label>

      {requiereFactura && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="RFC">
              <TextInput
                value={datos.rfc ?? ''}
                onChange={(e) => onChange({ rfc: e.target.value.toUpperCase() })}
                placeholder="GODE561231GR8"
              />
            </Field>
            <Field label="Código postal fiscal">
              <TextInput
                value={datos.cpFiscal ?? ''}
                onChange={(e) => onChange({ cpFiscal: e.target.value })}
                placeholder="53100"
              />
            </Field>
          </div>

          <Field label="Razón social" hint="Nombre fiscal exacto, sin 'S.A. de C.V.'">
            <TextInput
              value={datos.razonSocial ?? ''}
              onChange={(e) => onChange({ razonSocial: e.target.value })}
              placeholder="Como aparece en la Constancia de Situación Fiscal"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Régimen fiscal">
              <SelectInput
                value={datos.regimenFiscal ?? ''}
                onChange={(e) => onChange({ regimenFiscal: e.target.value })}
              >
                <option value="">Selecciona…</option>
                {Object.entries(REGIMENES_FISCALES).map(([clave, nombre]) => (
                  <option key={clave} value={clave}>
                    {clave} · {nombre}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Uso del CFDI">
              <SelectInput value={datos.usoCfdi ?? ''} onChange={(e) => onChange({ usoCfdi: e.target.value })}>
                <option value="">Selecciona…</option>
                {Object.entries(USOS_CFDI).map(([clave, nombre]) => (
                  <option key={clave} value={clave}>
                    {clave} · {nombre}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>

          <Field label="Correo para la factura">
            <TextInput
              type="email"
              value={datos.correoFacturacion ?? ''}
              onChange={(e) => onChange({ correoFacturacion: e.target.value })}
              placeholder="Puede ser distinto al de contacto"
            />
          </Field>

          <div className="rounded-lg bg-cream-200/70 p-4">
            <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
              <FileText size={13} />
              {faltan === 0 ? 'Listo para facturar' : `Faltan ${faltan} dato(s) para poder facturar`}
            </p>
            <ul className="space-y-1 text-sm">
              {requisitos.map((r) => (
                <li key={r.campo} className="flex items-start gap-2">
                  {r.ok ? (
                    <Check size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                  ) : (
                    <X size={15} className="mt-0.5 shrink-0 text-wine" />
                  )}
                  <span className={r.ok ? 'text-charcoal-soft line-through' : 'text-ink'}>
                    {r.label}
                    {!r.ok && <span className="block text-xs text-charcoal-soft">{r.ayuda}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </Card>
  );
}
