import { prisma } from '@hsa/database';
import { hashPassword } from '../auth/password.js';
import { barridoHistorico } from '../historico/archivar.js';
import type { Actor } from '../quotes/service.js';
import { purgar } from './lib/purga.js';
import { sembrarCatalogoDemo } from './demo/catalogo.js';
import { sembrarMovimientoDemo } from './demo/movimiento.js';

/**
 * Deja el DEMO DE VENTAS en su estado de exhibición.
 *
 * Vacía la base COMPLETA —catálogo incluido— y la vuelve a llenar con una
 * hacienda ficticia: salones, precios, banqueteros y ~25 eventos repartidos en
 * el calendario para que todas las pantallas tengan algo que enseñar.
 *
 * Corre cuantas veces se quiera: es la manera de limpiar el demo después de que
 * un prospecto lo dejó lleno de cotizaciones de "aaa" y "prueba 123".
 *
 * PARA LA INSTANCIA DE DEMO, NUNCA PARA LA DEL CLIENTE. Por eso exige
 * `--confirmo=<nombre-de-la-base>`, igual que la purga: hay que teclear a
 * propósito el nombre de la base contra la que se está corriendo.
 *
 * Uso (consola del servicio api de la instancia de demo):
 *   pnpm --filter @hsa/api exec tsx src/scripts/seed-demo.ts
 *   pnpm --filter @hsa/api exec tsx src/scripts/seed-demo.ts --confirmo=hsa_demo
 *
 * La contraseña de los dos usuarios sale de `DEMO_PASSWORD`, o es
 * `demo-hsa-2027` si no está definida.
 */

const BANDERA = '--confirmo=';
const PASSWORD_POR_OMISION = 'demo-hsa-2027';

const USUARIOS = [
  { nombre: 'Dirección (demo)', email: 'demo@haciendademo.mx', role: 'admin' as const },
  { nombre: 'Ventas (demo)', email: 'ventas@haciendademo.mx', role: 'ventas' as const },
];

async function main(): Promise<void> {
  const conectada = await prisma.$queryRaw<{ base: string }[]>`SELECT current_database() AS base`;
  const base = conectada[0]!.base;
  const confirmo = process.argv.find((a) => a.startsWith(BANDERA))?.slice(BANDERA.length);

  console.log(`Base conectada: ${base}\n`);

  if (confirmo !== base) {
    const cotizaciones = await prisma.quote.count();
    console.log(
      `Esto BORRA TODO lo que hay en "${base}" —catálogo, usuarios y los\n` +
        `${cotizaciones} evento(s) que tenga— y siembra la hacienda ficticia del demo.\n`,
    );
    if (confirmo !== undefined) {
      console.log(`NO se hizo nada: --confirmo=${confirmo} no es la base conectada.\n`);
    }
    console.log(
      'Es solo para la instancia de DEMO. Si esta es la base del cliente, para\n' +
        'aquí. Si de verdad es la del demo:\n' +
        `\n  pnpm --filter @hsa/api exec tsx src/scripts/seed-demo.ts ${BANDERA}${base}\n`,
    );
    return;
  }

  console.log('Vaciando la base completa…');
  const r = await purgar(prisma, { motivo: `Resiembra del demo de ventas en ${base}`, incluirCatalogo: true });
  console.log(`  ${r.borradas} fila(s) borradas\n`);

  const password = process.env.DEMO_PASSWORD ?? PASSWORD_POR_OMISION;
  const passwordHash = await hashPassword(password);
  const usuarios = [];
  for (const u of USUARIOS) {
    usuarios.push(await prisma.user.create({ data: { ...u, passwordHash } }));
  }
  // El catálogo y el movimiento se siembran COMO LOS CREARÍA EL ADMIN, con su
  // id de actor: así la bitácora de cada evento tiene autor y no sale en blanco
  // cuando el prospecto abra el historial de una cotización.
  const actor: Actor = { id: usuarios[0]!.id, role: 'admin' };

  console.log('Sembrando el catálogo ficticio…');
  const cat = await sembrarCatalogoDemo(prisma);
  console.log(
    `  ${cat.espacios.length} espacios · ${cat.tiposEvento.length} tipos de evento · ` +
      `${cat.banqueteros.length} banqueteros\n`,
  );

  console.log('Sembrando eventos, pagos, depósitos y apartados…');
  const mov = await sembrarMovimientoDemo(prisma, cat, actor);
  console.log(
    `  ${mov.eventos} eventos · ${mov.pagos} pagos · ${mov.depositos} depósito · ${mov.apartados} apartados\n`,
  );

  // El histórico se llena con el barrido de verdad, el mismo que corre al
  // arrancar el contenedor: así las fotos de los eventos pasados son las que
  // produce el sistema, no unas hechas a mano para la demo.
  console.log('Archivando los eventos que ya pasaron…');
  await barridoHistorico(prisma);
  // Se reporta el TOTAL y no lo que archivó el barrido: registrar un pago sobre
  // un evento ya pasado le vuelve a tomar la foto, así que la mayoría ya quedó
  // archivada durante la siembra y el barrido no encuentra nada pendiente.
  const fotos = await prisma.eventoHistorico.count();
  const eventosConFoto = await prisma.eventoHistorico.groupBy({ by: ['quoteId'] });
  console.log(`  ${eventosConFoto.length} evento(s) en el histórico, ${fotos} foto(s)\n`);

  console.log('── El demo quedó listo ──────────────────────────────────');
  for (const u of USUARIOS) console.log(`  ${u.email}  /  ${password}   (${u.role})`);
  console.log(
    '\nTodas las fechas se calcularon contra HOY, así que la agenda y el tablero\n' +
      'se ven vivos. Vuelve a correr este guion cuando el demo se ensucie.\n',
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('La siembra del demo falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
