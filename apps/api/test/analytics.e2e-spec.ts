import { createTestApp, type TestApp } from './utils/test-app';

/**
 * Expected figures were computed independently from the raw Northwind JSON (Python, exact
 * decimals, each line rounded half-up to the cent), shifted to TEST_ANCHOR 2026-10-22.
 */
describe('Analytics (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.app.close();
  });

  describe('sales-over-time', () => {
    it('totals revenue and orders per year', async () => {
      const res = await t.api
        .get('/v1/analytics/sales-over-time?granularity=year')
        .expect(200);

      expect(res.body.range).toEqual({ from: null, to: null, status: null });
      expect(res.body.data).toEqual([
        {
          periodStart: '2024-01-01T00:00:00.000Z',
          label: '2024',
          revenue: '20363.71',
          orders: 16,
          averageOrderValue: '1272.73',
        },
        {
          periodStart: '2025-01-01T00:00:00.000Z',
          label: '2025',
          revenue: '505154.22',
          orders: 345,
          averageOrderValue: '1464.22',
        },
        {
          periodStart: '2026-01-01T00:00:00.000Z',
          label: '2026',
          revenue: '740275.36',
          orders: 469,
          averageOrderValue: '1578.41',
        },
      ]);
    });

    it('reports a quarter and lists every month, filling gaps with zeros', async () => {
      const quarter = await t.api
        .get(
          '/v1/analytics/sales-over-time?granularity=quarter&from=2026-01-01&to=2026-04-01',
        )
        .expect(200);
      expect(quarter.body.data).toEqual([
        expect.objectContaining({
          label: '2026-Q1',
          revenue: '167666.87',
          orders: 104,
        }),
      ]);

      const months = await t.api
        .get('/v1/analytics/sales-over-time')
        .expect(200);
      expect(months.body.data).toHaveLength(23);
      expect(
        months.body.data.find((m: { label: string }) => m.label === '2026-03'),
      ).toMatchObject({
        revenue: '68883.91',
        orders: 37,
      });

      // A range beyond the data still lists each month, with zeros.
      const future = await t.api
        .get('/v1/analytics/sales-over-time?from=2027-01-01&to=2027-03-01')
        .expect(200);
      expect(future.body.data).toEqual([
        expect.objectContaining({
          label: '2027-01',
          revenue: '0.00',
          orders: 0,
          averageOrderValue: '0.00',
        }),
        expect.objectContaining({
          label: '2027-02',
          revenue: '0.00',
          orders: 0,
        }),
      ]);
    });

    it('labels ISO weeks', async () => {
      const res = await t.api
        .get(
          '/v1/analytics/sales-over-time?granularity=week&from=2026-03-02&to=2026-03-16',
        )
        .expect(200);
      expect(res.body.data.map((w: { label: string }) => w.label)).toEqual([
        '2026-W10',
        '2026-W11',
      ]);
    });

    it('rejects an inverted range and too many periods', async () => {
      const inverted = await t.api
        .get('/v1/analytics/sales-over-time?from=2026-02-01&to=2026-01-01')
        .expect(400);
      expect(inverted.body.errors[0].field).toBe('to');

      await t.api
        .get(
          '/v1/analytics/sales-over-time?granularity=day&from=2000-01-01&to=2026-01-01',
        )
        .expect(400);
      await t.api
        .get('/v1/analytics/sales-over-time?granularity=hour')
        .expect(400);
    });
  });

  describe('breakdowns', () => {
    it('splits revenue by category with shares that add up', async () => {
      const res = await t.api
        .get('/v1/analytics/sales-by-category')
        .expect(200);
      const rows = res.body.data;

      expect(rows[0]).toMatchObject({
        category: { code: 'CAT-01', name: 'Beverages' },
        revenue: '267868.20',
        units: 9532,
        orders: 354,
        sharePercent: 21.16,
      });
      expect(
        rows.map((r: { category: { code: string } }) => r.category.code),
      ).toEqual([
        'CAT-01',
        'CAT-04',
        'CAT-03',
        'CAT-06',
        'CAT-08',
        'CAT-02',
        'CAT-07',
        'CAT-05',
      ]);
      const cents = rows.reduce(
        (sum: number, r: { revenue: string }) =>
          sum + Math.round(Number(r.revenue) * 100),
        0,
      );
      expect(cents).toBe(126579329); // 1,265,793.29
    });

    it('ranks products by revenue or units, optionally within a category', async () => {
      const byRevenue = await t.api
        .get('/v1/analytics/sales-by-product?limit=3')
        .expect(200);
      expect(
        byRevenue.body.data.map(
          (p: { product: { code: string }; revenue: string }) => [
            p.product.code,
            p.revenue,
          ],
        ),
      ).toEqual([
        ['PRD-038', '141396.74'],
        ['PRD-029', '80368.69'],
        ['PRD-059', '71155.70'],
      ]);
      expect(byRevenue.body.data[0]).toMatchObject({
        product: { name: 'Côte de Blaye' },
        category: { code: 'CAT-01' },
        units: 623,
        orders: 24,
      });

      const byUnits = await t.api
        .get('/v1/analytics/sales-by-product?limit=3&sortBy=units')
        .expect(200);
      expect(
        byUnits.body.data.map(
          (p: { product: { code: string }; units: number }) => [
            p.product.code,
            p.units,
          ],
        ),
      ).toEqual([
        ['PRD-060', 1577],
        ['PRD-059', 1496],
        ['PRD-031', 1397],
      ]);

      const dairy = await t.api
        .get('/v1/analytics/sales-by-product?categoryId=cat-04&limit=100')
        .expect(200);
      expect(
        dairy.body.data.every(
          (p: { category: { code: string } }) => p.category.code === 'CAT-04',
        ),
      ).toBe(true);
    });

    it('ranks customers, optionally by country', async () => {
      const res = await t.api
        .get('/v1/analytics/top-customers?limit=3')
        .expect(200);
      expect(res.body.data).toEqual([
        expect.objectContaining({
          customer: expect.objectContaining({
            code: 'QUICK',
            companyName: 'QUICK-Stop',
          }),
          countryCode: 'DE',
          revenue: '110277.32',
          orders: 28,
          averageOrderValue: '3938.48',
          lastOrderDate: '2026-09-22T00:00:00.000Z',
        }),
        expect.objectContaining({
          customer: expect.objectContaining({ code: 'ERNSH' }),
          revenue: '104875.00',
        }),
        expect.objectContaining({
          customer: expect.objectContaining({ code: 'SAVEA' }),
          revenue: '104361.96',
        }),
      ]);

      const germany = await t.api
        .get('/v1/analytics/top-customers?limit=3&country=germany')
        .expect(200);
      expect(
        germany.body.data.map(
          (c: { customer: { code: string } }) => c.customer.code,
        ),
      ).toEqual(['QUICK', 'KOENE', 'FRANK']);
    });

    it('reports every employee, best first', async () => {
      const res = await t.api
        .get('/v1/analytics/sales-by-employee')
        .expect(200);

      expect(res.body.data).toHaveLength(9);
      expect(res.body.data[0]).toMatchObject({
        employee: { code: 'EMP-004', name: 'Margaret Peacock' },
        title: 'Sales Representative',
        revenue: '232890.89',
        orders: 156,
        averageOrderValue: '1492.89',
        customers: 75,
      });
      expect(res.body.data.at(-1)).toMatchObject({
        employee: { code: 'EMP-005' },
        revenue: '68792.31',
      });
    });

    it('reports ship-to countries', async () => {
      const res = await t.api.get('/v1/analytics/sales-by-country').expect(200);

      expect(res.body.data).toHaveLength(21);
      expect(res.body.data.slice(0, 3)).toEqual([
        {
          country: 'United States',
          countryCode: 'US',
          revenue: '245584.65',
          orders: 122,
          customers: 13,
          sharePercent: 19.4,
        },
        {
          country: 'Germany',
          countryCode: 'DE',
          revenue: '230284.69',
          orders: 122,
          customers: 11,
          sharePercent: 18.19,
        },
        {
          country: 'Austria',
          countryCode: 'AT',
          revenue: '128003.86',
          orders: 40,
          customers: 2,
          sharePercent: 10.11,
        },
      ]);
    });
  });

  describe('operations', () => {
    it('measures shipping speed, lateness and freight per shipper', async () => {
      const res = await t.api
        .get('/v1/analytics/shipping-performance')
        .expect(200);

      expect(
        res.body.data.map(
          (s: Record<string, unknown> & { shipper: { code: string } }) => [
            s.shipper.code,
            s.shippedOrders,
            s.averageDaysToShip,
            s.lateShipments,
            s.onTimePercent,
            s.totalFreight,
            s.averageFreight,
          ],
        ),
      ).toEqual([
        ['SHP-01', 245, 8.6, 12, 95.1, '16035.16', '65.45'],
        ['SHP-02', 315, 9.2, 16, 94.9, '27556.76', '87.48'],
        ['SHP-03', 249, 7.5, 9, 96.4, '20363.10', '81.78'],
      ]);
    });

    it('lists open overdue orders as of a date, most overdue first', async () => {
      const res = await t.api
        .get('/v1/orders/overdue?asOf=2026-10-22')
        .expect(200);

      expect(
        res.body.data.map((o: { code: string; daysLate: number }) => [
          o.code,
          o.daysLate,
        ]),
      ).toEqual([
        ['ORD-11008', 8],
        ['ORD-11019', 3],
      ]);
      expect(res.body.data[0]).not.toHaveProperty('lines');
    });

    it('lists orders that shipped late', async () => {
      const res = await t.api
        .get('/v1/orders/overdue?kind=shipped-late&limit=1')
        .expect(200);

      expect(res.body.meta.total).toBe(37);
      expect(res.body.data[0].daysLate).toBe(23);
    });

    it('lists products that need reordering, largest shortfall first', async () => {
      const res = await t.api.get('/v1/products/low-stock').expect(200);

      expect(
        res.body.data.map((p: { code: string; shortfall: number }) => [
          p.code,
          p.shortfall,
        ]),
      ).toEqual([
        ['PRD-030', 5],
        ['PRD-070', 5],
      ]);
    });

    it('keeps /orders/:id and /products/:id working next to the fixed paths', async () => {
      await t.api.get('/v1/orders/ORD-10248').expect(200);
      await t.api.get('/v1/products/PRD-001').expect(200);
    });
  });
});
