/**
 * The agent's HTTP API, as the page uses it. The event shapes mirror apps/agent/src/chat.ts
 * (ChatEvent); the agent is the source of truth.
 */

export type ChatEvent =
  | { type: 'reasoning'; text: string }
  | { type: 'token'; text: string }
  | {
      type: 'step';
      label: string;
      ms: number;
      firstTokenMs?: number;
      tokensPerSecond?: number;
    }
  | {
      type: 'tool';
      name: string;
      args: unknown;
      ms: number;
      result: string;
      isError: boolean;
    }
  | { type: 'error'; message: string }
  | { type: 'waiting'; ahead: number }
  | { type: 'done' };

export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, object>;
    required?: string[];
  };
}

export interface Catalog {
  instructions: string;
  tools: ToolInfo[];
  /** The model, its server (LLM_PROVIDER), the agent's profile for it and whether it reasons first. */
  llm: { model: string; provider?: string; profile: string; thinking: boolean };
}

export interface Health {
  status: string;
  tools: number;
  model: string;
  llm: 'up' | 'down';
}

export interface Turn {
  question: string;
  answer: string;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return (await res.json()) as T;
}

export const fetchCatalog = (signal?: AbortSignal) =>
  getJson<Catalog>('/api/tools', signal);
export const fetchHealth = (signal?: AbortSignal) =>
  getJson<Health>('/healthz', signal);

/** One NDJSON object per line; lines can be split anywhere across network chunks. */
export async function* readNdjson<T>(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<T> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as T;
      }
    }
    const rest = (buffer + decoder.decode()).trim();
    if (rest) yield JSON.parse(rest) as T;
  } finally {
    reader.releaseLock();
  }
}

/** Asks the agent; yields its events as they stream in. An error event ends the stream. */
export async function* streamChat(
  question: string,
  history: Turn[],
  signal: AbortSignal,
): AsyncIterable<ChatEvent> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, history }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `The agent answered ${res.status}.`);
  }
  yield* readNdjson<ChatEvent>(res.body);
}

/** "hf.co/Qwen/Qwen3-8B-GGUF:Q4_K_M" → "Qwen3-8B". */
export function modelName(model: string): string {
  const name = model
    .split('/')
    .pop()
    ?.split(':')[0]
    ?.replace(/-gguf$/i, '');
  return name || 'Model';
}
