import { buildServer } from './server.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer({ config });
  await app.listen({ port: config.PORT, host: config.HOST });
  // eslint-disable-next-line no-console
  console.log(`API HSA escuchando en http://${config.HOST}:${config.PORT}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
