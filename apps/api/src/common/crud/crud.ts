import { NotFoundException } from '@nestjs/common';
import type { Model, ProjectionType, QueryFilter } from 'mongoose';
import { ValidationException } from '../errors/validation.exception';
import { type IdOrCodeFilter, toIdOrCodeFilter } from '../ids/id-or-code';
import {
  paginate,
  type Paginated,
  type PaginationQueryDto,
  parseSort,
  type SortSpec,
  toSkip,
} from '../pagination/pagination';

export interface ListOptions<T> {
  sortable: readonly string[];
  defaultSort: SortSpec;
  projection?: ProjectionType<T>;
}

/** One page of lean documents plus the total count, in the standard envelope. */
export async function findPage<T>(
  model: Model<T>,
  filter: QueryFilter<T>,
  query: PaginationQueryDto,
  { sortable, defaultSort, projection }: ListOptions<T>,
): Promise<Paginated<unknown>> {
  const sort = parseSort(query.sort, sortable, defaultSort);
  const [data, total] = await Promise.all([
    model
      .find(filter, projection)
      .sort(sort)
      .skip(toSkip(query))
      .limit(query.limit)
      .lean(),
    model.countDocuments(filter),
  ]);
  return paginate(data, total, query);
}

/** Describes an id-or-code filter for messages: `Customer "ALFKI"`. */
export function describe(label: string, filter: IdOrCodeFilter): string {
  return `${label} "${'code' in filter ? filter.code : filter._id.toHexString()}"`;
}

export async function findOneOrFail<T>(
  model: Model<T>,
  filter: IdOrCodeFilter,
  label: string,
) {
  const doc = await model.findOne(filter as QueryFilter<T>).lean();
  if (!doc)
    throw new NotFoundException(`${describe(label, filter)} was not found.`);
  return doc;
}

/** Like findOneOrFail, but returns a full Mongoose document for load-modify-save edits. */
export async function findDocumentOrFail<T>(
  model: Model<T>,
  filter: IdOrCodeFilter,
  label: string,
) {
  const doc = await model.findOne(filter as QueryFilter<T>);
  if (!doc)
    throw new NotFoundException(`${describe(label, filter)} was not found.`);
  return doc;
}

/**
 * Filter on an embedded copied reference: `refFilter('category', 'CAT-01')` →
 * `{ 'category.code': 'CAT-01' }`; an ObjectId filters on `category._id`. No lookup needed.
 */
export function refFilter(
  path: string,
  idOrCode: string,
): Record<string, unknown> {
  const filter = toIdOrCodeFilter(idOrCode);
  return 'code' in filter
    ? { [`${path}.code`]: filter.code }
    : { [`${path}._id`]: filter._id };
}

/**
 * Resolves a reference given in a request body (`categoryId: "CAT-01"`). A missing or
 * soft-deleted target is reported as a 400 on that field, so the caller knows what to fix.
 */
export async function resolveReference<T>(
  model: Model<T>,
  idOrCode: string,
  field: string,
  label: string,
) {
  const filter = toIdOrCodeFilter(idOrCode);
  const doc = await model.findOne(filter as QueryFilter<T>).lean();
  if (!doc) {
    throw new ValidationException([
      { field, messages: [`${describe(label, filter)} was not found.`] },
    ]);
  }
  if ((doc as { deletedAt?: Date | null }).deletedAt) {
    throw new ValidationException([
      { field, messages: [`${describe(label, filter)} has been deleted.`] },
    ]);
  }
  return doc;
}

/** Case-insensitive "contains" match, with regex characters escaped. */
export function containsInsensitive(text: string): RegExp {
  return new RegExp(escapeRegex(text.trim()), 'i');
}

/** `^…$` case-insensitive exact match, with regex characters escaped. */
export function exactInsensitive(text: string): RegExp {
  return new RegExp(`^${escapeRegex(text.trim())}$`, 'i');
}

/**
 * Country filter: a 2-letter value matches the ISO code, anything longer the English name
 * (both case-insensitive): `country=de` and `country=germany` find the same records.
 */
export function countryFilter(path: string, country: string) {
  const value = country.trim();
  return /^[A-Za-z]{2}$/.test(value)
    ? { [`${path}.countryCode`]: value.toUpperCase() }
    : { [`${path}.country`]: exactInsensitive(value) };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
