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
  CreateShipperDto,
  ListShippersQueryDto,
  ShipperDto,
  UpdateShipperDto,
} from './shippers.dto';
import { ShippersService } from './shippers.service';

@ApiTags('shippers')
@ApiProblemResponses(400, 401, 429)
@Controller('shippers')
export class ShippersController {
  constructor(private readonly shippers: ShippersService) {}

  @Get()
  @ApiOperation({
    summary: 'List shipping companies',
    description: 'Deleted shippers are hidden unless includeDeleted=true.',
  })
  @ApiPaginatedResponse(ShipperDto)
  listShippers(@Query() query: ListShippersQueryDto) {
    return this.shippers.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a shipper by id or code',
    description:
      'Also returns deleted shippers (see deletedAt), since old orders reference them.',
  })
  @ApiIdOrCodeParam('SHP-01')
  @ApiOkResponse({ type: ShipperDto })
  @ApiProblemResponses(404)
  getShipper(@Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter) {
    return this.shippers.get(filter);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a shipper',
    description: 'The next code is assigned automatically.',
  })
  @ApiCreatedResponse({ type: ShipperDto })
  createShipper(@Body() dto: CreateShipperDto) {
    return this.shippers.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a shipper',
    description:
      'A new company name is also applied to pending orders. Deleted shippers return 409.',
  })
  @ApiIdOrCodeParam('SHP-01')
  @ApiOkResponse({ type: ShipperDto })
  @ApiProblemResponses(404, 409)
  updateShipper(
    @Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter,
    @Body() dto: UpdateShipperDto,
  ) {
    return this.shippers.update(filter, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a shipper (soft)',
    description:
      'Sets deletedAt; the shipper disappears from lists and can no longer be used on orders, ' +
      'but stays readable. Deleting again changes nothing. Returns the shipper.',
  })
  @ApiIdOrCodeParam('SHP-01')
  @ApiOkResponse({ type: ShipperDto })
  @ApiProblemResponses(404)
  deleteShipper(@Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter) {
    return this.shippers.remove(filter);
  }
}
