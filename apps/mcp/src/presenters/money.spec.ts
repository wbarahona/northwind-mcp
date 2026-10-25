import { fromCents, percentOf, sumMoney, toCents } from './money';

describe('money', () => {
  it('converts decimal strings to cents and back', () => {
    expect(toCents('18.00')).toBe(1800n);
    expect(toCents('9.8')).toBe(980n);
    expect(toCents('7')).toBe(700n);
    expect(fromCents(126579329n)).toBe('1265793.29');
    expect(fromCents(-5n)).toBe('-0.05');
    expect(() => toCents('1.234')).toThrow(/Not a money amount/);
  });

  it('sums exactly (0.1 + 0.2 stays 0.30)', () => {
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
    expect(sumMoney([])).toBe('0.00');
  });

  it('computes shares with two decimals, rounding half up', () => {
    expect(percentOf('232890.89', '1265793.29')).toBe(18.4);
    expect(percentOf('1.00', '3.00')).toBe(33.33);
    expect(percentOf('2.00', '3.00')).toBe(66.67);
    expect(percentOf('1.00', '0.00')).toBe(0);
  });
});
