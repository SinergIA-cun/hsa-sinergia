import { prisma } from '@hsa/database';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { mantenimientoAuditoria } from './auditoria/mantenimiento.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // Antes de atender la primera petición: que ninguna tabla se quede sin
  // auditar y que la bitácora no crezca sin techo.
  //
  // Falla ruidosa pero NO fatal. Los triggers los deja puestos la migración, que
  // sí tumba el arranque si truena; esto de aquí solo cubre las tablas que
  // llegaron después y la poda. Tirar toda la hacienda porque el mantenimiento
  // de la bitácora tuvo un tropiezo sería cobrar el remedio más caro que la
  // enfermedad — pero tiene que verse en la consola del servidor.
  try {
    const auditoria = await mantenimientoAuditoria(prisma, config.AUDITORIA_RETENCION_DIAS);
    if (auditoria.tablasEnganchadas > 0) {
      console.log(`Auditoría: ${auditoria.tablasEnganchadas} tabla(s) sin trigger, ya enganchadas.`);
    }
    if (auditoria.purgados > 0) {
      console.log(`Auditoría: ${auditoria.purgados} renglón(es) purgados por retención.`);
    }
  } catch (e) {
    console.error('Auditoría: FALLÓ el mantenimiento de la bitácora forense.', e);
  }

  const app = await buildServer({ config });
  await app.listen({ port: config.PORT, host: config.HOST });
  console.log(`API HSA escuchando en http://${config.HOST}:${config.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
