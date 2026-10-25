import { join, resolve } from 'node:path';
import { z } from 'zod';
import { PROFILE_NAMES, type ProfileName } from './profiles';

export interface Config {
  /** Where the page and the API endpoints are served. */
  port: number;
  /** Interface to listen on; 127.0.0.1 keeps it on this machine. */
  host: string;
  /** Which kind of model server: sets the defaults below and how errors name it. */
  llmProvider: LlmProvider;
  /** OpenAI-compatible base URL of the model server, ending in "/". */
  llmUrl: string;
  llmModel: string;
  /** Sent as a bearer token, for servers that need one (cloud APIs). */
  llmApiKey?: string;
  /** The model profile named in LLM_PROFILE; unset means "from the model's name". */
  llmProfile?: ProfileName;
  /** Let the model reason before answering, if its profile has a switch: better planning, much slower. */
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

export const LLM_PROVIDERS = [
  'docker-model-runner',
  'ollama',
  'openai-compatible',
] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/**
 * Each provider's address on this machine (for pnpm dev) and model name. The model is Qwen3
 * 4B, 4-bit, about 2.5 GB, chosen by the benchmark (docs/benchmark.md): about 7.5–8 of 9 right
 * against 9 for 8B, at about 1.6× the speed, which matters on laptops with less memory
 * bandwidth. openai-compatible has no defaults: LLM_URL and LLM_MODEL are required.
 */
export const PROVIDER_DEFAULTS: Record<
  LlmProvider,
  { label: string; url?: string; model?: string }
> = {
  // Host TCP access must be on (setup enables it).
  'docker-model-runner': {
    label: 'Docker Model Runner',
    url: 'http://localhost:12434/engines/v1/',
    model: 'hf.co/Qwen/Qwen3-4B-GGUF:Q4_K_M',
  },
  ollama: {
    label: 'Ollama',
    url: 'http://localhost:11434/v1/',
    model: 'qwen3:4b',
  },
  'openai-compatible': { label: 'the model server' },
};

/** Without LLM_PROVIDER: Docker Model Runner, so .env files from before providers keep working. */
export const DEFAULT_LLM_PROVIDER: LlmProvider = 'docker-model-runner';
export const DEFAULT_LLM_URL = PROVIDER_DEFAULTS[DEFAULT_LLM_PROVIDER].url!;
export const DEFAULT_LLM_MODEL = PROVIDER_DEFAULTS[DEFAULT_LLM_PROVIDER].model!;

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
  LLM_PROVIDER: optional(
    z
      .enum(LLM_PROVIDERS, {
        error: `must be one of ${LLM_PROVIDERS.join(', ')}`,
      })
      .default(DEFAULT_LLM_PROVIDER),
  ),
  LLM_URL: optional(httpUrl(DEFAULT_LLM_URL).optional()),
  LLM_MODEL: optional(z.string().trim().min(1).optional()),
  LLM_API_KEY: optional(z.string().trim().min(1).optional()),
  LLM_PROFILE: optional(
    z
      .enum(PROFILE_NAMES, {
        error: `must be one of ${PROFILE_NAMES.join(', ')}`,
      })
      .optional(),
  ),
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
  const defaults = PROVIDER_DEFAULTS[e.LLM_PROVIDER];
  const llmUrl = e.LLM_URL ?? defaults.url;
  const llmModel = e.LLM_MODEL ?? defaults.model;
  if (!llmUrl || !llmModel) {
    const missing = [!llmUrl && 'LLM_URL', !llmModel && 'LLM_MODEL'].filter(
      (name): name is string => Boolean(name),
    );
    throw new ConfigError(
      `Invalid configuration: ${missing.map((name) => `${name} is required with LLM_PROVIDER=${e.LLM_PROVIDER}`).join('; ')}`,
    );
  }
  return {
    port: e.PORT,
    host: e.HOST,
    llmProvider: e.LLM_PROVIDER,
    llmUrl: llmUrl.replace(/\/*$/, '/'),
    llmModel,
    ...(e.LLM_API_KEY !== undefined && { llmApiKey: e.LLM_API_KEY }),
    ...(e.LLM_PROFILE !== undefined && { llmProfile: e.LLM_PROFILE }),
    llmThinking: e.LLM_THINKING === '1',
    ...(e.LLM_TEMPERATURE !== undefined && {
      llmTemperature: e.LLM_TEMPERATURE,
    }),
    apiUrl: e.NORTHWIND_API_URL.replace(/\/+$/, ''),
    apiKey: e.NORTHWIND_API_KEY.trim(),
    webDir: resolve(e.WEB_DIR ?? DEFAULT_WEB_DIR),
  };
}
