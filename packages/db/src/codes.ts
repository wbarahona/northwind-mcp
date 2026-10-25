import { type Model, Schema } from 'mongoose';

/** Prefixed, zero-padded codes for entities that had numeric IDs in classic Northwind. */
export const CODE_FORMATS = {
  categories: { prefix: 'CAT', width: 2 },
  employees: { prefix: 'EMP', width: 3 },
  orders: { prefix: 'ORD', width: 5 },
  products: { prefix: 'PRD', width: 3 },
  regions: { prefix: 'REG', width: 2 },
  shippers: { prefix: 'SHP', width: 2 },
  suppliers: { prefix: 'SUP', width: 3 },
} as const;

export type CodeSequence = keyof typeof CODE_FORMATS;

/** `formatCode('products', 7)` → `"PRD-007"`; `formatCode('orders', 10248)` → `"ORD-10248"`. */
export function formatCode(sequence: CodeSequence, n: number): string {
  const { prefix, width } = CODE_FORMATS[sequence];
  return `${prefix}-${String(n).padStart(width, '0')}`;
}

/** Matches codes for a sequence; wider numbers are allowed once a sequence outgrows its padding. */
export function codePattern(sequence: CodeSequence): RegExp {
  const { prefix, width } = CODE_FORMATS[sequence];
  return new RegExp(`^${prefix}-\\d{${width},}$`);
}

/** Classic Northwind customer IDs: five upper-case letters, e.g. `ALFKI`. */
export const CUSTOMER_CODE = /^[A-Z]{5}$/;
/** Classic Northwind territory IDs: five digits (US ZIP-like), e.g. `06897`. */
export const TERRITORY_CODE = /^\d{5}$/;

/** One document per sequence: `{ _id: 'orders', seq: 11077 }` = the last code handed out. */
export interface Counter {
  _id: CodeSequence;
  seq: number;
}

export const CounterSchema = new Schema<Counter>(
  {
    _id: { type: String, required: true, enum: Object.keys(CODE_FORMATS) },
    seq: { type: Number, required: true, min: 0 },
  },
  { collection: 'counters', versionKey: false },
);

/** Atomically reserves the next code in a sequence (safe under concurrent requests). */
export async function nextCode(
  counters: Model<Counter>,
  sequence: CodeSequence,
): Promise<string> {
  const counter = await counters
    .findOneAndUpdate(
      { _id: sequence },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' },
    )
    .lean()
    .orFail();
  return formatCode(sequence, counter.seq);
}
