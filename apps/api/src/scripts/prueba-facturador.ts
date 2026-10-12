import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cfdiDePago } from '@hsa/shared';
import { Facturador, FacturadorError, FACTURADOR_PRUEBAS, facturadorDesdeEnv } from '../facturacion/facturador.js';

/**
 * Prueba de compatibilidad con Facturador.com, en su AMBIENTE DE PRUEBAS.
 *
 * Hace el recorrido completo con un pago de ejemplo armado igual que los del
 * punto de venta: token → emisor → factura (CFDI 4.0, ingreso PUE con IVA) →
 * XML timbrado → PDF. La cancelación va aparte, porque el SAT de pruebas tarda
 * 10–15 minutos en dejar cancelar:
 *
 *   pnpm --filter @hsa/api exec dotenv -e ../../.env -- tsx src/scripts/prueba-facturador.ts
 *   pnpm --filter @hsa/api exec dotenv -e ../../.env -- tsx src/scripts/prueba-facturador.ts --cancelar <UUID>
 *
 * Las llaves salen del .env (FACTURADOR_*; ver docs/FACTURADOR.md). Se niega a
 * correr contra producción: ahí cada factura es real.
 */

// Un receptor de pruebas de la documentación de Facturador (apidocs → Emitir CFDIs).
const RECEPTOR_PRUEBAS = { rfc: 'EKU9003173C9', nombre: 'ESCUELA KEMPER URGATE', regimenFiscal: '601', codigoPostal: '06370', usoCfdi: 'G03' };

/** "2026-10-12T10:30:00" en hora de la Ciudad de México. */
function ahoraMexico(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
}

const ok = (t: string) => console.log(`  ✓ ${t}`);
const falla = (t: string) => console.log(`  ✗ ${t}`);

async function main(): Promise<void> {
  const config = facturadorDesdeEnv();
  if (!config) {
    console.log('Faltan llaves en el .env: FACTURADOR_USUARIO, FACTURADOR_PASSWORD_MD5, FACTURADOR_CLIENT_ID y FACTURADOR_CLIENT_SECRET (ver docs/FACTURADOR.md).');
    process.exit(1);
  }
  if (config.apiUrl !== FACTURADOR_PRUEBAS.apiUrl || config.authUrl !== FACTURADOR_PRUEBAS.authUrl) {
    console.log('Esta prueba solo corre en el ambiente de pruebas de Facturador: quita FACTURADOR_AUTH_URL y FACTURADOR_API_URL del .env.');
    process.exit(1);
  }
  const f = new Facturador(config);
  const salida = join(tmpdir(), 'hsa-facturador-prueba');
  mkdirSync(salida, { recursive: true });

  console.log('Prueba de compatibilidad con Facturador.com (ambiente de pruebas)\n');
  await f.accessToken();
  ok('Autenticación (token OAuth)');
  const { emisorId, rfc } = await f.emisor();
  ok(`Emisor ${rfc} (emisorId ${emisorId})`);

  const cancelar = process.argv.indexOf('--cancelar');
  if (cancelar > -1) {
    const uuid = process.argv[cancelar + 1];
    if (!uuid) throw new Error('Falta el UUID: --cancelar <UUID>');
    const r = await f.cancelar(emisorId, uuid, '02');
    (r.esValido ? ok : falla)(`Cancelación de ${uuid}: ${r.descripcion ?? JSON.stringify(r.errores)}`);
    return;
  }

  const emisor = {
    rfc,
    nombre: process.env.FACTURADOR_EMISOR_NOMBRE ?? '',
    regimenFiscal: process.env.FACTURADOR_EMISOR_REGIMEN ?? '',
    codigoPostal: process.env.FACTURADOR_EMISOR_CP ?? '',
  };
  if (!emisor.nombre || !emisor.regimenFiscal || !emisor.codigoPostal) {
    throw new Error('Faltan FACTURADOR_EMISOR_NOMBRE, FACTURADOR_EMISOR_REGIMEN y FACTURADOR_EMISOR_CP en el .env.');
  }
  // Un anticipo de $1,000 pagado con transferencia y efectivo, como lo registra
  // el punto de venta. Menos de $1,000 se cancela sin pedirle permiso al receptor.
  const cfdi = cfdiDePago({
    emisor,
    receptor: RECEPTOR_PRUEBAS,
    concepto: {
      claveProdServ: process.env.FACTURADOR_CLAVE_PROD_SERV ?? '01010101',
      claveUnidad: process.env.FACTURADOR_CLAVE_UNIDAD ?? 'E48',
      descripcion: 'Anticipo de renta de salón para evento (prueba)',
    },
    montoConIva: 1_000,
    partes: [
      { forma: 'transferencia', monto: 600 },
      { forma: 'efectivo', monto: 400 },
    ],
    fecha: ahoraMexico(),
    ivaRate: 0.16,
    // Facturador exige serie. La cuenta de pruebas trabaja con "Sin Serie".
    serie: process.env.FACTURADOR_SERIE ?? 'Sin Serie',
    ...(process.env.FACTURADOR_SERIE_ID ? { serieId: Number(process.env.FACTURADOR_SERIE_ID) } : {}),
  });
  writeFileSync(join(salida, 'cfdi-enviado.json'), JSON.stringify(cfdi, null, 2));
  const r = await f.emitir(emisorId, cfdi);
  if (!r.esValido || !r.uuid) {
    falla(`Timbrado rechazado: ${JSON.stringify(r.errores ?? r.descripcion)}`);
    console.log(`\nEl JSON enviado quedó en ${join(salida, 'cfdi-enviado.json')}`);
    process.exit(1);
  }
  ok(`Factura timbrada: UUID ${r.uuid} (idComprobante ${r.idComprobante})`);

  const xml = await f.xml(emisorId, r.uuid);
  writeFileSync(join(salida, `${r.uuid}.xml`), xml);
  const cuadra = xml.includes('Total="1000') && xml.includes('TotalImpuestosTrasladados="137.93"');
  (cuadra ? ok : falla)(`XML descargado${cuadra ? ' (total $1,000 e IVA $137.93 correctos)' : ' (revisa los montos)'}`);

  const pdf = await f.pdfUrl(emisorId, r.uuid);
  ok(`PDF generado: ${pdf}`);

  console.log(`\nArchivos en ${salida}`);
  console.log(`\nPara probar la cancelación, espera 15 minutos y corre:\n  … prueba-facturador.ts --cancelar ${r.uuid}`);
}

main().catch((e) => {
  falla(e instanceof FacturadorError ? e.message : e instanceof Error ? e.message : String(e));
  process.exit(1);
});
