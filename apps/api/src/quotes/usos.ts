import type { PrismaClient, Prisma } from '@hsa/database';

/** Un contrato que impide borrar algo, con lo justo para poder encontrarlo. */
export interface ContratoQueUsa {
  id: string;
  /** El folio, que es por lo que se busca un contrato. */
  folio: string;
  /** Y cómo se describe hoy, para reconocerlo sin abrirlo. */
  etiqueta: string | null;
  cliente: string;
  fechaEventoISO: string;
  status: string;
  /**
   * Está en la papelera. Es el caso que más desespera: un contrato eliminado no
   * aparece en ninguna lista, así que sin decirlo la búsqueda sería infinita —y
   * el bloqueo, inexplicable.
   */
  enPapelera: boolean;
}

export interface UsoEnContratos {
  total: number;
  /** Los primeros, para poder ir directo. `total` dice la verdad completa. */
  muestra: ContratoQueUsa[];
}

/**
 * Cuántos contratos usan algo, y CUÁLES.
 *
 * Existe porque "en uso por 1 contrato" sin decir cuál convierte un borrado en
 * una búsqueda a mano entre cientos de contratos. Con el nombre y el código, el
 * mensaje deja de ser un misterio y se vuelve una liga.
 *
 * Se listan solo los primeros: con veinte, la lista completa no ayuda más que
 * la muestra —el mensaje sigue siendo "desactívalo"— y el payload deja de ser
 * un mensaje de error.
 */
export const TOPE_MUESTRA = 8;

export async function contratosQueUsan(
  db: PrismaClient | Prisma.TransactionClient,
  where: Prisma.QuoteWhereInput,
): Promise<UsoEnContratos> {
  const [total, filas] = await Promise.all([
    db.quote.count({ where }),
    db.quote.findMany({
      where,
      // Lo más reciente primero: es lo que alguien reconoce.
      orderBy: { fechaEvento: 'desc' },
      take: TOPE_MUESTRA,
      select: {
        id: true,
        folio: true,
        etiqueta: true,
        fechaEvento: true,
        status: true,
        deletedAt: true,
        client: { select: { nombre: true } },
      },
    }),
  ]);

  return {
    total,
    muestra: filas.map((q) => ({
      id: q.id,
      folio: q.folio,
      etiqueta: q.etiqueta,
      cliente: q.client?.nombre ?? 'Cliente',
      fechaEventoISO: q.fechaEvento.toISOString(),
      status: q.status,
      enPapelera: q.deletedAt != null,
    })),
  };
}

/** El mensaje del 409, con el detalle estructurado que lo acompaña. */
export function mensajeEnUso(uso: UsoEnContratos, sugerirDesactivar = true): string {
  const plural = uso.total === 1 ? 'contrato' : 'contratos';
  const cola = sugerirDesactivar ? ' Desactívalo en vez de borrarlo.' : '';
  return `No se puede borrar: en uso por ${uso.total} ${plural}.${cola}`;
}
