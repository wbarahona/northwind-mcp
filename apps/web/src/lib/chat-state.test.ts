import type { ChatEvent } from './api';
import {
  type AssistantMessage,
  chatReducer,
  type ChatState,
  historyFrom,
  initialChat,
  traceSummary,
} from './chat-state';

const play = (events: ChatEvent[], state: ChatState = initialChat) => {
  let s = chatReducer(state, {
    type: 'ask',
    question: 'Q?',
    engine: 'Qwen3-8B',
    at: 1000,
  });
  for (const event of events) s = chatReducer(s, { type: 'event', event });
  return chatReducer(s, { type: 'finish', at: 5300, outcome: 'done' });
};
const last = (s: ChatState) => s.messages.at(-1) as AssistantMessage;

describe('chatReducer', () => {
  it('adds the question and an assistant message that fills in as events arrive', () => {
    const s = play([
      { type: 'step', label: 'Plan → get_order', ms: 1200, firstTokenMs: 300 },
      {
        type: 'tool',
        name: 'get_order',
        args: { order: '10248' },
        ms: 40,
        result: 'Order ORD-10248 …',
        isError: false,
      },
      { type: 'token', text: 'Three ' },
      { type: 'token', text: 'lines.' },
      { type: 'step', label: 'Answer', ms: 900, tokensPerSecond: 24.6 },
      { type: 'done' },
    ]);

    expect(s.busy).toBe(false);
    expect(s.messages[0]).toEqual({ id: 1, role: 'user', text: 'Q?' });
    expect(last(s)).toMatchObject({
      status: 'done',
      answer: 'Three lines.',
      toolCalls: 1,
      elapsedMs: 4300,
    });
    expect(last(s).steps).toEqual([
      { label: 'Plan → get_order', detail: '1.2 s · first token 300 ms' },
      {
        label: 'MCP get_order',
        detail: '0.0 s · 17 chars to model',
        payload: '{"order":"10248"}\n\nOrder ORD-10248 …',
        isError: false,
      },
      { label: 'Answer', detail: '0.9 s · 24.6 tok/s' },
    ]);
    expect(traceSummary(last(s))).toBe(
      'How I got this · Qwen3-8B · 1 tool call · 4.3 s',
    );
  });

  it('drops text written before a tool call: the model was thinking aloud', () => {
    const s = play([
      { type: 'token', text: 'Let me look that up.' },
      { type: 'step', label: 'Plan → get_order', ms: 500 },
      { type: 'token', text: 'The answer.' },
      { type: 'step', label: 'Answer', ms: 500 },
    ]);

    expect(last(s).answer).toBe('The answer.');
  });

  it('keeps reasoning in the trace step it belongs to', () => {
    const s = play([
      { type: 'reasoning', text: 'I should call get_order. ' },
      { type: 'step', label: 'Plan → get_order', ms: 500 },
    ]);

    expect(last(s).steps[0]!.payload).toBe('I should call get_order.');
    expect(last(s).reasoning).toBe('');
  });

  it('shows waiting, then keeps an error from the agent even when the stream ends normally', () => {
    let s = chatReducer(initialChat, {
      type: 'ask',
      question: 'Q?',
      engine: 'm',
      at: 0,
    });
    s = chatReducer(s, { type: 'event', event: { type: 'waiting', ahead: 2 } });
    expect(last(s)).toMatchObject({ status: 'waiting', ahead: 2 });

    s = chatReducer(s, {
      type: 'event',
      event: { type: 'error', message: 'The model server is not reachable.' },
    });
    s = chatReducer(s, { type: 'finish', at: 10, outcome: 'done' });
    expect(last(s)).toMatchObject({
      status: 'error',
      error: 'The model server is not reachable.',
    });
  });

  it('marks a stopped answer, keeping what was written so far', () => {
    let s = chatReducer(initialChat, {
      type: 'ask',
      question: 'Q?',
      engine: 'm',
      at: 0,
    });
    s = chatReducer(s, {
      type: 'event',
      event: { type: 'token', text: 'Partial' },
    });
    s = chatReducer(s, { type: 'finish', at: 10, outcome: 'stopped' });

    expect(last(s)).toMatchObject({ status: 'stopped', answer: 'Partial' });
    expect(s.busy).toBe(false);
  });
});

describe('historyFrom', () => {
  it('keeps the last finished turns, trimming long answers', () => {
    let s = initialChat;
    for (const n of [1, 2, 3, 4]) {
      s = play([{ type: 'token', text: `answer ${n} ${'x'.repeat(700)}` }], s);
    }
    s = chatReducer(s, {
      type: 'ask',
      question: 'unfinished',
      engine: 'm',
      at: 0,
    });

    const history = historyFrom(s.messages);
    expect(history).toHaveLength(3);
    expect(history[0]!.answer.startsWith('answer 2')).toBe(true);
    expect(history[0]!.answer).toHaveLength(600);
  });
});
