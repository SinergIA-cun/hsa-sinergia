import { describe, it, expect } from 'vitest';
import { traducir, etiquetaDe, type FilaTraducible } from './lenguaje.js';

/**
 * Las pruebas usan los renglones REALES que el dueño mandó en una captura
 * diciendo "no se entiende". Cada uno de ellos es un caso aquí.
 *
 * Se revisa la frase Y la etiqueta por separado, porque van separadas: la frase
 * dice QUÉ pasó y la etiqueta dice A CUÁL registro. Pegarlas producía español
 * mal escrito —"Abrió la papelera Administrador"— y esconder el folio al final
 * de una oración larga, cuando el folio es justo lo que alguien viene a buscar.
 */
function fila(over: Partial<FilaTraducible>): FilaTraducible {
  return { tabla: 'Quote', operacion: 'UPDATE', campos: [], antes: null, despues: null, ...over };
}

describe('traducir la bitácora forense', () => {
  it('los renglones de la captura del dueño, tal como estaban', () => {
    // UPDATE User · papeleraVistaAt → era la fila más confusa de todas.
    expect(
      traducir(
        fila({
          tabla: 'User',
          campos: ['papeleraVistaAt'],
          antes: { nombre: 'Administrador', papeleraVistaAt: null },
          despues: { nombre: 'Administrador', papeleraVistaAt: '2026-09-09T15:14:00Z' },
        }),
      ).frase,
    ).toBe('Abrió la papelera');

    // UPDATE Quote · deletedAt → no es "editar", es mandar a la papelera.
    const papelera = traducir(
      fila({
        campos: ['deletedAt'],
        antes: { folio: '26SEP-0012', deletedAt: null },
        despues: { folio: '26SEP-0012', deletedAt: '2026-09-08T18:15:00Z' },
      }),
    );
    expect(papelera.frase).toBe('Envió a la papelera un contrato');
    expect(papelera.etiqueta).toBe('26SEP-0012');

    const alta = traducir(fila({ operacion: 'INSERT', despues: { folio: '26SEP-0013' } }));
    expect(alta.frase).toBe('Creó un contrato');
    expect(alta.etiqueta).toBe('26SEP-0013');

    const cliente = traducir(
      fila({ tabla: 'Client', operacion: 'INSERT', despues: { nombre: 'Familia Ballesteros' } }),
    );
    expect(cliente.frase).toBe('Dio de alta un cliente');
    expect(cliente.etiqueta).toBe('Familia Ballesteros');

    const usuario = traducir(
      fila({ tabla: 'User', operacion: 'INSERT', despues: { nombre: 'Jorge Ahumada' } }),
    );
    expect(usuario.frase).toBe('Dio de alta un usuario');
    expect(usuario.etiqueta).toBe('Jorge Ahumada');

    // DELETE PriceList y su contenido: el borrado de catálogo que hicimos.
    const catalogo = traducir(
      fila({ tabla: 'PriceList', operacion: 'DELETE', antes: { nombre: '2028' } }),
    );
    expect(catalogo.frase).toBe('Borró una lista de precios');
    expect(catalogo.etiqueta).toBe('2028');

    const servicio = traducir(
      fila({ tabla: 'AddOn', operacion: 'DELETE', antes: { nombre: 'Pista iluminada' } }),
    );
    expect(servicio.frase).toBe('Borró un servicio del catálogo');
    expect(servicio.etiqueta).toBe('Pista iluminada');

    // Esta tabla no tiene nombre que mostrar: la frase sola tiene que bastar.
    const dj = traducir(
      fila({ tabla: 'DjHoraExtraPrice', operacion: 'DELETE', antes: { price: 2950 } }),
    );
    expect(dj.frase).toBe('Borró un precio del DJ por hora extra');
    expect(dj.etiqueta).toBeNull();
  });

  it('un INSERT de ActivityLog es una consecuencia, no una acción', () => {
    const t = traducir(fila({ tabla: 'ActivityLog', operacion: 'INSERT' }));
    // Enviar un contrato a la papelera escribe también su bitácora: dos
    // renglones del mismo acto, y solo uno es noticia.
    expect(t.relevancia).toBe('secundario');
    expect(t.frase).toBe('Anotó un movimiento en la bitácora de un contrato');
  });

  it('poner o quitar la marca cambia el significado, no solo el campo', () => {
    const restaurar = fila({
      campos: ['deletedAt'],
      antes: { folio: '26SEP-0012', deletedAt: '2026-09-08T18:15:00Z' },
      despues: { folio: '26SEP-0012', deletedAt: null },
    });
    expect(traducir(restaurar).frase).toBe('Restauró un contrato');

    const activar = fila({
      tabla: 'PriceList',
      campos: ['activa'],
      antes: { nombre: '2028', activa: false },
      despues: { nombre: '2028', activa: true },
    });
    expect(traducir(activar).frase).toBe('Activó una lista de precios');

    const desactivar = fila({
      tabla: 'Space',
      campos: ['activo'],
      antes: { nombre: 'Salón Los Arcos', activo: true },
      despues: { nombre: 'Salón Los Arcos', activo: false },
    });
    const t = traducir(desactivar);
    expect(t.frase).toBe('Desactivó un espacio');
    expect(t.etiqueta).toBe('Salón Los Arcos');
  });

  it('el dinero se nombra por su recibo y su monto', () => {
    const pago = traducir(
      fila({ tabla: 'Payment', operacion: 'INSERT', despues: { folio: 37, monto: 5000 } }),
    );
    expect(pago.frase).toBe('Registró un pago');
    expect(pago.etiqueta).toBe('recibo #37');

    const anular = fila({
      tabla: 'Payment',
      campos: ['anuladoAt'],
      antes: { folio: 37, anuladoAt: null },
      despues: { folio: 37, anuladoAt: '2026-09-09T10:00:00Z' },
    });
    expect(traducir(anular).frase).toBe('Anuló un pago');

    const deposito = traducir(
      fila({ tabla: 'PagoBanquetero', operacion: 'INSERT', despues: { monto: 300000 } }),
    );
    expect(deposito.frase).toBe('Registró un depósito de banquetero');
    expect(deposito.etiqueta).toBe('$300,000');
  });

  it('los movimientos que solo se entienden sabiendo el negocio', () => {
    const convertir = traducir(
      fila({
        tabla: 'ApartadoFecha',
        campos: ['quoteId'],
        antes: { fechaEvento: '2029-08-18T00:00:00Z', quoteId: null },
        despues: { fechaEvento: '2029-08-18T00:00:00Z', quoteId: 'abc' },
      }),
    );
    expect(convertir.frase).toBe('Convirtió una fecha apartada en contrato');
    expect(convertir.etiqueta).toBe('2029-08-18');

    const mover = fila({
      campos: ['priceListId'],
      antes: { folio: '26SEP-0012', priceListId: 'a' },
      despues: { folio: '26SEP-0012', priceListId: 'b' },
    });
    expect(traducir(mover).frase).toBe('Movió un contrato a otra lista de precios');

    const estatus = fila({
      campos: ['status'],
      antes: { folio: '26SEP-0012', status: 'borrador' },
      despues: { folio: '26SEP-0012', status: 'formalizada' },
    });
    expect(traducir(estatus).frase).toBe('Cambió el estatus del contrato a formalizada');

    const desbloqueo = traducir(
      fila({
        tabla: 'Payment',
        campos: ['desbloqueoAt'],
        antes: { folio: 37, desbloqueoAt: null },
        despues: { folio: 37, desbloqueoAt: '2026-09-09T10:00:00Z' },
      }),
    );
    expect(desbloqueo.frase).toBe('Desbloqueó los datos fiscales de un pago');
    expect(desbloqueo.etiqueta).toBe('recibo #37');
  });

  it('un cambio de contraseña se dice, aunque el campo esté escondido', () => {
    /*
     * El disparador quita `passwordHash` DESPUÉS de comparar, para no copiar el
     * hash. El efecto es que el único campo que cambió queda invisible y la fila
     * parece no decir nada. Es el movimiento de seguridad que más importa ver.
     *
     * La etiqueta sí importa aquí, y no es redundante con la columna de quién:
     * un administrador puede cambiarle la contraseña a OTRO usuario.
     */
    const t = traducir(
      fila({
        tabla: 'User',
        campos: [],
        antes: { nombre: 'Jorge Ahumada' },
        despues: { nombre: 'Jorge Ahumada' },
      }),
    );
    expect(t.frase).toBe('Cambió una contraseña');
    expect(t.etiqueta).toBe('Jorge Ahumada');
  });

  it('un DELETE se identifica con lo que había ANTES, que es lo único que queda', () => {
    // Es el caso donde más importa poder decir QUÉ se borró.
    expect(
      etiquetaDe(fila({ operacion: 'DELETE', antes: { folio: '26SEP-0012' }, despues: null })),
    ).toBe('26SEP-0012');
  });

  it('la purga y los truncados se explican solos', () => {
    expect(traducir(fila({ tabla: 'AuditoriaDb', operacion: 'PURGA' })).frase).toBe(
      'Vació la bitácora al entregar la instalación',
    );
    /*
     * El truncado se nombra por su tabla técnica a propósito: solo aparece en la
     * purga de entrega, y ahí quien lee necesita saber exactamente qué tabla se
     * vació, no una paráfrasis amable.
     */
    expect(traducir(fila({ tabla: 'Quote', operacion: 'TRUNCATE' })).frase).toBe(
      'Vació por completo la tabla Quote',
    );
  });

  it('una tabla que nadie tradujo no rompe: cae al nombre técnico', () => {
    const t = traducir(fila({ tabla: 'TablaNueva', operacion: 'INSERT' }));
    expect(t.frase).toBe('Agregó TablaNueva');
    expect(t.relevancia).toBe('principal');
  });
});

describe('cuando cambian varias columnas de un jalón', () => {
  /**
   * Estos casos salieron de contar los campos que de verdad cambian en la base,
   * no de imaginar cuáles podrían cambiar.
   */
  function quote(campos: string[], extra: Record<string, unknown> = {}) {
    return traducir({
      tabla: 'Quote',
      operacion: 'UPDATE',
      campos,
      antes: { folio: '26SEP-0012' },
      despues: { folio: '26SEP-0012', ...extra },
    });
  }

  it('mover la fecha se dice como mover la fecha, no como cambiar montos', () => {
    /*
     * Cambiar la fecha recalcula el total, el desglose y la renta: cuatro
     * columnas, UNA decisión. La frase tiene que nombrar la decisión.
     */
    const t = quote(['fechaEvento', 'total', 'breakdown', 'rentaTotal']);
    expect(t.frase).toBe('Cambió la fecha de un contrato');
  });

  it('cambiar los invitados también gana sobre los totales que arrastra', () => {
    expect(quote(['invitados', 'total', 'breakdown']).frase).toBe(
      'Cambió el número de invitados de un contrato',
    );
  });

  it('si los montos cambiaron SOLOS, entonces sí son la noticia', () => {
    // Nadie tocó la fecha ni la gente y el precio se movió: se recotizó.
    expect(quote(['total', 'breakdown', 'rentaTotal']).frase).toBe(
      'Recotizó un contrato: cambiaron los montos',
    );
  });

  it('el estatus manda sobre todo lo demás', () => {
    const t = quote(['status', 'total', 'breakdown'], { status: 'complementada' });
    expect(t.frase).toBe('Cambió el estatus del contrato a complementada');
  });

  it('la vigencia se nombra: era el caso que caía en "editó un contrato"', () => {
    expect(quote(['vigenciaHasta']).frase).toBe('Cambió la vigencia de un contrato');
  });

  it('acreditar un abono como pago se dice completo', () => {
    const t = traducir({
      tabla: 'AbonoApartado',
      operacion: 'UPDATE',
      campos: ['paymentId'],
      antes: { monto: 50000, paymentId: null },
      despues: { monto: 50000, paymentId: 'pay1' },
    });
    expect(t.frase).toBe('Acreditó un abono como pago de un contrato');
    expect(t.etiqueta).toBe('$50,000');
  });

  it('los datos fiscales de un cliente se nombran por lo que son', () => {
    const t = traducir({
      tabla: 'Client',
      operacion: 'UPDATE',
      campos: ['rfc'],
      antes: { nombre: 'Familia Ballesteros', rfc: null },
      despues: { nombre: 'Familia Ballesteros', rfc: 'XAXX010101000' },
    });
    expect(t.frase).toBe('Cambió los datos fiscales de un cliente');
    expect(t.etiqueta).toBe('Familia Ballesteros');
  });

  it('un campo que nadie tradujo sigue cayendo al genérico, no se rompe', () => {
    expect(quote(['notasInternas']).frase).toBe('Editó un contrato');
  });
});
