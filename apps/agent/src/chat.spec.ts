import {
  buildSystemPrompt,
  type ChatEvent,
  runChat,
  shrink,
  type ToolBox,
} from './chat';
import { PROFILES, type ModelProfile } from './profiles';
import { callTool, say, scriptedLlm } from '../test/scripted-llm';
import type { CompletionChunk, FunctionTool } from './llm';

const tool = (name: string): FunctionTool => ({
  type: 'function',
  function: {
    name,
    description: `${name} tool`,
    parameters: { type: 'object' },
  },
});

function fakeToolbox(results: Record<string, string | Error> = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const toolbox: ToolBox = {
    tools: [tool('get_order'), tool('find_orders')],
    call: async (name, args) => {
      calls.push({ name, args });
      const result = results[name];
      if (result instanceof Error) throw result;
      if (result?.startsWith('ERROR '))
        return { isError: true, text: result.slice(6) };
      return { isError: false, text: result ?? `${name} result` };
    },
  };
  return { toolbox, calls };
}

async function chat(
  rounds: CompletionChunk[][],
  options: {
    question?: string;
    history?: { question: string; answer: string }[];
    results?: Record<string, string | Error>;
    maxToolRounds?: number;
    profile?: ModelProfile;
  } = {},
) {
  const { llm, requests } = scriptedLlm(rounds);
  const { toolbox, calls } = fakeToolbox(options.results);
  const events: ChatEvent[] = [];
  let clock = 0;
  await runChat(
    {
      question: options.question ?? "What's in order 10248?",
      history: options.history,
    },
    (e) => events.push(e),
    {
      llm,
      toolbox,
      systemPrompt: 'SYSTEM',
      maxToolRounds: options.maxToolRounds,
      profile: options.profile,
      now: () => (clock += 10),
    },
  );
  return { events, requests, calls };
}

const ofType = <T extends ChatEvent['type']>(events: ChatEvent[], type: T) =>
  events.filter((e): e is Extract<ChatEvent, { type: T }> => e.type === type);

// ---------------------------------------------------------------- tests

describe('runChat', () => {
  it('streams a direct answer as tokens, then an Answer step', async () => {
    const { events, requests } = await chat([[say('Hello'), say(' there')]]);

    expect(events.map((e) => e.type)).toEqual(['token', 'token', 'step']);
    expect(ofType(events, 'step')[0]).toMatchObject({
      label: 'Answer',
      firstTokenMs: 10,
    });
    expect(requests[0]!.messages).toEqual([
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: "What's in order 10248?" },
    ]);
    expect(requests[0]!.tools?.map((t) => t.function.name)).toEqual([
      'get_order',
      'find_orders',
    ]);
  });

  it('runs a tool call that arrives in pieces and gives the model its result', async () => {
    const { events, requests, calls } = await chat(
      [callTool('get_order', '{"order":"ORD-10248"}'), [say('Three lines.')]],
      { results: { get_order: 'Order ORD-10248 …\n{"code":"ORD-10248"}' } },
    );

    expect(calls).toEqual([
      { name: 'get_order', args: { order: 'ORD-10248' } },
    ]);
    expect(
      events.map((e) => (e.type === 'step' ? `step:${e.label}` : e.type)),
    ).toEqual(['step:Plan → get_order', 'tool', 'token', 'step:Answer']);
    expect(ofType(events, 'tool')[0]).toEqual({
      type: 'tool',
      name: 'get_order',
      args: { order: 'ORD-10248' },
      ms: 10,
      result: 'Order ORD-10248 …\n{"code":"ORD-10248"}',
      isError: false,
    });
    expect(requests[1]!.messages.slice(2)).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'id_get_order',
            type: 'function',
            function: { name: 'get_order', arguments: '{"order":"ORD-10248"}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'id_get_order',
        content: 'Order ORD-10248 …\n{"code":"ORD-10248"}',
      },
    ]);
  });

  it('runs several tool calls from one round, in order', async () => {
    const { calls, events } = await chat([
      [
        ...callTool('find_orders', '{"customer":"ALFKI"}', 0),
        ...callTool('get_order', '{"order":"10248"}', 1),
      ],
      [say('Done.')],
    ]);

    expect(calls.map((c) => c.name)).toEqual(['find_orders', 'get_order']);
    expect(ofType(events, 'step')[0]!.label).toBe(
      'Plan → find_orders, get_order',
    );
  });

  it('feeds tool errors back to the model so it can recover', async () => {
    const { requests, events } = await chat(
      [callTool('get_order', '{"order":"ORD-1"}'), [say('No such order.')]],
      {
        results: {
          get_order: 'ERROR 404 Not Found: Order "ORD-1" was not found.',
        },
      },
    );

    expect(ofType(events, 'tool')[0]).toMatchObject({ isError: true });
    expect(requests[1]!.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'id_get_order',
      content: 'Error: 404 Not Found: Order "ORD-1" was not found.',
    });
  });

  it.each([
    ['invalid JSON', '{"order":', /were not valid JSON/],
    ['a JSON array', '["ORD-10248"]', /must be a JSON object/],
  ])(
    'tells the model when its arguments are %s',
    async (_label, args, message) => {
      const { requests, calls } = await chat([
        callTool('get_order', args),
        [say('ok')],
      ]);

      expect(calls).toHaveLength(0);
      expect(
        (requests[1]!.messages.at(-1) as { content: string }).content,
      ).toMatch(message);
    },
  );

  it('tells the model when it calls a tool that does not exist, or one that throws', async () => {
    const unknown = await chat([
      callTool('delete_everything', '{}'),
      [say('ok')],
    ]);
    const throws = await chat(
      [callTool('get_order', '{"order":"1"}'), [say('ok')]],
      {
        results: { get_order: new Error('MCP server closed') },
      },
    );

    expect(
      (unknown.requests[1]!.messages.at(-1) as { content: string }).content,
    ).toBe(
      'Error: there is no tool named delete_everything. Use one of the listed tools.',
    );
    expect(unknown.calls).toHaveLength(0);
    expect(
      (throws.requests[1]!.messages.at(-1) as { content: string }).content,
    ).toBe('Error: the tool failed: MCP server closed');
  });

  it('withholds the tools on the last round, so the model has to answer', async () => {
    const forever = Array.from({ length: 3 }, () =>
      callTool('find_orders', '{}'),
    );
    const { requests, events } = await chat(
      [...forever, [say('Best I can tell…')]],
      {
        maxToolRounds: 3,
      },
    );

    expect(requests.map((r) => Boolean(r.tools))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(ofType(events, 'step').at(-1)!.label).toBe('Answer');
  });

  it('sends earlier turns as conversation history', async () => {
    const { requests } = await chat([[say('ok')]], {
      question: 'And their phone?',
      history: [{ question: 'Who is ALFKI?', answer: 'Alfreds Futterkiste.' }],
    });

    expect(requests[0]!.messages).toEqual([
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'Who is ALFKI?' },
      { role: 'assistant', content: 'Alfreds Futterkiste.' },
      { role: 'user', content: 'And their phone?' },
    ]);
  });

  const leaked =
    '\n<tool_call>\n{"name": "get_order", "arguments": {"order": "10248"}}\n</tool_call>';
  const leakedRound: CompletionChunk[] = [
    { choices: [{ delta: { reasoning_content: leaked.slice(0, 20) } }] },
    { choices: [{ delta: { reasoning_content: leaked.slice(20) } }] },
  ];

  it('runs a tool call written as text, with the qwen3 profile (llama.cpp passes it on as reasoning)', async () => {
    const { calls, events, requests } = await chat(
      [leakedRound, [say('Three lines.')]],
      { profile: PROFILES.qwen3 },
    );

    expect(calls).toEqual([{ name: 'get_order', args: { order: '10248' } }]);
    expect(ofType(events, 'step').map((s) => s.label)).toEqual([
      'Plan → get_order',
      'Answer',
    ]);
    expect(ofType(events, 'error')).toHaveLength(0);
    expect(requests[1]!.messages.at(-1)).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_0_0',
    });
  });

  it('leaves text tool calls alone with the generic profile', async () => {
    const { calls, events } = await chat([leakedRound]);

    expect(calls).toEqual([]);
    expect(ofType(events, 'step').map((s) => s.label)).toEqual(['Answer']);
    expect(ofType(events, 'error')).toHaveLength(1);
  });

  it('passes reasoning through separately, and reports speed when the server gives it', async () => {
    const { events } = await chat([
      [
        { choices: [{ delta: { reasoning_content: 'Thinking…' } }] },
        { ...say('Answer.'), timings: { predicted_per_second: 24.5 } },
      ],
    ]);

    expect(events[0]).toEqual({ type: 'reasoning', text: 'Thinking…' });
    expect(ofType(events, 'step')[0]).toMatchObject({ tokensPerSecond: 24.5 });
  });

  it('reports an empty answer instead of showing nothing', async () => {
    const { events } = await chat([[{ choices: [{ delta: {} }] }]]);

    expect(ofType(events, 'error')[0]!.message).toMatch(/empty answer/);
  });
});

describe('shrink', () => {
  const result = (rows: number) =>
    `${rows} customers.\n${JSON.stringify({
      items: Array.from({ length: rows }, (_, i) => ({
        code: `C${i}`,
        name: 'x'.repeat(40),
      })),
      total: rows,
    })}`;

  it('leaves results within the budget alone', () => {
    expect(shrink(result(3), 10_000)).toBe(result(3));
  });

  it('drops list rows from the end, keeps the summary, and says how many are shown', () => {
    const out = shrink(result(100), 2_000);

    expect(out.length).toBeLessThanOrEqual(2_000);
    expect(out.startsWith('100 customers.\n')).toBe(true);
    expect(out).toMatch(
      /\(only the first [0-9]+ of these 100 rows are shown\)$/,
    );
    const json = JSON.parse(out.split('\n')[1]!) as {
      items: unknown[];
      total: number;
    };
    expect(json.total).toBe(100);
    expect(json.items.length).toBeGreaterThan(10);
  });

  it('cuts text that is not a list as a last resort', () => {
    expect(shrink('x'.repeat(50), 20)).toBe(`${'x'.repeat(20)}…(truncated)`);
  });
});

describe('buildSystemPrompt', () => {
  it("includes the MCP server's instructions and the benchmark rules", () => {
    const prompt = buildSystemPrompt({
      instructions: 'Today is 2026-10-23.',
      profile: PROFILES.generic,
      thinking: false,
    });

    expect(prompt).toContain('Today is 2026-10-23.');
    expect(prompt).toContain('never fill it in yourself');
    expect(prompt).not.toContain('/no_think');
  });

  it("ends with the profile's suffix: Qwen3's thinking switch, off by default", () => {
    const qwen = (thinking: boolean) =>
      buildSystemPrompt({
        instructions: '',
        profile: PROFILES.qwen3,
        thinking,
      });

    expect(qwen(false).endsWith(' /no_think')).toBe(true);
    expect(qwen(true)).not.toContain('/no_think');
  });
});
