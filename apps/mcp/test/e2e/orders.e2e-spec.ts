import { connectE2e, type McpTestClient } from '../mcp-client';

/**
 * Order tools against the real API and seeded data (anchor 2026-10-22). Counts were checked
 * against packages/seed/data/raw; overdue and low-stock figures match the API's own e2e tests.
 */
describe('Order tools (e2e)', () => {
  let t: McpTestClient;

  beforeAll(async () => {
    t = await connectE2e();
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('find_orders', () => {
    it("lists a customer's orders newest first, without lines by default", async () => {
      const result = await t.call('find_orders', { customer: 'ALFKI' });

      expect(t.summary(result)).toBe(
        '6 orders. Products are not listed here: to see them, call get_order with an order code (e.g. ORD-11011), or set includeLines.',
      );
      const [latest] = result.structuredContent!.items as Record<
        string,
        unknown
      >[];
      expect(latest).toEqual({
        code: 'ORD-11011',
        status: 'shipped',
        customer: { code: 'ALFKI', name: 'Alfreds Futterkiste' },
        employee: { code: 'EMP-003', name: 'Janet Leverling' },
        orderDate: '2026-09-17',
        requiredDate: '2026-10-15',
        shippedDate: '2026-09-21',
        net: '933.50',
        total: '934.71',
      });
    });

    it('answers "what did Alfreds Futterkiste order most recently?" in one call', async () => {
      const result = await t.call('find_orders', {
        customer: 'Alfreds Futterkiste',
        includeLines: true,
        limit: 1,
      });

      expect(t.summary(result)).toMatch(
        /^"Alfreds Futterkiste" is ALFKI\. 6 orders; showing 1–1/,
      );
      const [latest] = result.structuredContent!.items as {
        code: string;
        lines: { product: { name: string }; quantity: number }[];
      }[];
      expect(latest!.code).toBe('ORD-11011');
      expect(latest!.lines.map((l) => [l.product.name, l.quantity])).toEqual([
        ['Escargots de Bourgogne', 40],
        ['Flotemysost', 20],
      ]);
    });

    it('caps pages with line items at 10 orders', async () => {
      const result = await t.call('find_orders', {
        includeLines: true,
        limit: 50,
      });

      expect(result.structuredContent!.items).toHaveLength(10);
    });

    it('combines product and employee names', async () => {
      const result = await t.call('find_orders', {
        product: 'Queso Cabrales',
        employee: 'Steven Buchanan',
      });

      expect(t.summary(result)).toMatch(
        /^"Steven Buchanan" is EMP-005\. "Queso Cabrales" is PRD-011\. 4 orders\./,
      );
    });

    it('filters by date range (to is exclusive) and sorts by size', async () => {
      const result = await t.call('find_orders', {
        from: '2026-03-01',
        to: '2026-04-01',
        sort: 'largest',
        limit: 2,
      });

      expect(result.structuredContent).toMatchObject({ total: 37 });
      expect(
        (
          result.structuredContent!.items as { code: string; total: string }[]
        ).map((o) => [o.code, o.total]),
      ).toEqual([
        ['ORD-10691', '10974.85'],
        ['ORD-10678', expect.any(String)],
      ]);
    });

    it('tells "no such customer" apart from "no orders"', async () => {
      const typo = await t.call('find_orders', { customer: 'ALKFI' });
      const none = await t.call('find_orders', {
        customer: 'QUICK',
        status: 'pending',
      });

      expect(typo.isError).toBe(true);
      expect(t.text(typo)).toMatch(
        /^No customer matches "ALKFI"\. Did you mean ALFKI/,
      );
      expect(none.isError).toBeFalsy();
      expect(t.summary(none)).toBe('No orders found.');
    });

    it('rejects a malformed date before calling the API', async () => {
      const result = await t.call('find_orders', { from: '1 March 2026' });

      expect(result.isError).toBe(true);
      expect(t.text(result)).toMatch(/must be a date as YYYY-MM-DD/);
    });
  });

  describe('get_order', () => {
    it('returns the whole order from the classic number', async () => {
      const result = await t.call('get_order', { order: 10248 });

      expect(t.summary(result)).toMatch(
        /^Order ORD-10248 for Vins et alcools Chevalier \(VINET\), placed [0-9-]+, shipped [0-9-]+: 3 lines, net 440\.00, total 472\.38 including 32\.38 freight\.$/,
      );
    });
  });

  describe('find_overdue_orders', () => {
    it('lists open overdue orders with the customer contact to call', async () => {
      const result = await t.call('find_overdue_orders', {
        asOf: '2026-10-22',
      });

      expect(t.summary(result)).toBe(
        '2 open overdue orders. Measured as of 2026-10-22.',
      );
      const items = result.structuredContent!.items as Record<
        string,
        unknown
      >[];
      expect(items.map((o) => [o.code, o.daysLate])).toEqual([
        ['ORD-11008', 8],
        ['ORD-11019', 3],
      ]);
      expect(items[0]!.customer).toEqual({
        code: 'ERNSH',
        name: 'Ernst Handel',
        contact: {
          name: 'Roland Mendel',
          title: 'Sales Manager',
          phone: '+4376753425',
          email: 'roland.mendel@ernst-handel.example',
        },
      });
    });

    it('lists orders that shipped late', async () => {
      const result = await t.call('find_overdue_orders', {
        kind: 'shipped-late',
        limit: 1,
      });

      expect(result.structuredContent).toMatchObject({ total: 37 });
      expect(
        (result.structuredContent!.items as { daysLate: number }[])[0]!
          .daysLate,
      ).toBe(23);
    });
  });

  describe('find_low_stock_products', () => {
    it('answers "which supplier makes the low-stock products?" in one call', async () => {
      const result = await t.call('find_low_stock_products');

      expect(t.summary(result)).toBe('2 products need reordering.');
      expect(result.structuredContent!.items).toEqual([
        expect.objectContaining({
          code: 'PRD-030',
          shortfall: 5,
          supplier: {
            code: 'SUP-013',
            name: 'Nord-Ost-Fisch Handelsgesellschaft mbH',
            contact: {
              name: 'Sven Petersen',
              title: 'Coordinator Foreign Markets',
              phone: '+4947218713',
            },
          },
        }),
        expect.objectContaining({
          code: 'PRD-070',
          shortfall: 5,
          supplier: expect.objectContaining({ code: expect.any(String) }),
        }),
      ]);
    });
  });
});
