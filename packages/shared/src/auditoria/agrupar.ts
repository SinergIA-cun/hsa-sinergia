/**
 * Junta en un solo movimiento los renglones que escribió una misma transacción.
 *
 * La bitácora la escriben disparadores, así que un acto de una persona deja
 * varios renglones. Mandar un contrato a la papelera escribe el UPDATE del
 * contrato Y el INSERT de su bitácora; borrar una lista de precios escribe un
 * DELETE por cada precio, por cada paquete y por cada servicio —decenas—. En
 * pantalla eso se ve como decenas de cosas que pasaron, cuando pasó UNA.
 *
 * Postgres da la transacción en `txid`, y la bitácora la guarda. Aquí se usa
 * para lo único que sirve de verdad: decir "esto fue un solo movimiento".
 *
 * El líder del grupo es el primer renglón PRINCIPAL. Los `secundario` son
 * consecuencias que se escriben solas —la bitácora del contrato, la foto del
 * histórico— y nunca deben dar el título: un grupo encabezado por "Anotó un
 * movimiento en la bitácora" esconde el "Envió a la papelera un contrato" que
 * lo causó.
 *
 * Función PURA y estructural: pide lo mínimo —id, txid, relevancia— así que
 * sirve igual para la lista y para cualquier otra vista de lo mismo.
 */

export interface RenglonAgrupable {
  id: string;
  txid: string;
  relevancia: 'principal' | 'secundario';
}

export interface GrupoAuditoria<T extends RenglonAgrupable> {
  /** El id del líder. Sirve de `key` y es estable mientras la página no cambie. */
  id: string;
  txid: string;
  /** El renglón que da el título del grupo. */
  lider: T;
  /** Los demás renglones de la misma transacción, en el orden en que venían. */
  resto: T[];
}

/**
 * Agrupa SOLO renglones consecutivos.
 *
 * Consecutivos y no "todos los que compartan txid" porque la lista viene
 * ordenada por id y paginada: dos transacciones no pueden entreverarse, pero una
 * transacción sí puede quedar cortada entre dos páginas. Al agrupar por
 * cercanía, el corte parte el grupo en dos —que es honesto— en vez de mentir
 * juntando renglones que la página no trae.
 *
 * Un `txid` vacío no agrupa: sin transacción conocida no hay nada que afirmar.
 */
export function agruparPorTransaccion<T extends RenglonAgrupable>(
  filas: readonly T[],
): GrupoAuditoria<T>[] {
  const grupos: GrupoAuditoria<T>[] = [];
  let actual: T[] = [];

  const cerrar = (): void => {
    if (actual.length === 0) return;
    const miembros = actual;
    const lider = miembros.find((f) => f.relevancia === 'principal') ?? miembros[0]!;
    grupos.push({
      id: lider.id,
      txid: lider.txid,
      lider,
      resto: miembros.filter((f) => f !== lider),
    });
    actual = [];
  };

  for (const fila of filas) {
    const previa = actual[actual.length - 1];
    if (previa && (previa.txid !== fila.txid || !fila.txid)) cerrar();
    actual.push(fila);
    if (!fila.txid) cerrar();
  }
  cerrar();
  return grupos;
}

/**
 * ¿Este renglón se muestra cuando alguien pidió ver la bitácora sin el ruido?
 *
 * El ruido son las consecuencias que la base escribe sola: cada cambio de un
 * contrato anota además su bitácora, y esos renglones llegan a ser la mitad de
 * la pantalla repitiendo "anotó un movimiento" sin decir cuál.
 *
 * La excepción NO es negociable: lo que entró por fuera de la aplicación se
 * muestra siempre, aunque sea una consecuencia. Alguien que edita `ActivityLog`
 * desde una consola de SQL está haciendo justo lo que esta pantalla existe para
 * delatar, y un filtro de comodidad no puede taparlo. Vive aquí, con prueba, y
 * no como una condición suelta en la vista, precisamente para que nadie la
 * "simplifique" más adelante.
 */
export function seMuestraSinRuido(fila: {
  relevancia: 'principal' | 'secundario';
  origen: string;
}): boolean {
  return fila.relevancia === 'principal' || fila.origen === 'externo';
}
