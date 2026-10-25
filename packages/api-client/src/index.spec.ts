import {
  API_KEY_HEADER,
  createNorthwindClient,
  NorthwindApiError,
  unwrap,
} from './index';

/** A fetch that records requests and answers with a canned response. */
function fakeFetch(
  status: number,
  body: unknown,
  contentType = 'application/json',
) {
  const requests: Request[] = [];
  const fetch = (input: Request) => {
    requests.push(input);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': contentType },
      }),
    );
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}

describe('createNorthwindClient', () => {
  it('sends the API key and builds typed paths and queries', async () => {
    const { fetch, requests } = fakeFetch(200, { data: [], meta: {} });
    const api = createNorthwindClient({
      baseUrl: 'http://api.test/',
      apiKey: 'k1',
      fetch,
    });

    await api.GET('/v1/orders', {
      params: { query: { customerId: 'ALFKI', status: 'pending' } },
    });
    await api.GET('/v1/orders/{id}', { params: { path: { id: 'ORD-10248' } } });

    expect(requests.map((r) => r.url)).toEqual([
      'http://api.test/v1/orders?customerId=ALFKI&status=pending',
      'http://api.test/v1/orders/ORD-10248',
    ]);
    expect(requests.every((r) => r.headers.get(API_KEY_HEADER) === 'k1')).toBe(
      true,
    );
  });

  it('sends JSON bodies', async () => {
    const { fetch, requests } = fakeFetch(201, {});
    const api = createNorthwindClient({
      baseUrl: 'http://api.test',
      apiKey: 'k',
      fetch,
    });

    await api.POST('/v1/orders/{id}/lines', {
      params: { path: { id: 'ORD-11077' } },
      body: { productId: 'PRD-001', quantity: 2 },
    });

    expect(requests[0]?.method).toBe('POST');
    expect(await requests[0]?.json()).toEqual({
      productId: 'PRD-001',
      quantity: 2,
    });
  });
});

describe('unwrap', () => {
  it('returns data on success', async () => {
    const { fetch } = fakeFetch(200, { code: 'ALFKI' });
    const api = createNorthwindClient({
      baseUrl: 'http://api.test',
      apiKey: 'k',
      fetch,
    });

    const customer = await unwrap(
      api.GET('/v1/customers/{id}', { params: { path: { id: 'ALFKI' } } }),
    );
    expect(customer.code).toBe('ALFKI');
  });

  it('throws the Problem Details with a readable message', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'One or more fields are invalid.',
      errors: [
        { field: 'lines.1.productId', messages: ['PRD-005 is discontinued.'] },
      ],
    };
    const { fetch } = fakeFetch(400, problem, 'application/problem+json');
    const api = createNorthwindClient({
      baseUrl: 'http://api.test',
      apiKey: 'k',
      fetch,
    });

    const error = await unwrap(
      api.POST('/v1/orders', {
        body: { customerId: 'ALFKI', employeeId: 'EMP-001', lines: [] },
      }),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NorthwindApiError);
    expect((error as NorthwindApiError).problem).toEqual(problem);
    expect((error as Error).message).toBe(
      '400 Bad Request: One or more fields are invalid. (lines.1.productId: PRD-005 is discontinued.)',
    );
  });

  it('describes errors that are not Problem Details', async () => {
    const { fetch } = fakeFetch(502, 'upstream down', 'text/plain');
    const api = createNorthwindClient({
      baseUrl: 'http://api.test',
      apiKey: 'k',
      fetch,
    });

    await expect(unwrap(api.GET('/health'))).rejects.toMatchObject({
      status: 502,
      problem: { status: 502, title: 'Error' },
    });
  });
});
