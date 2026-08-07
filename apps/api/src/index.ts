import { buildServer } from './server.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer({ config });
  await app.listen({ port: config.PORT, host: config.HOST });
  console.log(`API HSA escuchando en http://${config.HOST}:${config.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
