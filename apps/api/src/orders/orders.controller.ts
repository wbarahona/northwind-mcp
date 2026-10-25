import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiIdOrCodeParam,
  type IdOrCodeFilter,
  ParseIdOrCodePipe,
} from '../common/ids/id-or-code';
import { ApiProblemResponses } from '../common/openapi';
import { ApiPaginatedResponse } from '../common/pagination/pagination';
import {
  CreateOrderDto,
  ListOrdersQueryDto,
  OrderDto,
  OrderLineInputDto,
  OrderSummaryDto,
  OverdueOrderDto,
  OverdueOrdersQueryDto,
  ShipOrderDto,
  UpdateOrderDto,
  UpdateOrderLineDto,
} from './orders.dto';
import { OrdersService } from './orders.service';

const ApiProductParam = () =>
  ApiParam({
    name: 'productId',
    description:
      'Product on the order, by ObjectId or code (case-insensitive).',
    example: 'PRD-011',
  });

@ApiTags('orders')
@ApiProblemResponses(400, 401, 429)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({
    summary: 'List orders',
    description:
      'Newest first. Filter by customer, employee, shipper, product, status and order-date ' +
      'range (`from` inclusive, `to` exclusive). Items include totals but not line items; ' +
      'use getOrder for those.',
  })
  @ApiPaginatedResponse(OrderSummaryDto)
  listOrders(@Query() query: ListOrdersQueryDto) {
    return this.orders.list(query);
  }

  @Get('overdue')
  @ApiOperation({
    summary: 'Orders past their required date',
    description:
      'kind=open (default): pending orders whose required date has passed, as of `asOf` ' +
      '(default now). kind=shipped-late: orders shipped after their required date. ' +
      'Most overdue first, with daysLate.',
  })
  @ApiPaginatedResponse(OverdueOrderDto)
  listOverdueOrders(@Query() query: OverdueOrdersQueryDto) {
    return this.orders.overdue(query);
  }

  // Declared after the fixed paths above so ':id' doesn't capture "overdue".
  @Get(':id')
  @ApiOperation({
    summary: 'Get an order with its line items',
    description:
      'Includes each line (product, price at sale, quantity, discount) and the totals.',
  })
  @ApiIdOrCodeParam('ORD-10248')
  @ApiOkResponse({ type: OrderDto })
  @ApiProblemResponses(404)
  getOrder(@Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter) {
    return this.orders.get(filter);
  }

  @Post()
  @ApiOperation({
    summary: 'Place an order',
    description:
      "Each line uses the product's current price; discontinued products are rejected. " +
      "shipTo defaults to the customer's address. Totals are calculated. Product stock is " +
      'not changed.',
  })
  @ApiCreatedResponse({ type: OrderDto })
  createOrder(@Body() dto: CreateOrderDto) {
    return this.orders.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a pending order',
    description:
      'Change the employee, shipper, required date, freight or ship-to address. Shipped ' +
      'orders return 409. Use the line endpoints to change products.',
  })
  @ApiIdOrCodeParam('ORD-11077')
  @ApiOkResponse({ type: OrderDto })
  @ApiProblemResponses(404, 409)
  updateOrder(
    @Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.orders.update(filter, dto);
  }

  @Post(':id/ship')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark a pending order as shipped',
    description:
      'Sets shippedDate (default now) and the shipper (required if the order has none). ' +
      'The order is read-only afterwards.',
  })
  @ApiIdOrCodeParam('ORD-11077')
  @ApiOkResponse({ type: OrderDto })
  @ApiProblemResponses(404, 409)
  shipOrder(
    @Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter,
    @Body() dto: ShipOrderDto,
  ) {
    return this.orders.ship(filter, dto);
  }

  @Post(':id/lines')
  @ApiOperation({
    summary: 'Add a product to a pending order',
    description:
      "Uses the product's current price. A product already on the order returns 409; " +
      'update that line instead. Returns the whole order.',
  })
  @ApiIdOrCodeParam('ORD-11077')
  @ApiCreatedResponse({ type: OrderDto })
  @ApiProblemResponses(404, 409)
  addOrderLine(
    @Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter,
    @Body() dto: OrderLineInputDto,
  ) {
    return this.orders.addLine(filter, dto);
  }

  @Patch(':id/lines/:productId')
  @ApiOperation({
    summary: 'Change the quantity or discount of a line',
    description:
      'The price stays as when the line was added. Returns the whole order.',
  })
  @ApiIdOrCodeParam('ORD-11077')
  @ApiProductParam()
  @ApiOkResponse({ type: OrderDto })
  @ApiProblemResponses(404, 409)
  updateOrderLine(
    @Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter,
    @Param('productId') productId: string,
    @Body() dto: UpdateOrderLineDto,
  ) {
    return this.orders.updateLine(filter, productId, dto);
  }

  @Delete(':id/lines/:productId')
  @ApiOperation({
    summary: 'Remove a product from a pending order',
    description:
      "The last line can't be removed (409). Returns the whole order.",
  })
  @ApiIdOrCodeParam('ORD-11077')
  @ApiProductParam()
  @ApiOkResponse({ type: OrderDto })
  @ApiProblemResponses(404, 409)
  removeOrderLine(
    @Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter,
    @Param('productId') productId: string,
  ) {
    return this.orders.removeLine(filter, productId);
  }
}
