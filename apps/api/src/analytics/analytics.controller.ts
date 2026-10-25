import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponses } from '../common/openapi';
import {
  AnalyticsRangeQueryDto,
  ApiAnalyticsResponse,
  CategorySalesDto,
  CountrySalesDto,
  CustomerSalesDto,
  EmployeeSalesDto,
  ProductSalesDto,
  SalesByProductQueryDto,
  SalesOverTimeQueryDto,
  SalesPeriodDto,
  ShipperPerformanceDto,
  TopCustomersQueryDto,
} from './analytics.dto';
import { AnalyticsService } from './analytics.service';

const REVENUE =
  'Revenue is net product revenue (after line discounts, without freight) of orders placed ' +
  'in [from, to); both bounds are optional and echoed back in `range`.';

@ApiTags('analytics')
@ApiProblemResponses(400, 401, 429)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('sales-over-time')
  @ApiOperation({
    summary: 'Revenue and order count per day, week, month, quarter or year',
    description: `${REVENUE} Every period in the range is listed, with zeros where nothing sold. Weeks start on Monday (ISO).`,
  })
  @ApiAnalyticsResponse(SalesPeriodDto)
  salesOverTime(@Query() query: SalesOverTimeQueryDto) {
    return this.analytics.salesOverTime(query);
  }

  @Get('sales-by-category')
  @ApiOperation({
    summary: 'Revenue per product category, with its share of the total',
    description: `${REVENUE} Products count towards their current category. Sorted by revenue.`,
  })
  @ApiAnalyticsResponse(CategorySalesDto)
  salesByCategory(@Query() query: AnalyticsRangeQueryDto) {
    return this.analytics.salesByCategory(query);
  }

  @Get('sales-by-product')
  @ApiOperation({
    summary: 'Best-selling products by revenue or units',
    description: `${REVENUE} Optionally limited to one category. Returns the top \`limit\` (default 10).`,
  })
  @ApiAnalyticsResponse(ProductSalesDto)
  salesByProduct(@Query() query: SalesByProductQueryDto) {
    return this.analytics.salesByProduct(query);
  }

  @Get('top-customers')
  @ApiOperation({
    summary: 'Customers ranked by revenue',
    description: `${REVENUE} Optionally limited to customers in one country. Includes order count, average order value and last order date.`,
  })
  @ApiAnalyticsResponse(CustomerSalesDto)
  topCustomers(@Query() query: TopCustomersQueryDto) {
    return this.analytics.topCustomers(query);
  }

  @Get('sales-by-employee')
  @ApiOperation({
    summary: 'Sales performance per employee',
    description: `${REVENUE} Revenue, orders, average order value and distinct customers per sales employee.`,
  })
  @ApiAnalyticsResponse(EmployeeSalesDto)
  salesByEmployee(@Query() query: AnalyticsRangeQueryDto) {
    return this.analytics.salesByEmployee(query);
  }

  @Get('sales-by-country')
  @ApiOperation({
    summary: 'Revenue per ship-to country, with its share of the total',
    description: `${REVENUE} Grouped by where orders were shipped to.`,
  })
  @ApiAnalyticsResponse(CountrySalesDto)
  salesByCountry(@Query() query: AnalyticsRangeQueryDto) {
    return this.analytics.salesByCountry(query);
  }

  @Get('shipping-performance')
  @ApiOperation({
    summary: 'Shipping speed, lateness and freight per shipper',
    description:
      'Shipped orders placed in [from, to): average days from order to shipment, shipments ' +
      'after the required date, on-time percentage and freight.',
  })
  @ApiAnalyticsResponse(ShipperPerformanceDto)
  shippingPerformance(@Query() query: AnalyticsRangeQueryDto) {
    return this.analytics.shippingPerformance(query);
  }
}
