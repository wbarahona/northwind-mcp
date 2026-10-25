import type {
  CallToolResult,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import { describeFailure, toolError } from '../errors';

/** Read tools never change anything, so repeating a call is always safe. */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

/**
 * A successful result: a one-line summary for the model, then the compact data as JSON.
 * The same data goes in `structuredContent` for clients that read it.
 */
export function present(
  summary: string,
  data: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{ type: 'text', text: `${summary}\n${JSON.stringify(data)}` }],
    structuredContent: data,
  };
}

/** Runs a tool body and turns API and network failures into results the model can act on. */
export function guarded<A>(
  apiUrl: string,
  run: (args: A) => Promise<CallToolResult>,
): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await run(args);
    } catch (error) {
      return toolError(describeFailure(error, apiUrl));
    }
  };
}
