import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** A postal address as returned by the API. */
export class AddressDto {
  /** @example "Obere Str. 57" */
  street: string;
  /** @example Berlin */
  city: string;
  /** State, province or region, where the country uses one. @example WA */
  region: string | null;
  /** @example 12209 */
  postalCode: string | null;
  /** English country name. @example Germany */
  country: string;
  /** ISO 3166-1 alpha-2 country code. @example DE */
  countryCode: string;
}

/** A postal address in a request. The country name is derived from `countryCode`. */
export class AddressInputDto {
  /** @example "Obere Str. 57" */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  street: string;

  /** @example Berlin */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;

  /** State, province or region, where the country uses one. @example WA */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string | null;

  /** @example 12209 */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string | null;

  /** ISO 3166-1 alpha-2 country code; the country name is filled in from it. */
  @ApiProperty({ example: 'DE', pattern: '^[A-Za-z]{2}$' })
  @Matches(/^[A-Za-z]{2}$/, {
    message: 'countryCode must be an ISO 3166-1 alpha-2 code such as "DE"',
  })
  countryCode: string;
}
