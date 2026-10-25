import { createTestApp, type TestApp } from './utils/test-app';

/** Behaviour promised by the OpenAPI descriptions that LLM clients will rely on. */
describe('Documented contract (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('rejects a filter that the sub-list path already fixes', async () => {
    const res = await t.api
      .get('/v1/customers/ALFKI/orders?customerId=VINET')
      .expect(400);
    expect(res.body.errors).toEqual([
      {
        field: 'customerId',
        messages: ['property customerId should not exist'],
      },
    ]);
  });

  it('lists the allowed fields when a sort field is unknown', async () => {
    const res = await t.api.get('/v1/products?sort=price').expect(400);
    expect(res.body.errors[0].messages[0]).toBe(
      'Cannot sort by price. Allowed fields: code, name, unitPrice, unitsInStock.',
    );
  });

  it('sorts by every documented field', async () => {
    for (const sort of ['code', '-name', 'unitPrice', '-unitsInStock']) {
      await t.api.get(`/v1/products?limit=1&sort=${sort}`).expect(200);
    }
    for (const sort of [
      '-orderDate',
      'requiredDate',
      '-shippedDate',
      '-totals.total',
      'code',
    ]) {
      await t.api.get(`/v1/orders?limit=1&sort=${sort}`).expect(200);
    }
  });

  it('answers a "last quarter" question with real data', async () => {
    const res = await t.api
      .get(
        '/v1/analytics/sales-over-time?granularity=quarter&from=2026-07-01&to=2026-10-01',
      )
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].orders).toBeGreaterThan(0);
  });
});
