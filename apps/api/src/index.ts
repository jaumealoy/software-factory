import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

async function main(): Promise<void> {
  const app = await buildApp({ config });
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
