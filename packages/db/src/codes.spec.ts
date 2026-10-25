import { codePattern, formatCode } from './codes';

describe('codes', () => {
  it.each([
    ['products', 7, 'PRD-007'],
    ['categories', 1, 'CAT-01'],
    ['orders', 10248, 'ORD-10248'],
    ['products', 1234, 'PRD-1234'],
  ] as const)('formatCode(%s, %i) -> %s', (sequence, n, expected) => {
    expect(formatCode(sequence, n)).toBe(expected);
  });

  it('matches padded and outgrown codes, but not other prefixes', () => {
    const pattern = codePattern('products');

    expect(pattern.test('PRD-007')).toBe(true);
    expect(pattern.test('PRD-1234')).toBe(true);
    expect(pattern.test('PRD-07')).toBe(false);
    expect(pattern.test('ORD-007')).toBe(false);
  });
});
