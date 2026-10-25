import { stackFromEnv } from '@northwind/e2e-stack';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildSystemPrompt, type ChatEvent } from '../../src/chat';
import { type ChatMessage, createLlmClient } from '../../src/llm';
import { type McpConnection, startMcp } from '../../src/mcp';
import { createAgentServer } from '../../src/server';

/**
 * The agent end to end: the built MCP server over stdio (read-only) against the real API
 * and a seeded database, and a fake OpenAI-compatible model server that streams SSE like
 * llama.cpp. The model is scripted; everything else is real.
 */

interface ModelRequest {
  messages: ChatMessage[];
  tools?: { function: { name: string } }[];
}

/** Asks for get_order, then answers from what the tool returned. */
function fakeModelServer() {
  const requests: ModelRequest[] = [];
  const sse = (chunks: object[]) =>
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') +
    'data: [DONE]\n\n';
  const server = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const body = JSON.parse(raw) as ModelRequest;
      requests.push(body);
      const last = body.messages.at(-1)!;
      const chunks =
        last.role === 'tool'
          ? [
              { choices: [{ delta: { content: 'From the order: ' } }] },
              {
                choices: [{ delta: { content: last.content.split('\n')[0] } }],
              },
              {
                choices: [{ delta: {} }],
                timings: { predicted_per_second: 25 },
              },
            ]
          : [
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'call_1',
                          function: { name: 'get_order', arguments: '' },
                        },
                      ],
                    },
                  },
                ],
              },
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        { index: 0, function: { arguments: '{"order":' } },
                      ],
                    },
                  },
                ],
              },
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        { index: 0, function: { arguments: '"10248"}' } },
                      ],
                    },
                  },
                ],
              },
            ];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse(chunks));
    });
  });
  return { server, requests };
}

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

describe('Agent (e2e)', () => {
  let mcp: McpConnection;
  let model: ReturnType<typeof fakeModelServer>;
  let agent: Server;
  let base: string;

  beforeAll(async () => {
    const stack = stackFromEnv();
    mcp = await startMcp({ apiUrl: stack.apiUrl, apiKey: stack.apiKey });
    model = fakeModelServer();
    const modelUrl = await listen(model.server);
    agent = createAgentServer({
      catalog: mcp,
      llm: createLlmClient({ url: `${modelUrl}/v1/`, model: 'fake-qwen' }),
      systemPrompt: buildSystemPrompt({
        instructions: mcp.instructions,
        thinking: false,
      }),
      thinking: false,
      webDir: '/nonexistent',
    });
    base = await listen(agent);
  });

  afterAll(async () => {
    await mcp?.close();
    agent?.closeAllConnections();
    await new Promise((r) => agent?.close(r));
    await new Promise((r) => model?.server.close(r));
  });

  it('starts the MCP server read-only: 14 tools, none that can change data', async () => {
    const { tools } = (await (await fetch(`${base}/api/tools`)).json()) as {
      tools: { name: string }[];
    };

    expect(tools).toHaveLength(14);
    for (const write of [
      'place_order',
      'update_order',
      'ship_order',
      'remove_order_line',
    ]) {
      expect(tools.map((t) => t.name)).not.toContain(write);
    }
  });

  it('answers "What\'s in order 10248?" through the model, the MCP server and the API', async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: "What's in order 10248?" }),
    });
    const events = (await res.text())
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ChatEvent);

    expect(
      events.map((e) => (e.type === 'step' ? `step:${e.label}` : e.type)),
    ).toEqual([
      'step:Plan → get_order',
      'tool',
      'token',
      'token',
      'step:Answer',
      'done',
    ]);
    const tool = events.find((e) => e.type === 'tool')!;
    expect(tool).toMatchObject({
      name: 'get_order',
      args: { order: '10248' },
      isError: false,
      result: expect.stringMatching(
        /^Order ORD-10248 for Vins et alcools Chevalier \(VINET\), .*net 440\.00, total 472\.38/,
      ),
    });
    const answer = events
      .filter(
        (e): e is Extract<ChatEvent, { type: 'token' }> => e.type === 'token',
      )
      .map((e) => e.text)
      .join('');
    expect(answer).toMatch(
      /^From the order: Order ORD-10248 for Vins et alcools Chevalier/,
    );
    expect(
      events.find((e) => e.type === 'step' && e.label === 'Answer'),
    ).toMatchObject({
      tokensPerSecond: 25,
    });

    // What the model was given: the MCP server's instructions and only read-only tools.
    const first = model.requests.at(-2)!;
    expect(first.messages[0]!.content).toMatch(/Today is [0-9-]+ \(UTC\)/);
    expect(first.messages[0]!.content).toMatch(/This server is read-only/);
    expect(first.tools).toHaveLength(14);
  });
});
