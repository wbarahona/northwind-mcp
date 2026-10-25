import type { SortSpec } from '../common/pagination/sort-spec';
import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDate,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ORDER_STATUSES } from '@northwind/db';
import { AddressDto, AddressInputDto } from '../common/dto/address.dto';
import { CompanyRefDto, NamedRefDto } from '../common/dto/refs.dto';
import { TimestampsDto } from '../common/dto/timestamps.dto';
import { ApiMoney } from '../common/openapi';
import {
  ApiSort,
  PaginationQueryDto,
} from '../common/pagination/pagination.dto';
import {
  IsDiscountRate,
  IsIdOrCode,
  IsMoneyAmount,
} from '../common/validation/validators';

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class ShipToDto extends AddressDto {
  /** Recipient, usually the customer's company name. @example "Vins et alcools Chevalier" */
  name: string;
}

export class OrderLineDto {
  product: NamedRefDto;
  /** Price per unit when the order was placed (not the current list price). */
  @ApiMoney('14.00')
  unitPrice: string;
  /** @example 12 */
  quantity: number;
  /** Rate between 0 and 1; "0.15" is 15% off. */
  @ApiProperty({ type: String, example: '0.15' })
  discount: string;
  /** unitPrice × quantity × (1 − discount), rounded to the cent. */
  @ApiMoney('142.80')
  lineTotal: string;
}

export class OrderTotalsDto {
  /** Sum of unitPrice × quantity, before discounts. */
  @ApiMoney('440.00')
  subtotal: string;
  /** Total discount given. */
  @ApiMoney('0.00')
  discount: string;
  /** subtotal − discount: the product revenue of the order. */
  @ApiMoney('440.00')
  net: string;
  @ApiMoney('32.38')
  freight: string;
  /** net + freight: what the customer pays. */
  @ApiMoney('472.38')
  total: string;
}

export class OrderDto extends TimestampsDto {
  /** @example 6955b9007f176b5b1a33c31c */
  id: string;
  /** @example ORD-10248 */
  code: string;
  customer: CompanyRefDto;
  /** The sales employee who took the order. */
  employee: NamedRefDto;
  /** Shipping company; set when the order ships if not chosen earlier. */
  shipper: CompanyRefDto | null;
  /** When the order was placed. */
  orderDate: Date;
  /** Date the customer needs the order by. */
  requiredDate: Date | null;
  /** Null until shipped. */
  shippedDate: Date | null;
  @ApiMoney('32.38')
  freight: string;
  shipTo: ShipToDto;
  // Explicit lazy type: the Swagger plugin's generated self-require of this file resolves too
  // early under Jest's module loader (Swagger then reports a circular dependency).
  @ApiProperty({
    type: () => [OrderLineDto],
    description: 'One line per product.',
  })
  lines: OrderLineDto[];
  totals: OrderTotalsDto;
  /** `pending` until shipped; only pending orders can be changed. */
  @ApiProperty({ enum: ORDER_STATUSES })
  status: 'pending' | 'shipped';
}

/** List items leave out the line items; fetch the order for them. */
export class OrderSummaryDto extends OmitType(OrderDto, ['lines'] as const) {}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// Several orders share a date; the code breaks ties so newest-first is predictable.
export const ORDER_SORT = {
  fields: ['code', 'orderDate', 'requiredDate', 'shippedDate', 'totals.total'],
  default: { orderDate: -1, code: -1 },
} satisfies { fields: readonly string[]; default: SortSpec };

export class ListOrdersQueryDto extends PaginationQueryDto {
  @ApiSort(ORDER_SORT.fields, ORDER_SORT.default)
  declare sort?: string;

  /** Customer ObjectId or code. @example VINET */
  @IsOptional()
  @IsIdOrCode()
  customerId?: string;

  /** Employee ObjectId or code. @example EMP-005 */
  @IsOptional()
  @IsIdOrCode()
  employeeId?: string;

  /** Shipper ObjectId or code. @example SHP-03 */
  @IsOptional()
  @IsIdOrCode()
  shipperId?: string;

  /** Only orders containing this product (ObjectId or code). @example PRD-011 */
  @IsOptional()
  @IsIdOrCode()
  productId?: string;

  @ApiPropertyOptional({
    enum: ORDER_STATUSES,
    description:
      'pending: not shipped yet (still editable); shipped: dispatched (read-only).',
  })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: 'pending' | 'shipped';

  /** Orders placed on or after this date (ISO). @example 2026-01-01 */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  /** Orders placed before this date (ISO, exclusive). @example 2026-04-01 */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export class ShipToInputDto extends AddressInputDto {
  /** @example "Vins et alcools Chevalier" */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

export class OrderLineInputDto {
  /** Product ObjectId or code. Its current price is used. @example PRD-011 */
  @IsIdOrCode()
  productId: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 10000, example: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  quantity: number;

  /** Rate between 0 and 1 (0.15 = 15% off). Defaults to 0. */
  @ApiPropertyOptional({ type: String, example: '0.15', default: '0' })
  @IsOptional()
  @IsDiscountRate()
  discount?: string;
}

export class CreateOrderDto {
  /** Customer ObjectId or code. @example VINET */
  @IsIdOrCode()
  customerId: string;

  /** Sales employee ObjectId or code. @example EMP-005 */
  @IsIdOrCode()
  employeeId: string;

  /** Shipper ObjectId or code; can also be chosen when shipping. @example SHP-03 */
  @IsOptional()
  @IsIdOrCode()
  shipperId?: string;

  /** Defaults to now. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  orderDate?: Date;

  /** Must not be before the order date. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  requiredDate?: Date;

  /** Defaults to "0.00". */
  @ApiPropertyOptional({ type: String, example: '32.38' })
  @IsOptional()
  @IsMoneyAmount()
  freight?: string;

  /** Defaults to the customer's name and address. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ShipToInputDto)
  shipTo?: ShipToInputDto;

  /** At least one line; each product once. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  lines: OrderLineInputDto[];
}

/** Changes to a pending order. Lines have their own endpoints. */
export class UpdateOrderDto extends PartialType(
  OmitType(CreateOrderDto, ['customerId', 'lines', 'orderDate'] as const),
) {}

export class ShipOrderDto {
  /** Required unless the order already has a shipper. @example SHP-03 */
  @IsOptional()
  @IsIdOrCode()
  shipperId?: string;

  /** Defaults to now; must not be before the order date. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  shippedDate?: Date;
}

export class UpdateOrderLineDto extends PartialType(
  OmitType(OrderLineInputDto, ['productId'] as const),
) {}

// ---------------------------------------------------------------------------
// Overdue orders
// ---------------------------------------------------------------------------

export const OVERDUE_KINDS = ['open', 'shipped-late', 'all'] as const;

export class OverdueOrdersQueryDto extends OmitType(PaginationQueryDto, [
  'sort',
] as const) {
  /** open: pending and past the required date; shipped-late: shipped after it; all: both. */
  @ApiPropertyOptional({ enum: OVERDUE_KINDS, default: 'open' })
  @IsOptional()
  @IsIn(OVERDUE_KINDS)
  kind: (typeof OVERDUE_KINDS)[number] = 'open';

  /** The date "overdue" is measured against (ISO); defaults to now. @example 2026-10-22 */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  asOf?: Date;
}

export class OverdueOrderDto extends OrderSummaryDto {
  /** Days past the required date: until shipment, or until `asOf` for open orders. */
  daysLate: number;
}

/** listCustomerOrders: the customer comes from the path. */
export class ListCustomerOrdersQueryDto extends OmitType(ListOrdersQueryDto, [
  'customerId',
] as const) {}

/** listEmployeeOrders: the employee comes from the path. */
export class ListEmployeeOrdersQueryDto extends OmitType(ListOrdersQueryDto, [
  'employeeId',
] as const) {}
