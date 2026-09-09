/**
 * Traduce un renglón de la bitácora forense a algo que una persona entienda.
 *
 * La bitácora la escriben los disparadores de la base, así que habla en nombres
 * de tabla y de columna: `UPDATE Quote · deletedAt`, `INSERT ActivityLog`,
 * `DELETE DjHoraExtraPrice`. Es exacta y es ilegible — quien la abre para
 * averiguar qué pasó tiene que saber el esquema de memoria.
 *
 * Aquí se convierte en una frase con nombre: *"Envió a la papelera un contrato"*
 * · *"26SEP-0012"*. Tres piezas hacen el trabajo:
 *
 *  1. **El verbo** sale de la operación, pero en un UPDATE lo que manda es el
 *     CAMPO que cambió: poner `deletedAt` no es "editar un contrato", es
 *     mandarlo a la papelera. Y quitarlo es restaurarlo.
 *  2. **El sujeto** es el nombre humano de la tabla: "contrato", no `Quote`.
 *  3. **La identidad** sale del jsonb que la bitácora ya guarda: el folio del
 *     contrato, el nombre del cliente, el número del recibo. Un cuid no le dice
 *     nada a nadie.
 *
 * Función PURA: recibe la fila y devuelve texto. No toca la base.
 */

/** Lo que la traducción necesita de una fila de la bitácora. */
export interface FilaTraducible {
  tabla: string;
  operacion: string;
  /** Campos que cambiaron. Solo tiene contenido en los UPDATE. */
  campos: string[];
  antes: unknown;
  despues: unknown;
}

export interface Traduccion {
  /**
   * La frase, SIN el nombre del registro.
   *
   * La etiqueta va aparte y la pinta la interfaz como su propia pieza, en vez de
   * pegarse al final del texto: pegada salían cosas como "Cambió el estatus del
   * contrato a formalizada 26SEP-0012", y además el folio merece destacarse —es
   * por lo que se busca.
   */
  frase: string;
  /** Cómo se llama el registro: el folio, el nombre, el número de recibo. */
  etiqueta: string | null;
  /**
   * `principal` es una acción que alguien hizo a propósito. `secundario` es una
   * consecuencia —la bitácora del contrato, la foto del histórico— que se
   * escribe sola y no merece un renglón propio en la lista.
   */
  relevancia: 'principal' | 'secundario';
}

/**
 * Cómo le dice una persona a cada tabla, CON su artículo.
 *
 * Va con artículo porque sin él salen frases mal escritas —"Borró el lista de
 * precios"— y una bitácora que se lee mal es la mitad del problema que este
 * módulo vino a resolver. Se usa la forma indefinida porque encaja en todos los
 * verbos: creó UN contrato, borró UNA lista, activó UNA lista.
 */
const NOMBRE: Record<string, string> = {
  Quote: 'un contrato',
  Client: 'un cliente',
  Payment: 'un pago',
  PriceList: 'una lista de precios',
  RentalPrice: 'un precio de renta',
  AddOn: 'un servicio del catálogo',
  FoodPackage: 'un paquete de alimentos',
  FoodPackagePrice: 'un rango de un paquete de alimentos',
  DjHoraExtraPrice: 'un precio del DJ por hora extra',
  Space: 'un espacio',
  SpacePaymentRule: 'una regla de pago de un espacio',
  EventType: 'un tipo de evento',
  Banquetero: 'un banquetero',
  PagoBanquetero: 'un depósito de banquetero',
  ApartadoFecha: 'una fecha apartada',
  AbonoApartado: 'un abono a una fecha apartada',
  Empleado: 'un empleado',
  Cuadrilla: 'una cuadrilla',
  CuadrillaMiembro: 'un integrante de una cuadrilla',
  QuoteExtra: 'un servicio de un evento',
  User: 'un usuario',
  ActivityLog: 'la bitácora de un contrato',
  PriceListAudit: 'la bitácora de un catálogo',
  EventoHistorico: 'una foto del histórico',
  AuditoriaDb: 'la bitácora',
};

/**
 * Tablas que se escriben SOLAS como consecuencia de otra acción. Enviar un
 * contrato a la papelera escribe también su bitácora; son dos renglones del
 * mismo acto, y solo el primero es noticia.
 */
const CONSECUENCIAS = new Set(['ActivityLog', 'PriceListAudit', 'EventoHistorico']);

/** Verbos de alta y baja, cuando el campo no dice nada más específico. */
const ALTA: Record<string, string> = {
  Quote: 'Creó',
  Client: 'Dio de alta',
  Payment: 'Registró',
  User: 'Dio de alta',
  Empleado: 'Dio de alta',
  Banquetero: 'Dio de alta',
  PagoBanquetero: 'Registró',
  ApartadoFecha: 'Apartó',
  AbonoApartado: 'Registró',
};

function obj(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function texto(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number') return String(v);
  return null;
}

/**
 * Cómo se llama el registro, con lo que la propia fila guardó.
 *
 * Se busca en `despues` y si no en `antes`: un DELETE solo tiene `antes`, y es
 * justo el caso en el que más importa poder decir QUÉ se borró.
 */
export function etiquetaDe(fila: FilaTraducible): string | null {
  const d = obj(fila.despues);
  const a = obj(fila.antes);
  const campo = (llave: string): string | null => texto(d[llave]) ?? texto(a[llave]);

  switch (fila.tabla) {
    case 'Quote':
      return campo('folio');
    case 'Payment': {
      const folio = campo('folio');
      return folio ? `recibo #${folio}` : null;
    }
    case 'ApartadoFecha': {
      const fecha = campo('fechaEvento');
      return fecha ? fecha.slice(0, 10) : null;
    }
    case 'PagoBanquetero':
    case 'AbonoApartado': {
      const monto = campo('monto');
      return monto ? `$${Number(monto).toLocaleString('es-MX')}` : null;
    }
    case 'RentalPrice':
    case 'FoodPackagePrice': {
      const min = campo('min');
      const max = campo('max');
      return min ? `rango ${min}–${max ?? 'sin tope'}` : null;
    }
    default:
      // El resto se identifica por su nombre, que es lo que la gente lee.
      return campo('nombre');
  }
}

/**
 * El significado de un UPDATE, cuando el campo que cambió lo tiene.
 *
 * Devuelve `null` si el cambio no es uno de éstos, y entonces se cae al genérico
 * "Editó el X". Poner o quitar una fecha —`deletedAt`, `anuladoAt`— es la forma
 * que tiene esta base de decir "pasó algo", así que el sentido está en si la
 * fecha ENTRA o SALE.
 */
function significadoDeUpdate(fila: FilaTraducible, nombre: string): string | null {
  const d = obj(fila.despues);
  const a = obj(fila.antes);
  const cambio = (llave: string): boolean => fila.campos.includes(llave);
  /** ¿La marca se puso (entró una fecha) o se quitó? */
  const sePuso = (llave: string): boolean => d[llave] != null && a[llave] == null;

  if (cambio('deletedAt')) {
    return sePuso('deletedAt') ? `Envió a la papelera ${nombre}` : `Restauró ${nombre}`;
  }
  if (cambio('anuladoAt') && sePuso('anuladoAt')) return `Anuló ${nombre}`;
  if (cambio('canceladoAt') && sePuso('canceladoAt')) return `Canceló ${nombre}`;
  if (cambio('facturadoAt')) {
    return sePuso('facturadoAt')
      ? `Marcó como facturado ${nombre}`
      : `Quitó la marca de facturado de ${nombre}`;
  }
  if (cambio('desbloqueoAt') && sePuso('desbloqueoAt')) {
    return 'Desbloqueó los datos fiscales de un pago';
  }
  // Convertir un apartado: deja de ser una fecha suelta y pasa a tener contrato.
  if (fila.tabla === 'ApartadoFecha' && cambio('quoteId') && sePuso('quoteId')) {
    return 'Convirtió una fecha apartada en contrato';
  }
  if (fila.tabla === 'Quote' && cambio('priceListId')) {
    return 'Movió un contrato a otra lista de precios';
  }
  if (fila.tabla === 'Quote' && cambio('status')) {
    const status = texto(d['status']);
    return status ? `Cambió el estatus del contrato a ${status}` : 'Cambió el estatus de un contrato';
  }
  /*
   * Lo que alguien DECIDIÓ gana sobre lo que se recalculó.
   *
   * Mover la fecha de un evento cambia de un golpe la fecha, el total, el
   * desglose y la renta: cuatro columnas, una decisión. El orden de aquí abajo es
   * el que hace que la frase diga "cambió la fecha" y no "cambió unos montos",
   * que es cierto y no le sirve a nadie. Los totales solo hablan cuando cambiaron
   * SOLOS, y entonces sí son la noticia: la cotización se rehízo.
   */
  if (fila.tabla === 'Quote') {
    if (cambio('fechaEvento')) return 'Cambió la fecha de un contrato';
    if (cambio('spaceIds') || cambio('espacios')) return 'Cambió los espacios de un contrato';
    if (cambio('invitados')) return 'Cambió el número de invitados de un contrato';
    if (cambio('banqueteroId')) return 'Cambió el banquetero de un contrato';
    if (cambio('vigenciaHasta')) return 'Cambió la vigencia de un contrato';
    if (cambio('operativa')) return 'Actualizó la hoja operativa de un contrato';
    if (cambio('total') || cambio('rentaTotal') || cambio('breakdown')) {
      return 'Recotizó un contrato: cambiaron los montos';
    }
  }
  // El abono de un apartado deja de estar suelto: ya es un pago del contrato.
  if (fila.tabla === 'AbonoApartado' && cambio('paymentId') && sePuso('paymentId')) {
    return 'Acreditó un abono como pago de un contrato';
  }
  if (fila.tabla === 'Client' && (cambio('rfc') || cambio('regimenFiscal') || cambio('cp'))) {
    return 'Cambió los datos fiscales de un cliente';
  }
  if (cambio('activa') || cambio('activo')) {
    const llave = cambio('activa') ? 'activa' : 'activo';
    return d[llave] === true ? `Activó ${nombre}` : `Desactivó ${nombre}`;
  }
  // Marcar la papelera como vista es un clic, no un movimiento del negocio.
  if (fila.tabla === 'User' && fila.campos.length === 1 && cambio('papeleraVistaAt')) {
    return 'Abrió la papelera';
  }
  /*
   * Un UPDATE de usuario SIN campos visibles es un cambio de contraseña.
   *
   * El disparador quita `passwordHash` del registro después de comparar, para no
   * copiar el hash a la bitácora. El efecto secundario es que el único campo que
   * cambió queda invisible y la fila parece no decir nada. Decirlo en voz alta
   * es justo lo contrario de esconderlo: es el movimiento de seguridad que más
   * importa poder ver.
   */
  if (fila.tabla === 'User' && fila.campos.length === 0) return 'Cambió una contraseña';

  return null;
}

export function traducir(fila: FilaTraducible): Traduccion {
  const nombre = NOMBRE[fila.tabla] ?? fila.tabla;
  const etiqueta = etiquetaDe(fila);
  const relevancia = CONSECUENCIAS.has(fila.tabla) ? 'secundario' : 'principal';

  const base = ((): string => {
    /*
     * Un TRUNCATE se nombra por su tabla TÉCNICA, a propósito. Solo aparece en
     * la purga de entrega, y ahí quien lee es un administrador que necesita
     * saber exactamente qué tabla se vació — no una paráfrasis amable.
     */
    if (fila.operacion === 'TRUNCATE') return `Vació por completo la tabla ${fila.tabla}`;
    if (fila.operacion === 'PURGA') return 'Vació la bitácora al entregar la instalación';
    if (fila.operacion === 'INSERT') {
      if (fila.tabla === 'ActivityLog') return 'Anotó un movimiento en la bitácora de un contrato';
      if (fila.tabla === 'PriceListAudit') return 'Anotó un cambio en la bitácora de un catálogo';
      if (fila.tabla === 'EventoHistorico') return 'Archivó un evento en el histórico';
      return `${ALTA[fila.tabla] ?? 'Agregó'} ${nombre}`;
    }
    if (fila.operacion === 'DELETE') return `Borró ${nombre}`;
    return significadoDeUpdate(fila, nombre) ?? `Editó ${nombre}`;
  })();

  return { frase: base, etiqueta, relevancia };
}
