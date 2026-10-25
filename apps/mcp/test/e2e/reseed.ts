import { reseed as reseedStack, stackFromEnv } from '@northwind/e2e-stack';

/** Resets the e2e database to freshly seeded Northwind data (for specs that write). */
export const reseed = () => reseedStack(stackFromEnv().mongoUri);
