import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { parseIsoDate, seedDatabase } from '@northwind/seed';
import type { Connection } from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { E2E_API_KEY } from '../global-setup';

/** Fixed anchor so seeded dates (and anything derived from them) are the same on every run. */
export const TEST_ANCHOR = parseIsoDate('2026-10-22');

export interface TestApp {
  app: INestApplication<App>;
  connection: Connection;
  /** Authenticated requests: `api.get('/v1/customers')`. */
  api: {
    get: (path: string) => request.Test;
    post: (path: string, body?: object) => request.Test;
    patch: (path: string, body?: object) => request.Test;
    delete: (path: string) => request.Test;
  };
  /** Resets the database to freshly seeded Northwind data. */
  reseed: () => Promise<void>;
}

/** The real app (same setup as main.ts) on the in-memory database, seeded. */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = configureApp(
    moduleRef.createNestApplication<INestApplication<App>>(),
  );
  await app.init();

  const connection = app.get<Connection>(getConnectionToken());
  const reseed = async () => {
    await seedDatabase(connection, { anchor: TEST_ANCHOR });
  };
  await reseed();

  const server = () => request(app.getHttpServer());
  return {
    app,
    connection,
    reseed,
    api: {
      get: (path) => server().get(path).set('x-api-key', E2E_API_KEY),
      post: (path, body) =>
        server().post(path).set('x-api-key', E2E_API_KEY).send(body),
      patch: (path, body) =>
        server().patch(path).set('x-api-key', E2E_API_KEY).send(body),
      delete: (path) => server().delete(path).set('x-api-key', E2E_API_KEY),
    },
  };
}
