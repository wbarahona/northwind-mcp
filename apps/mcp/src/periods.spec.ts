import {
  describeRange,
  lastDay,
  parseQuarter,
  PERIODS,
  periodRange,
  previousQuarter,
  recentQuarters,
} from './periods';

const at = (iso: string) => new Date(`${iso}T15:30:00.000Z`);

describe('periodRange', () => {
  it('turns every named period into a from-inclusive, to-exclusive range', () => {
    const now = at('2026-10-22');
    expect(
      Object.fromEntries(PERIODS.map((p) => [p, periodRange(p, now)])),
    ).toEqual({
      this_month: { from: '2026-10-01', to: '2026-11-01' },
      last_month: { from: '2026-09-01', to: '2026-10-01' },
      this_quarter: { from: '2026-10-01', to: '2027-01-01' },
      last_quarter: { from: '2026-07-01', to: '2026-10-01' },
      this_year: { from: '2026-01-01', to: '2027-01-01' },
      last_year: { from: '2025-01-01', to: '2026-01-01' },
      last_30_days: { from: '2026-09-23', to: '2026-10-23' },
    });
  });

  it('crosses year boundaries', () => {
    expect(periodRange('last_month', at('2026-01-15'))).toEqual({
      from: '2025-12-01',
      to: '2026-01-01',
    });
    expect(periodRange('last_quarter', at('2026-02-10'))).toEqual({
      from: '2025-10-01',
      to: '2026-01-01',
    });
    expect(periodRange('last_30_days', at('2026-01-10'))).toEqual({
      from: '2025-12-12',
      to: '2026-01-11',
    });
  });

  it('uses the UTC date, whatever the time of day', () => {
    expect(
      periodRange('this_month', new Date('2026-10-31T23:59:59.999Z')),
    ).toEqual({ from: '2026-10-01', to: '2026-11-01' });
  });
});

describe('describeRange', () => {
  it('shows the last day included, not the exclusive end', () => {
    expect(lastDay('2026-03-01')).toBe('2026-02-28');
    expect(describeRange({ from: '2026-07-01', to: '2026-10-01' })).toBe(
      'orders placed 2026-07-01 to 2026-09-30',
    );
    expect(describeRange({ from: '2026-01-01' })).toBe(
      'orders placed since 2026-01-01',
    );
    expect(describeRange({ to: '2025-01-01' })).toBe(
      'orders placed before 2025-01-01',
    );
    expect(describeRange({})).toBe('all orders');
  });
});

describe('quarters', () => {
  it('parses a quarter and finds the one before it', () => {
    const q3 = parseQuarter('2026-q3')!;
    expect(q3).toEqual({
      label: '2026-Q3',
      from: '2026-07-01',
      to: '2026-10-01',
    });
    expect(previousQuarter(q3)).toEqual({
      label: '2026-Q2',
      from: '2026-04-01',
      to: '2026-07-01',
    });
    expect(previousQuarter(parseQuarter('2026-Q1')!)).toEqual({
      label: '2025-Q4',
      from: '2025-10-01',
      to: '2026-01-01',
    });
    expect(parseQuarter('2026-Q5')).toBeUndefined();
    expect(parseQuarter('Q3 2026')).toBeUndefined();
  });

  it('lists the quarters that have ended, newest first', () => {
    expect(recentQuarters(at('2026-10-22'), 3).map((q) => q.label)).toEqual([
      '2026-Q3',
      '2026-Q2',
      '2026-Q1',
    ]);
    expect(recentQuarters(at('2026-02-01'), 2).map((q) => q.label)).toEqual([
      '2025-Q4',
      '2025-Q3',
    ]);
  });
});
