/**
 * Named periods ("last_quarter") turned into date ranges, so models don't have to do
 * calendar arithmetic. Ranges are UTC calendar dates, `from` inclusive and `to` exclusive,
 * like the API's.
 */
export const PERIODS = [
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'last_30_days',
] as const;
export type Period = (typeof PERIODS)[number];

export interface DateRange {
  /** YYYY-MM-DD, inclusive. */
  from?: string;
  /** YYYY-MM-DD, exclusive. */
  to?: string;
}

const iso = (date: Date) => date.toISOString().slice(0, 10);
const utc = (year: number, month: number, day = 1) =>
  new Date(Date.UTC(year, month, day));

/** Today as YYYY-MM-DD (UTC). */
export const today = (now: Date) => iso(now);

export function periodRange(period: Period, now: Date): Required<DateRange> {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const quarterStart = month - (month % 3);
  switch (period) {
    case 'this_month':
      return { from: iso(utc(year, month)), to: iso(utc(year, month + 1)) };
    case 'last_month':
      return { from: iso(utc(year, month - 1)), to: iso(utc(year, month)) };
    case 'this_quarter':
      return {
        from: iso(utc(year, quarterStart)),
        to: iso(utc(year, quarterStart + 3)),
      };
    case 'last_quarter':
      return {
        from: iso(utc(year, quarterStart - 3)),
        to: iso(utc(year, quarterStart)),
      };
    case 'this_year':
      return { from: iso(utc(year, 0)), to: iso(utc(year + 1, 0)) };
    case 'last_year':
      return { from: iso(utc(year - 1, 0)), to: iso(utc(year, 0)) };
    case 'last_30_days':
      return {
        from: iso(utc(year, month, now.getUTCDate() - 29)),
        to: iso(utc(year, month, now.getUTCDate() + 1)),
      };
  }
}

/** The day before an exclusive end date: "2026-10-01" → "2026-09-30". */
export function lastDay(to: string): string {
  const date = new Date(`${to}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return iso(date);
}

/** "orders placed 2026-07-01 to 2026-09-30", "orders placed since 2026-01-01", "all orders". */
export function describeRange({ from, to }: DateRange): string {
  if (from && to) return `orders placed ${from} to ${lastDay(to)}`;
  if (from) return `orders placed since ${from}`;
  if (to) return `orders placed before ${to}`;
  return 'all orders';
}

/** A calendar quarter like "2026-Q3". */
export const QUARTER = /^([0-9]{4})-Q([1-4])$/;

export interface Quarter {
  label: string;
  from: string;
  to: string;
}

const quarter = (year: number, index: number): Quarter => {
  const start = utc(year, index * 3);
  const normalized = {
    year: start.getUTCFullYear(),
    q: start.getUTCMonth() / 3 + 1,
  };
  return {
    label: `${normalized.year}-Q${normalized.q}`,
    from: iso(start),
    to: iso(utc(year, index * 3 + 3)),
  };
};

/** "2026-Q3" → 2026-07-01 to 2026-10-01; undefined if it isn't a quarter. */
export function parseQuarter(label: string): Quarter | undefined {
  const match = QUARTER.exec(label.trim().toUpperCase());
  return match ? quarter(Number(match[1]), Number(match[2]) - 1) : undefined;
}

export function previousQuarter(q: Quarter): Quarter {
  const [year, n] = q.label.split('-Q').map(Number) as [number, number];
  return quarter(year, n - 2);
}

/** The most recent quarters that have ended, newest first. */
export function recentQuarters(now: Date, count: number): Quarter[] {
  const current = Math.floor(now.getUTCMonth() / 3);
  return Array.from({ length: count }, (_, i) =>
    quarter(now.getUTCFullYear(), current - 1 - i),
  );
}
