import { pageSummary } from './page';

const noun: [string, string] = ['customer', 'customers'];
const meta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

describe('pageSummary', () => {
  it('says when there is nothing', () => {
    expect(pageSummary(noun, meta(1, 20, 0), 0)).toBe('No customers found.');
  });

  it('gives just the count when everything fits on one page', () => {
    expect(pageSummary(noun, meta(1, 20, 1), 1)).toBe('1 customer.');
    expect(pageSummary(noun, meta(1, 20, 11), 11)).toBe('11 customers.');
  });

  it('says which rows are shown and how to get the next page', () => {
    expect(pageSummary(noun, meta(1, 20, 91), 20)).toBe(
      '91 customers; showing 1–20 (page 1 of 5). Call again with page=2 for more.',
    );
    expect(pageSummary(noun, meta(5, 20, 91), 11)).toBe(
      '91 customers; showing 81–91 (page 5 of 5).',
    );
  });

  it('says when the page is past the end', () => {
    expect(pageSummary(noun, meta(9, 20, 91), 0)).toBe(
      '91 customers, but page 9 is past the last page (5).',
    );
  });
});
