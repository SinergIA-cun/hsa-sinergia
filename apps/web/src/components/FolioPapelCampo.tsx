import { SERIE_FOLIO } from '@hsa/shared';
import { Field, TextInput } from './ui.tsx';

/**
 * El número de la hoja foliada, cuando el recibo se llenó a mano.
 *
 * "Los recibos de papel de septiembre en adelante conservan su número" (el
 * dueño, 5-oct-2026). Vacío = el sistema le da el siguiente de la serie, que es
 * lo normal. Solo lo ve un admin; la API lo exige igual.
 *
 * La "I" va pegada al campo y no se teclea (Jorge, 15-oct-2026: "si captura el
 * número le agrega la I"): todos los recibos son de la serie I, así que lo que
 * se escribe es solo el número, y se ve igual que en la hoja y en el recibo. Si
 * alguien la teclea de todos modos ("I 5341", "i5341"), se acepta igual. Cuando
 * desaparezca el papel, el campo simplemente se deja vacío.
 */
export function FolioPapelCampo({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Folio de papel (opcional)" hint="Solo si el recibo se llenó a mano. Vacío: el sistema da el siguiente.">
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-ink"
        >
          {SERIE_FOLIO}
        </span>
        <TextInput
          inputMode="numeric"
          aria-label={`Folio de papel, serie ${SERIE_FOLIO}`}
          value={value}
          onChange={(e) => onChange(soloNumero(e.target.value))}
          placeholder="5341"
          className="pl-6"
        />
      </div>
    </Field>
  );
}

/** "I 5341", "i5341" o "5341" → "5341". */
export function soloNumero(texto: string): string {
  return texto.replace(/^\s*i\s*/i, '').replace(/\D/g, '');
}

/** El folio tecleado, listo para mandar: `undefined` si está vacío. */
export function folioPapelParaEnviar(value: string): number | undefined {
  return /^\d+$/.test(value.trim()) && Number(value) > 0 ? Number(value) : undefined;
}
