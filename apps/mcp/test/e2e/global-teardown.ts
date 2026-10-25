import type { E2eStack } from '@northwind/e2e-stack';

export default async function globalTeardown(): Promise<void> {
  await (globalThis as { __STACK__?: E2eStack }).__STACK__?.stop();
}
