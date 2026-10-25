// The MCP half of `pnpm stack:smoke`: starts the built server over stdio, the way Claude
// Code does, against the API at NORTHWIND_API_URL, and exercises reads and writes.
// Exits 1 on the first check that fails. Run by scripts/stack-smoke.sh.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const client = new Client({ name: 'stack-smoke', version: '0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [server],
    env: {
      PATH: process.env.PATH ?? '',
      NORTHWIND_API_URL: process.env.NORTHWIND_API_URL ?? '',
      NORTHWIND_API_KEY: process.env.NORTHWIND_API_KEY ?? '',
      NORTHWIND_MCP_WRITES: 'true',
    },
    stderr: 'ignore',
  }),
);

let failed = false;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) failed = true;
};
const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.map((c) => c.text ?? '').join('\n');
  return { result, text, summary: text.split('\n')[0] };
};

try {
  const { tools } = await client.listTools();
  check('MCP server lists 20 tools', tools.length === 20, `${tools.length}`);

  const order = await call('get_order', { order: 10248 });
  check(
    'get_order 10248 through the containerised API',
    !order.result.isError &&
      order.result.structuredContent?.totals?.total === '472.38',
    order.summary,
  );

  // A write needs the replica-set primary: this proves directConnection reaches it.
  const placed = await call('place_order', {
    customer: 'ALFKI',
    employee: 'EMP-001',
    lines: [{ product: 'Chai', quantity: 2 }],
  });
  const code = placed.result.structuredContent?.code;
  check(
    'place_order writes to the primary',
    !placed.result.isError && Boolean(code),
    placed.summary,
  );

  const shipped = await call('ship_order', { order: code, shipper: 'SHP-01' });
  check(
    'ship_order',
    !shipped.result.isError &&
      shipped.result.structuredContent?.status === 'shipped',
    shipped.summary,
  );

  const locked = await call('update_order', { order: code, freight: 1 });
  check(
    'a shipped order is locked (409)',
    locked.result.isError === true && locked.text.startsWith('409'),
    locked.text,
  );
} finally {
  await client.close();
}

process.exit(failed ? 1 : 0);
