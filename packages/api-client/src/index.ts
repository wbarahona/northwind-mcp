import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { components, operations, paths } from './schema';

export type { components, operations, paths };

type Schemas = components['schemas'];

// Friendly names for the response shapes.
export type Category = Schemas['CategoryDto'];
export type Customer = Schemas['CustomerDto'];
export type Employee = Schemas['EmployeeDto'];
export type EmployeeSummary = Schemas['EmployeeSummaryDto'];
export type LowStockProduct = Schemas['LowStockProductDto'];
export type Order = Schemas['OrderDto'];
export type OrderLine = Schemas['OrderLineDto'];
export type OrderSummary = Schemas['OrderSummaryDto'];
export type OverdueOrder = Schemas['OverdueOrderDto'];
export type PageMeta = Schemas['PageMetaDto'];
export type ProblemDetails = Schemas['ProblemDetailsDto'];
export type Product = Schemas['ProductDto'];
export type Region = Schemas['RegionDto'];
export type Shipper = Schemas['ShipperDto'];
export type Supplier = Schemas['SupplierDto'];

export const API_KEY_HEADER = 'x-api-key';

export interface NorthwindClientOptions {
  /** Where the API runs, without the version prefix. @example http://localhost:3000 */
  baseUrl: string;
  /** One of the API's API_KEYS. */
  apiKey: string;
  /** Custom fetch (tests, proxies, timeouts). Defaults to the global fetch. */
  fetch?: typeof fetch;
}

export type NorthwindClient = Client<paths>;

/**
 * A typed client for every endpoint in apps/api/openapi.json:
 *
 *   const api = createNorthwindClient({ baseUrl, apiKey });
 *   const { data, error } = await api.GET('/v1/orders/{id}', { params: { path: { id: 'ORD-10248' } } });
 *
 * Paths, parameters, bodies and responses are all type-checked against the spec.
 */
export function createNorthwindClient(
  options: NorthwindClientOptions,
): NorthwindClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
    ...(options.fetch && { fetch: options.fetch }),
  });
  client.use(apiKey(options.apiKey));
  return client;
}

function apiKey(key: string): Middleware {
  return {
    onRequest({ request }) {
      request.headers.set(API_KEY_HEADER, key);
      return request;
    },
  };
}

/** A non-2xx response, with the API's RFC 9457 Problem Details. */
export class NorthwindApiError extends Error {
  override readonly name = 'NorthwindApiError';

  constructor(
    readonly status: number,
    readonly problem: ProblemDetails,
  ) {
    super(describeProblem(status, problem));
  }
}

/**
 * Returns `data`, or throws a NorthwindApiError whose message spells out the problem,
 * including invalid fields: "400 Bad Request: One or more fields are invalid.
 * (lines.1.productId: PRD-005 (Chef Anton's Gumbo Mix) is discontinued.)".
 */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;
  if (response.ok && data !== undefined) return data;
  throw new NorthwindApiError(response.status, toProblem(response, error));
}

function toProblem(response: Response, error: unknown): ProblemDetails {
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    'title' in error
  ) {
    return error as ProblemDetails;
  }
  return {
    type: 'about:blank',
    title: response.statusText || 'Error',
    status: response.status,
    detail: typeof error === 'string' ? error : undefined,
  };
}

function describeProblem(status: number, problem: ProblemDetails): string {
  const fields = (problem.errors ?? [])
    .map((e) => `${e.field}: ${e.messages.join('; ')}`)
    .join(', ');
  return `${status} ${problem.title}${problem.detail ? `: ${problem.detail}` : ''}${
    fields ? ` (${fields})` : ''
  }`;
}
