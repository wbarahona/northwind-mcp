import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SERVER_NAME, SERVER_VERSION } from '../src/server';
import { ORDER_10248, PENDING_ORDER, problem } from './fixtures';
import { connectMcp } from './mcp-client';

const API_URL = 'http://api.test';

type Route = (request: Request) => Response | Promise<Response>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** A fake Northwind API: answers order look-ups from fixtures and records every request. */
function fakeApi() {
  const requests: Request[] = [];
  let override: Route | undefined;
  const orders = new Map(
    [ORDER_10248, PENDING_ORDER].map((o) => [o.code, o] as const),
  );

  const fetch: typeof globalThis.fetch = async (input) => {
    const request = input as Request;
    requests.push(request);
    if (override) return override(request);
    const match = /^\/v1\/orders\/([^/]+)$/.exec(new URL(request.url).pathname);
    const code = match && decodeURIComponent(match[1]!).toUpperCase();
    const order = code && orders.get(code);
    return order
      ? json(200, order)
      : json(
          404,
          problem(404, 'Not Found', `Order "${code ?? '?'}" was not found.`),
        );
  };

  return {
    fetch,
    requests,
    /** Make every request behave like this instead. */
    respond(route: Route) {
      override = route;
    },
  };
}

async function connect() {
  const api = fakeApi();
  const mcp = await connectMcp({
    apiUrl: API_URL,
    apiKey: 'test-key',
    fetch: api.fetch,
  });
  return { api, ...mcp };
}

/** Every read tool (steps 9.2–9.3). */
/** Write tools and the risk hints a host can use to ask for confirmation. */
const WRITE_TOOLS = {
  place_order: { destructiveHint: false, idempotentHint: false },
  update_order: { destructiveHint: false, idempotentHint: true },
  add_order_line: { destructiveHint: false, idempotentHint: false },
  update_order_line: { destructiveHint: false, idempotentHint: true },
  remove_order_line: { destructiveHint: true, idempotentHint: true },
  ship_order: { destructiveHint: true, idempotentHint: false },
};

const READ_TOOLS = [
  'find_customers',
  'get_customer',
  'find_products',
  'get_product',
  'find_employees',
  'get_employee',
  'list_reference_data',
  'find_orders',
  'get_order',
  'find_overdue_orders',
  'find_low_stock_products',
  'sales_over_time',
  'sales_breakdown',
  'shipping_performance',
];

describe('Northwind MCP server (in-memory client, fake API)', () => {
  let t: Awaited<ReturnType<typeof connect>>;

  beforeEach(async () => {
    t = await connect();
  });

  afterEach(async () => {
    await t.close();
  });

  it('introduces itself with a name, version and instructions', () => {
    expect(t.client.getServerVersion()).toMatchObject({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    });
    expect(t.client.getInstructions()).toMatch(/readable codes/);

    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(SERVER_VERSION).toBe(pkg.version);
  });

  it('lists every tool with a title, a real description and both schemas', async () => {
    const { tools } = await t.client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [...READ_TOOLS, ...Object.keys(WRITE_TOOLS)].sort(),
    );
    for (const tool of tools) {
      expect(tool).toMatchObject({
        title: expect.any(String),
        description: expect.stringMatching(/.{80,}/),
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
      });
    }
  });

  it('annotates reads as read-only and writes with their risk', async () => {
    const { tools } = await t.client.listTools();
    const annotations = Object.fromEntries(
      tools.map((tool) => [tool.name, tool.annotations]),
    );

    for (const name of READ_TOOLS) {
      expect(annotations[name]).toMatchObject({
        readOnlyHint: true,
        idempotentHint: true,
      });
    }
    for (const [name, hints] of Object.entries(WRITE_TOOLS)) {
      expect([name, annotations[name]]).toEqual([
        name,
        { readOnlyHint: false, openWorldHint: false, ...hints },
      ]);
    }
  });

  it('registers no write tools in read-only mode, and says so', async () => {
    const readOnly = await connectMcp({
      apiUrl: API_URL,
      apiKey: 'test-key',
      fetch: fakeApi().fetch,
      writes: false,
    });
    const { tools } = await readOnly.client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [...READ_TOOLS].sort(),
    );
    expect(readOnly.client.getInstructions()).toMatch(
      /This server is read-only/,
    );
    expect(t.client.getInstructions()).toMatch(/shipping is final/);
    await readOnly.close();
  });

  it('marks only the identifying arguments as required', async () => {
    const { tools } = await t.client.listTools();
    const required = Object.fromEntries(
      tools.map((tool) => [tool.name, tool.inputSchema.required ?? []]),
    );

    expect(required).toEqual({
      find_customers: [],
      get_customer: ['customer'],
      find_products: [],
      get_product: ['product'],
      find_employees: [],
      get_employee: ['employee'],
      list_reference_data: ['kind'],
      find_orders: [],
      get_order: ['order'],
      find_overdue_orders: [],
      find_low_stock_products: [],
      sales_over_time: [],
      sales_breakdown: ['by'],
      shipping_performance: [],
      place_order: ['customer', 'employee', 'lines'],
      update_order: ['order'],
      add_order_line: ['order', 'product', 'quantity'],
      update_order_line: ['order', 'product'],
      remove_order_line: ['order', 'product'],
      ship_order: ['order'],
    });
  });

  it('keeps every tool schema usable by llama.cpp (no \\d, no ±2^53 bounds)', async () => {
    const { tools } = await t.client.listTools();
    const schemas = JSON.stringify(
      tools.map((tool) => [tool.inputSchema, tool.outputSchema]),
    );

    expect(schemas).not.toContain('\\\\d');
    expect(schemas).not.toMatch(/9007199254740991/);
  });

  it('returns an order as a summary line plus compact JSON', async () => {
    const result = await t.call('get_order', { order: 'ORD-10248' });

    expect(result.isError).toBeFalsy();
    const [summary, data] = t.text(result).split('\n');
    expect(summary).toBe(
      'Order ORD-10248 for Vins et alcools Chevalier (VINET), placed 2024-12-26, shipped 2025-01-07: ' +
        '3 lines, net 440.00, total 472.38 including 32.38 freight.',
    );
    expect(JSON.parse(data!)).toEqual(result.structuredContent);
    expect(result.structuredContent).toEqual({
      code: 'ORD-10248',
      status: 'shipped',
      customer: { code: 'VINET', name: 'Vins et alcools Chevalier' },
      employee: { code: 'EMP-005', name: 'Steven Buchanan' },
      shipper: { code: 'SHP-03', name: 'Federal Shipping' },
      orderDate: '2024-12-26',
      requiredDate: '2025-01-23',
      shippedDate: '2025-01-07',
      shipTo: {
        name: 'Vins et alcools Chevalier',
        street: "59 rue de l'Abbaye",
        city: 'Reims',
        postalCode: '51100',
        country: 'France',
        countryCode: 'FR',
      },
      lines: [
        {
          product: { code: 'PRD-011', name: 'Queso Cabrales' },
          unitPrice: '14.00',
          quantity: 12,
          discount: '0',
          lineTotal: '168.00',
        },
        {
          product: { code: 'PRD-042', name: 'Singaporean Hokkien Fried Mee' },
          unitPrice: '9.80',
          quantity: 10,
          discount: '0',
          lineTotal: '98.00',
        },
        {
          product: { code: 'PRD-072', name: 'Mozzarella di Giovanni' },
          unitPrice: '34.80',
          quantity: 5,
          discount: '0',
          lineTotal: '174.00',
        },
      ],
      totals: {
        subtotal: '440.00',
        discount: '0.00',
        net: '440.00',
        freight: '32.38',
        total: '472.38',
      },
    });
  });

  it('drops ids, timestamps and nulls, and keeps the time on a fresh order', async () => {
    const result = await t.call('get_order', { order: 'ORD-11078' });
    const data = result.structuredContent!;

    expect(t.text(result).split('\n')[0]).toContain(
      'placed 2026-10-23T14:05:09.120Z, pending (not shipped yet): 1 line,',
    );
    expect(data).not.toHaveProperty('shipper');
    expect(data).not.toHaveProperty('shippedDate');
    expect(data).not.toHaveProperty('requiredDate');
    expect(JSON.stringify(data)).not.toMatch(/"id"|createdAt|updatedAt|null/);
  });

  it.each([' 10248 ', 10248, 'ord-10248'])(
    'accepts the order as %p and sends the API key',
    async (order) => {
      const result = await t.call('get_order', { order });

      expect(result.isError).toBeFalsy();
      const request = t.api.requests.at(-1)!;
      expect(new URL(request.url).pathname).toMatch(
        /^\/v1\/orders\/(ORD|ord)-10248$/,
      );
      expect(request.headers.get('x-api-key')).toBe('test-key');
    },
  );

  it('still publishes the order argument as a plain string', async () => {
    const { tools } = await t.client.listTools();

    const getOrder = tools.find((tool) => tool.name === 'get_order')!;
    expect(getOrder.inputSchema.properties!.order).toMatchObject({
      type: 'string',
    });
  });

  it("passes the API's explanation through when an order doesn't exist", async () => {
    const result = await t.call('get_order', { order: 'ORD-1' });

    expect(result.isError).toBe(true);
    expect(t.text(result)).toBe('404 Not Found: Order "ORD-1" was not found.');
  });

  it('reports a wrong API key as a setup problem, not something to retry', async () => {
    t.api.respond(() =>
      json(401, problem(401, 'Unauthorized', 'Missing or invalid API key.')),
    );

    const result = await t.call('get_order', { order: 'ORD-10248' });

    expect(result.isError).toBe(true);
    expect(t.text(result)).toMatch(
      /rejected this MCP server's API key \(401\).*NORTHWIND_API_KEY.*Retrying won't help/,
    );
  });

  it('says so when the API is not running', async () => {
    t.api.respond(() => {
      throw new TypeError('fetch failed');
    });

    const result = await t.call('get_order', { order: 'ORD-10248' });

    expect(result.isError).toBe(true);
    expect(t.text(result)).toBe(
      'The Northwind API is not reachable at http://api.test. Is it running (pnpm dev)?',
    );
  });

  it('says so when the API is too slow', async () => {
    t.api.respond(() => {
      throw new DOMException('timed out', 'TimeoutError');
    });

    const result = await t.call('get_order', { order: 'ORD-10248' });

    expect(t.text(result)).toMatch(/did not answer in time/);
  });

  it('rejects bad arguments before calling the API', async () => {
    const result = await t.call('get_order', {});

    expect(result.isError).toBe(true);
    expect(t.text(result)).toMatch(/Invalid arguments for tool get_order/);
    expect(t.api.requests).toHaveLength(0);
  });
});

describe('Guide resource and prompts (in-memory)', () => {
  const NOW = new Date('2026-10-22T12:00:00.000Z');

  const connectAt = (writes = true) =>
    connectMcp({
      apiUrl: API_URL,
      apiKey: 'test-key',
      fetch: fakeApi().fetch,
      now: () => NOW,
      writes,
    });

  const promptText = (result: { messages: { content: unknown }[] }) =>
    (result.messages[0]!.content as { text: string }).text;

  it('serves northwind://guide as Markdown, matching the write mode', async () => {
    const rw = await connectAt(true);
    const ro = await connectAt(false);

    const { resources } = await rw.client.listResources();
    expect(resources).toEqual([
      expect.objectContaining({
        uri: 'northwind://guide',
        name: 'guide',
        mimeType: 'text/markdown',
      }),
    ]);

    const read = async (c: typeof rw) => {
      const { contents } = await c.client.readResource({
        uri: 'northwind://guide',
      });
      return (contents[0] as { text: string }).text;
    };
    const guide = await read(rw);
    expect(guide).toMatch(/^# Northwind Traders: working guide/);
    expect(guide).toMatch(/\*\*Revenue means net sales\*\*/);
    expect(guide).toMatch(/\*\*Shipping is final\*\*/);
    expect(await read(ro)).toMatch(/Nothing: this server is read-only/);
    expect(rw.client.getInstructions()).toMatch(/northwind:\/\/guide/);

    await rw.close();
    await ro.close();
  });

  it('lists three prompts with their arguments', async () => {
    const c = await connectAt();
    const { prompts } = await c.client.listPrompts();

    expect(
      prompts.map((p) => [
        p.name,
        p.arguments?.map((a) => [a.name, a.required ?? false]),
      ]),
    ).toEqual([
      ['quarterly_review', [['quarter', false]]],
      ['chase_overdue_orders', [['asOf', false]]],
      ['customer_brief', [['customer', true]]],
    ]);
    await c.close();
  });

  it('works out the quarter dates so the model does not have to', async () => {
    const c = await connectAt();

    const q3 = promptText(
      await c.client.getPrompt({
        name: 'quarterly_review',
        arguments: { quarter: '2026-q3' },
      }),
    );
    expect(q3).toMatch(
      /^Prepare a quarterly business review of Northwind Traders for 2026-Q3 \(orders placed 2026-07-01 to 2026-09-30\), compared with 2026-Q2 \(2026-04-01 to 2026-06-30\)\.\n/,
    );
    expect(q3).toContain(
      '1. sales_over_time with granularity "quarter", from "2026-04-01", to "2026-10-01"',
    );
    expect(q3).toContain(
      '2. sales_breakdown with by "customer", from "2026-07-01", to "2026-10-01", limit 5',
    );

    const byDefault = promptText(
      await c.client.getPrompt({ name: 'quarterly_review' }),
    );
    expect(byDefault).toContain('for 2026-Q3');

    const current = promptText(
      await c.client.getPrompt({
        name: 'quarterly_review',
        arguments: { quarter: '2026-Q4' },
      }),
    );
    expect(current).toContain(
      '2026-Q4 is still in progress, so its figures run only to today (2026-10-22).',
    );

    await expect(
      c.client.getPrompt({
        name: 'quarterly_review',
        arguments: { quarter: 'Q3' },
      }),
    ).rejects.toThrow(/"Q3" is not a quarter; use the form 2026-Q3/);
    await c.close();
  });

  it('completes quarters as the user types', async () => {
    const c = await connectAt();
    const complete = async (value: string) =>
      (
        await c.client.complete({
          ref: { type: 'ref/prompt', name: 'quarterly_review' },
          argument: { name: 'quarter', value },
        })
      ).completion.values;

    expect(await complete('')).toEqual([
      '2026-Q3',
      '2026-Q2',
      '2026-Q1',
      '2025-Q4',
      '2025-Q3',
      '2025-Q2',
      '2025-Q1',
      '2024-Q4',
    ]);
    expect(await complete('2025')).toEqual([
      '2025-Q4',
      '2025-Q3',
      '2025-Q2',
      '2025-Q1',
    ]);
    await c.close();
  });

  it('chases overdue orders as of today unless told otherwise, without changing anything', async () => {
    const c = await connectAt();

    const text = promptText(
      await c.client.getPrompt({ name: 'chase_overdue_orders' }),
    );
    expect(text).toContain(
      'Call find_overdue_orders with kind "open" and asOf "2026-10-22"',
    );
    expect(text).toContain('Do not change or ship any orders');

    const asOf = promptText(
      await c.client.getPrompt({
        name: 'chase_overdue_orders',
        arguments: { asOf: '2026-09-30' },
      }),
    );
    expect(asOf).toContain('overdue as of 2026-09-30');
    await expect(
      c.client.getPrompt({
        name: 'chase_overdue_orders',
        arguments: { asOf: 'yesterday' },
      }),
    ).rejects.toThrow(/not a date/);
    await c.close();
  });

  it('briefs on a customer from get_customer statistics, not the model adding things up', async () => {
    const c = await connectAt();

    const text = promptText(
      await c.client.getPrompt({
        name: 'customer_brief',
        arguments: { customer: 'ALFKI' },
      }),
    );
    expect(text).toMatch(
      /^Write a one-page brief about the Northwind customer "ALFKI"\./,
    );
    expect(text).toContain(
      'lifetime revenue (from get_customer, do not add it up yourself)',
    );
    await c.close();
  });
});
