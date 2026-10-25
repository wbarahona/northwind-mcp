import { nextPeriod, periodLabel, periodRange, periodStart } from './periods';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const day = (date: Date) => date.toISOString().slice(0, 10);

describe('periods', () => {
  it.each([
    ['day', '2025-03-14', '2025-03-14', '2025-03-14'],
    ['week', '2025-03-14', '2025-03-10', '2025-W11'], // Friday → Monday
    ['week', '2025-03-10', '2025-03-10', '2025-W11'],
    ['month', '2025-03-14', '2025-03-01', '2025-03'],
    ['quarter', '2025-05-20', '2025-04-01', '2025-Q2'],
    ['year', '2025-05-20', '2025-01-01', '2025'],
  ] as const)('%s of %s starts %s, labelled %s', (unit, date, start, label) => {
    const s = periodStart(d(date), unit);
    expect(day(s)).toBe(start);
    expect(periodLabel(s, unit)).toBe(label);
  });

  it('labels ISO weeks across year boundaries', () => {
    // 2024-12-30 (Mon) is in week 1 of 2025; 2021-01-01 (Fri) is in week 53 of 2020.
    expect(periodLabel(periodStart(d('2024-12-31'), 'week'), 'week')).toBe(
      '2025-W01',
    );
    expect(periodLabel(periodStart(d('2021-01-01'), 'week'), 'week')).toBe(
      '2020-W53',
    );
  });

  it('steps months and quarters across years', () => {
    expect(day(nextPeriod(d('2025-12-01'), 'month'))).toBe('2026-01-01');
    expect(day(nextPeriod(d('2025-10-01'), 'quarter'))).toBe('2026-01-01');
  });

  it('lists every period between two dates, inclusive', () => {
    expect(
      periodRange(d('2025-11-15'), d('2026-02-01'), 'month').map(day),
    ).toEqual(['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01']);
  });
});
