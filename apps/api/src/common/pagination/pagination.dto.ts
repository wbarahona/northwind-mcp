import { ApiPropertyOptional } from '@nestjs/swagger';
import type { SortSpec } from './sort-spec';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const MAX_PAGE_SIZE = 100;

/**
 * Shared list query params. Resource list DTOs extend this with their own filters.
 * `page` and `limit` have defaults, so they're documented as optional despite the non-optional types.
 */
export class PaginationQueryDto {
  /** 1-based page number. */
  @ApiPropertyOptional({ type: 'integer' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** Items per page. */
  @ApiPropertyOptional({ type: 'integer' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = 20;

  /**
   * Comma-separated sort fields; prefix a field with `-` for descending.
   * @example -orderDate,code
   */
  @IsOptional()
  @IsString()
  sort?: string;
}

export class PageMetaDto {
  /** The page returned (1-based). */
  page: number;
  /** Page size used. */
  limit: number;
  /** Total matching items across all pages. */
  total: number;
  /** Number of pages at this page size; request page+1 while page < totalPages. */
  totalPages: number;
}

/**
 * Documents a list's `sort` parameter with the fields it accepts. Put it on a redeclared
 * `sort?: string` in the list DTO; validation is inherited from PaginationQueryDto.
 */
export function ApiSort(
  fields: readonly string[],
  defaultSort: SortSpec,
): PropertyDecorator {
  const describe = (spec: SortSpec) =>
    Object.entries(spec)
      .map(([field, dir]) => (dir === -1 ? `-${field}` : field))
      .join(',');
  return ApiPropertyOptional({
    description:
      `Comma-separated fields; prefix with - for descending. Allowed: ${fields.join(', ')}. ` +
      `Default: ${describe(defaultSort)}.`,
    example: `-${fields[1] ?? fields[0]}`,
  });
}
