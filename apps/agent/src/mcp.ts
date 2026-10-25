import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { dirname, join } from 'node:path';
import type { ToolBox } from './chat';
import type { FunctionTool } from './llm';

/** What the page and the loop need from the MCP server. */
export interface McpCatalog {
  /** The server's instructions (today's date, codes, conventions) for the system prompt. */
  instructions: string;
  /** As listed by the server, for the page (it shows how many there are). */
  tools: Pick<Tool, 'name' | 'title' | 'description' | 'inputSchema'>[];
  toolbox: ToolBox;
}

export interface McpConnection extends McpCatalog {
  /** Called once if the MCP server process ends. */
  onClose(listener: () => void): void;
  close(): Promise<void>;
}

/** The built Northwind MCP server, found through its package. */
export const mcpServerPath = () =>
  join(
    dirname(require.resolve('@northwind/mcp/package.json')),
    'dist',
    'index.js',
  );

/**
 * The chat is served to people on the network without a login, so it must never be able to
 * change data: refuse any tool that isn't marked read-only, even though the server was
 * started with writes off.
 */
export function assertReadOnly(
  tools: Pick<Tool, 'name' | 'annotations'>[],
): void {
  const writable = tools.filter((t) => t.annotations?.readOnlyHint !== true);
  if (writable.length) {
    throw new Error(
      `The MCP server offers tools that can change data (${writable
        .map((t) => t.name)
        .join(', ')}); the chat agent only runs with read-only tools.`,
    );
  }
}

/** MCP tools → the OpenAI function format the model server expects. */
export function toFunctionTools(tools: Tool[]): FunctionTool[] {
  return tools.map(({ name, description, inputSchema }) => {
    const { $schema: _schema, ...parameters } = inputSchema as Record<
      string,
      unknown
    >;
    return {
      type: 'function',
      function: { name, description: description ?? '', parameters },
    };
  });
}

/** Wraps a connected MCP client as the catalog the agent uses. */
export async function catalogFrom(client: Client): Promise<McpCatalog> {
  const { tools } = await client.listTools();
  assertReadOnly(tools);
  return {
    instructions: client.getInstructions() ?? '',
    tools: tools.map(({ name, title, description, inputSchema }) => ({
      name,
      title,
      description,
      inputSchema,
    })),
    toolbox: {
      tools: toFunctionTools(tools),
      async call(name, args) {
        const result = await client.callTool({ name, arguments: args });
        const content = (result.content ?? []) as {
          type: string;
          text?: string;
        }[];
        return {
          isError: result.isError === true,
          text: content
            .map((c) => (c.type === 'text' ? (c.text ?? '') : ''))
            .join('\n'),
        };
      },
    },
  };
}

/**
 * Starts the Northwind MCP server as a child process (stdio), always read-only, and
 * connects to it.
 */
export async function startMcp(options: {
  apiUrl: string;
  apiKey: string;
  serverPath?: string;
}): Promise<McpConnection> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [options.serverPath ?? mcpServerPath()],
    env: {
      PATH: process.env.PATH ?? '',
      NORTHWIND_API_URL: options.apiUrl,
      NORTHWIND_API_KEY: options.apiKey,
      NORTHWIND_MCP_WRITES: 'false',
    },
    // Its log lines ("[northwind-mcp] ready …", errors) go to the agent's stderr.
    stderr: 'inherit',
  });
  const client = new Client({ name: 'northwind-agent', version: '0.1.0' });
  await client.connect(transport);

  let catalog: McpCatalog;
  try {
    catalog = await catalogFrom(client);
  } catch (error) {
    await client.close();
    throw error;
  }

  const listeners: (() => void)[] = [];
  let closing = false;
  client.onclose = () => {
    if (!closing) listeners.forEach((listener) => listener());
  };
  return {
    ...catalog,
    onClose: (listener) => listeners.push(listener),
    close: async () => {
      closing = true;
      await client.close();
    },
  };
}
