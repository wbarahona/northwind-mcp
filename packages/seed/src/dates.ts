const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;

/** `YYYY-MM-DD` → Date at UTC midnight. Throws on anything else. */
export function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Expected YYYY-MM-DD, got "${value}"`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date "${value}"`);
  return date;
}

/** Today at UTC midnight. */
export function utcToday(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export interface DateShift {
  /** Whole days added to every source date; always a multiple of 7. */
  days: number;
  shift: (date: Date) => Date;
}

/**
 * Moves the dataset so its latest order lands at least `daysBeforeAnchor` days before the
 * anchor (default 7), keeping weekdays: the offset is rounded *down* to whole weeks, so the
 * latest order ends up 7–13 days before the anchor and no order is ever in the future.
 */
export function computeDateShift(
  latestSourceDate: Date,
  anchor: Date,
  daysBeforeAnchor = 7,
): DateShift {
  const target = anchor.getTime() - daysBeforeAnchor * DAY_MS;
  const rawDays = Math.floor((target - latestSourceDate.getTime()) / DAY_MS);
  const days = Math.floor(rawDays / WEEK_DAYS) * WEEK_DAYS;
  return {
    days,
    shift: (date) => new Date(date.getTime() + days * DAY_MS),
  };
}
