import { connectE2e, type McpTestClient } from '../mcp-client';
import { reseed } from './reseed';

/**
 * Order write tools against the real API. The database is reseeded before and after, so
 * the read-only specs keep seeing classic data. Expected totals use current list prices:
 * Chai 18.00, Chang 19.00, Queso Cabrales 21.00.
 */
describe('Order write tools (e2e)', () => {
  let t: McpTestClient;

  beforeAll(async () => {
    await reseed();
    t = await connectE2e();
  });

  afterAll(async () => {
    await t?.close();
    await reseed();
  });

  type Totals = {
    subtotal: string;
    discount: string;
    net: string;
    freight: string;
    total: string;
  };
  const totals = (r: Awaited<ReturnType<McpTestClient['call']>>) =>
    r.structuredContent!.totals as Totals;
  const lines = (r: Awaited<ReturnType<McpTestClient['call']>>) =>
    (
      r.structuredContent!.lines as {
        product: { code: string };
        quantity: number;
        discount: string;
        lineTotal: string;
      }[]
    ).map((l) => [l.product.code, l.quantity, l.discount, l.lineTotal]);

  it('places, edits and ships an order, which then cannot change (acceptance 5–7)', async () => {
    // 5. "Place an order for Alfreds Futterkiste: 10 Chai and 5 Chang, 10% off the Chai,
    //     Nancy Davolio as the employee."
    const placed = await t.call('place_order', {
      customer: 'Alfreds Futterkiste',
      employee: 'Nancy Davolio',
      lines: [
        { product: 'Chai', quantity: 10, discount: '10%' },
        { product: 'Chang', quantity: 5 },
      ],
    });
    expect(placed.isError).toBeFalsy();
    expect(t.summary(placed)).toMatch(
      /^"Alfreds Futterkiste" is ALFKI\. "Nancy Davolio" is EMP-001\. "Chai" is PRD-001\. "Chang" is PRD-002\. Placed\. Order ORD-11078 for Alfreds Futterkiste \(ALFKI\), placed [0-9T:.Z-]+, pending \(not shipped yet\): 2 lines, net 257\.00, total 257\.00 including 0\.00 freight\. It can be changed until it ships\.$/,
    );
    expect(placed.structuredContent).toMatchObject({
      code: 'ORD-11078',
      status: 'pending',
      employee: { code: 'EMP-001', name: 'Nancy Davolio' },
      shipTo: {
        name: 'Alfreds Futterkiste',
        city: 'Berlin',
        countryCode: 'DE',
      },
    });
    expect(lines(placed)).toEqual([
      ['PRD-001', 10, '0.1', '162.00'],
      ['PRD-002', 5, '0', '95.00'],
    ]);
    expect(totals(placed)).toEqual({
      subtotal: '275.00',
      discount: '18.00',
      net: '257.00',
      freight: '0.00',
      total: '257.00',
    });

    // 6. "Add 2 Queso Cabrales to that order, ..."
    const added = await t.call('add_order_line', {
      order: 11078,
      product: 'Queso Cabrales',
      quantity: 2,
    });
    expect(t.summary(added)).toMatch(
      /^"Queso Cabrales" is PRD-011\. Added 2 × Queso Cabrales \(PRD-011\) at 21\.00\. Order ORD-11078 .*net 299\.00/,
    );

    const updated = await t.call('update_order_line', {
      order: 'ORD-11078',
      product: 'PRD-002',
      quantity: 6,
    });
    expect(t.summary(updated)).toMatch(
      /^Updated Chang \(PRD-002\): quantity 6, discount 0\. .*net 318\.00/,
    );

    const removed = await t.call('remove_order_line', {
      order: 'ORD-11078',
      product: 'PRD-011',
    });
    expect(t.summary(removed)).toMatch(
      /^Removed Queso Cabrales \(PRD-011\)\. .*2 lines, net 276\.00/,
    );

    const freight = await t.call('update_order', {
      order: 'ORD-11078',
      freight: '12.5',
      requiredDate: '2026-11-20',
    });
    expect(t.summary(freight)).toMatch(/^Updated requiredDate, freight\. /);
    expect(freight.structuredContent).toMatchObject({
      requiredDate: '2026-11-20',
    });
    expect(totals(freight)).toMatchObject({
      freight: '12.50',
      total: '288.50',
    });

    // "... then ship it with Speedy Express."
    // "Today" (pinned to 2026-10-22 here) means now: the order was placed earlier today in
    // real time, and midnight would fall before it.
    const shipped = await t.call('ship_order', {
      order: 'ORD-11078',
      shipper: 'Speedy Express',
      shippedDate: '2026-10-22',
    });
    expect(t.summary(shipped)).toMatch(
      /^"Speedy Express" is SHP-01\. Shipped with Speedy Express on [0-9T:.Z-]+\. .*The order is now final and cannot be changed\.$/,
    );
    expect(shipped.structuredContent).toMatchObject({
      status: 'shipped',
      shipper: { code: 'SHP-01' },
    });
    const shippedOn = (shipped.structuredContent!.shippedDate as string).slice(
      0,
      10,
    );

    // 7. A shipped order can't be changed, and the API's reason comes through.
    const locked = await t.call('update_order', {
      order: 'ORD-11078',
      freight: 1,
    });
    expect(locked.isError).toBe(true);
    expect(t.text(locked)).toBe(
      `409 Conflict: Order ORD-11078 was shipped on ${shippedOn} and can no longer be changed.`,
    );
    const lockedClassic = await t.call('update_order', {
      order: 10248,
      freight: 1,
    });
    expect(t.text(lockedClassic)).toMatch(
      /^409 Conflict: Order ORD-10248 was shipped on /,
    );
  });

  it('refuses a discontinued product and points at find_products (acceptance 8)', async () => {
    const result = await t.call('place_order', {
      customer: 'ALFKI',
      employee: 'EMP-001',
      lines: [{ product: "Chef Anton's Gumbo Mix", quantity: 1 }],
    });

    expect(result.isError).toBe(true);
    expect(t.text(result)).toBe(
      "400 Bad Request: One or more fields are invalid. (lines[0].product: PRD-005 (Chef Anton's Gumbo Mix) is discontinued.) " +
        'Discontinued products cannot be ordered; use find_products to choose an active one.',
    );
  });

  it('suggests close matches for a mistyped customer or product code', async () => {
    const customer = await t.call('place_order', {
      customer: 'ALKFI',
      employee: 'EMP-001',
      lines: [{ product: 'PRD-001', quantity: 1 }],
    });
    const product = await t.call('place_order', {
      customer: 'ALFKI',
      employee: 'EMP-001',
      lines: [{ product: 'PRD-999', quantity: 1 }],
    });

    expect(t.text(customer)).toMatch(
      /^No customer matches "ALKFI"\. Did you mean ALFKI/,
    );
    expect(t.text(product)).toMatch(/^No product matches "PRD-999"\./);
  });

  it('refuses a bare discount like 10 instead of guessing what it means', async () => {
    const result = await t.call('place_order', {
      customer: 'ALFKI',
      employee: 'EMP-001',
      lines: [{ product: 'PRD-001', quantity: 1, discount: 10 }],
    });

    expect(result.isError).toBe(true);
    expect(t.text(result)).toMatch(
      /discount is a rate between 0 and 1: use 0\.1 \(or "10%"\) for 10% off/,
    );
  });

  it('explains requests that would do nothing or break an order rule', async () => {
    const order = await t.call('place_order', {
      customer: 'ERNSH',
      employee: 'EMP-002',
      lines: [{ product: 'PRD-001', quantity: 1 }],
    });
    const code = order.structuredContent!.code as string;

    const nothing = await t.call('update_order', { order: code });
    const lastLine = await t.call('remove_order_line', {
      order: code,
      product: 'Chai',
    });
    const notOnOrder = await t.call('update_order_line', {
      order: code,
      product: 'Chang',
      quantity: 2,
    });
    const twice = await t.call('add_order_line', {
      order: code,
      product: 'PRD-001',
      quantity: 1,
    });
    const noShipper = await t.call('ship_order', { order: code });

    expect(t.text(nothing)).toBe(
      'Nothing to change: give at least one of employee, shipper, requiredDate, freight or shipTo.',
    );
    expect(t.text(lastLine)).toBe(
      `409 Conflict: That is the only line on ${code}; an order needs at least one.`,
    );
    expect(t.text(notOnOrder)).toBe(
      `404 Not Found: Product "PRD-002" is not on order ${code}.`,
    );
    expect(t.text(twice)).toBe(
      `409 Conflict: PRD-001 is already on ${code}; update that line instead.`,
    );
    expect(t.text(noShipper)).toBe(
      '400 Bad Request: One or more fields are invalid. (shipper: The order has no shipper yet; choose one to ship it.)',
    );
  });

  it('ships to a different address when asked', async () => {
    const result = await t.call('place_order', {
      customer: 'ALFKI',
      employee: 'EMP-001',
      lines: [{ product: 'PRD-001', quantity: 1 }],
      shipTo: {
        name: 'Alfreds Futterkiste (warehouse)',
        street: 'Lagerstr. 1',
        city: 'Potsdam',
        postalCode: '14467',
        countryCode: 'de',
      },
    });

    expect(result.structuredContent!.shipTo).toEqual({
      name: 'Alfreds Futterkiste (warehouse)',
      street: 'Lagerstr. 1',
      city: 'Potsdam',
      postalCode: '14467',
      country: 'Germany',
      countryCode: 'DE',
    });
  });
});

describe('Read-only mode (e2e)', () => {
  let t: McpTestClient;

  beforeAll(async () => {
    t = await connectE2e({ writes: false });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('registers no write tools and says it is read-only (acceptance 10)', async () => {
    const { tools } = await t.client.listTools();

    expect(tools).toHaveLength(14);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(
      true,
    );
    expect(t.client.getInstructions()).toMatch(
      /This server is read-only: it cannot place, change or ship orders\./,
    );

    const attempt = await t.call('place_order', {
      customer: 'ALFKI',
      employee: 'EMP-001',
      lines: [{ product: 'PRD-001', quantity: 1 }],
    });
    expect(attempt.isError).toBe(true);
    expect(t.text(attempt)).toMatch(/place_order not found/);
  });
});
