import { Check, X, FileText, Lock, ShieldAlert } from 'lucide-react';
import { REGIMENES_FISCALES, USOS_CFDI, requisitosFactura, type DatosFiscales } from '@hsa/shared';
import { Card, Field, TextInput, SelectInput } from './ui.tsx';

interface Props {
  requiereFactura: boolean;
  onRequiereFactura: (v: boolean) => void;
  datos: DatosFiscales;
  onChange: (patch: Partial<DatosFiscales>) => void;
  /** `false` cuando ya se emitió una factura con estos datos. */
  editable?: boolean;
  motivoBloqueo?: string | null;
  /** Un admin puede corregir datos ya facturados; el cambio queda en la bitácora. */
  esAdmin?: boolean;
}

/**
 * Datos fiscales del cliente (CFDI 4.0) y la lista de lo que falta para poder
 * facturarle. Los datos viven en el CLIENTE, no en el evento: se capturan una
 * vez y se reaprovechan en todos sus eventos.
 */
export function FacturacionSection({
  requiereFactura,
  onRequiereFactura,
  datos,
  onChange,
  editable = true,
  motivoBloqueo,
  esAdmin = false,
}: Props) {
  const requisitos = requisitosFactura(datos);
  const faltan = requisitos.filter((r) => !r.ok).length;
  // Por omisión editable: una cotización nueva no tiene pagos y se captura igual que siempre.
  const congelado = editable === false;
  // El candado congela los datos para ventas, no para admin: el servidor aplica
  // la misma excepción, así que deshabilitar los campos aquí solo escondería la
  // única salida que tiene la operación cuando hay que cancelar y reemitir.
  const bloqueado = congelado && !esAdmin;

  return (
    <Card className="space-y-4 p-6">
      <h2 className="font-display text-xl text-ink">Facturación del cliente</h2>

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
          {bloqueado && (
            <p className="flex items-start gap-2 rounded-lg border border-ink/15 bg-ink/5 px-3 py-2.5 text-sm text-ink-500">
              <Lock size={15} className="mt-0.5 shrink-0" />
              <span>{motivoBloqueo ?? 'Los datos fiscales ya no se pueden modificar.'}</span>
            </p>
          )}

          {congelado && esAdmin && (
            <p className="flex items-start gap-2 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2.5 text-sm text-ink">
              <ShieldAlert size={15} className="mt-0.5 shrink-0 text-gold" />
              <span>
                Ya se facturó con estos datos. Puedes cambiarlos porque eres administrador;
                quedará registrado en la bitácora. Cancela primero el CFDI que salió con los datos viejos.
              </span>
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="RFC">
              <TextInput
                value={datos.rfc ?? ''}
                onChange={(e) => onChange({ rfc: e.target.value.toUpperCase() })}
                placeholder="GODE561231GR8"
                disabled={bloqueado}
              />
            </Field>
            <Field label="Código postal fiscal">
              <TextInput
                value={datos.cpFiscal ?? ''}
                onChange={(e) => onChange({ cpFiscal: e.target.value })}
                placeholder="53100"
                disabled={bloqueado}
              />
            </Field>
          </div>

          <Field label="Razón social" hint="Nombre fiscal exacto, sin 'S.A. de C.V.'">
            <TextInput
              value={datos.razonSocial ?? ''}
              onChange={(e) => onChange({ razonSocial: e.target.value })}
              placeholder="Como aparece en la Constancia de Situación Fiscal"
              disabled={bloqueado}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Régimen fiscal">
              <SelectInput
                value={datos.regimenFiscal ?? ''}
                onChange={(e) => onChange({ regimenFiscal: e.target.value })}
                disabled={bloqueado}
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
              <SelectInput
                value={datos.usoCfdi ?? ''}
                onChange={(e) => onChange({ usoCfdi: e.target.value })}
                disabled={bloqueado}
              >
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
              disabled={bloqueado}
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
