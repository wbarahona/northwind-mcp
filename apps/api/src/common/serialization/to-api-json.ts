import { decimalToPlainString } from '@northwind/db';
import { Document } from 'mongoose';

/**
 * Converts what controllers return (Mongoose documents, lean objects, BSON values) into the API's JSON shape:
 * - `Decimal128` → plain decimal string (`"18.00"`), never a float and never `{ $numberDecimal }`
 * - `ObjectId` → 24-char hex string
 * - `_id` → `id`; `__v` dropped
 * Dates are left alone; JSON renders them as ISO-8601.
 */
export function toApiJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;

  if (value instanceof Document) return toApiJson(value.toObject());
  if (Array.isArray(value)) return value.map(toApiJson);

  const bsonType = (value as { _bsontype?: unknown })._bsontype;
  if (bsonType === 'Decimal128')
    return decimalToPlainString((value as { toString(): string }).toString());
  if (bsonType === 'ObjectId')
    return (value as { toHexString(): string }).toHexString();

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === '__v') continue;
    if (key === '_id') {
      if (!('id' in value)) out.id = toApiJson(child);
      continue;
    }
    out[key] = toApiJson(child);
  }
  return out;
}
