import { Field, TextInput } from './ui.tsx';

/**
 * El número de la hoja foliada, cuando el recibo se llenó a mano.
 *
 * "Los recibos de papel de septiembre en adelante conservan su número" (el
 * dueño, 5-oct-2026). Vacío = el sistema le da el siguiente de la serie, que es
 * lo normal. Solo lo ve un admin; la API lo exige igual.
 */
export function FolioPapelCampo({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Folio de papel (opcional)" hint="Solo si el recibo se llenó a mano. Vacío: el sistema da el siguiente.">
      <TextInput
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        placeholder="ej. 5341"
      />
    </Field>
  );
}

/** El folio tecleado, listo para mandar: `undefined` si está vacío. */
export function folioPapelParaEnviar(value: string): number | undefined {
  return /^\d+$/.test(value.trim()) && Number(value) > 0 ? Number(value) : undefined;
}
