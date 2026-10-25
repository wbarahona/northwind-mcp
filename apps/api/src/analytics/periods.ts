export const GRANULARITIES = [
  'day',
  'week',
  'month',
  'quarter',
  'year',
] as const;
export type Granularity = (typeof GRANULARITIES)[number];

/** Start of the UTC period containing `date`. Weeks start on Monday (ISO 8601). */
export function periodStart(date: Date, unit: Granularity): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  switch (unit) {
    case 'day':
      return new Date(Date.UTC(y, m, d));
    case 'week': {
      const mondayOffset = (date.getUTCDay() + 6) % 7;
      return new Date(Date.UTC(y, m, d - mondayOffset));
    }
    case 'month':
      return new Date(Date.UTC(y, m, 1));
    case 'quarter':
      return new Date(Date.UTC(y, m - (m % 3), 1));
    case 'year':
      return new Date(Date.UTC(y, 0, 1));
  }
}

/** Start of the period after the one starting at `start`. */
export function nextPeriod(start: Date, unit: Granularity): Date {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  const d = start.getUTCDate();
  switch (unit) {
    case 'day':
      return new Date(Date.UTC(y, m, d + 1));
    case 'week':
      return new Date(Date.UTC(y, m, d + 7));
    case 'month':
      return new Date(Date.UTC(y, m + 1, 1));
    case 'quarter':
      return new Date(Date.UTC(y, m + 3, 1));
    case 'year':
      return new Date(Date.UTC(y + 1, 0, 1));
  }
}

/** Human label: 2025-03-14, 2025-W11, 2025-03, 2025-Q1, 2025. */
export function periodLabel(start: Date, unit: Granularity): string {
  const iso = start.toISOString();
  switch (unit) {
    case 'day':
      return iso.slice(0, 10);
    case 'week': {
      const { year, week } = isoWeek(start);
      return `${year}-W${String(week).padStart(2, '0')}`;
    }
    case 'month':
      return iso.slice(0, 7);
    case 'quarter':
      return `${start.getUTCFullYear()}-Q${Math.floor(start.getUTCMonth() / 3) + 1}`;
    case 'year':
      return String(start.getUTCFullYear());
  }
}

/** Every period start from `first` up to and including `last`. */
export function periodRange(
  first: Date,
  last: Date,
  unit: Granularity,
): Date[] {
  const periods: Date[] = [];
  for (let p = periodStart(first, unit); p <= last; p = nextPeriod(p, unit)) {
    periods.push(p);
  }
  return periods;
}

/** ISO 8601 week: the week belongs to the year that contains its Thursday. */
function isoWeek(date: Date): { year: number; week: number } {
  const thursday = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7),
    ),
  );
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const week =
    1 +
    Math.round(
      ((thursday.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return { year, week };
}
