import { formatMXN } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import type { FichaSemana } from '../lib/types.ts';

const si = (v: boolean) => (v ? 'SÍ' : 'NO');
const val = (v: string | number | null | undefined) => (v == null || v === '' ? '—' : String(v));

/**
 * Ficha operativa COMPACTA para imprimir (tabla densa, como la hoja semanal que
 * usa la hacienda). Solo se ve en impresión: en pantalla se usa la tarjeta
 * `FichaOperativaCard`. Densa a propósito para que entren 3 por hoja.
 */
export function FichaOperativaPrint({ f }: { f: FichaSemana }) {
  const h = f.hoja;
  const horarios = [
    h.horaMisa ? `MISA ${h.horaMisa}` : null,
    f.horarioCivil ? `CIVIL ${f.horarioCivil}` : null,
    f.horaInicio ? `INICIO ${f.horaInicio}` : null,
    f.horaTermino ? `TÉRMINO ${f.horaTermino}` : null,
  ]
    .filter(Boolean)
    .join('   ');

  const seguridad =
    h.personalSeguridadHora || h.personalSeguridadElementos != null
      ? `${val(h.personalSeguridadHora)} · ${val(h.personalSeguridadElementos)} elementos`
      : '—';

  return (
    <table className="fop">
      <tbody>
        <tr>
          <th>FECHA</th>
          <td>{formatEventDate(f.fechaEventoISO, 'long')}</td>
          <th>No. INVITADOS</th>
          <td>{f.invitados}</td>
        </tr>
        <tr>
          <th>EVENTO</th>
          <td colSpan={3} className="fop-strong">
            {f.evento}
            {h.nombreFestejado ? `   ${h.nombreFestejado}` : ''}
          </td>
        </tr>
        <tr>
          <th>CLIENTE</th>
          <td colSpan={3}>
            {f.cliente}
            {h.relacionCliente ? `   ${h.relacionCliente}` : ''}
          </td>
        </tr>
        <tr>
          <th>LUGAR</th>
          <td className="fop-strong">{f.espacio}</td>
          <th>CAPILLA</th>
          <td>{f.usaCapilla ? (f.capillaHorario ? `SÍ · ${f.capillaHorario}` : 'SÍ') : 'NO'}</td>
        </tr>
        <tr>
          <th>HORARIOS</th>
          <td colSpan={3}>{horarios || '—'}</td>
        </tr>
        <tr>
          <th>HORAS DEL EVENTO</th>
          <td>{val(f.horasEvento)}</td>
          <th>FOTOGRAFÍA</th>
          <td>{si(h.fotografia)}</td>
        </tr>
        <tr>
          <th>COSTO × HORA EXTRA</th>
          <td>{formatMXN(f.costoHoraExtra)}</td>
          <th>BANQUETERO</th>
          <td>
            {val(h.banquetero)}
            {h.banqueteroPaqHsa ? ' · PAQ. HSA' : ''}
          </td>
        </tr>
        <tr>
          <th>ESTRADO</th>
          <td>{val(h.estrado)}</td>
          <th>PISTA</th>
          <td>{val(h.pista)}</td>
        </tr>
        <tr>
          <th>PERSONAL HSA</th>
          <td colSpan={3} className="fop-pre">
            {val(h.personalHsa)}
          </td>
        </tr>
        <tr>
          <th>SEGURIDAD</th>
          <td>{seguridad}</td>
          <th>LIMPIEZA NOCTURNA</th>
          <td>{si(h.limpiezaNocturna)}</td>
        </tr>
        <tr>
          <th>HABITACIÓN</th>
          <td>{val(h.habitacion)}</td>
          <th>SE QUEDA EQUIPO</th>
          <td>{val(h.seQuedaEquipo)}</td>
        </tr>
        <tr>
          <th>MANIOBRAS</th>
          <td>{h.maniobras ? 'SÍ' : ''}</td>
          <th>FINIQUITO</th>
          <td className={f.finiquito.pendiente ? 'fop-alerta' : ''}>
            {f.finiquito.pagado
              ? 'PAGADO'
              : f.finiquito.pendiente
                ? `PENDIENTE · restan ${formatMXN(f.finiquito.restante)}`
                : 'AL DÍA'}
          </td>
        </tr>
        {h.anotaciones && (
          <tr>
            <th>ANOTACIONES</th>
            <td colSpan={3}>{h.anotaciones}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
