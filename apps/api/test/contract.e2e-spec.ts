import {
  createNorthwindClient,
  type NorthwindClient,
  NorthwindApiError,
  unwrap,
} from '@northwind/api-client';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { E2E_API_KEY } from './global-setup';
import { OpenApiValidator } from './utils/openapi-validator';
import { createTestApp, type TestApp } from './utils/test-app';

/**
 * The API as the MCP server will use it: over HTTP, through the generated client, with
 * every response checked against the committed openapi.json (undocumented fields fail).
 */
describe('Contract: generated client against the real API (e2e)', () => {
  let t: TestApp;
  let api: NorthwindClient;
  const spec = new OpenApiValidator();

  /** Calls through the client and checks the real response against the spec. */
  async function expectDocumented(
    operationId: string,
    call: Promise<{ data?: unknown; error?: unknown; response: Response }>,
  ) {
    const { data, error, response } = await call;
    spec.assertResponse(operationId, response.status, data ?? error);
    return { data, error, status: response.status };
  }

  const baseUrl = () => {
    const { port } = (t.app.getHttpServer() as Server).address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  };

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.listen(0, '127.0.0.1');
    api = createNorthwindClient({ baseUrl: baseUrl(), apiKey: E2E_API_KEY });
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('documents every read endpoint response exactly', async () => {
    const id = (value: string) => ({ params: { path: { id: value } } });
    const calls: [
      string,
      Promise<{ data?: unknown; error?: unknown; response: Response }>,
    ][] = [
      ['listCategories', api.GET('/v1/categories')],
      ['getCategory', api.GET('/v1/categories/{id}', id('CAT-01'))],
      [
        'listCategoryProducts',
        api.GET('/v1/categories/{id}/products', id('CAT-01')),
      ],
      [
        'listProducts',
        api.GET('/v1/products', { params: { query: { limit: 100 } } }),
      ],
      ['getProduct', api.GET('/v1/products/{id}', id('PRD-001'))],
      ['listLowStockProducts', api.GET('/v1/products/low-stock')],
      [
        'listSuppliers',
        api.GET('/v1/suppliers', { params: { query: { limit: 100 } } }),
      ],
      ['getSupplier', api.GET('/v1/suppliers/{id}', id('SUP-001'))],
      [
        'listSupplierProducts',
        api.GET('/v1/suppliers/{id}/products', id('SUP-001')),
      ],
      ['listShippers', api.GET('/v1/shippers')],
      ['getShipper', api.GET('/v1/shippers/{id}', id('SHP-01'))],
      [
        'listCustomers',
        api.GET('/v1/customers', { params: { query: { limit: 100 } } }),
      ],
      ['getCustomer', api.GET('/v1/customers/{id}', id('ALFKI'))],
      ['listCustomerOrders', api.GET('/v1/customers/{id}/orders', id('ALFKI'))],
      ['listEmployees', api.GET('/v1/employees')],
      ['getEmployee', api.GET('/v1/employees/{id}', id('EMP-002'))],
      [
        'listEmployeeOrders',
        api.GET('/v1/employees/{id}/orders', id('EMP-001')),
      ],
      [
        'listEmployeeReports',
        api.GET('/v1/employees/{id}/reports', id('EMP-002')),
      ],
      ['listRegions', api.GET('/v1/regions')],
      ['getRegion', api.GET('/v1/regions/{id}', id('REG-01'))],
      [
        'listOrders',
        api.GET('/v1/orders', { params: { query: { limit: 100 } } }),
      ],
      ['getOrder', api.GET('/v1/orders/{id}', id('ORD-10248'))],
      [
        'listOverdueOrders',
        api.GET('/v1/orders/overdue', { params: { query: { kind: 'all' } } }),
      ],
      ['salesOverTime', api.GET('/v1/analytics/sales-over-time')],
      ['salesByCategory', api.GET('/v1/analytics/sales-by-category')],
      ['salesByProduct', api.GET('/v1/analytics/sales-by-product')],
      ['topCustomers', api.GET('/v1/analytics/top-customers')],
      ['salesByEmployee', api.GET('/v1/analytics/sales-by-employee')],
      ['salesByCountry', api.GET('/v1/analytics/sales-by-country')],
      ['shippingPerformance', api.GET('/v1/analytics/shipping-performance')],
      ['checkHealth', api.GET('/health')],
    ];

    for (const [operationId, call] of calls) {
      const { status } = await expectDocumented(operationId, call);
      expect([operationId, status]).toEqual([operationId, 200]);
    }
  });

  it('really fails on drift: extra, missing or mistyped fields', async () => {
    const customer = (await unwrap(
      api.GET('/v1/customers/{id}', { params: { path: { id: 'ALFKI' } } }),
    )) as Record<string, unknown>;
    const { companyName: _omitted, ...missing } = customer;

    expect(() =>
      spec.assertResponse('getCustomer', 200, {
        ...customer,
        internalNote: 'x',
      }),
    ).toThrow(/must NOT have additional properties/);
    expect(() => spec.assertResponse('getCustomer', 200, missing)).toThrow(
      /must have required property 'companyName'/,
    );
    expect(() =>
      spec.assertResponse('getCustomer', 200, { ...customer, fax: 42 }),
    ).toThrow(/\/fax must be/);
  });

  it('documents the order workflow responses', async () => {
    const created = await expectDocumented(
      'createOrder',
      api.POST('/v1/orders', {
        body: {
          customerId: 'ALFKI',
          employeeId: 'EMP-001',
          lines: [{ productId: 'PRD-001', quantity: 2 }],
        },
      }),
    );
    expect(created.status).toBe(201);
    const code = (created.data as { code: string }).code;
    const path = { params: { path: { id: code } } };

    await expectDocumented(
      'addOrderLine',
      api.POST('/v1/orders/{id}/lines', {
        ...path,
        body: { productId: 'PRD-002', quantity: 1 },
      }),
    );
    await expectDocumented(
      'updateOrderLine',
      api.PATCH('/v1/orders/{id}/lines/{productId}', {
        params: { path: { id: code, productId: 'PRD-002' } },
        body: { quantity: 3, discount: '0.05' },
      }),
    );
    await expectDocumented(
      'updateOrder',
      api.PATCH('/v1/orders/{id}', { ...path, body: { freight: '9.90' } }),
    );
    const shipped = await expectDocumented(
      'shipOrder',
      api.POST('/v1/orders/{id}/ship', {
        ...path,
        body: { shipperId: 'SHP-01' },
      }),
    );
    expect((shipped.data as { status: string }).status).toBe('shipped');
  });

  it('documents error responses as Problem Details', async () => {
    const invalid = await expectDocumented(
      'createOrder',
      api.POST('/v1/orders', {
        body: {
          customerId: 'ALFKI',
          employeeId: 'EMP-001',
          lines: [{ productId: 'PRD-005', quantity: 1 }],
        },
      }),
    );
    expect(invalid.status).toBe(400);

    const missing = await expectDocumented(
      'getOrder',
      api.GET('/v1/orders/{id}', { params: { path: { id: 'ORD-1' } } }),
    );
    expect(missing.status).toBe(404);

    const locked = await expectDocumented(
      'updateOrder',
      api.PATCH('/v1/orders/{id}', {
        params: { path: { id: 'ORD-10248' } },
        body: { freight: '1.00' },
      }),
    );
    expect(locked.status).toBe(409);
  });

  it('turns errors into readable exceptions with unwrap()', async () => {
    const error = await unwrap(
      api.POST('/v1/orders', {
        body: {
          customerId: 'ALFKI',
          employeeId: 'EMP-001',
          lines: [{ productId: 'PRD-005', quantity: 1 }],
        },
      }),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NorthwindApiError);
    expect((error as Error).message).toBe(
      "400 Bad Request: One or more fields are invalid. (lines.0.productId: PRD-005 (Chef Anton's Gumbo Mix) is discontinued.)",
    );
  });

  it('rejects a wrong API key with a documented 401', async () => {
    const stranger = createNorthwindClient({
      baseUrl: baseUrl(),
      apiKey: 'wrong',
    });

    const { status } = await expectDocumented(
      'listOrders',
      stranger.GET('/v1/orders'),
    );
    expect(status).toBe(401);
  });
});
