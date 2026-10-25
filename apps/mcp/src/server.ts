import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NorthwindClient } from '@northwind/api-client';
import { today } from './periods';
import { registerPrompts } from './prompts';
import { registerGuide } from './resources/guide';
import { registerAnalyticsTools } from './tools/analytics';
import { registerLookupTools } from './tools/lookup';
import { registerOrderWriteTools } from './tools/order-writes';
import { registerOrderTools } from './tools/orders';

export const SERVER_NAME = 'northwind';
/** Kept in step with package.json (a test checks). */
export const SERVER_VERSION = '0.1.0';

/** Sent to the host when it connects; many hosts add it to the model's context. */
export const instructions = (now: Date, writes: boolean) =>
  [
    'Northwind Traders is a food import and export company: customers, products, suppliers,',
    'sales employees, shippers and orders. Records are identified by readable codes',
    '(customers ALFKI, orders ORD-10248, products PRD-001, employees EMP-001), which every tool',
    'accepts. Money amounts are decimal strings ("18.00"). Revenue means net sales: after',
    'line discounts, before freight. Answer from tool results only; if a field you need is',
    'missing, call another tool rather than guessing it.',
    `Today is ${today(now)} (UTC); the analytics tools take named periods such as`,
    '"last_quarter" so you do not need to work out dates.',
    'The northwind://guide resource explains the conventions in more detail.',
    writes
      ? 'Orders can be placed and changed until they ship; shipping is final. Nothing can be deleted.'
      : 'This server is read-only: it cannot place, change or ship orders.',
  ].join(' ');

export interface NorthwindMcpServerOptions {
  /** Where the API runs; only used in error messages ("not reachable at …"). */
  apiUrl: string;
  /** The current time; tests pin it so named periods ("this_year") are reproducible. */
  now?: () => Date;
  /** Register the order write tools (NORTHWIND_MCP_WRITES). */
  writes: boolean;
}

/**
 * Builds the MCP server with all its tools, without a transport: index.ts connects stdio,
 * tests connect an in-memory client.
 */
export function createNorthwindMcpServer(
  api: NorthwindClient,
  options: NorthwindMcpServerOptions,
): McpServer {
  const now = options.now ?? (() => new Date());
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION, title: 'Northwind Traders' },
    { instructions: instructions(now(), options.writes) },
  );
  registerLookupTools(server, api, options.apiUrl);
  registerOrderTools(server, api, options.apiUrl);
  registerAnalyticsTools(server, api, options.apiUrl, now);
  registerGuide(server, options.writes);
  registerPrompts(server, api, now);
  if (options.writes) registerOrderWriteTools(server, api, options.apiUrl, now);
  return server;
}
