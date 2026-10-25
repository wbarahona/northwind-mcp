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
  ListEmployeeOrdersQueryDto,
  OrderSummaryDto,
} from '../orders/orders.dto';
import { OrdersService } from '../orders/orders.service';
import {
  CreateEmployeeDto,
  EmployeeDto,
  EmployeeSummaryDto,
  ListEmployeeReportsQueryDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
} from './employees.dto';
import { EmployeesService } from './employees.service';

@ApiTags('employees')
@ApiProblemResponses(400, 401, 429)
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly orders: OrdersService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List employees',
    description:
      'Sales staff with manager and territories (notes left out). Filter by name (`q`), ' +
      'manager or territory. Deleted employees are hidden unless includeDeleted=true.',
  })
  @ApiPaginatedResponse(EmployeeSummaryDto)
  listEmployees(@Query() query: ListEmployeesQueryDto) {
    return this.employees.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get an employee by id or code, including notes',
    description:
      'Code like EMP-001 (any case) or the ObjectId. Also returns deleted employees (see deletedAt).',
  })
  @ApiIdOrCodeParam('EMP-001')
  @ApiOkResponse({ type: EmployeeDto })
  @ApiProblemResponses(404)
  getEmployee(@Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter) {
    return this.employees.get(filter);
  }

  @Get(':id/orders')
  @ApiOperation({
    summary: 'List the orders an employee took',
    description:
      'Newest first; same filters as listOrders, with the employee fixed by the path.',
  })
  @ApiIdOrCodeParam('EMP-001')
  @ApiPaginatedResponse(OrderSummaryDto)
  @ApiProblemResponses(404)
  async listEmployeeOrders(
    @Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter,
    @Query() query: ListEmployeeOrdersQueryDto,
  ) {
    const employee = await this.employees.get(filter);
    return this.orders.list({ ...query, employeeId: employee.code });
  }

  @Get(':id/reports')
  @ApiOperation({
    summary: "List an employee's direct reports",
    description:
      'Employees whose manager (reportsTo) is this employee. Same filters as listEmployees.',
  })
  @ApiIdOrCodeParam('EMP-002')
  @ApiPaginatedResponse(EmployeeSummaryDto)
  @ApiProblemResponses(404)
  async listEmployeeReports(
    @Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter,
    @Query() query: ListEmployeeReportsQueryDto,
  ) {
    const employee = await this.employees.get(filter);
    return this.employees.list({ ...query, reportsToId: employee.code });
  }

  @Post()
  @ApiOperation({
    summary: 'Hire an employee',
    description:
      'The next code is assigned automatically. reportsToId sets the manager; ' +
      'territoryCodes come from listRegions.',
  })
  @ApiCreatedResponse({ type: EmployeeDto })
  createEmployee(@Body() dto: CreateEmployeeDto) {
    return this.employees.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update an employee',
    description:
      'Send only the fields to change; address and territoryCodes are replaced as a whole. ' +
      'reportsToId: null removes the manager; reporting cycles are rejected. A new name is ' +
      'applied to pending orders and to direct reports.',
  })
  @ApiIdOrCodeParam('EMP-001')
  @ApiOkResponse({ type: EmployeeDto })
  @ApiProblemResponses(404, 409)
  updateEmployee(
    @Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(filter, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete an employee (soft)',
    description:
      'Sets deletedAt; refused (409) while active employees still report to them. The ' +
      'employee stays readable with their order history. Returns the employee.',
  })
  @ApiIdOrCodeParam('EMP-001')
  @ApiOkResponse({ type: EmployeeDto })
  @ApiProblemResponses(404, 409)
  deleteEmployee(@Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter) {
    return this.employees.remove(filter);
  }
}
