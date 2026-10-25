import { publishStack, startE2eStack } from '@northwind/e2e-stack';

/** A seeded in-memory MongoDB and the real built API, shared by every e2e spec. */
export default async function globalSetup(): Promise<void> {
  const stack = await startE2eStack();
  (globalThis as { __STACK__?: typeof stack }).__STACK__ = stack;
  publishStack(stack);
}
