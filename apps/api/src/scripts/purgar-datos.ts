import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { loadConfig } from '../config.js';
import { censo, purgar, TABLAS_CATALOGO, TABLAS_MOVIMIENTO } from './lib/purga.js';

/**
 * Entrega la app al cliente sin los datos de prueba.
 *
 * Se borra el MOVIMIENTO: cotizaciones, clientes, pagos y recibos, depósitos y
 * apartados de banqueteros, bitácora, histórico y auditoría. Los folios de
 * recibo y las referencias de cliente vuelven a empezar en 1.
 *
 * Se conserva lo que el cliente ya cargó de su operación real: catálogo y
 * precios, sus banqueteros, su personal y cuadrillas, las reglas de pago por
 * salón y los usuarios. Si alguno de esos es de prueba, el guion los lista al
 * final para que se borren desde la app, que es donde se ve quién es quién.
 *
 * ESTO NO ES IDEMPOTENTE Y NO SE PUEDE DESHACER. Por eso:
 *  · NUNCA va en la cadena de arranque del contenedor;
 *  · exige `--confirmo=<nombre-de-la-base>`, que hay que teclear a propósito y
 *    obliga a mirar contra qué base se está corriendo.
 *
 * Uso (consola del servicio api en EasyPanel):
 *   # 1. Ver qué hay, sin tocar nada:
 *   pnpm --filter @hsa/api exec tsx src/scripts/purgar-datos.ts
 *   # 2. Respaldar (desde la consola del servicio de Postgres):
 *   pg_dump -U hsa hsa > /tmp/hsa-antes-de-la-purga.sql
 *   # 3. Vaciar:
 *   pnpm --filter @hsa/api exec tsx src/scripts/purgar-datos.ts --confirmo=hsa
 */

const BANDERA = '--confirmo=';

function arg(prefijo: string): string | undefined {
  const encontrado = process.argv.find((a) => a.startsWith(prefijo));
  return encontrado?.slice(prefijo.length);
}

function tabla(filas: { tabla: string; filas: number }[]): void {
  const ancho = Math.max(...filas.map((f) => f.tabla.length));
  for (const f of filas) {
    const marca = f.filas > 0 ? '' : '  (vacía)';
    console.log(`  ${f.tabla.padEnd(ancho)}  ${String(f.filas).padStart(7)}${marca}`);
  }
}

/**
 * Los comprobantes en disco. Con los pagos borrados nadie puede volver a
 * abrirlos —la llave vivía en la fila del pago— así que dejarlos ahí no es
 * conservar nada: es dejar fotos de fichas de depósito de clientes de prueba en
 * el VPS del cliente nuevo.
 */
async function borrarComprobantes(dir: string): Promise<number> {
  let archivos: string[];
  try {
    archivos = await readdir(dir);
  } catch {
    console.log(`\nComprobantes: el directorio ${dir} no existe todavía. Nada que borrar.`);
    return 0;
  }
  for (const a of archivos) await unlink(join(dir, a));
  return archivos.length;
}

/** Lo que queda en pie y conviene revisar a ojo antes de entregar. */
async function reportarLoQueQueda(): Promise<void> {
  const [banqueteros, usuarios, catalogos] = await Promise.all([
    prisma.banquetero.findMany({ select: { nombre: true, telefono: true }, orderBy: { nombre: 'asc' } }),
    prisma.user.findMany({ select: { nombre: true, email: true, role: true }, orderBy: { email: 'asc' } }),
    prisma.priceList.findMany({ select: { nombre: true, anio: true, activa: true }, orderBy: { nombre: 'asc' } }),
  ]);

  console.log('\n── Lo que quedó en pie ──────────────────────────────────');
  console.log(`\nBanqueteros (${banqueteros.length}) — borra desde la app los que sean de prueba:`);
  for (const b of banqueteros) console.log(`  · ${b.nombre}${b.telefono ? '' : '  (sin teléfono)'}`);

  console.log(`\nUsuarios (${usuarios.length}):`);
  for (const u of usuarios) console.log(`  · ${u.email}  ${u.role}`);

  console.log(`\nCatálogos (${catalogos.length}):`);
  for (const c of catalogos) console.log(`  · ${c.nombre} (${c.anio})${c.activa ? '  ACTIVO' : ''}`);
  if (catalogos.length > 1) {
    console.log(
      '  Ojo: los catálogos extra suelen ser clones con precio negociado para un\n' +
        '  banquetero. Si nacieron de una prueba, bórralos desde el panel.',
    );
  }
}

async function main(): Promise<void> {
  const conectada = await prisma.$queryRaw<{ base: string }[]>`SELECT current_database() AS base`;
  const base = conectada[0]!.base;
  const confirmo = arg(BANDERA);

  console.log(`Base conectada: ${base}\n`);
  console.log('── Lo que se BORRARÍA ───────────────────────────────────');
  tabla(await censo(prisma, [...TABLAS_MOVIMIENTO, 'AuditoriaDb']));
  console.log('\n── Lo que se CONSERVA ───────────────────────────────────');
  tabla(await censo(prisma, TABLAS_CATALOGO));

  if (confirmo !== base) {
    console.log('\n────────────────────────────────────────────────────────');
    if (confirmo === undefined) {
      console.log('Ensayo: no se borró nada.');
    } else {
      console.log(`NO se borró nada: --confirmo=${confirmo} no es la base conectada (${base}).`);
    }
    console.log(
      '\nEsto no se puede deshacer. Respalda primero, desde la consola del\n' +
        'servicio de Postgres:\n' +
        `\n  pg_dump -U hsa ${base} > /tmp/${base}-antes-de-la-purga.sql\n` +
        '\nY cuando el respaldo esté hecho, vacía con:\n' +
        `\n  pnpm --filter @hsa/api exec tsx src/scripts/purgar-datos.ts ${BANDERA}${base}\n`,
    );
    return;
  }

  console.log('\n── Vaciando ─────────────────────────────────────────────');
  const r = await purgar(prisma, { motivo: `Entrega al cliente: purga de datos de prueba en ${base}` });
  console.log(`  ${r.borradas} fila(s) de movimiento`);
  console.log(`  ${r.auditoriaBorrada} fila(s) de bitácora forense`);
  console.log('  Folios de recibo y referencias de cliente: de vuelta en 1');

  const comprobantes = await borrarComprobantes(loadConfig().COMPROBANTES_DIR);
  if (comprobantes > 0) console.log(`  ${comprobantes} comprobante(s) en disco`);

  const sobras = (await censo(prisma, TABLAS_MOVIMIENTO)).filter((c) => c.filas > 0);
  if (sobras.length > 0) {
    console.log('\nQuedaron filas de movimiento, que no debería pasar:');
    tabla(sobras);
    process.exitCode = 1;
    return;
  }

  await reportarLoQueQueda();
  console.log(
    '\n── Antes de entregar ────────────────────────────────────\n' +
      '\nCAMBIA LA CONTRASEÑA DEL ADMIN. El seed la deja en `admin1234`, que es\n' +
      'pública: está en el repositorio. Con la app en internet y datos reales\n' +
      'adentro, eso es la puerta abierta.\n' +
      '\nLa bitácora forense quedó con un solo renglón: el de esta purga, con el\n' +
      'censo de lo que se fue. Del día del cliente en adelante, todo lo que pase\n' +
      'queda registrado ahí.\n',
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('La purga falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
