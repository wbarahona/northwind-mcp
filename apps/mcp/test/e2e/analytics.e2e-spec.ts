import { connectE2e, type McpTestClient } from '../mcp-client';

/**
 * Analytics tools against the real API, with "today" pinned to the seed anchor (2026-10-22).
 * All-time figures match apps/api's analytics e2e tests; the named-period figures
 * (last_quarter, this_year) were computed independently from packages/seed/data/raw
 * (exact decimals, each line rounded half-up to the cent).
 */
describe('Analytics tools (e2e)', () => {
  let t: McpTestClient;

  beforeAll(async () => {
    t = await connectE2e();
  });

  afterAll(async () => {
    await t?.close();
  });

  it("tells the model today's date and that named periods exist", () => {
    expect(t.client.getInstructions()).toMatch(
      /Today is 2026-10-22 \(UTC\).*"last_quarter"/,
    );
  });

  describe('sales_over_time', () => {
    it('totals revenue per year, with the best year', async () => {
      const result = await t.call('sales_over_time', { granularity: 'year' });

      expect(t.summary(result)).toBe(
        'Revenue per year for all orders: 3 periods, total 1265793.29 from 830 orders ' +
          '(average order 1525.05). Best year: 2026 with 740275.36.',
      );
      expect(result.structuredContent).toMatchObject({
        range: {},
        granularity: 'year',
        periods: [
          {
            label: '2024',
            start: '2024-01-01',
            revenue: '20363.71',
            orders: 16,
            averageOrderValue: '1272.73',
          },
          {
            label: '2025',
            start: '2025-01-01',
            revenue: '505154.22',
            orders: 345,
          },
          {
            label: '2026',
            start: '2026-01-01',
            revenue: '740275.36',
            orders: 469,
          },
        ],
        totals: {
          revenue: '1265793.29',
          orders: 830,
          averageOrderValue: '1525.05',
        },
        best: { label: '2026' },
      });
    });

    it('resolves a named period against today', async () => {
      const result = await t.call('sales_over_time', {
        period: 'this_year',
        granularity: 'quarter',
      });

      expect(t.summary(result)).toMatch(
        /^Revenue per quarter for orders placed 2026-01-01 to 2026-12-31 \(this_year\): 4 periods, total 740275\.36 from 469 orders/,
      );
      expect(result.structuredContent!.range).toEqual({
        period: 'this_year',
        from: '2026-01-01',
        to: '2027-01-01',
      });
      expect(
        (
          result.structuredContent!.periods as {
            label: string;
            revenue: string;
          }[]
        )[0],
      ).toMatchObject({ label: '2026-Q1', revenue: '167666.87', orders: 104 });
    });

    it('lists months with gaps filled, and a specific month', async () => {
      const result = await t.call('sales_over_time', {});
      const periods = result.structuredContent!.periods as {
        label: string;
        revenue: string;
        orders: number;
      }[];

      expect(periods).toHaveLength(23);
      expect(periods.find((p) => p.label === '2026-03')).toMatchObject({
        revenue: '68883.91',
        orders: 37,
      });
    });

    it('refuses more periods than a model can use, and says what to do', async () => {
      const result = await t.call('sales_over_time', { granularity: 'day' });

      expect(result.isError).toBe(true);
      expect(t.text(result)).toMatch(
        /^That is [0-9]+ day periods, more than the 120 this tool returns\. Use a coarser granularity or a shorter range\.$/,
      );
    });

    it('rejects period and from/to together', async () => {
      const result = await t.call('sales_over_time', {
        period: 'last_year',
        from: '2025-01-01',
      });

      expect(result.isError).toBe(true);
      expect(t.text(result)).toMatch(
        /^Give either period or from\/to, not both\./,
      );
    });
  });

  describe('sales_breakdown', () => {
    it('answers "top 5 customers last quarter" in one call', async () => {
      const result = await t.call('sales_breakdown', {
        by: 'customer',
        period: 'last_quarter',
        limit: 5,
      });

      expect(t.summary(result)).toBe(
        'Revenue by customer for orders placed 2026-07-01 to 2026-09-30 (last_quarter): top 5. ' +
          '#1 QUICK-Stop (QUICK): 37217.32 from 8 orders.',
      );
      expect(
        (
          result.structuredContent!.rows as {
            code: string;
            revenue: string;
            orders: number;
          }[]
        ).map((r) => [r.code, r.revenue, r.orders]),
      ).toEqual([
        ['QUICK', '37217.32', 8],
        ['SAVEA', '31939.71', 9],
        ['ERNSH', '31287.15', 7],
        ['HANAR', '22489.20', 6],
        ['HUNGO', '19059.17', 3],
      ]);
      expect(result.structuredContent!.complete).toBe(false);
    });

    it('answers "which employee sold the most this year, and their title?" in one call', async () => {
      const result = await t.call('sales_breakdown', {
        by: 'employee',
        period: 'this_year',
      });

      const [first] = result.structuredContent!.rows as Record<
        string,
        unknown
      >[];
      expect(first).toMatchObject({
        rank: 1,
        code: 'EMP-003',
        name: 'Janet Leverling',
        title: 'Sales Representative',
        revenue: '120811.95',
      });
      expect(result.structuredContent).toMatchObject({
        complete: true,
        totals: { revenue: '740275.36', orders: 469 },
      });
    });

    it('ranks categories over all orders, with shares that add up', async () => {
      const result = await t.call('sales_breakdown', { by: 'category' });
      const rows = result.structuredContent!.rows as {
        code: string;
        sharePercent: number;
      }[];

      expect(t.summary(result)).toBe(
        'Revenue by category for all orders: 8 rows, total 1265793.29. #1 Beverages (CAT-01): 267868.20 from 354 orders.',
      );
      expect(rows[0]).toEqual({
        rank: 1,
        code: 'CAT-01',
        name: 'Beverages',
        revenue: '267868.20',
        orders: 354,
        units: 9532,
        sharePercent: 21.16,
      });
      expect(rows.map((r) => r.code)).toEqual([
        'CAT-01',
        'CAT-04',
        'CAT-03',
        'CAT-06',
        'CAT-08',
        'CAT-02',
        'CAT-07',
        'CAT-05',
      ]);
    });

    it('computes employee shares the API does not provide', async () => {
      const result = await t.call('sales_breakdown', { by: 'employee' });
      const rows = result.structuredContent!.rows as {
        code: string;
        sharePercent: number;
        customers: number;
      }[];

      expect(rows).toHaveLength(9);
      expect(rows[0]).toMatchObject({
        code: 'EMP-004',
        revenue: '232890.89',
        averageOrderValue: '1492.89',
        customers: 75,
        sharePercent: 18.4,
      });
      expect(rows.at(-1)).toMatchObject({
        code: 'EMP-005',
        revenue: '68792.31',
      });
    });

    it('ranks products by revenue or units, within a category given by name', async () => {
      const byRevenue = await t.call('sales_breakdown', {
        by: 'product',
        limit: 3,
      });
      const byUnits = await t.call('sales_breakdown', {
        by: 'product',
        limit: 3,
        rankBy: 'units',
      });
      const dairy = await t.call('sales_breakdown', {
        by: 'product',
        category: 'Dairy Products',
      });

      const codes = (r: typeof byRevenue) =>
        (r.structuredContent!.rows as { code: string }[]).map((p) => p.code);
      expect(codes(byRevenue)).toEqual(['PRD-038', 'PRD-029', 'PRD-059']);
      expect(codes(byUnits)).toEqual(['PRD-060', 'PRD-059', 'PRD-031']);
      expect(t.summary(byUnits)).toMatch(
        /^Units sold by product for all orders: top 3\. #1 Camembert Pierrot \(PRD-060\): 1577 units, /,
      );
      expect(t.summary(dairy)).toMatch(
        /^"Dairy Products" is CAT-04\. Revenue by product/,
      );
      expect(
        (
          dairy.structuredContent!.rows as { category: { code: string } }[]
        ).every((p) => p.category.code === 'CAT-04'),
      ).toBe(true);
      expect(dairy.structuredContent!.complete).toBe(true);
    });

    it('knows a list is complete even at the maximum limit', async () => {
      const result = await t.call('sales_breakdown', {
        by: 'product',
        limit: 100,
      });

      expect(result.structuredContent!.rows).toHaveLength(77);
      expect(result.structuredContent).toMatchObject({
        complete: true,
        totals: { revenue: '1265793.29' },
      });
    });

    it('narrows customers to a country', async () => {
      const result = await t.call('sales_breakdown', {
        by: 'customer',
        country: 'germany',
        limit: 3,
      });

      expect(
        (result.structuredContent!.rows as { code: string }[]).map(
          (c) => c.code,
        ),
      ).toEqual(['QUICK', 'KOENE', 'FRANK']);
      expect(t.summary(result)).toMatch(/for all orders in germany: top 3\./);
    });

    it('ranks ship-to countries with customers and shares', async () => {
      const result = await t.call('sales_breakdown', {
        by: 'country',
        limit: 2,
      });

      expect(result.structuredContent!.rows).toEqual([
        {
          rank: 1,
          code: 'US',
          name: 'United States',
          revenue: '245584.65',
          orders: 122,
          customers: 13,
          sharePercent: 19.4,
        },
        {
          rank: 2,
          code: 'DE',
          name: 'Germany',
          revenue: '230284.69',
          orders: 122,
          customers: 11,
          sharePercent: 18.19,
        },
      ]);
      expect(t.summary(result)).toMatch(/: top 2 of 21\./);
      expect(result.structuredContent).not.toHaveProperty('totals');
    });

    it("rejects arguments that don't apply to the dimension", async () => {
      const result = await t.call('sales_breakdown', {
        by: 'customer',
        category: 'Beverages',
      });

      expect(result.isError).toBe(true);
      expect(t.text(result)).toBe(
        'These arguments don\'t apply to by=customer: category (by=product only). Leave them out, or change "by".',
      );
    });

    it('suggests a category when the name matches none', async () => {
      const result = await t.call('sales_breakdown', {
        by: 'product',
        category: 'Diary Products',
      });

      expect(t.text(result)).toMatch(
        /^No category matches "Diary Products"\. Did you mean CAT-04 \(Dairy Products\)\?/,
      );
    });
  });

  describe('shipping_performance', () => {
    it('measures each shipper and names the fastest and most punctual', async () => {
      const result = await t.call('shipping_performance');

      expect(t.summary(result)).toBe(
        'Shipping for all orders: 3 shippers, 809 shipped orders. Fastest: Federal Shipping ' +
          '(7.5 days on average). Most on time: Federal Shipping (96.4%).',
      );
      expect(result.structuredContent!.shippers).toEqual([
        {
          shipper: { code: 'SHP-01', name: 'Speedy Express' },
          shippedOrders: 245,
          averageDaysToShip: 8.6,
          lateShipments: 12,
          onTimePercent: 95.1,
          totalFreight: '16035.16',
          averageFreight: '65.45',
        },
        {
          shipper: { code: 'SHP-02', name: 'United Package' },
          shippedOrders: 315,
          averageDaysToShip: 9.2,
          lateShipments: 16,
          onTimePercent: 94.9,
          totalFreight: '27556.76',
          averageFreight: '87.48',
        },
        {
          shipper: { code: 'SHP-03', name: 'Federal Shipping' },
          shippedOrders: 249,
          averageDaysToShip: 7.5,
          lateShipments: 9,
          onTimePercent: 96.4,
          totalFreight: '20363.10',
          averageFreight: '81.78',
        },
      ]);
    });
  });
});
