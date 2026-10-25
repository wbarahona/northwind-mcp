import type { ChatEvent, Turn } from './api';

/** One line of "How I got this". */
export interface TraceStep {
  label: string;
  detail: string;
  /** Shown in a <pre>: tool arguments and the exact text the model received, or reasoning. */
  payload?: string;
  isError?: boolean;
}

export interface UserMessage {
  id: number;
  role: 'user';
  text: string;
}

export interface AssistantMessage {
  id: number;
  role: 'assistant';
  /** waiting: queued behind another chat; tools: calling tools; streaming: writing the answer. */
  status:
    | 'thinking'
    | 'waiting'
    | 'tools'
    | 'streaming'
    | 'done'
    | 'error'
    | 'stopped';
  answer: string;
  reasoning: string;
  error?: string;
  steps: TraceStep[];
  toolCalls: number;
  /** Who answered, for the trace summary, e.g. "Qwen3-8B". */
  engine: string;
  startedAt: number;
  elapsedMs?: number;
  ahead?: number;
}

export type Message = UserMessage | AssistantMessage;

export interface ChatState {
  messages: Message[];
  busy: boolean;
  nextId: number;
}

export const initialChat: ChatState = { messages: [], busy: false, nextId: 1 };

export type ChatAction =
  | { type: 'ask'; question: string; engine: string; at: number }
  | { type: 'event'; event: ChatEvent }
  | {
      type: 'finish';
      at: number;
      outcome: 'done' | 'stopped' | { error: string };
    };

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The assistant message being written (the last one). */
function updateLast(
  state: ChatState,
  update: (m: AssistantMessage) => AssistantMessage,
): ChatState {
  const last = state.messages.at(-1);
  if (last?.role !== 'assistant') return state;
  return { ...state, messages: [...state.messages.slice(0, -1), update(last)] };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'ask': {
      const user: UserMessage = {
        id: state.nextId,
        role: 'user',
        text: action.question,
      };
      const assistant: AssistantMessage = {
        id: state.nextId + 1,
        role: 'assistant',
        status: 'thinking',
        answer: '',
        reasoning: '',
        steps: [],
        toolCalls: 0,
        engine: action.engine,
        startedAt: action.at,
      };
      return {
        messages: [...state.messages, user, assistant],
        busy: true,
        nextId: state.nextId + 2,
      };
    }

    case 'event':
      return updateLast(state, (m) => applyEvent(m, action.event));

    case 'finish':
      return {
        ...updateLast(state, (m) => ({
          ...m,
          elapsedMs: action.at - m.startedAt,
          ...(action.outcome === 'done'
            ? { status: m.status === 'error' ? 'error' : 'done' }
            : action.outcome === 'stopped'
              ? { status: 'stopped' }
              : { status: 'error', error: action.outcome.error }),
        })),
        busy: false,
      };
  }
}

function applyEvent(m: AssistantMessage, event: ChatEvent): AssistantMessage {
  switch (event.type) {
    case 'waiting':
      return { ...m, status: 'waiting', ahead: event.ahead };
    case 'reasoning':
      return {
        ...m,
        status: m.status === 'waiting' ? 'thinking' : m.status,
        reasoning: m.reasoning + event.text,
      };
    case 'token':
      return { ...m, status: 'streaming', answer: m.answer + event.text };
    case 'step': {
      const speed = event.tokensPerSecond
        ? ` · ${event.tokensPerSecond.toFixed(1)} tok/s`
        : '';
      const first =
        event.firstTokenMs !== undefined
          ? ` · first token ${event.firstTokenMs} ms`
          : '';
      const step: TraceStep = {
        label: event.label,
        detail: `${seconds(event.ms)}${first}${speed}`,
        ...(m.reasoning.trim() && { payload: m.reasoning.trim() }),
      };
      // Text before a tool call is the model talking to itself, not the answer.
      return event.label === 'Answer'
        ? { ...m, steps: [...m.steps, step] }
        : {
            ...m,
            steps: [...m.steps, step],
            status: 'tools',
            answer: '',
            reasoning: '',
          };
    }
    case 'tool':
      return {
        ...m,
        toolCalls: m.toolCalls + 1,
        steps: [
          ...m.steps,
          {
            label: `MCP ${event.name}`,
            detail: `${seconds(event.ms)} · ${event.result.length} chars to model${event.isError ? ' · error' : ''}`,
            payload: `${JSON.stringify(event.args)}\n\n${event.result}`,
            isError: event.isError,
          },
        ],
      };
    case 'error':
      return { ...m, status: 'error', error: event.message };
    case 'done':
      return m;
  }
}

/** The last few turns, trimmed, as context for the next question (shared by both engines). */
export function historyFrom(messages: Message[], turns = 3): Turn[] {
  const history: Turn[] = [];
  for (let i = 1; i < messages.length; i++) {
    const question = messages[i - 1];
    const answer = messages[i];
    if (
      question?.role === 'user' &&
      answer?.role === 'assistant' &&
      answer.status === 'done'
    ) {
      history.push({
        question: question.text,
        answer: answer.answer.slice(0, 600),
      });
    }
  }
  return history.slice(-turns);
}

/** "How I got this · Qwen3-8B · 2 tool calls · 4.3 s" */
export function traceSummary(m: AssistantMessage): string {
  const calls = `${m.toolCalls} tool call${m.toolCalls === 1 ? '' : 's'}`;
  const time = m.elapsedMs !== undefined ? ` · ${seconds(m.elapsedMs)}` : '';
  return `How I got this · ${m.engine} · ${calls}${time}`;
}
