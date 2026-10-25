# @northwind/mcp

An MCP server that lets an AI assistant work with Northwind Traders: look things up, answer
sales questions, and place and manage orders. It talks to the [Northwind API](../api) through
the typed [`@northwind/api-client`](../../packages/api-client); every rule (validation, totals,
locked shipped orders) stays in the API. Background on MCP: [docs/mcp-primer.md](../../docs/mcp-primer.md).

It runs over **stdio**: the host (Claude Code, Claude Desktop, the chat agent) starts it as a
child process and exchanges JSON-RPC messages on stdin/stdout. Logs go to stderr only.

## What the assistant can change

Writes are **on by default**. With them on, an assistant using this server can:

| Tool                | What it does                                                        | Can it be undone?                      |
| ------------------- | ------------------------------------------------------------------- | -------------------------------------- |
| `place_order`       | Create an order at current list prices                              | No delete; edit it while it is pending |
| `update_order`      | Change a pending order's employee, shipper, dates, freight, ship-to | Yes, by updating again                 |
| `add_order_line`    | Add a product to a pending order                                    | Yes, `remove_order_line`               |
| `update_order_line` | Change a line's quantity or discount                                | Yes, by updating again                 |
| `remove_order_line` | Remove a product from a pending order (marked destructive)          | Add it back (at today's price)         |
| `ship_order`        | Mark a pending order shipped (marked destructive)                   | **No: a shipped order is final**       |

It **cannot**:

- delete anything (orders, customers, products, …);
- change customers, products, suppliers, employees, shippers or regions;
- change an order once it has shipped;
- order discontinued products.

`remove_order_line` and `ship_order` carry `destructiveHint`. That is information a host _may_
use, not a guarantee: whether Claude Code asks before a tool depends on your permission
settings (once you choose "don't ask again", it won't). So the repo's
[`.claude/settings.json`](../../.claude/settings.json) makes Claude Code **always ask** before
these two, whatever you approved before:

```json
{
  "permissions": {
    "ask": ["mcp__northwind__ship_order", "mcp__northwind__remove_order_line"]
  }
}
```

The real protection is still the API's rules and the switch below.

**To turn writes off**, set `NORTHWIND_MCP_WRITES=false`. The six tools above are then not
registered at all, and the server tells the model it is read-only. The server logs on startup
whether writes are on:

```
[northwind-mcp] ready: API at http://localhost:3000, order writes ON (NORTHWIND_MCP_WRITES=true)
```

## Configuration

| Variable               | Default                 | Purpose                                    |
| ---------------------- | ----------------------- | ------------------------------------------ |
| `NORTHWIND_API_URL`    | `http://localhost:3000` | Where the API runs                         |
| `NORTHWIND_API_KEY`    | (required)              | One of the API's `API_KEYS`                |
| `NORTHWIND_MCP_WRITES` | `true`                  | `false` registers the read-only tools only |

The server refuses to start (exit code 1, reason on stderr) if the key is missing or the URL
isn't http(s). API calls time out after 15 seconds.

## Use it

The API must be running (`pnpm db:up && pnpm dev` from the repo root), and the server built
(`pnpm build`).

### Claude Code

The repo's [`.mcp.json`](../../.mcp.json) registers the server for everyone who opens the
project. It contains no secrets: the server reads `NORTHWIND_API_KEY` from your environment,
or from the repo's root `.env` (gitignored; see `.env.example`).

1. Make sure `.env` has `NORTHWIND_API_KEY` set to one of `API_KEYS`, or export it in your
   shell.
2. Start `claude` **from the repo root** (the paths in `.mcp.json` are relative to it).
3. Approve the `northwind` server when asked (project servers always need approval once).
4. `/mcp` shows its status and tools. The prompts are in the `/` menu: type `/` and look for
   the northwind entries (quarterly review, chase overdue orders, customer brief).

### Claude Desktop

Desktop doesn't start from a shell, so it needs absolute paths and the key in its config.
Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "northwind": {
      "command": "/Users/<you>/.nvm/versions/node/v24.22.1/bin/node",
      "args": ["/Users/<you>/projects/northwind-mcp/apps/mcp/dist/index.js"],
      "env": {
        "NORTHWIND_API_URL": "http://localhost:3000",
        "NORTHWIND_API_KEY": "<one of API_KEYS>",
        "NORTHWIND_MCP_WRITES": "true"
      }
    }
  }
}
```

`which node` (with `nvm use 24`) prints the node path. Restart Claude Desktop after editing.
That file holds the key in plain text, so use a key meant for this machine only.

### MCP Inspector

```sh
pnpm --filter @northwind/mcp inspect
```

Opens the Inspector in the browser with settings from the root `.env`; click **Connect**,
then try tools, the resource and prompts. (It runs through `pnpm dlx`, so nothing is added
to the workspace.)

## What it offers

**Tools (20):**

| Group     | Tools                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| Look-ups  | `find_customers`, `get_customer`, `find_products`, `get_product`, `find_employees`, `get_employee`, `list_reference_data` |
| Orders    | `find_orders`, `get_order`, `find_overdue_orders`, `find_low_stock_products`                                              |
| Analytics | `sales_over_time`, `sales_breakdown` (by category, product, customer, employee or country), `shipping_performance`        |
| Writes    | `place_order`, `update_order`, `add_order_line`, `update_order_line`, `remove_order_line`, `ship_order`                   |

**Resource:** `northwind://guide`, the conventions (codes, money, dates, paging, what can
change) as Markdown, to attach at the start of a conversation.

**Prompts:** `quarterly_review` (quarter, default the last complete one),
`chase_overdue_orders` (as-of date, default today), `customer_brief` (customer). Quarter and
customer autocomplete.

**Built for small models too** (measured in [docs/benchmark.md](../../docs/benchmark.md)):

- Results start with a one-line summary, then compact JSON (ids, timestamps and nulls dropped).
  The same data is in `structuredContent`, checked against each tool's `outputSchema`.
- Codes or exact names work for every reference ("Dairy Products", "Nancy Davolio", `11` for
  `PRD-011`); a miss lists close matches ("ALKFI" → ALFKI).
- Results include what the next question usually needs: customer contacts on overdue orders,
  supplier contacts on low stock, order statistics on a customer, optional order lines.
- Analytics take named periods (`last_quarter`, `this_year`, …), and the instructions state
  today's date, so models never do calendar arithmetic.
- Arguments are read leniently ("2" for 2, "Shipped", "10%"), while the published schemas stay
  strict and work with llama.cpp (no `\d`, bounded integers).

## Develop

```sh
pnpm --filter @northwind/mcp test       # unit + in-memory MCP client with a fake API
pnpm --filter @northwind/mcp test:e2e   # real API (built) + seeded in-memory MongoDB
pnpm --filter @northwind/mcp dev        # rebuild on change
```

Layout: `src/server.ts` builds the server without a transport (tests attach an in-memory
client); `src/index.ts` adds stdio. `tools/` registers the tools, `presenters/` shapes results,
`lookup/` resolves codes and names, `prompts/` and `resources/` hold the rest.

Never write to stdout from the server: it carries the protocol. Use `console.error`.
