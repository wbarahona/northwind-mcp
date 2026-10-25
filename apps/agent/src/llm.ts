/**
 * A minimal client for an OpenAI-compatible chat completions endpoint with streaming
 * (Docker Model Runner, Ollama, llama.cpp, LM Studio, vLLM, …), and the message types
 * the tool loop uses.
 */

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** A tool as the model sees it. */
export interface FunctionTool {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}

/** One streamed chunk. Only the fields the loop reads are typed. */
export interface CompletionChunk {
  choices?: {
    delta?: {
      content?: string | null;
      /** The model's reasoning, for models that think (llama.cpp splits it out). */
      reasoning_content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
  }[];
  /** llama.cpp's speed figures. */
  timings?: { predicted_per_second?: number };
}

export interface CompletionRequest {
  messages: ChatMessage[];
  /** Omitted on the last round, so the model has to answer in words. */
  tools?: FunctionTool[];
  signal?: AbortSignal;
}

export interface LlmClient {
  readonly model: string;
  stream(request: CompletionRequest): AsyncIterable<CompletionChunk>;
}

/** The model server failed or refused; the message is meant for the person asking. */
export class LlmError extends Error {
  override readonly name = 'LlmError';
}

export function createLlmClient(options: {
  /** Base URL ending in "/", e.g. http://localhost:12434/engines/v1/ */
  url: string;
  model: string;
  /** How errors name the server, e.g. "Ollama". */
  label?: string;
  /** Sent as `Authorization: Bearer …` when set. */
  apiKey?: string;
  /** Sampling temperature; omitted from requests when unset (the server's default applies). */
  temperature?: number;
  fetch?: typeof globalThis.fetch;
}): LlmClient {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const endpoint = new URL('chat/completions', options.url);

  return {
    model: options.model,
    async *stream({ messages, tools, signal }) {
      let res: Response;
      try {
        res = await fetchFn(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(options.apiKey && {
              authorization: `Bearer ${options.apiKey}`,
            }),
          },
          body: JSON.stringify({
            model: options.model,
            messages,
            ...(tools?.length ? { tools } : {}),
            ...(options.temperature !== undefined && {
              temperature: options.temperature,
            }),
            stream: true,
            stream_options: { include_usage: true },
          }),
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new LlmError(
          `${capitalize(options.label ?? 'the model server')} is not reachable at ${options.url}. Check that it is running and that LLM_URL points to it.`,
        );
      }
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw new LlmError(
          `The model server answered ${res.status}${text ? `: ${text.slice(0, 500)}` : ''}`,
        );
      }
      yield* parseSse(res.body);
    },
  };
}

/**
 * Server-sent events → parsed chunks. Lines can arrive split across network chunks, with
 * \n or \r\n. llama.cpp reports request errors mid-stream on an `error:` line (not as an
 * HTTP status), e.g. "Failed to parse grammar"; those become an LlmError.
 */
export async function* parseSse(
  body: AsyncIterable<Uint8Array>,
): AsyncIterable<CompletionChunk> {
  const decoder = new TextDecoder();
  let buffer = '';

  const parseLine = (raw: string): CompletionChunk | 'done' | undefined => {
    const line = raw.trim();
    if (line.startsWith('error:')) {
      throw new LlmError(
        `The model server rejected the request: ${errorMessage(line.slice(6))}`,
      );
    }
    if (!line.startsWith('data:')) return undefined; // comments, event names, keep-alives
    const data = line.slice(5).trim();
    if (data === '[DONE]') return 'done';
    try {
      return JSON.parse(data) as CompletionChunk;
    } catch {
      throw new LlmError(
        `The model server sent something unreadable: ${data.slice(0, 200)}`,
      );
    }
  };

  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const chunk = parseLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (chunk === 'done') return;
      if (chunk) yield chunk;
    }
  }
  const last = parseLine(buffer + decoder.decode());
  if (last && last !== 'done') yield last;
}

/** `{"message": "..."}` or `{"error": {"message": "..."}}` or plain text. */
function errorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      message?: string;
      error?: { message?: string } | string;
    };
    const nested =
      typeof parsed.error === 'string' ? parsed.error : parsed.error?.message;
    return parsed.message ?? nested ?? raw.trim();
  } catch {
    return raw.trim();
  }
}

const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);
