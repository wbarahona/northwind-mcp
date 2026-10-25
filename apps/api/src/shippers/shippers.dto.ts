import type { SortSpec } from '../common/pagination/sort-spec';
import { PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { SoftDeleteListQueryDto } from '../common/dto/soft-delete.dto';
import { ApiSort } from '../common/pagination/pagination.dto';
import { TimestampsDto } from '../common/dto/timestamps.dto';
import { IsE164Phone } from '../common/validation/validators';

export class ShipperDto extends TimestampsDto {
  /** @example 6955b900d8d4f8144e5aa27f */
  id: string;
  /** @example SHP-01 */
  code: string;
  /** @example "Speedy Express" */
  companyName: string;
  /** @example +15035559831 */
  phone: string | null;
  /** Set when the shipper was deleted; null while active. */
  deletedAt: Date | null;
}

export const SHIPPER_SORT = {
  fields: ['code', 'companyName'],
  default: { code: 1 },
} satisfies { fields: readonly string[]; default: SortSpec };

export class ListShippersQueryDto extends SoftDeleteListQueryDto {
  @ApiSort(SHIPPER_SORT.fields, SHIPPER_SORT.default)
  declare sort?: string;
}

export class CreateShipperDto {
  /** @example "Speedy Express" */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  companyName: string;

  /** E.164 format. @example +15035559831 */
  @IsOptional()
  @IsE164Phone()
  phone?: string | null;
}

export class UpdateShipperDto extends PartialType(CreateShipperDto) {}
