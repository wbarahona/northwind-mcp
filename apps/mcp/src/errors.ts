import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { NorthwindApiError } from '@northwind/api-client';

/** A tool result the model reads as a failure (`isError`), so it can explain or recover. */
export function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/**
 * The API names fields after its request bodies; the tools name them after what they are:
 * "customerId" → "customer", "lines.0.productId" → "lines[0].product".
 */
export function toolFieldName(apiField: string): string {
  return apiField
    .replace(/\.([0-9]+)(?=\.|$)/g, '[$1]')
    .replace(/(^|\.)([a-z][A-Za-z]*)Id(?=\.|$)/g, '$1$2');
}

/** The API's Problem Details as one readable line, with tool field names. */
function describeApiError(error: NorthwindApiError): string {
  const { status, problem } = error;
  const fields = (problem.errors ?? []).map(
    (e) => `${toolFieldName(e.field)}: ${e.messages.join('; ')}`,
  );
  const hints = fields.some((f) => f.includes('is discontinued'))
    ? ' Discontinued products cannot be ordered; use find_products to choose an active one.'
    : '';
  return (
    `${status} ${problem.title}${problem.detail ? `: ${problem.detail}` : ''}` +
    `${fields.length ? ` (${fields.join(', ')})` : ''}${hints}`
  );
}

/**
 * Turns a failed API call into a message for the model. API errors keep the API's own
 * explanation; setup problems (bad key, API down) say what to fix instead of inviting retries.
 */
export function describeFailure(error: unknown, apiUrl: string): string {
  if (error instanceof NorthwindApiError) {
    if (error.status === 401 || error.status === 403) {
      return (
        `The Northwind API rejected this MCP server's API key (${error.status}). ` +
        "This is a setup problem: NORTHWIND_API_KEY must be one of the API's API_KEYS. Retrying won't help."
      );
    }
    return describeApiError(error);
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `The Northwind API at ${apiUrl} did not answer in time. It may be overloaded or stuck; try again shortly.`;
  }
  // fetch() rejects with a TypeError when it can't connect at all (refused, DNS, reset).
  if (error instanceof TypeError) {
    return `The Northwind API is not reachable at ${apiUrl}. Is it running (pnpm dev)?`;
  }
  return error instanceof Error ? error.message : String(error);
}
