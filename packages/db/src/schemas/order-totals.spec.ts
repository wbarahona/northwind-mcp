import { computeOrderTotals } from './order-totals';

describe('computeOrderTotals', () => {
  it('matches classic Northwind order 10248 (no discounts)', () => {
    const totals = computeOrderTotals(
      [
        { unitPrice: '14.00', quantity: 12, discount: '0' },
        { unitPrice: '9.80', quantity: 10, discount: '0' },
        { unitPrice: '34.80', quantity: 5, discount: '0' },
      ],
      '32.38',
    );

    expect(totals).toEqual({
      lineTotals: [16800n, 9800n, 17400n],
      subtotal: 44000n,
      discount: 0n,
      net: 44000n,
      freight: 3238n,
      total: 47238n,
    });
  });

  it('matches classic Northwind order 10250 (15% discounts, net 1552.60)', () => {
    const totals = computeOrderTotals(
      [
        { unitPrice: '7.70', quantity: 10, discount: '0' },
        { unitPrice: '42.40', quantity: 35, discount: '0.15' },
        { unitPrice: '16.80', quantity: 15, discount: '0.15' },
      ],
      '65.83',
    );

    expect(totals?.lineTotals).toEqual([7700n, 126140n, 21420n]);
    expect(totals?.subtotal).toBe(181300n);
    expect(totals?.discount).toBe(26040n);
    expect(totals?.net).toBe(155260n);
    expect(totals?.total).toBe(161843n);
  });

  it('rounds each line half-up to the cent', () => {
    // 0.99 x 1 x 0.95 = 0.9405 -> 0.94; 0.03 x 1 x 0.5 = 0.015 -> 0.02
    const totals = computeOrderTotals(
      [
        { unitPrice: '0.99', quantity: 1, discount: '0.05' },
        { unitPrice: '0.03', quantity: 1, discount: '0.5' },
      ],
      '0',
    );

    expect(totals?.lineTotals).toEqual([94n, 2n]);
  });

  it.each([
    [{ unitPrice: undefined, quantity: 1, discount: '0' }, '0'],
    [{ unitPrice: '1.00', quantity: 1.5, discount: '0' }, '0'],
    [{ unitPrice: '1.00', quantity: 1, discount: '1.5' }, '0'],
    [{ unitPrice: '1.00', quantity: 1, discount: '0' }, '-3'],
  ])('returns undefined for malformed input %#', (line, freight) => {
    expect(computeOrderTotals([line], freight)).toBeUndefined();
  });
});
