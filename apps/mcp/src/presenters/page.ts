import type { PageMeta } from '@northwind/api-client';
import { z } from 'zod';

/** The paging fields of every list result. */
export const PageFields = {
  total: z.number().describe('Matches across all pages'),
  page: z.number(),
  totalPages: z.number(),
};

export function listView<T>(items: T[], meta: PageMeta) {
  return {
    items,
    total: meta.total,
    page: meta.page,
    totalPages: meta.totalPages,
  };
}

/**
 * The paging half of a list summary: "91 customers; showing 1–20 (page 1 of 5). Call again
 * with page=2 for more." Says plainly when there is nothing, or nothing on this page.
 */
export function pageSummary(
  [one, many]: [string, string],
  meta: PageMeta,
  shown: number,
): string {
  const noun = meta.total === 1 ? one : many;
  if (meta.total === 0) return `No ${many} found.`;
  if (shown === 0) {
    return `${meta.total} ${noun}, but page ${meta.page} is past the last page (${meta.totalPages}).`;
  }
  if (meta.totalPages <= 1) return `${meta.total} ${noun}.`;

  const first = (meta.page - 1) * meta.limit + 1;
  const range = `showing ${first}–${first + shown - 1} (page ${meta.page} of ${meta.totalPages})`;
  return meta.page < meta.totalPages
    ? `${meta.total} ${noun}; ${range}. Call again with page=${meta.page + 1} for more.`
    : `${meta.total} ${noun}; ${range}.`;
}
