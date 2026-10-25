import { createTestApp, type TestApp } from './utils/test-app';

interface Line {
  product: { code: string; name: string };
  unitPrice: string;
  quantity: number;
  discount: string;
  lineTotal: string;
}

describe('Orders (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.app.close();
  });

  describe('reading', () => {
    it('gets classic order 10248 with lines and totals', async () => {
      const res = await t.api.get('/v1/orders/ORD-10248').expect(200);

      expect(res.body).toMatchObject({
        code: 'ORD-10248',
        customer: { code: 'VINET' },
        employee: { code: 'EMP-005', name: 'Steven Buchanan' },
        shipper: { code: 'SHP-03' },
        status: 'shipped',
        totals: {
          subtotal: '440.00',
          discount: '0.00',
          net: '440.00',
          freight: '32.38',
          total: '472.38',
        },
      });
      expect(
        res.body.lines.map((l: Line) => [
          l.product.code,
          l.unitPrice,
          l.quantity,
          l.lineTotal,
        ]),
      ).toEqual([
        ['PRD-011', '14.00', 12, '168.00'],
        ['PRD-042', '9.80', 10, '98.00'],
        ['PRD-072', '34.80', 5, '174.00'],
      ]);
    });

    it('lists newest first, with totals but no lines', async () => {
      const res = await t.api.get('/v1/orders?limit=3').expect(200);

      expect(res.body.meta.total).toBe(830);
      expect(res.body.data.map((o: { code: string }) => o.code)).toEqual([
        'ORD-11077',
        'ORD-11076',
        'ORD-11075',
      ]);
      expect(res.body.data[0]).not.toHaveProperty('lines');
      expect(res.body.data[0]).not.toHaveProperty('__v');
    });

    it('filters by status, product and date range', async () => {
      const pending = await t.api.get('/v1/orders?status=pending').expect(200);
      expect(pending.body.meta.total).toBe(21);

      const withChai = await t.api
        .get('/v1/orders?productId=prd-001')
        .expect(200);
      expect(withChai.body.meta.total).toBe(38);

      const first = await t.api.get('/v1/orders/ORD-10248').expect(200);
      const day = first.body.orderDate.slice(0, 10);
      const next = new Date(Date.parse(day) + 86_400_000)
        .toISOString()
        .slice(0, 10);
      const sameDay = await t.api
        .get(`/v1/orders?from=${day}&to=${next}`)
        .expect(200);
      expect(sameDay.body.data.map((o: { code: string }) => o.code)).toEqual([
        'ORD-10248',
      ]);
    });

    it('sorts by total, rejecting unknown sort fields', async () => {
      const res = await t.api
        .get('/v1/orders?sort=-totals.total&limit=1')
        .expect(200);
      expect(res.body.data[0].code).toBe('ORD-10865');

      await t.api.get('/v1/orders?sort=customer').expect(400);
    });
  });

  describe('placing and changing an order', () => {
    let code: string;

    it('places an order at current prices, with ship-to defaulting to the customer', async () => {
      const res = await t.api
        .post('/v1/orders', {
          customerId: 'alfki',
          employeeId: 'EMP-001',
          freight: '12.5',
          lines: [
            { productId: 'PRD-001', quantity: 10, discount: 0.1 },
            { productId: 'PRD-002', quantity: 2 },
          ],
        })
        .expect(201);
      code = res.body.code;

      expect(res.body).toMatchObject({
        code: 'ORD-11078',
        status: 'pending',
        shipper: null,
        shippedDate: null,
        shipTo: {
          name: 'Alfreds Futterkiste',
          city: 'Berlin',
          countryCode: 'DE',
        },
        totals: {
          subtotal: '218.00',
          discount: '18.00',
          net: '200.00',
          freight: '12.50',
          total: '212.50',
        },
      });
      expect(
        res.body.lines.map((l: Line) => [l.unitPrice, l.discount, l.lineTotal]),
      ).toEqual([
        ['18.00', '0.1', '162.00'],
        ['19.00', '0', '38.00'],
      ]);
    });

    it('adds, updates and removes lines, recomputing totals', async () => {
      const added = await t.api
        .post(`/v1/orders/${code}/lines`, { productId: 'PRD-011', quantity: 3 })
        .expect(201);
      expect(added.body.totals.net).toBe('263.00');

      const updated = await t.api
        .patch(`/v1/orders/${code}/lines/prd-011`, {
          quantity: 5,
          discount: '0.05',
        })
        .expect(200);
      expect(updated.body.lines.at(-1)).toMatchObject({
        quantity: 5,
        discount: '0.05',
        lineTotal: '99.75',
      });
      expect(updated.body.totals.net).toBe('299.75');

      const removed = await t.api
        .delete(`/v1/orders/${code}/lines/PRD-011`)
        .expect(200);
      expect(removed.body.lines).toHaveLength(2);
      expect(removed.body.totals.net).toBe('200.00');
    });

    it('refuses a duplicate line and a missing one', async () => {
      await t.api
        .post(`/v1/orders/${code}/lines`, { productId: 'PRD-001', quantity: 1 })
        .expect(409);
      await t.api
        .patch(`/v1/orders/${code}/lines/PRD-077`, { quantity: 1 })
        .expect(404);
    });

    it('keeps product renames in sync on pending orders', async () => {
      await t.api
        .patch('/v1/products/PRD-002', { name: 'Chang Lager' })
        .expect(200);

      const order = await t.api.get(`/v1/orders/${code}`).expect(200);
      expect(order.body.lines[1].product.name).toBe('Chang Lager');
      const shipped = await t.api.get('/v1/orders/ORD-10255').expect(200);
      expect(shipped.body.lines[0].product.name).toBe('Chang');
    });

    it('updates freight and the required date, validating dates', async () => {
      const res = await t.api
        .patch(`/v1/orders/${code}`, {
          freight: '20',
          requiredDate: '2099-01-01',
        })
        .expect(200);
      expect(res.body.totals.total).toBe('220.00');

      const bad = await t.api
        .patch(`/v1/orders/${code}`, { requiredDate: '2000-01-01' })
        .expect(400);
      expect(bad.body.errors[0].field).toBe('requiredDate');
    });

    it('needs a shipper to ship, then locks the order', async () => {
      const noShipper = await t.api
        .post(`/v1/orders/${code}/ship`, {})
        .expect(400);
      expect(noShipper.body.errors[0].field).toBe('shipperId');

      const shipped = await t.api
        .post(`/v1/orders/${code}/ship`, { shipperId: 'SHP-02' })
        .expect(200);
      expect(shipped.body).toMatchObject({
        status: 'shipped',
        shipper: { code: 'SHP-02' },
      });

      const locked = await t.api
        .patch(`/v1/orders/${code}`, { freight: '1' })
        .expect(409);
      expect(locked.body.detail).toMatch(/can no longer be changed/);
      await t.api
        .post(`/v1/orders/${code}/lines`, { productId: 'PRD-003', quantity: 1 })
        .expect(409);
      await t.api.post(`/v1/orders/${code}/ship`, {}).expect(409);
    });

    it('never removes the last line', async () => {
      const order = await t.api
        .post('/v1/orders', {
          customerId: 'ALFKI',
          employeeId: 'EMP-001',
          lines: [{ productId: 'PRD-001', quantity: 1 }],
        })
        .expect(201);

      await t.api
        .delete(`/v1/orders/${order.body.code}/lines/PRD-001`)
        .expect(409);
    });

    it("doesn't change product stock", async () => {
      const before = await t.api.get('/v1/products/PRD-003').expect(200);
      await t.api
        .post('/v1/orders', {
          customerId: 'ALFKI',
          employeeId: 'EMP-001',
          lines: [{ productId: 'PRD-003', quantity: 5 }],
        })
        .expect(201);
      const after = await t.api.get('/v1/products/PRD-003').expect(200);

      expect(after.body.unitsInStock).toBe(before.body.unitsInStock);
    });
  });

  describe('validation', () => {
    const order = (lines: object[]) => ({
      customerId: 'ALFKI',
      employeeId: 'EMP-001',
      lines,
    });

    it('names the offending line for discontinued, unknown and repeated products', async () => {
      const res = await t.api
        .post(
          '/v1/orders',
          order([
            { productId: 'PRD-001', quantity: 1 },
            { productId: 'PRD-005', quantity: 1 },
          ]),
        )
        .expect(400);
      expect(res.body.errors).toEqual([
        {
          field: 'lines.1.productId',
          messages: ["PRD-005 (Chef Anton's Gumbo Mix) is discontinued."],
        },
      ]);

      const unknown = await t.api
        .post('/v1/orders', order([{ productId: 'PRD-999', quantity: 1 }]))
        .expect(400);
      expect(unknown.body.errors[0].field).toBe('lines.0.productId');

      const repeated = await t.api
        .post(
          '/v1/orders',
          order([
            { productId: 'PRD-001', quantity: 1 },
            { productId: 'prd-001', quantity: 2 },
          ]),
        )
        .expect(400);
      expect(repeated.body.errors[0]).toMatchObject({
        field: 'lines.1.productId',
      });
    });

    it('rejects empty orders, bad quantities and discounts', async () => {
      const res = await t.api
        .post(
          '/v1/orders',
          order([{ productId: 'PRD-001', quantity: 0, discount: '1.5' }]),
        )
        .expect(400);
      const fields = res.body.errors.map((e: { field: string }) => e.field);
      expect(fields).toEqual(
        expect.arrayContaining(['lines.0.quantity', 'lines.0.discount']),
      );

      await t.api.post('/v1/orders', order([])).expect(400);
    });
  });
});
