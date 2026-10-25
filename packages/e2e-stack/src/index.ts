import { parseIsoDate, seedDatabase } from '@northwind/seed';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';

/** The key the e2e API accepts. */
export const E2E_API_KEY = 'e2e-stack-key';
/** Seed anchor shared by every e2e suite (and apps/api's), so known figures match. */
export const TEST_ANCHOR = '2026-10-22';

export interface E2eStack {
  apiUrl: string;
  apiKey: string;
  mongoUri: string;
  stop(): Promise<void>;
}

/** The built API (apps/api/dist), found through its package so the path never drifts. */
const apiMain = () =>
  join(
    dirname(require.resolve('@northwind/api/package.json')),
    'dist',
    'main.js',
  );

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/** Resets a database to freshly seeded Northwind data (for suites that write). */
export async function reseed(mongoUri: string): Promise<void> {
  const connection = await mongoose.createConnection(mongoUri).asPromise();
  try {
    await seedDatabase(connection, { anchor: parseIsoDate(TEST_ANCHOR) });
  } finally {
    await connection.close();
  }
}

/**
 * Starts an in-memory MongoDB replica set, seeds it with Northwind, and runs the real built
 * API against it on a free port. Call it from a Jest globalSetup and `stop()` it in the
 * teardown.
 */
export async function startE2eStack(): Promise<E2eStack> {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const mongoUri = mongo.getUri('northwind');
  let api: ChildProcess | undefined;

  const stop = async () => {
    if (api && api.exitCode === null) {
      const exited = new Promise((resolve) => api!.once('exit', resolve));
      api.kill('SIGTERM');
      await exited;
    }
    await mongo.stop();
  };

  try {
    await reseed(mongoUri);

    const port = await freePort();
    let output = '';
    api = spawn(process.execPath, [apiMain()], {
      cwd: dirname(dirname(apiMain())),
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        MONGO_URI: mongoUri,
        PORT: String(port),
        API_KEYS: E2E_API_KEY,
        THROTTLE_LIMIT: '100000',
        LOG_LEVEL: 'warn',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    api.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    api.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));

    const apiUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (api.exitCode !== null) {
        throw new Error(
          `The API exited during startup (is apps/api built?):\n${output}`,
        );
      }
      const healthy = await fetch(`${apiUrl}/health`)
        .then((res) => res.ok)
        .catch(() => false);
      if (healthy) return { apiUrl, apiKey: E2E_API_KEY, mongoUri, stop };
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`The API did not become healthy within 30 s:\n${output}`);
  } catch (error) {
    await stop();
    throw error;
  }
}

/** Environment variables a globalSetup hands to the test files (they run in other processes). */
export const STACK_ENV = {
  apiUrl: 'NORTHWIND_E2E_API_URL',
  apiKey: 'NORTHWIND_E2E_API_KEY',
  mongoUri: 'NORTHWIND_E2E_MONGO_URI',
} as const;

/** Publishes a started stack to the test files (call in globalSetup). */
export function publishStack(stack: E2eStack): void {
  process.env[STACK_ENV.apiUrl] = stack.apiUrl;
  process.env[STACK_ENV.apiKey] = stack.apiKey;
  process.env[STACK_ENV.mongoUri] = stack.mongoUri;
}

/** The stack as a test file sees it (published by the globalSetup). */
export function stackFromEnv(): {
  apiUrl: string;
  apiKey: string;
  mongoUri: string;
} {
  const apiUrl = process.env[STACK_ENV.apiUrl];
  const apiKey = process.env[STACK_ENV.apiKey];
  const mongoUri = process.env[STACK_ENV.mongoUri];
  if (!apiUrl || !apiKey || !mongoUri) {
    throw new Error('No e2e stack: run this suite with its e2e Jest config.');
  }
  return { apiUrl, apiKey, mongoUri };
}
