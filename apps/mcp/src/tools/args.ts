import { z } from 'zod';

/*
 * Argument schemas shared by the tools. Two rules, both learned from small local models:
 *  - Be lenient about how a value is sent: models write numbers as strings ("2"), booleans as
 *    "true", enums in another case, codes as numbers. The published schema stays strict and
 *    simple; the preprocess step only normalises what arrives.
 *  - Keep the published JSON Schema grammar-safe for llama.cpp: no `\d` in patterns and no
 *    unbounded integers (Zod would publish ±2^53 bounds).
 */

const trimmed = (value: unknown) =>
  typeof value === 'string' ? value.trim() : value;
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/** A record code argument. A number is accepted too (models often send 10248 as a number). */
export const codeArg = (description: string) =>
  z.preprocess(
    (value) => (typeof value === 'number' ? String(value) : value),
    z.string().trim().min(1).max(100).describe(description),
  );

/** A free-text argument (search words, a city). */
export const textArg = (description: string) =>
  z.preprocess(trimmed, z.string().min(1).max(100).describe(description));

export const intArg = (min: number, max: number, description: string) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && /^ *-?[0-9]+ *$/.test(value)
        ? Number(value)
        : value,
    z.number().int().min(min).max(max).describe(description),
  );

export const amountArg = (description: string) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && /^ *[0-9]+(\.[0-9]+)? *$/.test(value)
        ? Number(value)
        : value,
    z.number().min(0).max(1_000_000).describe(description),
  );

export const boolArg = (description: string) =>
  z.preprocess((value) => {
    const v = typeof value === 'string' ? value.trim().toLowerCase() : value;
    return v === 'true' ? true : v === 'false' ? false : v;
  }, z.boolean().describe(description));

/** An enum argument; "Shipped", " pending " and "shipped-late" all match. */
export const enumArg = <const T extends readonly [string, ...string[]]>(
  values: T,
  description: string,
) =>
  z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value.trim().toLowerCase().replace(/[- ]/g, '_')
        : value,
    z.enum(values).describe(description),
  );

/** A calendar date, YYYY-MM-DD. The API checks that it is a real date. */
export const dateArg = (description: string) =>
  z.preprocess(
    trimmed,
    z
      .string()
      .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, 'must be a date as YYYY-MM-DD')
      .describe(description),
  );

/** Optional arguments: an empty string counts as "not given" (small models send those). */
export const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

/** Every list tool pages the same way. */
export const pagingArgs = {
  page: optional(intArg(1, 1000, 'Page number, starting at 1 (default 1)')),
  limit: optional(intArg(1, 100, 'Results per page (default 20, max 100)')),
};

export const DEFAULT_LIMIT = 20;

/** Accepts "ORD-10248", "ord-10248" or just "10248" (the classic Northwind order number). */
export function orderCode(value: string): string {
  return /^[0-9]+$/.test(value) ? `ORD-${value}` : value;
}

/**
 * A discount rate: 0.15 or "15%" both mean 15% off. A bare 15 is refused rather than
 * guessed, since reading it wrongly would give a 1500% discount.
 */
export const discountArg = (description: string) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const v = value.trim();
    const percent = /^([0-9]+(?:\.[0-9]+)?) *%$/.exec(v);
    if (percent) return Number(percent[1]) / 100;
    return /^[0-9]+(\.[0-9]+)?$/.test(v) ? Number(v) : v;
  }, z.number().min(0).max(1, 'discount is a rate between 0 and 1: use 0.1 (or "10%") for 10% off').describe(description));

export const quantityArg = intArg(1, 10_000, 'Units, 1 to 10000');

/** A ship-to address; the country name is filled in by the API from the code. */
export const shipToArg = z
  .object({
    name: textArg('Recipient, usually the company name'),
    street: textArg('Street address'),
    city: textArg('City'),
    region: optional(textArg('State, province or region')),
    postalCode: optional(textArg('Postal code')),
    countryCode: z
      .string()
      .regex(/^[A-Za-z]{2}$/, 'must be a 2-letter ISO country code such as DE')
      .describe('ISO 3166-1 alpha-2 country code, e.g. DE'),
  })
  .describe("Where to deliver; defaults to the customer's address");
