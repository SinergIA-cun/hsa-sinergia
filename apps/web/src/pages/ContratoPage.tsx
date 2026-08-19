import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { faltanDatosFactura } from '@hsa/shared';
import { api } from '../lib/api.ts';
import { formatMXNCents, formatPctFraccion } from '../lib/money.ts';
import { formatEventDate } from '../lib/date.ts';
import type { QuoteDetail, Catalog } from '../lib/types.ts';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const BLANK = '________________';

/** Contrato pre-llenado de Hacienda San Andrés (9 páginas), vista de impresión. */
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
  const rentaLines = lines.filter(
    (l) => l.concepto.startsWith('Renta ') || l.concepto === 'Horas extra',
  );
  // TODOS los descuentos, no el primero: desde el Plan G puede haber dos (el 5%
  // por alimentos y el de cortesía). Con un `find`, el de cortesía quedaba
  // invisible mientras el "Total de Renta" ya lo traía restado, y el contrato no
  // cuadraba con lo que el cliente iba a pagar.
  const descuentos = lines.filter((l) => l.concepto.toLowerCase().includes('descuento'));
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
    : rentaLines
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
        </span>
        <button onClick={() => window.print()} className="contrato-btn" style={{ background: '#b0894e', color: '#fff' }}>
          <Printer size={15} /> Imprimir / PDF
        </button>
      </div>

      <div className="doc">
        {/* PÁGINA 1 */}
        <section className="doc-page">
          <div className="marca">Hacienda San Andrés<small>1894</small></div>
          <div className="folio">-1-</div>
          <p>
            Contrato de Prestación de Servicios y Renta de Instalaciones que celebran por una parte{' '}
            <b>Hacienda San Andrés Atoto, S.A.</b> y por la otra parte{' '}
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
              {rentaLines.map((l, i) => (
                <tr key={i}>
                  <td>{l.concepto}</td>
                  <td style={{ textAlign: 'right' }}>{formatMXNCents(l.monto)}</td>
                  <td>IVA incluido</td>
                </tr>
              ))}
              {descuentos.map((l, i) => (
                <tr key={`desc-${i}`}>
                  {/* El concepto lo trae el desglose congelado: incluye el % y, en
                      el de cortesía, el motivo. Eso es lo que hay que imprimir. */}
                  <td>
                    {l.concepto}
                    {l.detalle && <> — {l.detalle}</>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{formatMXNCents(l.monto)}</td>
                  <td />
                </tr>
              ))}
              <tr>
                <td><b>Total de Renta</b></td>
                <td style={{ textAlign: 'right' }}><b>{formatMXNCents(quote.rentaTotal)}</b></td>
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
            <b>E)</b> Hacienda San Andrés Atoto S. A. se compromete a que las instalaciones se encuentren en buenas
            condiciones para su utilización el día del evento.
          </p>
          <p>
            <b>F)</b> El Contratante se compromete a reparar o pagar el valor comercial de cualquier daño o deterioro
            en las instalaciones de Hacienda San Andrés Atoto, S.A. que se llegasen a ocasionar como producto de
            situaciones inherentes al desarrollo normal del evento como son: destrucción de macetas, vidrios, plantas,
            adornos, mobiliario o cualquier otro daño similar. A la conclusión del Evento, El Contratante devolverá las
            instalaciones a Hacienda San Andrés Atoto, S.A. en presencia de un representante de la misma. Hacienda San
            Andrés Atoto, S.A. no se responsabiliza de los daños o desaparición que pueda sufrir cualquier tipo de
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

        {/* PÁGINA 3 */}
        <section className="doc-page">
          <div className="folio">-3-</div>
          <p>
            <b>H)</b> Para reservar el uso de las instalaciones en la fecha y horario requeridos por El Contratante, se
            debe cubrir los siguientes pagos:
          </p>
          {estadoCuenta.planPendiente || !plan ? (
            <p style={{ fontStyle: 'italic' }}>
              El plan de pagos de este espacio se define por separado. Anticipo, complemento y finiquito conforme a lo
              acordado con Hacienda San Andrés Atoto, S.A.
            </p>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Espacio</th><th>Renta</th><th>Apartado</th>
                    <th>Complemento<br />(3 meses después de contratar)</th><th>Finiquito</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.spaceIds.map((id) => {
                    // El monto sale del desglose que calculó el servidor: el contrato
                    // imprime lo que se cobra, no una cuenta recalculada aparte.
                    const d = hitoComplemento?.desglose?.find((x) => x.spaceId === id);
                    const regla = catalogQ.data?.spaces.find((s) => s.id === id)?.paymentRule;
                    return (
                      <tr key={id}>
                        <td>{espaciosById.get(id) ?? id}</td>
                        <td>{d ? formatMXNCents(d.rentaBase) : '—'}</td>
                        <td>{regla ? formatMXNCents(regla.anticipo) : 'por definir'}</td>
                        <td>{d ? `${formatPctFraccion(d.pct)} = ${formatMXNCents(d.monto)}` : 'por definir'}</td>
                        <td />
                      </tr>
                    );
                  })}
                  <tr>
                    <td><b>{quote.spaceIds.length > 1 ? 'Total del evento' : 'Total'}</b></td>
                    <td><b>{formatMXNCents(quote.rentaTotal)}</b></td>
                    <td><b>{hitoApartar ? formatMXNCents(hitoApartar.objetivo) : '—'}</b></td>
                    <td>
                      <b>
                        {hitoComplemento?.desglose
                          ? formatMXNCents(hitoComplemento.desglose.reduce((s, d) => s + d.monto, 0))
                          : '—'}
                      </b>
                    </td>
                    <td>
                      {hitoFiniquito ? formatMXNCents(hitoFiniquito.objetivo) : '—'}, cubierto{' '}
                      {hitoFiniquito?.venceISO ? `el ${formatEventDate(hitoFiniquito.venceISO, 'long')}` : '30 días antes del evento'}.
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="nota">
                El complemento es adicional al apartado. Al cubrirlo, lo pagado acumulado
                suma {hitoComplemento ? formatMXNCents(hitoComplemento.objetivo) : '—'}.
              </p>
            </>
          )}
          <p>
            Si no está liquidado El Evento en su totalidad para la fecha contratada, no se les permitirá el acceso al
            inmueble a ningún organizador, proveedor o invitado. Si algún cheque fuera devuelto por el banco El
            Contratante pagará a Hacienda San Andrés Atoto, S.A. el 20% del monto del mismo, y en este caso Hacienda San
            Andrés Atoto, S.A. se reserva el derecho de dar por cancelado el presente contrato, o exigir el cumplimiento
            del mismo.
          </p>
          <p>
            <b>I)</b> Las partes de común acuerdo determinan que en caso de rescisión o incumplimiento que motive a que
            no se lleve a cabo el evento, se acepta basarse en el siguiente tabulador para penas o devoluciones:
          </p>
          <ol>
            <li>Si avisa faltando 90 días o menos, la parte que incumpla pierde el 100% del costo total.</li>
            <li>Si avisa faltando entre 120 y 91 días, la parte que incumpla pierde el 75% del costo total.</li>
            <li>
              Si avisa faltando más de 120 días, la parte que incumpla pierde el 50% o el primer depósito del costo
              total, y en este único caso, si Hacienda San Andrés Atoto, S.A. lograra rentar la fecha a otra persona
              interesada, reintegrará a El Contratante dicho 50% de anticipo.
            </li>
          </ol>
          <Foot />
        </section>

        {/* PÁGINA 4 */}
        <section className="doc-page">
          <div className="folio">-4-</div>
          <ol start={4}>
            <li>
              No se permiten cambios de fechas a menos que sea para adelantarla o en caso de cierre de actividades
              solicitado por las autoridades de seguridad o salud pública. No obstante, las partes acuerdan reagendar el
              evento sin penalización en caso de fuerza mayor debidamente acreditada, esto sujeto a disponibilidad de las
              fechas de Hacienda San Andrés Atoto S.A. Se entenderá como causa de fuerza mayor a cualquier acontecimiento
              extraordinario, imprevisible o inevitable que imposibilite o haga irrazonablemente gravosa la celebración
              del evento en la fecha programada, incluyendo de manera enunciativa mas no limitativa: fallecimiento de
              alguno de los padres de los contratantes o hermanos; pandemias; emergencias o restricciones sanitarias
              decretadas por autoridades competentes; restricciones gubernamentales; inundaciones; incendios; fenómenos
              naturales; conflictos sociales o cualquier otro evento ajeno al control razonable de las partes.
            </li>
            <li>
              La parte que resulte obligada al pago conforme a los incisos anteriores deberá cubrir el monto
              correspondiente, incluyendo la penalización aplicable, dentro de un plazo máximo de 5 días hábiles contados
              a partir de la fecha de terminación del contrato. El pago deberá realizarse mediante depósito o
              transferencia bancaria a la cuenta que señale la parte acreedora, y su cumplimiento se acreditará con el
              comprobante respectivo.
            </li>
            <li>
              En caso de cancelación por fuerza mayor (fallecimiento), debidamente demostrado por "los contratantes", el
              costo de cancelación será de 0% (cero por ciento) del costo total del evento, siempre y cuando sea al menos
              un mes antes de la fecha del evento.
            </li>
            <li>
              No se permiten cambios de espacios a menos que sea hacia un jardín o salón de Hacienda San Andrés Atoto
              S.A. de mayor capacidad o por causas de fuerza mayor debidamente acreditadas.
            </li>
          </ol>
          <p>
            <b>NOTA:</b> Todos los avisos deben ser hechos por escrito o mediante correo electrónico y con acuse de
            recibo de Hacienda San Andrés Atoto, S.A.
          </p>
          <p>
            <b>J)</b> El Contratante se obliga a notificar a sus clientes e invitados que serán responsables de los
            actos, omisiones y daños ocasionados por ellos mismos o por los proveedores contratados directamente por los
            contratantes para la realización del evento. Será únicamente responsabilidad del propio contratante y de
            ninguna manera de Hacienda San Andrés Atoto, S.A., cuya responsabilidad se limita a tener las instalaciones
            en buenas condiciones de funcionamiento para El Evento de El Contratante.
          </p>
          <Foot />
        </section>

        {/* PÁGINA 5 */}
        <section className="doc-page">
          <div className="folio">-5-</div>
          <p>El Contratante será responsable de manera enunciativa y no limitativa de lo siguiente:</p>
          <ol>
            <li>Del personal al que contrate para el servicio del banquete: (meseros, cocineros, etc.)</li>
            <li>De la calidad y estado de los alimentos y bebidas del servicio de banquete que contraten.</li>
            <li>Del grupo musical, planta de luz y equipo de luces y sonido que se emplee para amenizar el evento.</li>
            <li>De los aparatos, juegos, objetos que se usen para amenizar el evento. Queda prohibido el uso de cualquier tipo de pirotecnia o globo de cantoya.</li>
            <li>En caso de activar pirotecnia o globos de cantoya, se deberá pagar al momento una multa de $10,000 por cada vez que se accione la pirotecnia o se lance un globo de cantoya.</li>
            <li>De la conducta de todos y cada uno de sus invitados o de toda persona que por cualquier razón asista al Evento o se encuentre en las instalaciones de Hacienda San Andrés Atoto, S.A. durante el desarrollo de éste.</li>
          </ol>
          <p>
            Por lo que El Contratante se compromete a sacar en paz y a salvo a Hacienda San Andrés Atoto, S.A. de
            cualquier denuncia, demanda, reclamación, multa o infracción que se deriven de lo anterior.
          </p>
          <p>
            <b>K)</b> El Contratante acepta que su evento sea atendido por un Valet Parking designado por Hacienda San
            Andrés Atoto, S.A., lo cual es conveniente por conocer los alrededores, políticas y reglas del lugar; y por
            simplificar el manejo de los lugares de estacionamiento, sobre todo cuando Hacienda San Andrés Atoto, S.A.
            tenga 2 (dos) o más eventos ese mismo día. Costo por automóvil $100.00 (cien pesos) y El Contratante contará
            con dos cortesías de Valet Parking.
          </p>
          <p>
            Asimismo, acepta que su evento sea atendido por un fotógrafo de mesa en mesa o "de riesgo", el cual sin
            compromiso tratará de vender sus fotos a $80.00 (Ochenta pesos) c/u.
          </p>
          <Foot />
        </section>

        {/* PÁGINA 6 — Firmas */}
        <section className="doc-page">
          <div className="folio">-6-</div>
          <p>
            <b>L)</b> El incumplimiento de cualquiera de las cláusulas comprendidas en este contrato será causa de la
            anulación del mismo, y en este caso Hacienda San Andrés Atoto, S.A. se reserva el derecho de rentar las
            instalaciones a otro posible cliente.
          </p>
          <p>
            Para la interpretación y cumplimiento de éste contrato, las partes se someten expresamente a las leyes
            aplicables y al fuero de los Tribunales competentes ubicados en la Ciudad de México, renunciando a otra
            jurisdicción y al fuero que pudiera corresponderles por domicilio presente o futuro o por cualquier otra
            causa.
          </p>
          <p style={{ marginTop: '2rem' }}>
            Firman de común acuerdo este contrato y reglamento adjunto el día{' '}
            <span className="fill">{hoy.getUTCDate()}</span> de{' '}
            <span className="fill">{MESES[hoy.getUTCMonth()]}</span> del{' '}
            <span className="fill">{hoy.getUTCFullYear()}</span>.
          </p>
          <p style={{ marginTop: '2rem' }}><b>Firmas</b></p>
          <div className="firmas">
            <div className="firma">
              {quote.client?.nombre}
              <div style={{ fontSize: '0.8rem', color: '#777' }}>Cliente</div>
            </div>
            <div className="firma">
              {vendedor || ' '}
              <div style={{ fontSize: '0.8rem', color: '#777' }}>Vendedor · Hacienda San Andrés Atoto S. A.</div>
            </div>
          </div>
          <Foot />
        </section>

        {/* PÁGINA 7 — Reglamento */}
        <section className="doc-page">
          <div className="folio">-7-</div>
          <h2>REGLAMENTO DE PROVEEDORES</h2>
          <ol>
            <li>Es responsabilidad del Cliente la calidad de los alimentos, bebida y servicios contratados por su cuenta.</li>
            <li>Son responsables del buen comportamiento y de comunicar este reglamento a los proveedores y personal que preste cualquier servicio durante su evento.</li>
          </ol>
          <p><b>Manejo de desechos</b></p>
          <ol>
            <li>Está prohibido quitar las tapas de las coladeras y tarjas para tirar restos de alimentos.</li>
            <li>Se debe dejar la basura y restos de alimentos de cada evento y/o degustación en bolsas negras para basura.</li>
            <li>Está prohibido vaciar las bebidas o tirar basura en las jardineras.</li>
            <li>Los espacios asignados para barra de alcohol deberán contar con botes de basura y/o bolsas negras; no debe haber basura en el suelo.</li>
          </ol>
          <p><b>Entrega y Recolección de Equipo</b></p>
          <ol>
            <li>El horario de entrega de equipo es de 8:00 a 18:00 hrs; fuera de este horario se deberá pagar horas extras.</li>
            <li>Salón Los Arcos: el equipo debe contar con tapas de hule en las patas de cada mesa y silla, para evitar rayones.</li>
            <li>No se permite colocar cableado para iluminar las mesas en el salón y en los jardines.</li>
            <li>
              El proveedor tiene 1 hora para el desmontaje; no se permite dejar mobiliario al término de cada evento, de
              lo contrario se tendrá que recoger al siguiente día después de las 8:00 am pagando la siguiente
              penalización:
              <ul>
                <li>a) Mesas, sillas, equipo de cocina en general, audio y video: $5,000 pesos por día.</li>
                <li>b) Letras, Photo Booth, mesas de dulce, estructuras de decoración en general: $1,000 pesos por día.</li>
              </ul>
            </li>
          </ol>
          <Foot />
        </section>

        {/* PÁGINA 8 */}
        <section className="doc-page">
          <div className="folio">-8-</div>
          <ul>
            <li>c) Bases: $500 por bases por día.</li>
          </ul>
          <ol start={5}>
            <li>Hacienda San Andrés no se hace responsable de equipo dañado o perdido durante los días que no se haya recogido; al tercer día después del evento las piezas abandonadas serán desechadas.</li>
            <li>No se permite montar equipo en pasillos y accesos.</li>
            <li>Está prohibido martillar, clavar y pegar cinta en árboles, paredes y mobiliario de Hacienda San Andrés.</li>
          </ol>
          <p><b>Audio y Ambientación</b></p>
          <ol>
            <li>El DJ, conjunto y músicos en general deberán traer su propia planta eléctrica.</li>
            <li>Está prohibido el uso de pirotecnia de cualquier tipo y globos de cantoya. Si se activa cualquier tipo de pirotecnia se cobrará una multa de $10,000 pesos que deberá ser pagada al momento y se invitará a sacar el equipo de pirotecnia; si se hace caso omiso, el proveedor deberá salir de las instalaciones.</li>
            <li>Es obligatorio el uso de velas eléctricas cuando se decore con bombillas colgantes.</li>
            <li>El proveedor debe retirar los alambres o piolas utilizadas para colgar cualquier tipo de decoración.</li>
          </ol>
          <p><b>Inflables.</b> No se permite ningún tipo de juego inflable en el Jardín del Caballo.</p>
          <p><b>Daños a instalaciones.</b> Habrá sanción económica sobre valor factura a quien dañe cualquier instalación y/o equipo de Hacienda San Andrés.</p>
          <p><b>Fotos y Video</b></p>
          <ol>
            <li>No se permite la entrada a fotógrafos de banqueteros o clientes ajenos a los autorizados por Hacienda San Andrés, para la venta de fotografía "de riesgo".</li>
            <li>El uso de drones es responsabilidad del Cliente, quien se hará responsable de los daños causados a las personas o a las instalaciones.</li>
          </ol>
          <p><b>Degustaciones</b></p>
          <ol>
            <li>Las degustaciones deben durar cuatro horas máximo y terminar a más tardar a las 17:00 horas.</li>
          </ol>
          <Foot />
        </section>

        {/* PÁGINA 9 — Aceptación */}
        <section className="doc-page">
          <div className="folio">-9-</div>
          <ol start={2}>
            <li>No están permitidas las degustaciones para eventos contratados en otros recintos para eventos.</li>
          </ol>
          <p>Estas restricciones son medidas de Protección Civil estatal y de seguridad interna.</p>

          {/* Datos de facturación justo ANTES de la firma: el cliente firma debajo de los
              datos fiscales que declara. Va aquí y no en la página 1 porque aquella solo
              tiene 132px libres —el bloque la desbordaba y corría los folios de las 9
              páginas—, mientras que esta última hoja está a media capacidad. */}
          {quote.requiereFactura && (
            <div style={{ marginTop: '2rem' }}>
              <p style={{ marginBottom: '0.25rem' }}><b>Datos de facturación</b></p>
              <div className="fiscal-grid">
                <span><small>RFC</small><span className="fill">{quote.client?.rfc || BLANK}</span></span>
                <span><small>Razón social</small><span className="fill">{quote.client?.razonSocial || BLANK}</span></span>
                <span><small>Régimen fiscal</small><span className="fill">{quote.client?.regimenFiscal || BLANK}</span></span>
                <span><small>C.P. fiscal</small><span className="fill">{quote.client?.cpFiscal || BLANK}</span></span>
                <span><small>Uso del CFDI</small><span className="fill">{quote.client?.usoCfdi || BLANK}</span></span>
                <span><small>Correo para la factura</small><span className="fill">{quote.client?.correoFacturacion || BLANK}</span></span>
              </div>
              {faltanDatosFactura(quote.client ?? {}) && (
                <p style={{ fontStyle: 'italic' }}>
                  Faltan datos para poder emitir la factura; se solicitarán antes del evento.
                </p>
              )}
            </div>
          )}

          <div className="firmas" style={{ marginTop: quote.requiereFactura ? '3rem' : '6rem' }}>
            <div className="firma" style={{ maxWidth: '28rem', margin: '0 auto' }}>
              {quote.client?.nombre}
              <div style={{ fontSize: '0.8rem', color: '#777' }}>Nombre y Firma de aceptación del Cliente</div>
            </div>
          </div>
          <Foot />
        </section>
      </div>
    </div>
  );
}

function Foot() {
  return (
    <div className="foot">
      Atlacomulco No. 1, Col. San Esteban, Naucalpan de Juárez, Estado de México. Tel 5357 1986 y 5357 2833
      <br />
      www.haciendasanandres.com.mx
    </div>
  );
}
