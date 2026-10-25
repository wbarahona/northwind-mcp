import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callTool, say, scriptedLlm } from '../test/scripted-llm';
import type { ChatEvent } from './chat';
import type { CompletionChunk, LlmClient } from './llm';
import type { McpCatalog } from './mcp';
import { createAgentServer, LIMITS } from './server';

const catalog = (calls: string[] = []): McpCatalog => ({
  instructions: 'Northwind instructions.',
  tools: [
    {
      name: 'get_order',
      description: 'Get one order',
      inputSchema: { type: 'object' },
    },
  ],
  toolbox: {
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_order',
          description: 'Get one order',
          parameters: {},
        },
      },
    ],
    call: async (name, args) => {
      calls.push(`${name} ${JSON.stringify(args)}`);
      return {
        isError: false,
        text: `Order ORD-10248 …\n{"code":"ORD-10248"}`,
      };
    },
  },
});

let webDir: string;
beforeAll(() => {
  webDir = mkdtempSync(join(tmpdir(), 'agent-web-'));
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(
    join(webDir, 'index.html'),
    '<!doctype html><title>Chat</title>',
  );
  writeFileSync(join(webDir, 'assets', 'app-1a2b.js'), 'console.log(1)');
  writeFileSync(join(tmpdir(), 'agent-secret.txt'), 'outside');
});
afterAll(() => rmSync(webDir, { recursive: true, force: true }));

/** Every server a test starts is closed afterwards, even when the test fails. */
const open: Server[] = [];
afterEach(async () => {
  for (const server of open.splice(0)) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

async function start(
  options: { llm?: LlmClient; webDir?: string; calls?: string[] } = {},
) {
  const server: Server = createAgentServer({
    catalog: catalog(options.calls),
    llm: options.llm ?? scriptedLlm([[say('Hello.')]]).llm,
    systemPrompt: 'SYSTEM',
    thinking: false,
    webDir: options.webDir ?? webDir,
    checkLlm: () => Promise.resolve(true),
  });
  open.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return {
    server,
    base,
    post,
    // Servers are closed in afterEach; this keeps the tests readable.
    close: () => Promise.resolve(),
  };
}

const events = async (res: Response): Promise<ChatEvent[]> =>
  (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChatEvent);

describe('agent server', () => {
  it('describes its tools and model', async () => {
    const t = await start();
    const res = await fetch(`${t.base}/api/tools`);

    expect(await res.json()).toEqual({
      instructions: 'Northwind instructions.',
      tools: [
        {
          name: 'get_order',
          description: 'Get one order',
          inputSchema: { type: 'object' },
        },
      ],
      llm: { model: 'scripted', thinking: false },
    });
    expect(await (await fetch(`${t.base}/healthz`)).json()).toEqual({
      status: 'ok',
      tools: 1,
      model: 'scripted',
      llm: 'up',
    });
    await t.close();
  });

  it('streams a chat as NDJSON events, ending with done', async () => {
    const { llm } = scriptedLlm([
      callTool('get_order', '{"order":"10248"}'),
      [say('Three lines.')],
    ]);
    const calls: string[] = [];
    const t = await start({ llm, calls });

    const res = await t.post('/api/chat', {
      question: "What's in order 10248?",
    });

    expect(res.headers.get('content-type')).toBe(
      'application/x-ndjson; charset=utf-8',
    );
    expect((await events(res)).map((e) => e.type)).toEqual([
      'step',
      'tool',
      'token',
      'step',
      'done',
    ]);
    expect(calls).toEqual(['get_order {"order":"10248"}']);
    await t.close();
  });

  it('reports a failing model as an error event', async () => {
    const llm: LlmClient = {
      model: 'broken',
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('The model server is not reachable.');
      },
    };
    const t = await start({ llm });

    const res = await t.post('/api/chat', { question: 'hi' });

    expect(await events(res)).toEqual([
      { type: 'error', message: 'The model server is not reachable.' },
    ]);
    await t.close();
  });

  it('runs one chat at a time and tells the next one it is waiting', async () => {
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((r) => (releaseFirst = r));
    let started = 0;
    const llm: LlmClient = {
      model: 'slow',
      async *stream(): AsyncIterable<CompletionChunk> {
        started++;
        if (started === 1) await firstMayFinish;
        yield say(`answer ${started}`);
      },
    };
    const t = await start({ llm });

    const first = t.post('/api/chat', { question: 'one' });
    await new Promise((r) => setTimeout(r, 50));
    const second = t.post('/api/chat', { question: 'two' });
    await new Promise((r) => setTimeout(r, 50));
    expect(started).toBe(1);
    releaseFirst();

    const secondEvents = await events(await second);
    expect(secondEvents[0]).toEqual({ type: 'waiting', ahead: 1 });
    expect(secondEvents).toContainEqual({ type: 'token', text: 'answer 2' });
    expect((await events(await first)).at(-1)).toEqual({ type: 'done' });
    await t.close();
  });

  it('stops the model when the page goes away (Stop button)', async () => {
    let signal: AbortSignal | undefined;
    const llm: LlmClient = {
      model: 'endless',
      async *stream(request) {
        signal = request.signal;
        while (!request.signal?.aborted) {
          yield say('.');
          await new Promise((r) => setTimeout(r, 10));
        }
      },
    };
    const t = await start({ llm });
    const controller = new AbortController();

    const res = await fetch(`${t.base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'go on forever' }),
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();
    await new Promise((r) => setTimeout(r, 100));

    expect(signal?.aborted).toBe(true);
    await t.close();
  });

  it('refuses non-JSON posts, oversized bodies and bad input', async () => {
    const t = await start();

    const form = await t.post('/api/chat', 'question=hi', {
      'content-type': 'application/x-www-form-urlencoded',
    });
    const big = await t.post('/api/chat', {
      question: 'x'.repeat(LIMITS.chatBodyBytes),
    });
    const broken = await t.post('/api/chat', '{"question":');
    const empty = await t.post('/api/chat', { question: '  ' });
    const long = await t.post('/api/chat', {
      question: 'x'.repeat(LIMITS.questionChars + 1),
    });
    const badHistory = await t.post('/api/chat', {
      question: 'hi',
      history: 'yesterday',
    });

    expect(form.status).toBe(415);
    expect(big.status).toBe(413);
    expect(broken.status).toBe(400);
    expect(await empty.json()).toEqual({
      error: 'Ask a question ("question" is empty).',
    });
    expect(long.status).toBe(400);
    expect(badHistory.status).toBe(400);
    await t.close();
  });

  it('keeps only the most recent history turns', async () => {
    const scripted = scriptedLlm([[say('ok')]]);
    const t = await start({ llm: scripted.llm });
    const history = Array.from({ length: 10 }, (_, i) => ({
      question: `q${i}`,
      answer: `a${i}`,
    }));

    await events(await t.post('/api/chat', { question: 'now', history }));

    const users = scripted.requests[0]!.messages.filter(
      (m) => m.role === 'user',
    ).map((m) => m.content);
    expect(users).toEqual(['q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'now']);
    await t.close();
  });

  it('serves the page with security headers, assets cached, and index.html for page routes', async () => {
    const t = await start();

    const page = await fetch(`${t.base}/`);
    const route = await fetch(`${t.base}/some/page/route`);
    const asset = await fetch(`${t.base}/assets/app-1a2b.js`);
    const missing = await fetch(`${t.base}/assets/missing.js`);

    expect(await page.text()).toContain('<title>Chat</title>');
    expect(page.headers.get('content-security-policy')).toContain(
      "default-src 'self'",
    );
    expect(page.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    );
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect(await route.text()).toContain('<title>Chat</title>');
    expect(asset.headers.get('content-type')).toBe(
      'text/javascript; charset=utf-8',
    );
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(missing.status).toBe(404);
    await t.close();
  });

  it('never serves files outside the page folder', async () => {
    const t = await start();
    // Raw requests: fetch() would normalize "/../" away before it reached the server.
    const rawGet = (path: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request(
          `${t.base}${path.startsWith('/') ? '' : '/'}`,
          { path },
          (res) => {
            let body = '';
            res.on('data', (c: Buffer) => (body += c.toString()));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          },
        );
        req.on('error', reject);
        req.end();
      });

    for (const path of [
      '/../agent-secret.txt',
      '/assets/../../agent-secret.txt',
      '/%2e%2e/agent-secret.txt',
      '/assets/%2e%2e%2f..%2fagent-secret.txt',
    ]) {
      const res = await rawGet(path);
      expect([path, res.status]).toEqual([path, 404]);
      expect(res.body).not.toContain('outside');
    }
    await t.close();
  });

  it('explains when the page has not been built', async () => {
    const t = await start({ webDir: join(webDir, 'does-not-exist') });

    const res = await fetch(`${t.base}/`);

    expect(await res.text()).toContain("The chat page isn't built yet");
    await t.close();
  });

  it('answers unknown API paths and methods clearly', async () => {
    const t = await start();

    expect((await fetch(`${t.base}/api/nope`)).status).toBe(404);
    expect((await fetch(`${t.base}/api/chat`)).status).toBe(405);
    expect(
      (await t.post('/api/call', { name: 'get_order', arguments: {} })).status,
    ).toBe(404);
    expect((await fetch(`${t.base}/`, { method: 'DELETE' })).status).toBe(405);
    await t.close();
  });
});
