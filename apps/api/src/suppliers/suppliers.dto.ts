import type { SortSpec } from '../common/pagination/sort-spec';
import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AddressDto, AddressInputDto } from '../common/dto/address.dto';
import { ContactDto, ContactInputDto } from '../common/dto/contact.dto';
import { SoftDeleteListQueryDto } from '../common/dto/soft-delete.dto';
import { ApiSort } from '../common/pagination/pagination.dto';
import { TimestampsDto } from '../common/dto/timestamps.dto';
import { IsE164Phone } from '../common/validation/validators';

export class SupplierDto extends TimestampsDto {
  /** @example 6955b900d8d4f8144e5aa27f */
  id: string;
  /** @example SUP-001 */
  code: string;
  /** @example "Exotic Liquids" */
  companyName: string;
  contact: ContactDto;
  address: AddressDto;
  /** E.164 where the number could be converted. */
  fax: string | null;
  /** @example https://exotic-liquids.example */
  homePage: string | null;
  /** Set when the supplier was deleted; null while active. */
  deletedAt: Date | null;
}

export const SUPPLIER_SORT = {
  fields: ['code', 'companyName', 'address.country'],
  default: { code: 1 },
} satisfies { fields: readonly string[]; default: SortSpec };

export class ListSuppliersQueryDto extends SoftDeleteListQueryDto {
  @ApiSort(SUPPLIER_SORT.fields, SUPPLIER_SORT.default)
  declare sort?: string;

  /** ISO code or English name, case-insensitive. @example JP */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  country?: string;

  /** Full-text search on company and contact names. @example liquids */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CreateSupplierDto {
  /** @example "Exotic Liquids" */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  companyName: string;

  @ValidateNested()
  @Type(() => ContactInputDto)
  contact: ContactInputDto;

  @ValidateNested()
  @Type(() => AddressInputDto)
  address: AddressInputDto;

  /** E.164 format. @example +441715552222 */
  @IsOptional()
  @IsE164Phone()
  fax?: string | null;

  /** @example https://exotic-liquids.example */
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  homePage?: string | null;
}

/** Any subset of the create fields. `contact` and `address` are replaced as a whole. */
export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}
