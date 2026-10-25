import { z } from 'zod';

export interface Config {
  /** Where the Northwind API runs, without the version prefix. */
  apiUrl: string;
  /** One of the API's API_KEYS. */
  apiKey: string;
  /** Whether the order write tools are registered. */
  writes: boolean;
}

/** The environment is wrong; the message says which variables and why. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

// Hosts often pass unset variables as empty strings (e.g. an unresolved "${VAR}").
const unsetIfEmpty = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const EnvSchema = z.object({
  NORTHWIND_API_URL: z.preprocess(
    unsetIfEmpty,
    z
      .url({
        protocol: /^https?$/,
        error: 'must be an http(s) URL, e.g. http://localhost:3000',
      })
      .default('http://localhost:3000'),
  ),
  NORTHWIND_API_KEY: z.preprocess(
    unsetIfEmpty,
    z.string({ error: "is required: set it to one of the API's API_KEYS" }),
  ),
  NORTHWIND_MCP_WRITES: z.preprocess(
    (value) => {
      const v = unsetIfEmpty(value);
      return typeof v === 'string' ? v.trim().toLowerCase() : v;
    },
    z
      .enum(['true', 'false'], { error: 'must be "true" or "false"' })
      .default('true'),
  ),
});

/** Reads and checks the MCP server's settings. Throws a ConfigError listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join('.')} ${issue.message}`,
    );
    throw new ConfigError(`Invalid configuration: ${problems.join('; ')}`);
  }
  const { NORTHWIND_API_URL, NORTHWIND_API_KEY, NORTHWIND_MCP_WRITES } =
    parsed.data;
  return {
    apiUrl: NORTHWIND_API_URL.replace(/\/+$/, ''),
    apiKey: NORTHWIND_API_KEY.trim(),
    writes: NORTHWIND_MCP_WRITES === 'true',
  };
}
