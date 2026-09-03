import { faltanDatosFactura } from '@hsa/shared';
import { formatMXNCents, formatPctFraccion } from '../../lib/money.ts';
import { formatEventDate } from '../../lib/date.ts';
import { MARCA } from '../../lib/marca.ts';
import { BLANK, Foot, MESES, type ClausulasProps } from './comun.tsx';

/**
 * El clausulado del DEMO: términos genéricos de salón de eventos.
 *
 * Existe porque el demo se le enseña a otros salones —la competencia de
 * Hacienda San Andrés— y su contrato trae sus condiciones comerciales reales:
 * el tabulador de cancelación, la multa por pirotecnia, la tarifa del valet, el
 * reglamento de proveedores. Eso no se le enseña a un competidor.
 *
 * Cubre el mismo terreno que el de verdad —pagos, cancelación, daños,
 * responsabilidades, proveedores, firma— con condiciones inventadas y redondas.
 * Lo que se está demostrando es que el sistema IMPRIME el contrato ya llenado
 * con los datos del evento; para eso, el texto solo necesita ser creíble.
 *
 * NO ES ASESORÍA LEGAL Y NO ESTÁ REVISADO POR UN ABOGADO. Es texto de
 * demostración. Si algún día un cliente quisiera usarlo de base para el suyo,
 * tiene que pasar por su abogado antes. Por eso la página 3 lo dice en voz alta,
 * en el propio documento.
 *
 * La tabla del plan de pagos SÍ es la de verdad: sale del mismo cálculo que el
 * contrato real, porque es justamente lo que la demo quiere lucir.
 */
export function ClausulasNeutras({
  quote,
  estadoCuenta,
  plan,
  hitoApartar,
  hitoComplemento,
  hitoFiniquito,
  espaciosById,
  hoy,
  vendedor,
}: ClausulasProps) {
  return (
    <>
      {/* PÁGINA 3 — Pagos y cancelación */}
      <section className="doc-page">
        <div className="folio">-3-</div>
        <p>
          <b>H)</b> Para reservar el uso de las instalaciones en la fecha y horario requeridos por El
          Contratante, se deben cubrir los siguientes pagos:
        </p>
        {estadoCuenta.planPendiente || !plan ? (
          <p style={{ fontStyle: 'italic' }}>
            El plan de pagos de este espacio se define por separado. Anticipo, complemento y
            finiquito conforme a lo acordado con {MARCA.razonSocial}
          </p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Espacio</th>
                  <th>Renta</th>
                  <th>Apartado</th>
                  <th>
                    Complemento
                    <br />
                    (3 meses después de contratar)
                  </th>
                  <th>Finiquito</th>
                </tr>
              </thead>
              <tbody>
                {quote.spaceIds.map((id) => {
                  const d = hitoComplemento?.desglose?.find((x) => x.spaceId === id);
                  const ap = hitoApartar?.desglose?.find((x) => x.spaceId === id);
                  return (
                    <tr key={id}>
                      <td>{espaciosById.get(id) ?? id}</td>
                      <td>{d?.rentaBase != null ? formatMXNCents(d.rentaBase) : '—'}</td>
                      <td>{ap ? formatMXNCents(ap.monto) : 'por definir'}</td>
                      <td>
                        {d?.pct != null
                          ? `${formatPctFraccion(d.pct)} = ${formatMXNCents(d.monto)}`
                          : 'por definir'}
                      </td>
                      <td />
                    </tr>
                  );
                })}
                <tr>
                  <td>
                    <b>{quote.spaceIds.length > 1 ? 'Total del evento' : 'Total'}</b>
                  </td>
                  <td>
                    <b>{formatMXNCents(quote.rentaTotal)}</b>
                  </td>
                  <td>
                    <b>{hitoApartar ? formatMXNCents(hitoApartar.objetivo) : '—'}</b>
                  </td>
                  <td>
                    <b>
                      {hitoComplemento?.desglose
                        ? formatMXNCents(hitoComplemento.desglose.reduce((s, d) => s + d.monto, 0))
                        : '—'}
                    </b>
                  </td>
                  <td>
                    {hitoFiniquito ? formatMXNCents(hitoFiniquito.objetivo) : '—'}, cubierto{' '}
                    {hitoFiniquito?.venceISO
                      ? `el ${formatEventDate(hitoFiniquito.venceISO, 'long')}`
                      : '30 días antes del evento'}
                    .
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="nota">
              El complemento es adicional al apartado. Al cubrirlo, lo pagado acumulado suma{' '}
              {hitoComplemento ? formatMXNCents(hitoComplemento.objetivo) : '—'}.
            </p>
          </>
        )}
        <p>
          El Evento debe estar liquidado en su totalidad antes de la fecha contratada. Si no lo
          está, no se permitirá el acceso al inmueble a organizadores, proveedores ni invitados.
        </p>
        <p>
          <b>I)</b> Si por rescisión o incumplimiento el evento no se lleva a cabo, las partes
          acuerdan el siguiente tabulador de penas o devoluciones, contado desde la fecha del
          evento:
        </p>
        <table>
          <thead>
            <tr>
              <th>Aviso</th>
              <th>Pierde la parte que incumple</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>60 días o menos</td>
              <td>100% del costo total</td>
            </tr>
            <tr>
              <td>Entre 61 y 120 días</td>
              <td>50% del costo total</td>
            </tr>
            <tr>
              <td>Más de 120 días</td>
              <td>El anticipo de apartado</td>
            </tr>
          </tbody>
        </table>
        <p>
          En caso de fuerza mayor debidamente acreditada, las partes reagendarán el evento sin
          penalización, sujeto a disponibilidad de fechas. Se entiende por fuerza mayor cualquier
          acontecimiento extraordinario, imprevisible o inevitable ajeno al control razonable de las
          partes.
        </p>
        <p className="nota">
          Texto de demostración. Este clausulado es genérico e ilustrativo: sirve para mostrar cómo
          el sistema imprime el contrato ya llenado con los datos del evento. No sustituye al
          contrato de ningún salón ni constituye asesoría legal.
        </p>
        <Foot />
      </section>

      {/* PÁGINA 4 — Responsabilidades y proveedores */}
      <section className="doc-page">
        <div className="folio">-4-</div>
        <p>
          <b>J)</b> El Contratante es responsable de los actos, omisiones y daños ocasionados por
          sus invitados y por los proveedores que contrate directamente, de manera enunciativa y no
          limitativa:
        </p>
        <ol>
          <li>Del personal de servicio del banquete que contrate: meseros, cocineros y capitanes.</li>
          <li>De la calidad y el estado de los alimentos y bebidas que se sirvan.</li>
          <li>Del grupo musical, la planta de luz y el equipo de audio e iluminación.</li>
          <li>De los juegos, aparatos y objetos que se usen para amenizar el evento.</li>
          <li>De la conducta de todas las personas que asistan al evento o se encuentren en las instalaciones durante su desarrollo.</li>
        </ol>
        <p>
          El Contratante se compromete a sacar en paz y a salvo a {MARCA.razonSocial} de cualquier
          reclamación, demanda, multa o infracción que se derive de lo anterior.
        </p>
        <p>
          <b>K)</b> Los proveedores externos deberán acreditarse ante la administración al menos 48
          horas antes del evento, respetar los horarios de montaje y desmontaje acordados, y retirar
          su equipo el día siguiente del evento. El montaje no puede modificar la instalación
          eléctrica ni fijarse a muros, árboles o mobiliario.
        </p>
        <p>
          <b>L)</b> Queda prohibido el uso de pirotecnia, globos de cantoya y cualquier material
          inflamable dentro de las instalaciones, por disposición de Protección Civil.
        </p>
        <p>
          El Contratante devolverá las instalaciones a {MARCA.razonSocial} al concluir el evento, en
          presencia de un representante, y cubrirá el valor comercial de cualquier daño ocasionado
          durante su desarrollo.
        </p>
        <Foot />
      </section>

      {/* PÁGINA 5 — Firmas */}
      <section className="doc-page">
        <div className="folio">-5-</div>
        <p>
          <b>M)</b> El incumplimiento de cualquiera de las cláusulas de este contrato es causa de su
          anulación, y en ese caso {MARCA.razonSocial} se reserva el derecho de rentar las
          instalaciones a otro cliente.
        </p>
        <p>
          Todos los avisos entre las partes deben hacerse por escrito o por correo electrónico, con
          acuse de recibo.
        </p>
        <p>
          Para la interpretación y el cumplimiento de este contrato, las partes se someten a las
          leyes aplicables y a los tribunales competentes del domicilio de {MARCA.razonSocial},
          renunciando a cualquier otro fuero que pudiera corresponderles.
        </p>

        {quote.requiereFactura && (
          <div style={{ marginTop: '2rem' }}>
            <p style={{ marginBottom: '0.25rem' }}>
              <b>Datos de facturación</b>
            </p>
            <div className="fiscal-grid">
              <span>
                <small>RFC</small>
                <span className="fill">{quote.client?.rfc || BLANK}</span>
              </span>
              <span>
                <small>Razón social</small>
                <span className="fill">{quote.client?.razonSocial || BLANK}</span>
              </span>
              <span>
                <small>Régimen fiscal</small>
                <span className="fill">{quote.client?.regimenFiscal || BLANK}</span>
              </span>
              <span>
                <small>C.P. fiscal</small>
                <span className="fill">{quote.client?.cpFiscal || BLANK}</span>
              </span>
              <span>
                <small>Uso del CFDI</small>
                <span className="fill">{quote.client?.usoCfdi || BLANK}</span>
              </span>
              <span>
                <small>Correo para la factura</small>
                <span className="fill">{quote.client?.correoFacturacion || BLANK}</span>
              </span>
            </div>
            {faltanDatosFactura(quote.client ?? {}) && (
              <p style={{ fontStyle: 'italic' }}>
                Faltan datos para poder emitir la factura; se solicitarán antes del evento.
              </p>
            )}
          </div>
        )}

        <p style={{ marginTop: '2rem' }}>
          Firman de común acuerdo este contrato el día{' '}
          <span className="fill">{hoy.getUTCDate()}</span> de{' '}
          <span className="fill">{MESES[hoy.getUTCMonth()]}</span> del{' '}
          <span className="fill">{hoy.getUTCFullYear()}</span>.
        </p>
        <p style={{ marginTop: '2rem' }}>
          <b>Firmas</b>
        </p>
        <div className="firmas">
          <div className="firma">
            {quote.client?.nombre}
            <div style={{ fontSize: '0.8rem', color: '#777' }}>Cliente</div>
          </div>
          <div className="firma">
            {vendedor || ' '}
            <div style={{ fontSize: '0.8rem', color: '#777' }}>
              Vendedor · {MARCA.razonSocial}
            </div>
          </div>
        </div>
        <Foot />
      </section>
    </>
  );
}
