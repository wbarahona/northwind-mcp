import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const GUIDE_URI = 'northwind://guide';

const CAN_CHANGE = `## What can change

- **Orders can be placed and edited while pending**: \`place_order\`, \`update_order\`,
  \`add_order_line\`, \`update_order_line\`, \`remove_order_line\`.
- **Shipping is final**: after \`ship_order\` an order can never be changed again.
- **Nothing can be deleted**, and customers, products, employees and suppliers are read-only
  here.
- New lines use the product's current list price; discontinued products can't be ordered.`;

const READ_ONLY = `## What can change

Nothing: this server is read-only (NORTHWIND_MCP_WRITES=false). It can look things up and
report, but not place, change or ship orders.`;

/** The guide a user can attach at the start of a conversation. */
export function guideText(writes: boolean): string {
  return `# Northwind Traders: working guide

Northwind Traders imports and exports specialty foods. This server reads its customers,
products, suppliers, sales staff, shippers and orders${writes ? ', and manages orders' : ''}.

## Codes

Every record has a readable code, and every tool accepts it:

| Record | Code | Example |
| --- | --- | --- |
| Customer | five letters | \`ALFKI\` (Alfreds Futterkiste) |
| Order | ORD- + number | \`ORD-10248\` (or just \`10248\`) |
| Product | PRD- + 3 digits | \`PRD-001\` (Chai) |
| Employee | EMP- + 3 digits | \`EMP-001\` (Nancy Davolio) |
| Category | CAT- + 2 digits | \`CAT-04\` (Dairy Products) |
| Supplier | SUP- + 3 digits | \`SUP-001\` (Exotic Liquids) |
| Shipper | SHP- + 2 digits | \`SHP-01\` (Speedy Express) |
| Territory | 5 digits | \`02116\` (Boston) |

Exact names work too ("Dairy Products", "Nancy Davolio"). When a code or name matches
nothing, the error lists close matches.

## Money

- Amounts are decimal strings ("18.00"), never rounded floats.
- **Revenue means net sales**: unit price × quantity × (1 − discount), each line rounded to
  the cent, **before freight**. An order's total is net + freight.
- Discounts are rates between 0 and 1: 0.15 is 15% off.

## Dates

- Dates are ISO (YYYY-MM-DD), in UTC.
- Ranges are \`from\` inclusive and \`to\` exclusive: March 2026 is from 2026-03-01 to
  2026-04-01.
- The analytics tools also take named periods (\`this_month\`, \`last_quarter\`,
  \`this_year\`, \`last_30_days\`, …) and say which dates they used.
- An order is **pending** until it ships. It is **overdue** when it is still pending after its
  required date.

## Lists

Lists return 20 rows per page by default (at most 100), and the first line of each result
says whether more pages exist. Lists show summaries; the \`get_…\` tools return details.
\`find_orders\` leaves out line items unless \`includeLines\` is set.

${writes ? CAN_CHANGE : READ_ONLY}

## Answering well

- Answer from tool results only. If something you need isn't in a result, call another tool
  rather than guessing it.
- Prefer the totals and shares the tools compute over adding numbers up yourself.
`;
}

export function registerGuide(server: McpServer, writes: boolean): void {
  server.registerResource(
    'guide',
    GUIDE_URI,
    {
      title: 'Northwind working guide',
      description:
        'Codes, money and date conventions, paging, and what can and cannot be changed. ' +
        'Attach it at the start of a conversation about Northwind.',
      mimeType: 'text/markdown',
      annotations: { audience: ['user', 'assistant'], priority: 0.8 },
    },
    (uri) => ({
      contents: [
        { uri: uri.href, mimeType: 'text/markdown', text: guideText(writes) },
      ],
    }),
  );
}
