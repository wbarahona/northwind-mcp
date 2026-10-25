/**
 * Writes the OpenAPI document to apps/api/openapi.json without a database:
 *
 *   pnpm --filter @northwind/api openapi           regenerate the file
 *   pnpm --filter @northwind/api openapi:check     fail if the file is out of date
 *
 * Nest's preview mode builds the module graph and controller metadata but instantiates no
 * providers, so nothing connects to MongoDB.
 */
import { NestFactory } from '@nestjs/core';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT = join(__dirname, '..', 'openapi.json');

async function main(): Promise<void> {
  // Config validation runs when AppModule is imported; it only needs plausible values here.
  process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/openapi-export';
  process.env.API_KEYS ??= 'openapi-export';
  const { AppModule } = await import('./app.module.js');
  const { applyApiConventions } = await import('./app.setup.js');
  const { buildOpenApiDocument } = await import('./swagger.js');

  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
  });
  applyApiConventions(app);
  const json = `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`;
  await app.close();

  if (process.argv.includes('--check')) {
    const current = readFileSync(OUTPUT, 'utf8');
    if (current !== json) {
      console.error(
        'openapi.json is out of date. Run: pnpm --filter @northwind/api openapi',
      );
      process.exitCode = 1;
      return;
    }
    console.log('openapi.json is up to date.');
    return;
  }
  writeFileSync(OUTPUT, json);
  console.log(`Wrote ${OUTPUT}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
