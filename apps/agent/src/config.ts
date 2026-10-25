import { join, resolve } from 'node:path';
import { z } from 'zod';

export interface Config {
  /** Where the page and the API endpoints are served. */
  port: number;
  /** Interface to listen on; 127.0.0.1 keeps it on this machine. */
  host: string;
  /** OpenAI-compatible base URL of the model server, ending in "/". */
  llmUrl: string;
  llmModel: string;
  /** Let Qwen3 reason before answering: better planning, much slower. */
  llmThinking: boolean;
  /** Sampling temperature; unset leaves the model server's default. */
  llmTemperature?: number;
  /** Passed to the MCP server it starts. */
  apiUrl: string;
  apiKey: string;
  /** The built chat page (apps/web/dist). */
  webDir: string;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Docker Model Runner on the host, with host TCP access on (setup enables it). */
export const DEFAULT_LLM_URL = 'http://localhost:12434/engines/v1/';
/**
 * Qwen3 4B, 4-bit: about 2.5 GB. Chosen by the benchmark (docs/benchmark.md): about 8 of 9
 * right against 9 for 8B, at about 1.6× the speed, which matters on laptops with less memory
 * bandwidth.
 */
export const DEFAULT_LLM_MODEL = 'hf.co/Qwen/Qwen3-4B-GGUF:Q4_K_M';

const unsetIfEmpty = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(unsetIfEmpty, schema);

const httpUrl = (example: string) =>
  z.url({
    protocol: /^https?$/,
    error: `must be an http(s) URL, e.g. ${example}`,
  });

const EnvSchema = z.object({
  PORT: optional(
    z.coerce
      .number({ error: 'must be a port number' })
      .int()
      .min(1)
      .max(65535)
      .default(5173),
  ),
  HOST: optional(
    z
      .ipv4({ error: 'must be an IPv4 address such as 127.0.0.1 or 0.0.0.0' })
      .default('127.0.0.1'),
  ),
  LLM_URL: optional(httpUrl(DEFAULT_LLM_URL).default(DEFAULT_LLM_URL)),
  LLM_MODEL: optional(z.string().trim().min(1).default(DEFAULT_LLM_MODEL)),
  LLM_THINKING: optional(
    z.enum(['0', '1'], { error: 'must be 0 or 1' }).default('0'),
  ),
  LLM_TEMPERATURE: optional(
    z.coerce
      .number({ error: 'must be a number from 0 to 2' })
      .min(0, 'must be a number from 0 to 2')
      .max(2, 'must be a number from 0 to 2')
      .optional(),
  ),
  NORTHWIND_API_URL: optional(
    httpUrl('http://localhost:3000').default('http://localhost:3000'),
  ),
  NORTHWIND_API_KEY: optional(
    z.string({ error: "is required: set it to one of the API's API_KEYS" }),
  ),
  WEB_DIR: optional(z.string().trim().min(1).optional()),
});

/** apps/web/dist next to this package in the monorepo; the Docker image sets WEB_DIR. */
export const DEFAULT_WEB_DIR = join(__dirname, '..', '..', 'web', 'dist');

/** Reads and checks the agent's settings. Throws a ConfigError listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join('.')} ${issue.message}`,
    );
    throw new ConfigError(`Invalid configuration: ${problems.join('; ')}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    host: e.HOST,
    llmUrl: e.LLM_URL.replace(/\/*$/, '/'),
    llmModel: e.LLM_MODEL,
    llmThinking: e.LLM_THINKING === '1',
    ...(e.LLM_TEMPERATURE !== undefined && {
      llmTemperature: e.LLM_TEMPERATURE,
    }),
    apiUrl: e.NORTHWIND_API_URL.replace(/\/+$/, ''),
    apiKey: e.NORTHWIND_API_KEY.trim(),
    webDir: resolve(e.WEB_DIR ?? DEFAULT_WEB_DIR),
  };
}
