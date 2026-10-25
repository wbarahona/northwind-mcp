import { Types } from 'mongoose';
import { averageMoney, money, percentOf, sumMoney } from './money';

describe('money', () => {
  it('formats decimals with exactly two places', () => {
    expect(money(Types.Decimal128.fromString('1.5'))).toBe('1.50');
    expect(money(Types.Decimal128.fromString('266.00'))).toBe('266.00');
    expect(money(null)).toBe('0.00');
  });

  it('refuses values that were not rounded to cents', () => {
    expect(() => money(Types.Decimal128.fromString('1.005'))).toThrow(
      /Not a money amount/,
    );
  });
});

describe('percentOf', () => {
  it('rounds half-up to two decimals', () => {
    expect(percentOf('1.00', '3.00')).toBe(33.33);
    expect(percentOf('2.00', '3.00')).toBe(66.67);
    expect(percentOf('1.00', '8.00')).toBe(12.5);
    expect(percentOf('5.00', '0.00')).toBe(0);
  });
});

describe('averageMoney and sumMoney', () => {
  it('rounds averages half-up to the cent', () => {
    expect(averageMoney('10.00', 3)).toBe('3.33');
    expect(averageMoney('0.05', 2)).toBe('0.03');
    expect(averageMoney('10.00', 0)).toBe('0.00');
  });

  it('sums exactly', () => {
    expect(
      sumMoney(['0.10', '0.20', Types.Decimal128.fromString('0.30')]),
    ).toBe('0.60');
  });
});
