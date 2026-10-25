import type { SortSpec } from '../common/pagination/sort-spec';
import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { CompanyRefDto, NamedRefDto } from '../common/dto/refs.dto';
import { TimestampsDto } from '../common/dto/timestamps.dto';
import { ApiMoney } from '../common/openapi';
import {
  ApiSort,
  PaginationQueryDto,
} from '../common/pagination/pagination.dto';
import {
  IsIdOrCode,
  IsMoneyAmount,
  ToBoolean,
} from '../common/validation/validators';

export class ProductDto extends TimestampsDto {
  /** @example 6955b9007f176b5b1a33c31c */
  id: string;
  /** @example PRD-001 */
  code: string;
  /** @example Chai */
  name: string;
  category: NamedRefDto;
  supplier: CompanyRefDto;
  /** Free-text pack size. @example "10 boxes x 20 bags" */
  quantityPerUnit: string | null;
  /** Current list price. Orders keep the price they were placed at. */
  @ApiMoney('18.00')
  unitPrice: string;
  /** Units in the warehouse. Orders don't change it. */
  unitsInStock: number;
  /** Units ordered from the supplier but not received yet. */
  unitsOnOrder: number;
  /** Reorder when units in stock plus on order fall to this level. */
  reorderLevel: number;
  /** Discontinued products can't be added to orders. */
  discontinued: boolean;
}

export const PRODUCT_SORT = {
  fields: ['code', 'name', 'unitPrice', 'unitsInStock'],
  default: { code: 1 },
} satisfies { fields: readonly string[]; default: SortSpec };

export class ListProductsQueryDto extends PaginationQueryDto {
  @ApiSort(PRODUCT_SORT.fields, PRODUCT_SORT.default)
  declare sort?: string;

  /** Category ObjectId or code. @example CAT-01 */
  @IsOptional()
  @IsIdOrCode()
  categoryId?: string;

  /** Supplier ObjectId or code. @example SUP-001 */
  @IsOptional()
  @IsIdOrCode()
  supplierId?: string;

  /** Only discontinued (`true`) or only active (`false`) products. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  discontinued?: boolean;

  /** Lowest unit price, inclusive. @example 10.00 */
  @IsOptional()
  @IsMoneyAmount()
  minPrice?: string;

  /** Highest unit price, inclusive. @example 50.00 */
  @IsOptional()
  @IsMoneyAmount()
  maxPrice?: string;

  /** `true`: units in stock > 0; `false`: out of stock. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  inStock?: boolean;

  /** Full-text search on the product name. @example queso */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CreateProductDto {
  /** @example Chai */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** Category ObjectId or code. @example CAT-01 */
  @IsIdOrCode()
  categoryId: string;

  /** Supplier ObjectId or code. @example SUP-001 */
  @IsIdOrCode()
  supplierId: string;

  /** @example "10 boxes x 20 bags" */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  quantityPerUnit?: string | null;

  /** Decimal string (a JSON number is accepted). */
  @ApiMoney('18.00')
  @IsMoneyAmount()
  unitPrice: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    default: 0,
    description: 'Units in the warehouse.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitsInStock?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    default: 0,
    description: 'Units ordered from the supplier, not received yet.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitsOnOrder?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    default: 0,
    description:
      'Reorder when units in stock plus on order fall to this level.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  reorderLevel?: number;

  /** Discontinued products can't be added to orders. Defaults to false. */
  @IsOptional()
  @IsBoolean()
  discontinued?: boolean;
}

/** Any subset of the create fields. Price changes don't affect existing orders. */
export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class LowStockQueryDto extends OmitType(PaginationQueryDto, [
  'sort',
] as const) {}

export class LowStockProductDto extends ProductDto {
  /** reorderLevel − (unitsInStock + unitsOnOrder); 0 means exactly at the reorder level. */
  shortfall: number;
}

/** listCategoryProducts: the category comes from the path. */
export class ListCategoryProductsQueryDto extends OmitType(
  ListProductsQueryDto,
  ['categoryId'] as const,
) {}

/** listSupplierProducts: the supplier comes from the path. */
export class ListSupplierProductsQueryDto extends OmitType(
  ListProductsQueryDto,
  ['supplierId'] as const,
) {}
