import { MongoMemoryReplSet } from 'mongodb-memory-server';

export const E2E_API_KEY = 'e2e-test-key';

/**
 * Runs once before any test file is imported. ConfigModule reads the environment when
 * AppModule is first imported, so the in-memory database and test env must exist first.
 * Real environment variables take precedence over .env, so tests never touch the dev database.
 */
export default async function globalSetup(): Promise<void> {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (globalThis as { __MONGO__?: MongoMemoryReplSet }).__MONGO__ = mongo;

  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI = mongo.getUri('northwind');
  process.env.API_KEYS = E2E_API_KEY;
}
