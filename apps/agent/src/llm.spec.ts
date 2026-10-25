import {
  type CompletionChunk,
  createLlmClient,
  LlmError,
  parseSse,
} from './llm';

const bytes = (...parts: string[]): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    for (const part of parts) yield new TextEncoder().encode(part);
  },
});

const collect = async (stream: AsyncIterable<CompletionChunk>) => {
  const out: CompletionChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
};

const content = (chunks: CompletionChunk[]) =>
  chunks.map((c) => c.choices?.[0]?.delta?.content ?? '').join('');

describe('parseSse', () => {
  it('reads data lines split anywhere across network chunks, with \\n or \\r\\n', async () => {
    const chunks = await collect(
      parseSse(
        bytes(
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\r\n\r\nda',
          'ta: {"choices":[{"delta":{"con',
          'tent":"lo"}}]}\n\n: keep-alive\n\ndata: [DONE]\n\n',
          'data: {"choices":[{"delta":{"content":"ignored after DONE"}}]}\n',
        ),
      ),
    );

    expect(content(chunks)).toBe('Hello');
  });

  it('reads a last line without a trailing newline', async () => {
    const chunks = await collect(
      parseSse(bytes('data: {"choices":[{"delta":{"content":"end"}}]}')),
    );
    expect(content(chunks)).toBe('end');
  });

  it("turns llama.cpp's mid-stream error lines into an LlmError", async () => {
    const stream = parseSse(
      bytes(
        'data: {"choices":[{"delta":{"content":"a"}}]}\n',
        'error: {"code":400,"message":"Failed to parse grammar","type":"invalid_request_error"}\n',
      ),
    );

    await expect(collect(stream)).rejects.toThrow(
      new LlmError(
        'The model server rejected the request: Failed to parse grammar',
      ),
    );
  });

  it('refuses unreadable data instead of guessing', async () => {
    await expect(collect(parseSse(bytes('data: {not json\n')))).rejects.toThrow(
      /sent something unreadable/,
    );
  });
});

describe('createLlmClient', () => {
  const sse = (body: string, status = 200) =>
    new Response(body, {
      status,
      headers: { 'content-type': 'text/event-stream' },
    });

  it('posts a streaming request, with tools only when there are some', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const fetch = (async (url: URL, init: RequestInit) => {
      requests.push({
        url: String(url),
        body: JSON.parse(init.body as string),
      });
      return sse(
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
      );
    }) as unknown as typeof globalThis.fetch;
    const llm = createLlmClient({
      url: 'http://llm.test/engines/v1/',
      model: 'qwen3',
      fetch,
    });
    const tool = {
      type: 'function' as const,
      function: { name: 'get_order', description: 'd', parameters: {} },
    };

    await collect(
      llm.stream({
        messages: [{ role: 'user', content: 'hi' }],
        tools: [tool],
      }),
    );
    await collect(llm.stream({ messages: [{ role: 'user', content: 'hi' }] }));

    expect(requests[0]).toEqual({
      url: 'http://llm.test/engines/v1/chat/completions',
      body: {
        model: 'qwen3',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [tool],
        stream: true,
        stream_options: { include_usage: true },
      },
    });
    expect(requests[1]!.body).not.toHaveProperty('tools');
    expect(requests[0]!.body).not.toHaveProperty('temperature');

    const warm = createLlmClient({
      url: 'http://llm.test/engines/v1/',
      model: 'qwen3',
      temperature: 0.2,
      fetch,
    });
    await collect(warm.stream({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(requests[2]!.body).toMatchObject({ temperature: 0.2 });
  });

  it('explains an HTTP error and an unreachable server', async () => {
    const refused = createLlmClient({
      url: 'http://llm.test/v1/',
      model: 'm',
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    const notFound = createLlmClient({
      url: 'http://llm.test/v1/',
      model: 'm',
      fetch: () => Promise.resolve(sse('model "m" not found', 404)),
    });
    const messages = [{ role: 'user' as const, content: 'hi' }];

    await expect(collect(refused.stream({ messages }))).rejects.toThrow(
      'The model server is not reachable at http://llm.test/v1/. Is Docker Model Runner running?',
    );
    await expect(collect(notFound.stream({ messages }))).rejects.toThrow(
      'The model server answered 404: model "m" not found',
    );
  });

  it('lets an abort through as an abort, not as "unreachable"', async () => {
    const controller = new AbortController();
    controller.abort();
    const llm = createLlmClient({
      url: 'http://llm.test/v1/',
      model: 'm',
      fetch: ((_url: URL, init: RequestInit) =>
        Promise.reject(
          init.signal!.reason as Error,
        )) as typeof globalThis.fetch,
    });

    await expect(
      collect(llm.stream({ messages: [], signal: controller.signal })),
    ).rejects.toThrow(/aborted/i);
  });
});
