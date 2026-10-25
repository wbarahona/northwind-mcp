import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
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
  ListCustomerOrdersQueryDto,
  OrderSummaryDto,
} from '../orders/orders.dto';
import { OrdersService } from '../orders/orders.service';
import {
  CreateCustomerDto,
  CustomerDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './customers.dto';
import { CustomersService } from './customers.service';

@ApiTags('customers')
@ApiProblemResponses(400, 401, 429)
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly orders: OrdersService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List customers',
    description:
      'Filter by country (ISO code or name) and city; `q` searches company and contact ' +
      'names. Deleted customers are hidden unless includeDeleted=true.',
  })
  @ApiPaginatedResponse(CustomerDto)
  listCustomers(@Query() query: ListCustomersQueryDto) {
    return this.customers.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a customer by id or code',
    description:
      'Also returns deleted customers (see deletedAt), since old orders reference them.',
  })
  @ApiIdOrCodeParam('ALFKI')
  @ApiOkResponse({ type: CustomerDto })
  @ApiProblemResponses(404)
  getCustomer(@Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter) {
    return this.customers.get(filter);
  }

  @Get(':id/orders')
  @ApiOperation({
    summary: "List a customer's orders",
    description:
      'Newest first; same filters as listOrders, with the customer fixed by the path.',
  })
  @ApiIdOrCodeParam('ALFKI')
  @ApiPaginatedResponse(OrderSummaryDto)
  @ApiProblemResponses(404)
  async listCustomerOrders(
    @Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter,
    @Query() query: ListCustomerOrdersQueryDto,
  ) {
    const customer = await this.customers.get(filter);
    return this.orders.list({ ...query, customerId: customer.code });
  }

  @Post()
  @ApiOperation({
    summary: 'Create a customer',
    description:
      'Send a five-letter code or let one be derived from the company name. The country ' +
      'name is filled in from address.countryCode. A code already in use returns 409.',
  })
  @ApiCreatedResponse({ type: CustomerDto })
  @ApiProblemResponses(409)
  createCustomer(@Body() dto: CreateCustomerDto) {
    return this.customers.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a customer',
    description:
      'Send only the fields to change; contact and address are replaced as a whole. A new ' +
      'company name is also applied to pending orders. Deleted customers return 409.',
  })
  @ApiIdOrCodeParam('ALFKI')
  @ApiOkResponse({ type: CustomerDto })
  @ApiProblemResponses(404, 409)
  updateCustomer(
    @Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.update(filter, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a customer (soft)',
    description:
      'Sets deletedAt: the customer leaves lists and can no longer place orders, but stays ' +
      'readable with its order history. Deleting again changes nothing. Returns the customer.',
  })
  @ApiIdOrCodeParam('ALFKI')
  @ApiOkResponse({ type: CustomerDto })
  @ApiProblemResponses(404)
  deleteCustomer(@Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter) {
    return this.customers.remove(filter);
  }
}
