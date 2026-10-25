import { Types } from 'mongoose';

/** Money is stored with exactly 2 decimal places. */
export const MONEY_SCALE = 2;
/** Discount rates (0–1) allow up to 4 decimal places, e.g. 0.15 or 0.0525. */
export const RATE_SCALE = 4;

/**
 * Decimal128#toString can use exponent notation (`1.5E+3`, `1E-7`); expand it so callers
 * always get a plain decimal string. Scale is preserved (`"18.00"` stays `"18.00"`).
 */
export function decimalToPlainString(decimal: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?E([+-]\d+)$/i.exec(decimal);
  if (!match) return decimal;

  const [, sign = '', int = '', frac = '', exp = '0'] = match;
  const digits = int + frac;
  const point = int.length + Number(exp);

  let plain: string;
  if (point <= 0) plain = `0.${'0'.repeat(-point)}${digits}`;
  else if (point >= digits.length)
    plain = digits + '0'.repeat(point - digits.length);
  else plain = `${digits.slice(0, point)}.${digits.slice(point)}`;

  return sign + plain;
}

/**
 * Parses a non-negative decimal (string, number or Decimal128) into an integer scaled by
 * 10^scale, e.g. `"14.5"` at scale 2 → `1450n`. Returns undefined if the value is not a
 * non-negative decimal or has more decimal places than `scale` (no silent rounding).
 */
export function toScaledInt(value: unknown, scale: number): bigint | undefined {
  const text = decimalText(value);
  if (text === undefined) return undefined;

  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return undefined;

  const [, int = '0', frac = ''] = match;
  if (frac.length > scale) {
    // Allow trailing zeros beyond the scale ("18.000" is still 18.00).
    if (/[^0]/.test(frac.slice(scale))) return undefined;
  }
  return BigInt(int + frac.slice(0, scale).padEnd(scale, '0'));
}

/** `1450n` at scale 2 → `"14.50"`. */
export function formatScaledInt(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(scale + 1, '0');
  const int = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${int}${scale > 0 ? `.${frac}` : ''}`;
}

export function toCents(value: unknown): bigint | undefined {
  return toScaledInt(value, MONEY_SCALE);
}

export function centsToDecimal128(cents: bigint): Types.Decimal128 {
  return Types.Decimal128.fromString(formatScaledInt(cents, MONEY_SCALE));
}

/**
 * Mongoose setter for money fields: normalizes valid amounts to exactly 2 decimals
 * (`18` → `"18.00"`). Invalid input passes through untouched so the validator reports it.
 */
export function normalizeMoney(value: unknown): unknown {
  const cents = toCents(value);
  return cents === undefined ? value : formatScaledInt(cents, MONEY_SCALE);
}

export function isMoney(value: unknown): boolean {
  return value == null || toCents(value) !== undefined;
}

/** Mongoose setter for discount rates: shortest form, `0.1500` → `"0.15"`, `0` → `"0"`. */
export function normalizeRate(value: unknown): unknown {
  const scaled = toScaledInt(value, RATE_SCALE);
  if (scaled === undefined) return value;
  return formatScaledInt(scaled, RATE_SCALE).replace(/\.?0+$/, '');
}

export function isRate(value: unknown): boolean {
  if (value == null) return true;
  const scaled = toScaledInt(value, RATE_SCALE);
  return scaled !== undefined && scaled <= 10n ** BigInt(RATE_SCALE);
}

function decimalText(value: unknown): string | undefined {
  if (value instanceof Types.Decimal128)
    return decimalToPlainString(value.toString());
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return decimalToPlainString(String(value));
  }
  return undefined;
}
