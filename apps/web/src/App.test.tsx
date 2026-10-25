import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import type { ChatEvent } from './lib/api';

const CATALOG = {
  instructions: 'Northwind.',
  tools: [
    {
      name: 'get_order',
      description: 'Get one order',
      inputSchema: { type: 'object' },
    },
  ],
  llm: { model: 'hf.co/Qwen/Qwen3-8B-GGUF:Q4_K_M', thinking: false },
};

const ORDER_EVENTS: ChatEvent[] = [
  { type: 'step', label: 'Plan → get_order', ms: 1200 },
  {
    type: 'tool',
    name: 'get_order',
    args: { order: '10248' },
    ms: 45,
    result: 'Order ORD-10248 for Vins et alcools Chevalier (VINET) …',
    isError: false,
  },
  { type: 'token', text: 'Order **ORD-10248** has:\n' },
  { type: 'token', text: '- Queso Cabrales\n- Mozzarella di Giovanni' },
  { type: 'step', label: 'Answer', ms: 800, tokensPerSecond: 24 },
  { type: 'done' },
];

/** A fake agent: answers /api/tools and /healthz, and streams the given chat events. */
function fakeAgent(
  options: {
    events?: ChatEvent[];
    llm?: 'up' | 'down';
    down?: boolean;
    hold?: boolean;
  } = {},
) {
  const chats: { question: string; history: unknown[] }[] = [];
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    });

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (options.down) throw new TypeError('Failed to fetch');
    if (url === '/api/tools') return json(CATALOG);
    if (url === '/healthz')
      return json({
        status: 'ok',
        tools: 1,
        model: 'm',
        llm: options.llm ?? 'up',
      });
    if (url === '/api/chat') {
      chats.push(JSON.parse(init!.body as string) as (typeof chats)[number]);
      const signal = init!.signal!;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of options.events ?? ORDER_EVENTS) {
            if (options.hold && event.type === 'done') break;
            controller.enqueue(
              new TextEncoder().encode(`${JSON.stringify(event)}\n`),
            );
          }
          if (options.hold) {
            signal.addEventListener('abort', () =>
              controller.error(new DOMException('aborted', 'AbortError')),
            );
          } else controller.close();
        },
      });
      return new Response(body, {
        headers: { 'content-type': 'application/x-ndjson' },
      });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return { chats };
}

afterEach(() => vi.unstubAllGlobals());

describe('App', () => {
  it('shows the model, the tools and the suggested questions once connected', async () => {
    fakeAgent();
    render(<App />);

    expect(await screen.findByText('Local model ready')).toBeInTheDocument();
    expect(
      screen.getByText('Qwen3-8B via Docker Model Runner · 1 read-only tools'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: "What's in order 10248?" }),
    ).toBeEnabled();
    expect(
      screen.getAllByRole('button', { name: /\?$|ALFKI$|Germany$/ }),
    ).toHaveLength(9);
  });

  it('asks a suggested question and streams the answer with its trace', async () => {
    const { chats } = fakeAgent();
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole('button', { name: "What's in order 10248?" }),
    );

    const log = screen.getByRole('log', { name: 'Conversation' });
    expect(
      await within(log).findByText('Mozzarella di Giovanni'),
    ).toBeInTheDocument();
    expect(within(log).getByText('ORD-10248').tagName).toBe('STRONG');
    expect(within(log).getByText("What's in order 10248?")).toBeInTheDocument();

    const trace = within(log).getByText(
      /^How I got this · Qwen3-8B · 1 tool call · [0-9.]+ s$/,
    );
    await user.click(trace);
    expect(within(log).getByText('MCP get_order')).toBeInTheDocument();
    expect(
      within(log).getByText(/Order ORD-10248 for Vins et alcools Chevalier/),
    ).toBeInTheDocument();
    expect(chats).toEqual([
      { question: "What's in order 10248?", history: [] },
    ]);
  });

  it('sends typed questions with Enter, with the earlier turn as history', async () => {
    const { chats } = fakeAgent();
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByRole('textbox', { name: 'Your question' });
    await waitFor(() => expect(input).toBeEnabled());

    await user.type(input, 'First question{Enter}');
    await screen.findByText('Mozzarella di Giovanni');
    await user.type(input, 'Second line{Shift>}{Enter}{/Shift}continues');
    expect(input).toHaveValue('Second line\ncontinues');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(chats).toHaveLength(2));
    expect(chats[1]).toEqual({
      question: 'Second line\ncontinues',
      history: [
        {
          question: 'First question',
          answer:
            'Order **ORD-10248** has:\n- Queso Cabrales\n- Mozzarella di Giovanni',
        },
      ],
    });
  });

  it('stops an answer with the Stop button', async () => {
    fakeAgent({ hold: true });
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole('button', { name: "What's in order 10248?" }),
    );
    await screen.findByText('Mozzarella di Giovanni');

    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(await screen.findByText('Stopped.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('shows errors from the agent in the answer', async () => {
    fakeAgent({
      events: [
        {
          type: 'error',
          message:
            'The model server is not reachable. Is Docker Model Runner running?',
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole('button', { name: "What's in order 10248?" }),
    );

    expect(
      await screen.findByText(
        'The model server is not reachable. Is Docker Model Runner running?',
      ),
    ).toBeInTheDocument();
  });

  it('says when the model server is offline, and when the agent is unreachable', async () => {
    fakeAgent({ llm: 'down' });
    const { unmount } = render(<App />);
    expect(await screen.findByText('Model server offline')).toBeInTheDocument();
    unmount();

    fakeAgent({ down: true });
    render(<App />);
    expect(await screen.findByText('Agent unreachable')).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Your question' }),
    ).toBeDisabled();
  });
});
