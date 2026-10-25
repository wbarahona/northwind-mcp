import { createHash } from 'node:crypto';
import { Types } from 'mongoose';

/** Fixed timestamp for seeded ObjectIds (2026-01-01T00:00:00Z); keeps ids stable. */
const SEED_EPOCH_SECONDS = 1_767_225_600;

/**
 * Deterministic ObjectId per (collection, code): reseeding gives every record the same id,
 * so ids that clients (or an LLM conversation) already hold stay valid. Layout: 4-byte fixed
 * timestamp + 8 bytes of SHA-256(collection:code).
 */
export function seedObjectId(collection: string, code: string): Types.ObjectId {
  const bytes = Buffer.alloc(12);
  bytes.writeUInt32BE(SEED_EPOCH_SECONDS, 0);
  createHash('sha256')
    .update(`${collection}:${code}`)
    .digest()
    .copy(bytes, 4, 0, 8);
  return new Types.ObjectId(bytes);
}
