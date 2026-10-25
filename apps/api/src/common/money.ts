import {
  formatScaledInt,
  MONEY_SCALE,
  normalizeMoney,
  toCents,
} from '@northwind/db';

/**
 * Formats an aggregation result (Decimal128, already rounded to cents) as a money string
 * with exactly two decimals: `1.5` → `"1.50"`; null/undefined → `"0.00"`.
 */
export function money(value: unknown): string {
  if (value === null || value === undefined) return '0.00';
  const normalized = normalizeMoney(value);
  if (typeof normalized !== 'string' || toCents(normalized) === undefined) {
    throw new Error(`Not a money amount: ${JSON.stringify(value)}`);
  }
  return normalized;
}

/** part / whole as a percentage with 2 decimals; 0 when the whole is 0. */
export function percentOf(part: unknown, whole: unknown): number {
  const p = toCents(part) ?? 0n;
  const w = toCents(whole) ?? 0n;
  if (w === 0n) return 0;
  // Hundredths of a percent, rounded half-up: (p / w) × 100 × 100, then + ½.
  const hundredths = ((p * 20_000n) / w + 1n) / 2n;
  return Number(hundredths) / 100;
}

/** total / count, rounded half-up to the cent; "0.00" when count is 0. */
export function averageMoney(total: unknown, count: number): string {
  const cents = toCents(money(total)) ?? 0n;
  if (count === 0) return '0.00';
  const n = BigInt(count);
  return formatScaledInt((cents * 2n + n) / (2n * n), MONEY_SCALE);
}

/** Exact sum of money values. */
export function sumMoney(values: unknown[]): string {
  const cents = values.reduce<bigint>(
    (sum, v) => sum + (toCents(money(v)) ?? 0n),
    0n,
  );
  return formatScaledInt(cents, MONEY_SCALE);
}
