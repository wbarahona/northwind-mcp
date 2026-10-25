import { ValidationException } from '../errors/validation.exception';
import { paginate, parseSort, toSkip } from './pagination';

describe('pagination', () => {
  it('computes skip from page and limit', () => {
    expect(toSkip({ page: 3, limit: 20 })).toBe(40);
  });

  it('wraps data with page metadata', () => {
    expect(paginate(['a'], 41, { page: 1, limit: 20 }).meta).toEqual({
      page: 1,
      limit: 20,
      total: 41,
      totalPages: 3,
    });
  });
});

describe('parseSort', () => {
  const allowed = ['code', 'orderDate'];

  it('parses directions in the given order and adds an _id tie-breaker', () => {
    const spec = parseSort('-orderDate, code', allowed, { code: 1 });

    expect(spec).toEqual({ orderDate: -1, code: 1, _id: 1 });
    expect(Object.keys(spec)).toEqual(['orderDate', 'code', '_id']);
  });

  it('uses the fallback when no sort is given', () => {
    expect(parseSort(undefined, allowed, { orderDate: -1 })).toEqual({
      orderDate: -1,
      _id: 1,
    });
  });

  it('rejects fields outside the allowlist', () => {
    expect(() => parseSort('-password', allowed, {})).toThrow(
      ValidationException,
    );
  });
});
