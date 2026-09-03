import { faltanDatosFactura } from '@hsa/shared';
import { formatMXNCents, formatPctFraccion } from '../../lib/money.ts';
import { formatEventDate } from '../../lib/date.ts';
import { MARCA } from '../../lib/marca.ts';
import { BLANK, Foot, MESES, type ClausulasProps } from './comun.tsx';

/**
 * El clausulado de Hacienda San Andrés: páginas 3 a 9 del contrato que se firma.
 *
 * Se movió aquí TAL CUAL estaba en `ContratoPage`, sin tocar una palabra. Es un
 * documento legal: lo único que cambió es de qué archivo se lee.
 *
 * La versión neutra del demo vive en `ClausulasNeutras.tsx`; cuál se imprime lo
 * decide `MARCA.contrato`.
 */
export function ClausulasHSA({
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
            acordado con {MARCA.razonSocial}
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
                  // El apartado sale del HITO, no del catálogo: con un descuento
                  // el plan se topa al total y el catálogo diría otro número, así
                  // que los renglones dejarían de sumar el total impreso abajo.
                  const ap = hitoApartar?.desglose?.find((x) => x.spaceId === id);
                  return (
                    <tr key={id}>
                      <td>{espaciosById.get(id) ?? id}</td>
                      <td>{d?.rentaBase != null ? formatMXNCents(d.rentaBase) : '—'}</td>
                      <td>{ap ? formatMXNCents(ap.monto) : 'por definir'}</td>
                      <td>{d?.pct != null ? `${formatPctFraccion(d.pct)} = ${formatMXNCents(d.monto)}` : 'por definir'}</td>
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
          Contratante pagará a {MARCA.razonSocial} el 20% del monto del mismo, y en este caso {MARCA.razonSocial} se reserva el derecho de dar por cancelado el presente contrato, o exigir el cumplimiento
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
            total, y en este único caso, si {MARCA.razonSocial} lograra rentar la fecha a otra persona
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
            fechas de {MARCA.razonSocial} Se entenderá como causa de fuerza mayor a cualquier acontecimiento
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
            No se permiten cambios de espacios a menos que sea hacia un jardín o salón de {MARCA.razonSocial}
            S.A. de mayor capacidad o por causas de fuerza mayor debidamente acreditadas.
          </li>
        </ol>
        <p>
          <b>NOTA:</b> Todos los avisos deben ser hechos por escrito o mediante correo electrónico y con acuse de
          recibo de {MARCA.razonSocial}
        </p>
        <p>
          <b>J)</b> El Contratante se obliga a notificar a sus clientes e invitados que serán responsables de los
          actos, omisiones y daños ocasionados por ellos mismos o por los proveedores contratados directamente por los
          contratantes para la realización del evento. Será únicamente responsabilidad del propio contratante y de
          ninguna manera de {MARCA.razonSocial}, cuya responsabilidad se limita a tener las instalaciones
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
          <li>De la conducta de todos y cada uno de sus invitados o de toda persona que por cualquier razón asista al Evento o se encuentre en las instalaciones de {MARCA.razonSocial} durante el desarrollo de éste.</li>
        </ol>
        <p>
          Por lo que El Contratante se compromete a sacar en paz y a salvo a {MARCA.razonSocial} de
          cualquier denuncia, demanda, reclamación, multa o infracción que se deriven de lo anterior.
        </p>
        <p>
          <b>K)</b> El Contratante acepta que su evento sea atendido por un Valet Parking designado por {MARCA.razonSocial}, lo cual es conveniente por conocer los alrededores, políticas y reglas del lugar; y por
          simplificar el manejo de los lugares de estacionamiento, sobre todo cuando {MARCA.razonSocial}
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
          anulación del mismo, y en este caso {MARCA.razonSocial} se reserva el derecho de rentar las
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
            <div style={{ fontSize: '0.8rem', color: '#777' }}>Vendedor · {MARCA.razonSocial}</div>
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
          <li>{MARCA.nombre} no se hace responsable de equipo dañado o perdido durante los días que no se haya recogido; al tercer día después del evento las piezas abandonadas serán desechadas.</li>
          <li>No se permite montar equipo en pasillos y accesos.</li>
          <li>Está prohibido martillar, clavar y pegar cinta en árboles, paredes y mobiliario de {MARCA.nombre}.</li>
        </ol>
        <p><b>Audio y Ambientación</b></p>
        <ol>
          <li>El DJ, conjunto y músicos en general deberán traer su propia planta eléctrica.</li>
          <li>Está prohibido el uso de pirotecnia de cualquier tipo y globos de cantoya. Si se activa cualquier tipo de pirotecnia se cobrará una multa de $10,000 pesos que deberá ser pagada al momento y se invitará a sacar el equipo de pirotecnia; si se hace caso omiso, el proveedor deberá salir de las instalaciones.</li>
          <li>Es obligatorio el uso de velas eléctricas cuando se decore con bombillas colgantes.</li>
          <li>El proveedor debe retirar los alambres o piolas utilizadas para colgar cualquier tipo de decoración.</li>
        </ol>
        <p><b>Inflables.</b> No se permite ningún tipo de juego inflable en el Jardín del Caballo.</p>
        <p><b>Daños a instalaciones.</b> Habrá sanción económica sobre valor factura a quien dañe cualquier instalación y/o equipo de {MARCA.nombre}.</p>
        <p><b>Fotos y Video</b></p>
        <ol>
          <li>No se permite la entrada a fotógrafos de banqueteros o clientes ajenos a los autorizados por {MARCA.nombre}, para la venta de fotografía "de riesgo".</li>
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
    </>
  );
}
