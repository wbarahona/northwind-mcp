import { z } from 'zod';

/**
 * Shared pieces of the compact shapes the model reads. Ids and timestamps are dropped
 * (codes are the identifiers the model uses), and so is every field that is null.
 */

/** A copied reference: the code to call tools with and the name to show. */
export const Ref = z.object({
  code: z.string().describe('Readable code, usable as a tool argument'),
  name: z.string(),
});
export type Ref = z.infer<typeof Ref>;

export const Address = z.object({
  name: z.string().optional().describe('Recipient'),
  street: z.string(),
  city: z.string(),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string(),
  countryCode: z.string().describe('ISO 3166-1 alpha-2'),
});
export type Address = z.infer<typeof Address>;

export const Money = z
  .string()
  .describe('Decimal amount as a string, e.g. "18.00"');

export const Day = z
  .string()
  .describe(
    'ISO date (YYYY-MM-DD), or a full ISO timestamp when the time matters',
  );

/**
 * Seeded dates are UTC midnight, so they read best as YYYY-MM-DD. A date with a time of
 * day (e.g. an order placed a minute ago) keeps the full timestamp.
 */
export function day(value: string): string {
  return value.endsWith('T00:00:00.000Z') ? value.slice(0, 10) : value;
}

/** Copies only the fields that have a value (drops null and undefined). */
export function compact<T extends Record<string, unknown>>(
  fields: T,
): { [K in keyof T]: Exclude<T[K], null> } {
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== null && v !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], null> };
}
