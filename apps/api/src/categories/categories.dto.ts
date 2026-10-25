import type { SortSpec } from '../common/pagination/sort-spec';
import { PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { TimestampsDto } from '../common/dto/timestamps.dto';
import {
  ApiSort,
  PaginationQueryDto,
} from '../common/pagination/pagination.dto';

export class CategoryDto extends TimestampsDto {
  /** @example 6955b900e22f34d03f125f66 */
  id: string;
  /** @example CAT-01 */
  code: string;
  /** Unique. @example Beverages */
  name: string;
  /** @example "Soft drinks, coffees, teas, beers, and ales" */
  description: string | null;
}

export const CATEGORY_SORT = {
  fields: ['code', 'name'],
  default: { code: 1 },
} satisfies { fields: readonly string[]; default: SortSpec };

export class ListCategoriesQueryDto extends PaginationQueryDto {
  @ApiSort(CATEGORY_SORT.fields, CATEGORY_SORT.default)
  declare sort?: string;

  /** Case-insensitive substring of the name or description. @example drink */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CreateCategoryDto {
  /** Must be unique. @example "Frozen Foods" */
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  /** @example "Ice cream, frozen vegetables and ready meals" */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}
