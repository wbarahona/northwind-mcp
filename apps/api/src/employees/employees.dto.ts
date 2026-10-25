import type { SortSpec } from '../common/pagination/sort-spec';
import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDate,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AddressDto, AddressInputDto } from '../common/dto/address.dto';
import { NamedRefDto } from '../common/dto/refs.dto';
import { SoftDeleteListQueryDto } from '../common/dto/soft-delete.dto';
import { ApiSort } from '../common/pagination/pagination.dto';
import { TimestampsDto } from '../common/dto/timestamps.dto';
import { IsE164Phone, IsIdOrCode } from '../common/validation/validators';

export class EmployeeTerritoryDto {
  /** @example 06897 */
  code: string;
  /** @example Wilton */
  name: string;
  /** @example REG-01 */
  regionCode: string;
}

export class EmployeeDto extends TimestampsDto {
  /** @example 6955b90069a57a9960a9fa42 */
  id: string;
  /** @example EMP-002 */
  code: string;
  /** @example Andrew */
  firstName: string;
  /** @example Fuller */
  lastName: string;
  /** @example "Vice President, Sales" */
  title: string | null;
  /** @example Dr. */
  titleOfCourtesy: string | null;
  /** @example andrew.fuller@northwind-traders.example */
  email: string | null;
  /** @example +12065559482 */
  phone: string | null;
  /** Office phone extension. @example 3457 */
  extension: string | null;
  /** Date of birth (UTC midnight). */
  birthDate: Date | null;
  /** Date the employee joined (UTC midnight). */
  hireDate: Date | null;
  address: AddressDto;
  /** Free-text biography. */
  notes: string | null;
  /** Manager; null for the head of sales. */
  reportsTo: NamedRefDto | null;
  /** Sales territories the employee covers. */
  // Explicit lazy type: the Swagger plugin's generated self-require of this file resolves too
  // early under Jest's module loader (Swagger then reports a circular dependency).
  @ApiProperty({ type: () => [EmployeeTerritoryDto] })
  territories: EmployeeTerritoryDto[];
  /** Set when the employee was deleted; null while active. */
  deletedAt: Date | null;
}

/** List items leave out the free-text notes. */
export class EmployeeSummaryDto extends OmitType(EmployeeDto, [
  'notes',
] as const) {}

export const EMPLOYEE_SORT = {
  fields: ['code', 'lastName', 'firstName', 'hireDate'],
  default: { code: 1 },
} satisfies { fields: readonly string[]; default: SortSpec };

export class ListEmployeesQueryDto extends SoftDeleteListQueryDto {
  @ApiSort(EMPLOYEE_SORT.fields, EMPLOYEE_SORT.default)
  declare sort?: string;

  /** Case-insensitive substring of the first or last name. @example dav */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Only direct reports of this manager (ObjectId or code). @example EMP-002 */
  @IsOptional()
  @IsIdOrCode()
  reportsToId?: string;

  /** Only employees covering this territory. @example 06897 */
  @IsOptional()
  @Matches(/^\d{5}$/, { message: 'territory must be a 5-digit territory code' })
  territory?: string;
}

export class CreateEmployeeDto {
  /** @example Laura */
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  firstName: string;

  /** @example Callahan */
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName: string;

  /** @example "Inside Sales Coordinator" */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string | null;

  /** @example Ms. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  titleOfCourtesy?: string | null;

  /** @example laura.callahan@northwind-traders.example */
  @IsOptional()
  @IsEmail()
  email?: string | null;

  /** E.164 format. @example +12065551189 */
  @IsOptional()
  @IsE164Phone()
  phone?: string | null;

  /** @example 2344 */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  extension?: string | null;

  /** ISO date. @example 1990-01-09 */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  birthDate?: Date | null;

  /** ISO date. @example 2024-03-05 */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  hireDate?: Date | null;

  @ValidateNested()
  @Type(() => AddressInputDto)
  address: AddressInputDto;

  /** Free-text biography. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  /** Manager (ObjectId or code); null for none. @example EMP-002 */
  @IsOptional()
  @IsIdOrCode()
  reportsToId?: string | null;

  /** Territory codes the employee covers (see listRegions). @example ["06897","19713"] */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Matches(/^\d{5}$/, {
    each: true,
    message: 'each territory code must be 5 digits',
  })
  territoryCodes?: string[];
}

/** Any subset of the create fields. `address` and `territoryCodes` are replaced as a whole. */
export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}

/** listEmployeeReports: the manager comes from the path. */
export class ListEmployeeReportsQueryDto extends OmitType(
  ListEmployeesQueryDto,
  ['reportsToId'] as const,
) {}
