import type { SortSpec } from '../common/pagination/sort-spec';
import { ApiProperty } from '@nestjs/swagger';
import { TimestampsDto } from '../common/dto/timestamps.dto';
import {
  ApiSort,
  PaginationQueryDto,
} from '../common/pagination/pagination.dto';

export class TerritoryDto {
  /** @example 06897 */
  code: string;
  /** @example Wilton */
  name: string;
}

export class RegionDto extends TimestampsDto {
  /** @example 6955b900957e8b35aacec724 */
  id: string;
  /** @example REG-01 */
  code: string;
  /** @example Eastern */
  name: string;
  /** Sales territories in this region; employees are assigned to territories. */
  // Explicit lazy type: the Swagger plugin's generated self-require of this file resolves too
  // early under Jest's module loader (Swagger then reports a circular dependency).
  @ApiProperty({ type: () => [TerritoryDto] })
  territories: TerritoryDto[];
}

export const REGION_SORT = {
  fields: ['code', 'name'],
  default: { code: 1 },
} satisfies { fields: readonly string[]; default: SortSpec };

export class ListRegionsQueryDto extends PaginationQueryDto {
  @ApiSort(REGION_SORT.fields, REGION_SORT.default)
  declare sort?: string;
}
