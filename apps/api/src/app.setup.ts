import { type INestApplication, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { setupSwagger } from './swagger';

/** URL conventions that shape the API surface (and so the OpenAPI document). */
export function applyApiConventions(app: INestApplication): INestApplication {
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  return app;
}

/** App-level setup shared by main.ts and the e2e tests, so tests exercise the real configuration. */
export function configureApp(app: INestApplication): INestApplication {
  app.useLogger(app.get(Logger));
  // Don't advertise the framework in every response.
  (app as NestExpressApplication).disable('x-powered-by');
  applyApiConventions(app);
  setupSwagger(app);
  return app;
}
