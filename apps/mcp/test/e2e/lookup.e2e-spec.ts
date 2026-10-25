import { connectE2e, type McpTestClient } from '../mcp-client';

/**
 * Look-up tools against the real API and seeded Northwind data. Counts were checked
 * against packages/seed/data/raw (e.g. 11 German customers, 10 dairy products).
 */
describe('Look-up tools (e2e)', () => {
  let t: McpTestClient;

  beforeAll(async () => {
    t = await connectE2e();
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('customers', () => {
    it('finds customers by country, with contact and city', async () => {
      const result = await t.call('find_customers', { country: 'Germany' });

      expect(t.summary(result)).toBe('11 customers.');
      expect(result.structuredContent).toMatchObject({ total: 11, page: 1 });
      expect((result.structuredContent!.items as unknown[])[0]).toEqual({
        code: 'ALFKI',
        name: 'Alfreds Futterkiste',
        contact: { name: 'Maria Anders', title: 'Sales Representative' },
        city: 'Berlin',
        country: 'Germany',
      });
    });

    it('pages: the summary says how to get more', async () => {
      const result = await t.call('find_customers', { limit: 20 });

      expect(t.summary(result)).toBe(
        '91 customers; showing 1–20 (page 1 of 5). Call again with page=2 for more.',
      );
    });

    it('suggests close matches when a search finds nothing', async () => {
      const result = await t.call('find_customers', { query: 'Futerkiste' });

      expect(result.isError).toBeFalsy();
      expect(t.summary(result)).toBe(
        'No customers found. Close matches for "Futerkiste": ALFKI (Alfreds Futterkiste).',
      );
      expect(result.structuredContent!.suggestions).toEqual([
        { code: 'ALFKI', name: 'Alfreds Futterkiste' },
      ]);
    });

    it('gets a customer by code, in any case, or by exact company name', async () => {
      const byCode = await t.call('get_customer', { customer: 'alfki' });
      const byName = await t.call('get_customer', {
        customer: 'Alfreds Futterkiste',
      });

      expect(t.summary(byCode)).toBe(
        'Alfreds Futterkiste (ALFKI), Berlin, Germany; contact Maria Anders, Sales Representative. ' +
          '6 orders from 2026-02-02 to 2026-09-17, lifetime revenue 4273.00, 0 pending.',
      );
      expect(byCode.structuredContent).toMatchObject({
        orderStats: { orders: 6, lastOrderDate: '2026-09-17' },
        contact: {
          email: 'maria.anders@alfreds-futterkiste.example',
          phone: '+49300074321',
        },
        address: { street: 'Obere Str. 57', postalCode: '12209' },
      });
      expect(t.summary(byName)).toMatch(/^"Alfreds Futterkiste" is ALFKI\. /);
      expect(byName.structuredContent).toEqual(byCode.structuredContent);
    });

    it('includes exact order statistics, matching the analytics figures', async () => {
      const result = await t.call('get_customer', { customer: 'QUICK' });

      // Same lifetime figure as sales_breakdown by=customer (all orders): 110277.32.
      expect(result.structuredContent!.orderStats).toEqual({
        orders: 28,
        pending: 0,
        lifetimeRevenue: '110277.32',
        firstOrderDate: '2025-01-13',
        lastOrderDate: '2026-09-22',
      });
      expect(t.summary(result)).toContain(
        '28 orders from 2025-01-13 to 2026-09-22, lifetime revenue 110277.32, 0 pending.',
      );
    });

    it('answers a mistyped code with close matches ("ALKFI")', async () => {
      const result = await t.call('get_customer', { customer: 'ALKFI' });

      expect(result.isError).toBe(true);
      expect(t.text(result)).toBe(
        'No customer matches "ALKFI". Did you mean ALFKI (Alfreds Futterkiste)? Call again with the code.',
      );
    });

    it('treats a five-letter name as a code, then suggests the company', async () => {
      const result = await t.call('get_customer', { customer: 'Ernst' });

      // "Ernst" looks like a customer code, isn't one, and matches one company.
      expect(result.isError).toBe(true);
      expect(t.text(result)).toMatch(/Did you mean ERNSH \(Ernst Handel\)/);

      const handel = await t.call('get_customer', { customer: 'Ernst Handel' });
      expect(handel.structuredContent).toMatchObject({ code: 'ERNSH' });
    });
  });

  describe('products', () => {
    it('answers "how much does Chai cost and how many are in stock?" in one call', async () => {
      const result = await t.call('find_products', { query: 'Chai' });

      expect(result.structuredContent!.items).toEqual([
        {
          code: 'PRD-001',
          name: 'Chai',
          category: { code: 'CAT-01', name: 'Beverages' },
          supplier: { code: 'SUP-001', name: 'Exotic Liquids' },
          unitPrice: '18.00',
          quantityPerUnit: '10 boxes x 20 bags',
          unitsInStock: 39,
        },
      ]);
    });

    it('filters by category name, and by a unique part of it', async () => {
      const full = await t.call('find_products', {
        category: 'Dairy Products',
      });
      const part = await t.call('find_products', { category: 'dairy' });

      expect(t.summary(full)).toBe('"Dairy Products" is CAT-04. 10 products.');
      expect(t.summary(part)).toBe(
        '"dairy" taken as CAT-04 (Dairy Products). 10 products.',
      );
      const items = full.structuredContent!.items as {
        category: { code: string };
      }[];
      expect(items.every((p) => p.category.code === 'CAT-04')).toBe(true);
    });

    it('leaves out discontinued products unless asked, and says so', async () => {
      const hidden = await t.call('find_products', { query: 'Gumbo' });
      const shown = await t.call('find_products', {
        query: 'Gumbo',
        includeDiscontinued: 'true',
      });

      expect(t.summary(hidden)).toMatch(
        /^No products found\. Discontinued products are left out; set includeDiscontinued to include them\. Close matches for "Gumbo": PRD-005/,
      );
      expect(shown.structuredContent!.items).toEqual([
        expect.objectContaining({ code: 'PRD-005', discontinued: true }),
      ]);

      const active = await t.call('find_products', { limit: 100 });
      expect(active.structuredContent!.total).toBe(69);
    });

    it('filters by price and sorts', async () => {
      const result = await t.call('find_products', {
        minPrice: 50,
        sort: 'most_expensive',
      });
      const prices = (
        result.structuredContent!.items as { unitPrice: string }[]
      ).map((p) => Number(p.unitPrice));

      expect(prices.length).toBeGreaterThan(0);
      expect(prices.every((p) => p >= 50)).toBe(true);
      expect(prices).toEqual([...prices].sort((a, b) => b - a));
      expect(prices[0]).toBe(263.5); // Côte de Blaye
    });

    it('gets a product by classic number or name, with reorder facts', async () => {
      const chai = await t.call('get_product', { product: 1 });
      const gumbo = await t.call('get_product', {
        product: "Chef Anton's Gumbo Mix",
      });

      expect(t.summary(chai)).toBe(
        'Chai (PRD-001): 18.00 per 10 boxes x 20 bags, 39 in stock, 0 on order, reorder level 10.',
      );
      expect(chai.structuredContent).toMatchObject({
        unitsOnOrder: 0,
        reorderLevel: 10,
        needsReorder: false,
      });
      expect(t.summary(gumbo)).toMatch(/Discontinued: it cannot be ordered\.$/);
    });
  });

  describe('employees', () => {
    it('lists the staff with titles, managers and territory names', async () => {
      const result = await t.call('find_employees');

      expect(t.summary(result)).toBe('9 employees.');
      expect((result.structuredContent!.items as unknown[])[0]).toMatchObject({
        code: 'EMP-001',
        name: 'Nancy Davolio',
        title: 'Sales Representative',
        reportsTo: { code: 'EMP-002', name: 'Andrew Fuller' },
        territories: ['Wilton', 'Neward'],
      });
    });

    it('resolves a manager by name and a territory by name', async () => {
      const reports = await t.call('find_employees', {
        manager: 'Andrew Fuller',
      });
      const boston = await t.call('find_employees', { territory: 'Boston' });

      expect(t.summary(reports)).toBe(
        '"Andrew Fuller" is EMP-002. 5 employees.',
      );
      expect(t.summary(boston)).toBe('"Boston" is 02116. 1 employee.');
      expect(boston.structuredContent!.items).toEqual([
        expect.objectContaining({ code: 'EMP-002' }),
      ]);
    });

    it('gets an employee with manager, direct reports and territories', async () => {
      const fuller = await t.call('get_employee', { employee: 'EMP-002' });
      const nancy = await t.call('get_employee', { employee: 'Nancy Davolio' });

      expect(t.summary(fuller)).toBe(
        'Andrew Fuller (EMP-002), Vice President, Sales; 5 direct reports, 7 territories.',
      );
      expect(
        (fuller.structuredContent!.directReports as { name: string }[]).map(
          (r) => r.name,
        ),
      ).toEqual([
        'Nancy Davolio',
        'Janet Leverling',
        'Margaret Peacock',
        'Steven Buchanan',
        'Laura Callahan',
      ]);
      expect(nancy.structuredContent).toMatchObject({
        code: 'EMP-001',
        reportsTo: { name: 'Andrew Fuller' },
        territories: [
          { code: '06897', name: 'Wilton', region: 'REG-01' },
          { code: '19713', name: 'Neward', region: 'REG-01' },
        ],
        notes: expect.stringContaining('Colorado State University'),
      });
    });
  });

  describe('reference data', () => {
    it.each([
      ['categories', '8 categories.'],
      ['shippers', '3 shippers.'],
      ['suppliers', '29 suppliers.'],
      ['regions', '4 regions.'],
    ])('lists all %s', async (kind, summary) => {
      const result = await t.call('list_reference_data', { kind });

      expect(t.summary(result)).toBe(summary);
      expect(result.structuredContent!.kind).toBe(kind);
    });

    it('accepts the kind in any case', async () => {
      const result = await t.call('list_reference_data', { kind: 'Shippers' });

      expect(result.structuredContent!.items).toEqual([
        { code: 'SHP-01', name: 'Speedy Express', phone: '+15035559831' },
        { code: 'SHP-02', name: 'United Package', phone: '+15035553199' },
        { code: 'SHP-03', name: 'Federal Shipping', phone: '+15035559931' },
      ]);
    });
  });

  describe('prompts', () => {
    it('completes customer codes from the real customer list', async () => {
      const complete = async (value: string) =>
        (
          await t.client.complete({
            ref: { type: 'ref/prompt', name: 'customer_brief' },
            argument: { name: 'customer', value },
          })
        ).completion.values;

      expect(await complete('a')).toEqual(['ALFKI', 'ANATR', 'ANTON', 'AROUT']);
      // By company name too: "Ernst Handel" → ERNSH.
      expect(await complete('ernst')).toEqual(['ERNSH']);
    });
  });
});
