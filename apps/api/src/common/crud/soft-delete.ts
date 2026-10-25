import { ConflictException } from '@nestjs/common';
import type { HydratedDocument } from 'mongoose';

/** Filter fragment that hides soft-deleted records unless asked for. */
export function activeFilter(includeDeleted?: boolean) {
  return includeDeleted ? {} : { deletedAt: null };
}

/** Deleted records stay readable (old orders point at them) but can't be edited. */
export function assertNotDeleted(
  doc: { deletedAt: Date | null; code: string },
  label: string,
): void {
  if (doc.deletedAt) {
    throw new ConflictException(
      `${label} "${doc.code}" was deleted on ${doc.deletedAt.toISOString()} and can't be changed.`,
    );
  }
}

/** Marks a record deleted; deleting it again is a no-op that returns it unchanged. */
export async function softDelete<T extends { deletedAt: Date | null }>(
  doc: HydratedDocument<T>,
) {
  if (!doc.deletedAt) {
    doc.set('deletedAt', new Date());
    await doc.save();
  }
  return doc.toObject();
}
