import { applyDecorators, type Type as ClassType } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { ORDER_STATUSES } from '@northwind/db';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CompanyRefDto, NamedRefDto } from '../common/dto/refs.dto';
import { ApiMoney } from '../common/openapi';
import { IsIdOrCode } from '../common/validation/validators';
import { GRANULARITIES, type Granularity } from './periods';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Which orders a report covers. Revenue = net product revenue (after discounts, without freight). */
export class AnalyticsRangeQueryDto {
  /** Orders placed on or after this date (ISO). Omit for no lower bound. @example 2026-01-01 */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  /** Orders placed before this date (ISO, exclusive). Omit for no upper bound. @example 2026-04-01 */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  /** Only pending or only shipped orders; omit for both. */
  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: 'pending' | 'shipped';
}

export class SalesOverTimeQueryDto extends AnalyticsRangeQueryDto {
  /** Period size; weeks start on Monday. */
  @ApiPropertyOptional({ enum: GRANULARITIES, default: 'month' })
  @IsOptional()
  @IsIn(GRANULARITIES)
  granularity: Granularity = 'month';
}

export class TopQueryDto extends AnalyticsRangeQueryDto {
  /** How many rows to return. */
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 100,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}

export class SalesByProductQueryDto extends TopQueryDto {
  /** Only products currently in this category (ObjectId or code). @example CAT-01 */
  @IsOptional()
  @IsIdOrCode()
  categoryId?: string;

  /** Rank by revenue or by units sold. */
  @ApiPropertyOptional({ enum: ['revenue', 'units'], default: 'revenue' })
  @IsOptional()
  @IsIn(['revenue', 'units'])
  sortBy: 'revenue' | 'units' = 'revenue';
}

export class TopCustomersQueryDto extends TopQueryDto {
  /** Only customers in this country (ISO code or English name). @example DE */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  country?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** The order-date range a report covers; null means unbounded. */
export class AnalyticsRangeDto {
  /** Inclusive lower bound on the order date; null = from the first order. */
  from: Date | null;
  /** Exclusive upper bound on the order date; null = up to the latest order. */
  to: Date | null;
  // null must be listed in the enum itself for validators to accept it (OpenAPI 3.0.3).
  @ApiProperty({
    enum: [...ORDER_STATUSES, null],
    nullable: true,
    description: 'Status filter applied; null = all orders.',
  })
  status: 'pending' | 'shipped' | null;
}

export class SalesPeriodDto {
  /** First day of the period (UTC). */
  periodStart: Date;
  /** @example 2026-03 */
  label: string;
  @ApiMoney('68883.91')
  revenue: string;
  /** Orders placed in the period. */
  orders: number;
  /** Revenue divided by orders; "0.00" for empty periods. */
  @ApiMoney('1861.73')
  averageOrderValue: string;
}

export class CategorySalesDto {
  category: NamedRefDto;
  @ApiMoney('267868.20')
  revenue: string;
  /** Units sold. */
  units: number;
  /** Orders with at least one product of the category. */
  orders: number;
  /** Share of the revenue of all categories, in percent. @example 21.16 */
  sharePercent: number;
}

export class ProductSalesDto {
  /** Current product name and category. */
  product: NamedRefDto;
  category: NamedRefDto;
  @ApiMoney('141396.74')
  revenue: string;
  /** Units sold. */
  units: number;
  /** Orders containing the product. */
  orders: number;
}

export class CustomerSalesDto {
  customer: CompanyRefDto;
  /** ISO 3166-1 alpha-2 code of the customer's address. @example DE */
  countryCode: string;
  @ApiMoney('110277.32')
  revenue: string;
  /** Orders placed in the range. */
  orders: number;
  @ApiMoney('3938.48')
  averageOrderValue: string;
  /** Most recent order date in the range. */
  lastOrderDate: Date;
}

export class EmployeeSalesDto {
  employee: NamedRefDto;
  /** Job title. @example "Sales Representative" */
  title: string | null;
  @ApiMoney('232890.89')
  revenue: string;
  /** Orders taken in the range. */
  orders: number;
  @ApiMoney('1492.89')
  averageOrderValue: string;
  /** Distinct customers served. */
  customers: number;
}

export class CountrySalesDto {
  /** Ship-to country. @example "United States" */
  country: string;
  /** @example US */
  countryCode: string;
  @ApiMoney('245584.65')
  revenue: string;
  /** Orders shipped to the country. */
  orders: number;
  /** Distinct customers ordering for the country. */
  customers: number;
  /** Share of total revenue, in percent. @example 19.4 */
  sharePercent: number;
}

export class ShipperPerformanceDto {
  shipper: CompanyRefDto;
  /** Shipped orders in the range. */
  shippedOrders: number;
  /** Average days from order to shipment. @example 8.6 */
  averageDaysToShip: number;
  /** Orders shipped after their required date. */
  lateShipments: number;
  /** Share shipped on or before the required date, in percent. @example 95.1 */
  onTimePercent: number;
  @ApiMoney('16035.16')
  totalFreight: string;
  @ApiMoney('65.45')
  averageFreight: string;
}

/** Documents a `{ range, data: Model[] }` analytics response. */
export const ApiAnalyticsResponse = <Model extends ClassType>(model: Model) =>
  applyDecorators(
    ApiExtraModels(AnalyticsRangeDto, model),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['range', 'data'],
        properties: {
          range: { $ref: getSchemaPath(AnalyticsRangeDto) },
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
        },
      },
    }),
  );
