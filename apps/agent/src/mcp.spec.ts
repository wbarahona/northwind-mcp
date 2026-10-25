import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { assertReadOnly, catalogFrom, toFunctionTools } from './mcp';

/** A real MCP server in memory with the tools given, and a client connected to it. */
async function connectTo(
  tools: { name: string; readOnly: boolean; fails?: boolean }[],
) {
  const server = new McpServer(
    { name: 'test', version: '0' },
    { instructions: 'Test instructions.' },
  );
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: `${tool.name} tool`,
        inputSchema: { order: z.string() },
        annotations: { readOnlyHint: tool.readOnly },
      },
      ({ order }) =>
        tool.fails
          ? {
              isError: true,
              content: [{ type: 'text', text: `No order ${order}.` }],
            }
          : {
              content: [
                { type: 'text', text: `Order ${order}` },
                { type: 'text', text: '{"code":"x"}' },
              ],
            },
    );
  }
  const client = new Client({ name: 'agent-test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe('assertReadOnly', () => {
  it('accepts read-only tools and names any tool that can change data', () => {
    expect(() =>
      assertReadOnly([
        { name: 'get_order', annotations: { readOnlyHint: true } },
      ]),
    ).not.toThrow();
    expect(() =>
      assertReadOnly([
        { name: 'get_order', annotations: { readOnlyHint: true } },
        { name: 'place_order', annotations: { readOnlyHint: false } },
        { name: 'mystery' },
      ]),
    ).toThrow(
      'The MCP server offers tools that can change data (place_order, mystery); the chat agent only runs with read-only tools.',
    );
  });
});

describe('catalogFrom', () => {
  it('lists the tools for the model and the page, and calls them', async () => {
    const client = await connectTo([
      { name: 'get_order', readOnly: true },
      { name: 'find_orders', readOnly: true, fails: true },
    ]);

    const catalog = await catalogFrom(client);

    expect(catalog.instructions).toBe('Test instructions.');
    expect(catalog.tools.map((t) => t.name)).toEqual([
      'get_order',
      'find_orders',
    ]);
    expect(catalog.toolbox.tools[0]).toEqual({
      type: 'function',
      function: {
        name: 'get_order',
        description: 'get_order tool',
        parameters: expect.objectContaining({
          type: 'object',
          required: ['order'],
        }),
      },
    });
    expect(catalog.toolbox.tools[0]!.function.parameters).not.toHaveProperty(
      '$schema',
    );
    expect(await catalog.toolbox.call('get_order', { order: '10248' })).toEqual(
      {
        isError: false,
        text: 'Order 10248\n{"code":"x"}',
      },
    );
    expect(await catalog.toolbox.call('find_orders', { order: '1' })).toEqual({
      isError: true,
      text: 'No order 1.',
    });
    await client.close();
  });

  it('refuses a server that offers write tools', async () => {
    const client = await connectTo([
      { name: 'get_order', readOnly: true },
      { name: 'ship_order', readOnly: false },
    ]);

    await expect(catalogFrom(client)).rejects.toThrow(
      /can change data \(ship_order\)/,
    );
    await client.close();
  });
});

describe('toFunctionTools', () => {
  it('keeps the input schema as the parameters, without $schema', () => {
    expect(
      toFunctionTools([
        {
          name: 'x',
          inputSchema: {
            type: 'object',
            $schema: 'http://json-schema.org/draft-07/schema#',
          },
        },
      ]),
    ).toEqual([
      {
        type: 'function',
        function: {
          name: 'x',
          description: '',
          parameters: { type: 'object' },
        },
      },
    ]);
  });
});
