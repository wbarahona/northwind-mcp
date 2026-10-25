#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createNorthwindClient } from '@northwind/api-client';
import { ConfigError, loadConfig } from './config';
import { createNorthwindMcpServer } from './server';

// stdout carries the MCP protocol: every log line goes to stderr.
const log = (message: string) => console.error(`[northwind-mcp] ${message}`);

/** Hosts wait on every tool call, so a stuck API must not hang the conversation. */
const API_TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    log(error.message);
    process.exit(1);
  }

  const api = createNorthwindClient({
    baseUrl: config.apiUrl,
    apiKey: config.apiKey,
    fetch: (request) =>
      fetch(request, { signal: AbortSignal.timeout(API_TIMEOUT_MS) }),
  });
  const server = createNorthwindMcpServer(api, {
    apiUrl: config.apiUrl,
    writes: config.writes,
  });
  await server.connect(new StdioServerTransport());

  log(
    `ready: API at ${config.apiUrl}, order writes ${config.writes ? 'ON' : 'off'}` +
      ` (NORTHWIND_MCP_WRITES=${config.writes})`,
  );
}

main().catch((error: unknown) => {
  log(
    `failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
