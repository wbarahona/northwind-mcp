import type { SortSpec } from '../common/pagination/sort-spec';
import { OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AddressDto, AddressInputDto } from '../common/dto/address.dto';
import { ContactDto, ContactInputDto } from '../common/dto/contact.dto';
import { SoftDeleteListQueryDto } from '../common/dto/soft-delete.dto';
import { ApiSort } from '../common/pagination/pagination.dto';
import { TimestampsDto } from '../common/dto/timestamps.dto';
import { IsE164Phone } from '../common/validation/validators';

export class CustomerDto extends TimestampsDto {
  /** @example 6955b900e22f34d03f125f61 */
  id: string;
  /** Five letters, e.g. the classic ALFKI. @example ALFKI */
  code: string;
  /** @example "Alfreds Futterkiste" */
  companyName: string;
  contact: ContactDto;
  address: AddressDto;
  /** @example +49300076545 */
  fax: string | null;
  /** Set when the customer was deleted; null while active. */
  deletedAt: Date | null;
}

export const CUSTOMER_SORT = {
  fields: ['code', 'companyName', 'address.city', 'address.country'],
  default: { code: 1 },
} satisfies { fields: readonly string[]; default: SortSpec };

export class ListCustomersQueryDto extends SoftDeleteListQueryDto {
  @ApiSort(CUSTOMER_SORT.fields, CUSTOMER_SORT.default)
  declare sort?: string;

  /** ISO code or English name, case-insensitive. @example DE */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  country?: string;

  /** Exact city, case-insensitive. @example Berlin */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  /** Full-text search on company and contact names. @example futterkiste */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CreateCustomerDto {
  /**
   * Five letters, unique. Optional: when omitted, one is derived from the company name
   * ("Blue Moon Bakery" → BLUMO), varying the last letters if it's taken.
   * @example BLUMO
   */
  @IsOptional()
  @Matches(/^[A-Za-z]{5}$/, {
    message: 'code must be exactly five letters, e.g. "BLUMO"',
  })
  code?: string;

  /** @example "Blue Moon Bakery" */
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

  /** E.164 format. @example +4930123456 */
  @IsOptional()
  @IsE164Phone()
  fax?: string | null;
}

/** Any subset of the create fields except the code, which never changes. `contact` and `address` are replaced as a whole. */
export class UpdateCustomerDto extends PartialType(
  OmitType(CreateCustomerDto, ['code'] as const),
) {}
