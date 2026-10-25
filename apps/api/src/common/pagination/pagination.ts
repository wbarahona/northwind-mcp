import { applyDecorators, type Type as ClassType } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { ValidationException } from '../errors/validation.exception';
import { PageMetaDto, type PaginationQueryDto } from './pagination.dto';
import type { SortSpec } from './sort-spec';

export {
  MAX_PAGE_SIZE,
  PageMetaDto,
  PaginationQueryDto,
} from './pagination.dto';

export interface Paginated<T> {
  data: T[];
  meta: PageMetaDto;
}

export type { SortSpec } from './sort-spec';

export function toSkip({
  page,
  limit,
}: Pick<PaginationQueryDto, 'page' | 'limit'>): number {
  return (page - 1) * limit;
}

export function paginate<T>(
  data: T[],
  total: number,
  { page, limit }: Pick<PaginationQueryDto, 'page' | 'limit'>,
): Paginated<T> {
  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Parses `?sort=-orderDate,code` against an allowlist into a Mongo sort spec.
 * Always ends with `_id` so pages stay stable when sort values tie.
 */
export function parseSort(
  sort: string | undefined,
  allowed: readonly string[],
  fallback: SortSpec,
): SortSpec {
  const fields = (sort ?? '')
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);

  const unknown = fields
    .map((field) => field.replace(/^-/, ''))
    .filter((f) => !allowed.includes(f));
  if (unknown.length > 0) {
    throw new ValidationException([
      {
        field: 'sort',
        messages: [
          `Cannot sort by ${unknown.join(', ')}. Allowed fields: ${allowed.join(', ')}.`,
        ],
      },
    ]);
  }

  const spec: SortSpec =
    fields.length > 0
      ? Object.fromEntries(
          fields.map((field) =>
            field.startsWith('-')
              ? [field.slice(1), -1 as const]
              : [field, 1 as const],
          ),
        )
      : { ...fallback };

  return { ...spec, _id: spec._id ?? 1 };
}

/** Documents a `{ data: Model[], meta }` response for a list endpoint. */
export const ApiPaginatedResponse = <Model extends ClassType>(model: Model) =>
  applyDecorators(
    ApiExtraModels(PageMetaDto, model),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PageMetaDto) },
        },
      },
    }),
  );
