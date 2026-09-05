import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatMXNCents } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import type { QuoteDetail, Catalog } from '../lib/types.ts';
import { MARCA } from '../lib/marca.ts';
import { BLANK, Foot, type ClausulasProps } from './contrato/comun.tsx';
import { ClausulasHSA } from './contrato/ClausulasHSA.tsx';
import { ClausulasNeutras } from './contrato/ClausulasNeutras.tsx';

/** Contrato pre-llenado del salón (9 páginas), vista de impresión. */
export function ContratoPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['quote', id],
    queryFn: () => api.get<QuoteDetail>(`/api/quotes/${id}`),
    retry: false,
  });
  const catalogQ = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<Catalog>('/api/catalog'),
  });

  // El catálogo entra en la espera: sin él los espacios saldrían con su id crudo y
  // los renglones de pago dirían "por definir". Es un contrato que se firma, así que
  // no se imprime hasta tener los nombres y las reglas reales.
  if (isLoading || catalogQ.isLoading) {
    return <div className="grid min-h-screen place-items-center text-ink-500">Cargando contrato…</div>;
  }
  if (isError || !data) {
    return <div className="grid min-h-screen place-items-center text-wine">No se encontró la cotización.</div>;
  }
  if (catalogQ.isError || !catalogQ.data) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center text-wine">
        No se pudo cargar el catálogo de espacios. El contrato no se muestra sin los nombres y las reglas de pago
        correctos; vuelve a intentarlo.
      </div>
    );
  }

  const { quote, estadoCuenta } = data;
  const plan = estadoCuenta.plan;
  const hitoApartar = plan?.find((m) => m.key === 'apartar');
  const hitoComplemento = plan?.find((m) => m.key === 'complemento');
  const hitoFiniquito = plan?.find((m) => m.key === 'finiquito');
  const lines = quote.breakdown.lines;
  // Los renglones de renta salen del GRUPO de la línea, NUNCA del texto del
  // concepto. Filtrar por texto ('Renta ' y 'Horas extra') dejaba la Capilla
  // fuera de la tabla mientras el pie imprimía `quote.rentaTotal`, que sí la
  // trae: todo evento de sábado con capilla imprimía una tabla cuyos renglones
  // sumaban $5,000 menos que su propio total, en un documento que se firma.
  // El grupo también recoge los dos descuentos, que antes se imprimían en un
  // filtro aparte (y con `find` en vez de `filter` solo salía el primero).
  //
  // `rentaTotal` es EXACTAMENTE la suma de las líneas del grupo `renta`: mientras
  // el filtro sea el grupo, la tabla cuadra sola aunque el motor gane renglones.
  const tieneGrupos = lines.some((l) => l.grupo);
  const rentaLines = tieneGrupos
    ? lines.filter((l) => l.grupo === 'renta')
    : // Desgloses congelados antes de que la línea llevara `grupo`. Se listan sus
      // conceptos de renta por texto porque es lo único que traen; no hay forma
      // mejor, y ninguno de ellos puede tener descuento de cortesía ni extras.
      lines.filter(
        (l) =>
          l.concepto.startsWith('Renta ') ||
          l.concepto === 'Horas extra' ||
          l.concepto === 'Capilla' ||
          l.concepto.toLowerCase().includes('descuento'),
      );
  // El pie de la tabla imprime el total del DESGLOSE, no la columna `rentaTotal`
  // de la cotización: esa columna es un entero (`Math.round`), así que con un
  // descuento que cae en medio peso decía 61,963.00 mientras los renglones
  // sumaban 61,962.50. Un contrato cuyos renglones no suman su propio total es
  // justo lo que este bloque existe para evitar. Los desgloses viejos (sin
  // grupo) no traen el total por bloque: para ellos sigue mandando la columna.
  const rentaTotalImpreso = tieneGrupos ? quote.breakdown.rentaTotal : quote.rentaTotal;
  const foodLine = lines.find((l) => l.concepto.startsWith('Alimentos '));
  // Servicios sueltos y add-ons: todo lo de "otros" que no sea el paquete de
  // alimentos, que ya se imprime en su propia tabla.
  const serviciosLines = lines.filter((l) => l.grupo === 'otros' && !l.concepto.startsWith('Alimentos '));
  const paqueteNombre = foodLine ? foodLine.concepto.replace('Alimentos ', '') : null;
  const espaciosById = new Map((catalogQ.data?.spaces ?? []).map((s) => [s.id, s.nombre]));
  // Nombres de los espacios del evento. Se prefiere `spaceId` de las líneas; si el
  // desglose es anterior a ese campo, se usa el texto del concepto como respaldo.
  const nombresEspacios = quote.spaceIds.length > 0
    ? quote.spaceIds.map((id) => espaciosById.get(id) ?? id)
    : lines
        .filter((l) => l.concepto.startsWith('Renta '))
        .map((l) => l.concepto.replace('Renta ', ''));
  const espacioNombre = nombresEspacios.length > 0 ? nombresEspacios.join(' y ') : BLANK;

  const hoy = new Date();
  const correo = quote.client?.correo || '____________';
  const horarioCivil = quote.horarioCivil || BLANK;
  const horaInicio = quote.horaInicio || BLANK;
  const horaTermino = quote.horaTermino || BLANK;
  const horasEvento = quote.horasEvento != null ? String(quote.horasEvento) : '____';
  const vendedor = quote.createdBy?.nombre || '';

  const propsClausulas: ClausulasProps = {
    quote,
    estadoCuenta,
    plan,
    hitoApartar,
    hitoComplemento,
    hitoFiniquito,
    espaciosById,
    hoy,
    vendedor,
  };

  return (
    <div className="contrato-root">
      <style>{`
        .contrato-root { background: #f3f3f0; color: #1a1a1a; font-family: Georgia, 'Times New Roman', serif; }
        .contrato-toolbar { position: sticky; top: 0; z-index: 10; display: flex; justify-content: space-between;
          align-items: center; gap: 1rem; padding: 0.75rem 1.25rem; background: #14304d; color: #f7f2e8; }
        .contrato-btn { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem;
          border-radius: 0.5rem; font-family: 'Archivo', system-ui, sans-serif; font-size: 0.85rem; cursor: pointer; }
        .doc { max-width: 46rem; margin: 1.5rem auto; }
        .doc-page { background: #fff; padding: 4rem 3.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 12px rgba(0,0,0,0.12);
          min-height: 60rem; line-height: 1.55; font-size: 0.95rem; }
        .doc-page h2 { text-align: center; font-size: 1.5rem; letter-spacing: 0.05em; margin: 0 0 0.5rem; }
        .doc-page .marca { text-align: center; font-size: 1.4rem; letter-spacing: 0.02em; }
        .doc-page .marca small { display: block; font-size: 0.6rem; letter-spacing: 0.35em; color: #b0894e; margin-top: 2px; }
        .doc-page .folio { text-align: center; color: #888; font-size: 0.8rem; margin: 0.25rem 0 2rem; }
        .doc-page p { margin: 0 0 0.85rem; text-align: justify; }
        .doc-page .fill { color: #14304d; font-weight: 600; }
        .doc-page table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; font-size: 0.9rem; }
        .doc-page td, .doc-page th { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
        .doc-page .fiscal-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.35rem 0.9rem; margin: 0.35rem 0 0.4rem; font-size: 0.85rem; }
        .doc-page .fiscal-grid > span { display: flex; flex-direction: column; border: 1px solid #ccc; padding: 0.3rem 0.5rem; }
        .doc-page .fiscal-grid small { color: #666; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.03em; }
        .doc-page .campo-row { display: flex; gap: 0.75rem; margin: 0.35rem 0; }
        .doc-page .campo-row b { min-width: 11rem; }
        .doc-page .campo-row span { border-bottom: 1px solid #999; flex: 1; }
        .doc-page .nota { font-size: 0.82rem; color: #555; font-style: italic; margin-top: -0.35rem; }
        .doc-page ol, .doc-page ul { margin: 0 0 0.85rem 1.25rem; }
        .doc-page li { margin-bottom: 0.4rem; text-align: justify; }
        .doc-page .firmas { display: flex; justify-content: space-between; gap: 3rem; margin-top: 4rem; text-align: center; }
        .doc-page .firma { flex: 1; border-top: 1px solid #333; padding-top: 0.4rem; }
        .doc-page .foot { margin-top: 3rem; padding-top: 0.75rem; border-top: 1px solid #ddd; text-align: center;
          font-size: 0.7rem; color: #777; }
        @media print {
          .contrato-root { background: #fff; }
          .contrato-toolbar { display: none; }
          .doc { max-width: none; margin: 0; }
          .doc-page { box-shadow: none; margin: 0; padding: 2.5rem 3rem; min-height: auto; break-after: page; }
          .doc-page:last-child { break-after: auto; }
        }
      `}</style>

      <div className="contrato-toolbar">
        <Link to={`/cotizaciones/${quote.id}`} className="contrato-btn" style={{ border: '1px solid rgba(247,242,232,0.4)' }}>
          <ArrowLeft size={15} /> Volver
        </Link>
        <span style={{ fontFamily: 'Archivo, sans-serif', fontSize: '0.85rem' }}>
          Contrato · {quote.client?.nombre}
          {` · ${quote.folio}`}
        </span>
        <button onClick={() => window.print()} className="contrato-btn" style={{ background: '#b0894e', color: '#fff' }}>
          <Printer size={15} /> Imprimir / PDF
        </button>
      </div>

      <div className="doc">
        {/* PÁGINA 1 */}
        <section className="doc-page">
          <div className="marca">{MARCA.nombre}<small>{MARCA.anio}</small></div>
          {/* El código de evento va en la primera página: es el identificador que
              alguien va a copiar del contrato al recibo o al correo. */}
          <div className="folio">
            Evento <b>{quote.folio}</b>{quote.etiqueta ? ` · ${quote.etiqueta}` : ''} · -1-
          </div>
          <p>
            Contrato de Prestación de Servicios y Renta de Instalaciones que celebran por una parte{' '}
            <b>{MARCA.razonSocial}</b> y por la otra parte{' '}
            <span className="fill">{quote.client?.nombre}</span> (<span className="fill">{correo}</span>) a
            quien en lo sucesivo se le denominará <b>El Contratante</b> sujetándose ambas partes a las siguientes:
          </p>
          <p><b>CLÁUSULAS</b></p>
          <p><b>A)</b> Descripción del evento:</p>
          <div className="campo-row"><b>Tipo de evento</b><span className="fill">{quote.eventType?.nombre}</span></div>
          <div className="campo-row"><b>Número de invitados</b><span className="fill">{quote.invitados}</span></div>
          <div className="campo-row"><b>Fecha del evento</b><span className="fill">{formatEventDate(quote.fechaEvento, 'long')}</span></div>
          <div className="campo-row"><b>Horario civil</b><span className="fill">{horarioCivil}</span></div>
          <div className="campo-row"><b>Horario de inicio</b><span className="fill">{horaInicio}</span></div>
          <div className="campo-row"><b>Horario de término</b><span className="fill">{horaTermino}</span></div>
          <p style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}>
            * Se ofrecen 30 min. de aforo y 30 min. de salida más las horas del evento.
          </p>
          <p><b>B)</b> Las instalaciones contratadas para este evento son: <span className="fill">{espacioNombre}</span></p>
          <p><b>C)</b> El precio por la renta de las instalaciones contratadas es de:</p>
          <table>
            <tbody>
              {/* Un solo recorrido, en el orden del desglose congelado. El concepto
                  y el detalle vienen de ahí: el detalle trae el motivo del
                  descuento de cortesía y el "2 × 5% renta" de las horas extra. */}
              {rentaLines.map((l, i) => (
                <tr key={i}>
                  <td>
                    {l.concepto}
                    {l.detalle && <> — {l.detalle}</>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{formatMXNCents(l.monto)}</td>
                  <td>{l.monto < 0 ? '' : 'IVA incluido'}</td>
                </tr>
              ))}
              <tr>
                <td><b>Total de Renta</b></td>
                <td style={{ textAlign: 'right' }}><b>{formatMXNCents(rentaTotalImpreso)}</b></td>
                <td>IVA incluido</td>
              </tr>
            </tbody>
          </table>
          {foodLine && (
            <>
              <p style={{ marginTop: '1rem' }}>El precio del paquete es de:</p>
              <table>
                <tbody>
                  <tr>
                    <td><span className="fill">{paqueteNombre}</span></td>
                    <td style={{ textAlign: 'right' }}>{formatMXNCents(foodLine.monto)}</td>
                    <td>IVA no incluido</td>
                  </tr>
                  <tr>
                    <td>Número de invitados</td>
                    <td style={{ textAlign: 'right' }}>{quote.invitados}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </>
          )}
          {serviciosLines.length > 0 && (
            <>
              <p style={{ marginTop: '1rem' }}>Servicios adicionales contratados para este evento:</p>
              <table>
                <tbody>
                  {serviciosLines.map((l, i) => (
                    <tr key={`serv-${i}`}>
                      <td>
                        {l.concepto}
                        {l.detalle && <> ({l.detalle})</>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatMXNCents(l.monto)}</td>
                      <td>{l.ivaIncluido ? 'IVA incluido' : 'IVA no incluido'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <Foot />
        </section>

        {/* PÁGINA 2 */}
        <section className="doc-page">
          <div className="folio">-2-</div>
          {foodLine && (
            <table>
              <tbody>
                <tr>
                  <td><b>Total de Paquete</b></td>
                  <td style={{ textAlign: 'right' }}><b>{formatMXNCents(foodLine.monto)}</b></td>
                  <td>IVA no incluido</td>
                </tr>
              </tbody>
            </table>
          )}
          <p style={{ marginTop: '1.5rem' }}>Incluye, además:</p>
          <ul>
            <li>Personal de vigilancia</li>
            <li>Personal de limpieza en los sanitarios</li>
            <li>Servicio de guardarropa.</li>
            <li>Estrado y pista (40m2 Campos o Arcos / 100m2 Cúpula)</li>
            <li>Calentadores (4 Campos / 6 Cúpula).</li>
          </ul>
          <p>
            <b>D)</b> La renta de las instalaciones cubre hasta <span className="fill">{horasEvento}</span> horas de
            evento. Por cada hora extra de duración del evento se cobrará el 5% del precio de renta.
          </p>
          <p>
            <b>E)</b> {MARCA.razonSocial} se compromete a que las instalaciones se encuentren en buenas
            condiciones para su utilización el día del evento.
          </p>
          <p>
            <b>F)</b> El Contratante se compromete a reparar o pagar el valor comercial de cualquier daño o deterioro
            en las instalaciones de {MARCA.razonSocial} que se llegasen a ocasionar como producto de
            situaciones inherentes al desarrollo normal del evento como son: destrucción de macetas, vidrios, plantas,
            adornos, mobiliario o cualquier otro daño similar. A la conclusión del Evento, El Contratante devolverá las
            instalaciones a {MARCA.razonSocial} en presencia de un representante de la misma. {MARCA.razonSocial} no se responsabiliza de los daños o desaparición que pueda sufrir cualquier tipo de
            equipo o bienes que sean dejados en las instalaciones; antes, durante y después del Evento, ni por daños en
            equipos derivados de alteraciones de energía eléctrica o por robos o conductas vandálicas; no adquiriendo en
            virtud de éste contrato ninguna de las responsabilidades que el Código Civil para la Ciudad de México prevé
            para el depositario.
          </p>
          <p>
            <b>G)</b> Los invitados tendrán acceso al evento mediante invitación y/o boletos personales impresos o
            digitales.
          </p>
          <Foot />
        </section>

        {/* Las páginas 3 a 9 son los TÉRMINOS, y ahí se bifurca: el clausulado
            de verdad o el neutro del demo. Las dos primeras páginas —las partes,
            la descripción y las tablas de precio— son iguales, porque eso es lo
            que el sistema llena y es lo que la demo quiere enseñar. */}
        {MARCA.contrato === 'neutro' ? (
          <ClausulasNeutras {...propsClausulas} />
        ) : (
          <ClausulasHSA {...propsClausulas} />
        )}
      </div>
    </div>
  );
}

