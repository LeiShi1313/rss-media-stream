import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildApp(config);

try {
  await app.listen({ host: config.apiHost, port: config.apiPort });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
