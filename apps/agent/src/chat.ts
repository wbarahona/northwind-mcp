import type { ChatMessage, FunctionTool, LlmClient, ToolCall } from './llm';
import { type ModelProfile, PROFILES } from './profiles';

/** What the page receives, one JSON object per line. */
export type ChatEvent =
  | { type: 'reasoning'; text: string }
  | { type: 'token'; text: string }
  | {
      type: 'step';
      /** "Plan → get_order, find_orders" or "Answer". */
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
      /** Exactly what the model was given. */
      result: string;
      isError: boolean;
    }
  | { type: 'error'; message: string }
  /** Another chat is using the model; this one starts when those ahead of it finish. */
  | { type: 'waiting'; ahead: number }
  | { type: 'done' };

export interface ToolResult {
  text: string;
  isError: boolean;
}

/** The tools the model may call, and how to run one (the MCP client in production). */
export interface ToolBox {
  tools: FunctionTool[];
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

export interface Turn {
  question: string;
  answer: string;
}

export interface ChatOptions {
  llm: LlmClient;
  toolbox: ToolBox;
  systemPrompt: string;
  /** What this model family needs; `generic` when unset. */
  profile?: ModelProfile;
  /** Rounds that may call tools; one more round without tools forces an answer. */
  maxToolRounds?: number;
  /** Characters of each tool result handed to the model. */
  resultBudget?: number;
  /** For tests: a fake clock in milliseconds. */
  now?: () => number;
}

export const MAX_TOOL_ROUNDS = 6;
export const RESULT_BUDGET = 12_000;

export function buildSystemPrompt(options: {
  instructions: string;
  profile: ModelProfile;
  thinking: boolean;
}): string {
  return [
    'You are the Northwind Traders assistant for internal staff.',
    options.instructions,
    'Answer only from data you retrieve with the tools; never invent names, numbers, codes or dates.',
    "If a field you need isn't in the results, call a tool to get it; never fill it in yourself.",
    'Chain several tool calls when a question needs it, for example find a customer, then their orders.',
    'Prefer the totals and shares the tools compute over adding numbers up yourself.',
    // Rules from the benchmark (docs/benchmark.md): each targets a mistake small models made.
    'Copy codes, names and figures exactly as the tools give them; never round, recompute or respell them.',
    "For one customer's orders, call find_orders with customer set to their code or name: without it, you get every customer's orders.",
    'If a tool says nothing matches and suggests a code, call it again with that code.',
    'When asked what an order contains or what someone ordered, give the order code, its products and its total: use get_order, or find_orders with includeLines.',
    'Keep answers short and factual; use a compact Markdown list for several items.',
    options.profile.promptSuffix({ thinking: options.thinking }),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The agent loop: the model answers, or asks for tools; their results go back to it, until
 * it answers or the rounds run out. Every step is reported through `send`.
 */
export async function runChat(
  input: { question: string; history?: Turn[] },
  send: (event: ChatEvent) => void,
  options: ChatOptions,
  signal?: AbortSignal,
): Promise<void> {
  const now = options.now ?? (() => performance.now());
  const maxRounds = options.maxToolRounds ?? MAX_TOOL_ROUNDS;
  const budget = options.resultBudget ?? RESULT_BUDGET;
  const profile = options.profile ?? PROFILES.generic;

  const messages: ChatMessage[] = [
    { role: 'system', content: options.systemPrompt },
    ...(input.history ?? []).flatMap((turn): ChatMessage[] => [
      { role: 'user', content: turn.question },
      { role: 'assistant', content: turn.answer },
    ]),
    { role: 'user', content: input.question },
  ];

  for (let round = 0; round <= maxRounds; round++) {
    const withTools = round < maxRounds;
    const started = now();
    let firstTokenMs: number | undefined;
    let tokensPerSecond: number | undefined;
    let content = '';
    let reasoning = '';
    const calls: { id: string; name: string; arguments: string }[] = [];

    for await (const chunk of options.llm.stream({
      messages,
      tools: withTools ? options.toolbox.tools : undefined,
      signal,
    })) {
      tokensPerSecond = chunk.timings?.predicted_per_second ?? tokensPerSecond;
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        send({ type: 'reasoning', text: delta.reasoning_content });
      }
      if (delta.content) {
        firstTokenMs ??= Math.round(now() - started);
        content += delta.content;
        send({ type: 'token', text: delta.content });
      }
      // Tool calls arrive in pieces: an index, then the name, then the arguments in parts.
      for (const piece of delta.tool_calls ?? []) {
        const call = (calls[piece.index ?? 0] ??= {
          id: '',
          name: '',
          arguments: '',
        });
        if (piece.id) call.id = piece.id;
        if (piece.function?.name) call.name += piece.function.name;
        if (piece.function?.arguments)
          call.arguments += piece.function.arguments;
      }
    }

    let requested = calls.filter((c) => c.name);
    // Some models write a tool call as text in their own format, which the server then passes
    // on as reasoning or content. Their profile reads those, so they run instead of ending the
    // chat with an empty answer.
    if (requested.length === 0) {
      const fromText = profile.textToolCalls(`${content}\n${reasoning}`);
      if (fromText.length) {
        requested = fromText;
        content = '';
      }
    }
    send({
      type: 'step',
      label: requested.length
        ? `Plan → ${requested.map((c) => c.name).join(', ')}`
        : 'Answer',
      ms: Math.round(now() - started),
      ...(firstTokenMs !== undefined && { firstTokenMs }),
      ...(tokensPerSecond !== undefined && { tokensPerSecond }),
    });

    if (requested.length === 0) {
      if (!content.trim()) {
        send({
          type: 'error',
          message:
            'The model gave an empty answer. Try asking again, or rephrase the question.',
        });
      }
      return;
    }

    const toolCalls: ToolCall[] = requested.map((c, i) => ({
      id: c.id || `call_${round}_${i}`,
      type: 'function',
      function: { name: c.name, arguments: c.arguments || '{}' },
    }));
    messages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const t0 = now();
      const { args, result } = await runTool(options.toolbox, call, budget);
      send({
        type: 'tool',
        name: call.function.name,
        args,
        ms: Math.round(now() - t0),
        result: result.text,
        isError: result.isError,
      });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result.text,
      });
    }
  }
}

async function runTool(
  toolbox: ToolBox,
  call: ToolCall,
  budget: number,
): Promise<{ args: unknown; result: ToolResult }> {
  let args: unknown;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    return {
      args: call.function.arguments,
      result: {
        isError: true,
        text: `Error: the arguments for ${call.function.name} were not valid JSON. Call it again with a JSON object.`,
      },
    };
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return {
      args,
      result: {
        isError: true,
        text: `Error: the arguments for ${call.function.name} must be a JSON object.`,
      },
    };
  }
  if (!toolbox.tools.some((t) => t.function.name === call.function.name)) {
    return {
      args,
      result: {
        isError: true,
        text: `Error: there is no tool named ${call.function.name}. Use one of the listed tools.`,
      },
    };
  }
  try {
    const result = await toolbox.call(
      call.function.name,
      args as Record<string, unknown>,
    );
    return {
      args,
      result: result.isError
        ? { isError: true, text: `Error: ${result.text}` }
        : { isError: false, text: shrink(result.text, budget) },
    };
  } catch (error) {
    return {
      args,
      result: {
        isError: true,
        text: `Error: the tool failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}

/**
 * Keeps a tool result inside the model's context. Our MCP results are a summary line, then
 * compact JSON: when that's too long, list rows are dropped from the end (saying how many
 * are shown), and only as a last resort is the text cut.
 */
export function shrink(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const newline = text.indexOf('\n');
  const summary = newline >= 0 ? text.slice(0, newline) : '';
  const json = newline >= 0 ? text.slice(newline + 1) : text;

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return `${text.slice(0, budget)}…(truncated)`;
  }
  const list = listIn(data);
  if (list) {
    const total = list.length;
    const fits = () =>
      summary.length + 1 + JSON.stringify(data).length + 60 <= budget;
    while (list.length > 1 && !fits()) list.pop();
    if (list.length < total) {
      const out = `${summary}\n${JSON.stringify(data)}\n(only the first ${list.length} of these ${total} rows are shown)`;
      if (out.length <= budget) return out;
    }
  }
  return `${text.slice(0, budget)}…(truncated)`;
}

/** The array a list result keeps its rows in. */
function listIn(data: unknown): unknown[] | undefined {
  if (Array.isArray(data)) return data as unknown[];
  if (data && typeof data === 'object') {
    for (const key of ['items', 'rows', 'periods', 'shippers']) {
      const value = (data as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as unknown[];
    }
  }
  return undefined;
}
