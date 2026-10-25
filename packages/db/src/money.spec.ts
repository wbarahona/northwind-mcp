import { Types } from 'mongoose';
import {
  decimalToPlainString,
  formatScaledInt,
  isMoney,
  isRate,
  normalizeMoney,
  normalizeRate,
  toScaledInt,
} from './money';

describe('decimalToPlainString', () => {
  it.each([
    ['18.00', '18.00'],
    ['1.5E+3', '1500'],
    ['1E+1', '10'],
    ['-1.2345E+2', '-123.45'],
    ['1E-7', '0.0000001'],
    ['-2.5E-8', '-0.000000025'],
    ['NaN', 'NaN'],
  ])('%s -> %s', (input, expected) => {
    expect(decimalToPlainString(input)).toBe(expected);
  });
});

describe('toScaledInt', () => {
  it.each([
    ['14', 2, 1400n],
    ['14.5', 2, 1450n],
    ['0.05', 2, 5n],
    ['18.000', 2, 1800n],
    [9.8, 2, 980n],
    [Types.Decimal128.fromString('32.38'), 2, 3238n],
    [Types.Decimal128.fromString('1.5E+3'), 2, 150000n],
    ['0.15', 4, 1500n],
  ])('%s at scale %i -> %s', (input, scale, expected) => {
    expect(toScaledInt(input, scale)).toBe(expected);
  });

  it.each([['14.005'], ['-1'], ['abc'], [''], [null], [Number.NaN], [{}]])(
    'rejects %p',
    (input) => {
      expect(toScaledInt(input, 2)).toBeUndefined();
    },
  );
});

describe('formatScaledInt', () => {
  it.each([
    [0n, 2, '0.00'],
    [5n, 2, '0.05'],
    [1450n, 2, '14.50'],
    [-1450n, 2, '-14.50'],
    [42n, 0, '42'],
  ])('%s at scale %i -> %s', (input, scale, expected) => {
    expect(formatScaledInt(input, scale)).toBe(expected);
  });
});

describe('money and rate normalization', () => {
  it('pads money to 2 decimals', () => {
    expect(normalizeMoney('18')).toBe('18.00');
    expect(normalizeMoney(9.8)).toBe('9.80');
  });

  it('passes invalid money through for the validator to reject', () => {
    expect(normalizeMoney('1.234')).toBe('1.234');
    expect(isMoney('1.234')).toBe(false);
    expect(isMoney('-5')).toBe(false);
    expect(isMoney(null)).toBe(true);
  });

  it('writes rates in their shortest form', () => {
    expect(normalizeRate('0.1500')).toBe('0.15');
    expect(normalizeRate(0)).toBe('0');
    expect(normalizeRate('1')).toBe('1');
    expect(normalizeRate('0.0525')).toBe('0.0525');
  });

  it('accepts rates between 0 and 1 only', () => {
    expect(isRate('0.25')).toBe(true);
    expect(isRate('1')).toBe(true);
    expect(isRate('1.01')).toBe(false);
    expect(isRate('0.00001')).toBe(false);
  });
});
