import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createNorthwindClient } from '@northwind/api-client';
import { stackFromEnv, TEST_ANCHOR } from '@northwind/e2e-stack';
import { createNorthwindMcpServer } from '../src/server';

export interface McpTestClient {
  client: Client;
  /** Calls a tool and returns its result (errors come back as `isError` results). */
  call: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<CallToolResult>;
  /** The result's text: summary line, then compact JSON. */
  text: (result: CallToolResult) => string;
  /** The first line of the text. */
  summary: (result: CallToolResult) => string;
  close: () => Promise<void>;
}

/** A real MCP client connected in memory to our server, which calls the API at `apiUrl`. */
export async function connectMcp(options: {
  apiUrl: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  /** Register the write tools (default true). */
  writes?: boolean;
}): Promise<McpTestClient> {
  const server = createNorthwindMcpServer(
    createNorthwindClient({
      baseUrl: options.apiUrl,
      apiKey: options.apiKey,
      ...(options.fetch && { fetch: options.fetch }),
    }),
    {
      apiUrl: options.apiUrl,
      now: options.now,
      writes: options.writes ?? true,
    },
  );
  const client = new Client({ name: 'test', version: '0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  const text = (result: CallToolResult) =>
    result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  return {
    client,
    call: async (name, args = {}) =>
      (await client.callTool({ name, arguments: args })) as CallToolResult,
    text,
    summary: (result) => text(result).split('\n')[0]!,
    close: () => client.close(),
  };
}

/** Connected to the e2e stack started by test/e2e/global-setup.ts. */
export function connectE2e(
  options: { writes?: boolean } = {},
): Promise<McpTestClient> {
  const { apiUrl, apiKey } = stackFromEnv();
  // The seed's anchor date, so named periods ("this_year") match the seeded data.
  return connectMcp({
    apiUrl,
    apiKey,
    now: () => new Date(`${TEST_ANCHOR}T12:00:00.000Z`),
    ...options,
  });
}
