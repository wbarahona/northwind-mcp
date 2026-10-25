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
  ListSupplierProductsQueryDto,
  ProductDto,
} from '../products/products.dto';
import { ProductsService } from '../products/products.service';
import {
  CreateSupplierDto,
  ListSuppliersQueryDto,
  SupplierDto,
  UpdateSupplierDto,
} from './suppliers.dto';
import { SuppliersService } from './suppliers.service';

@ApiTags('suppliers')
@ApiProblemResponses(400, 401, 429)
@Controller('suppliers')
export class SuppliersController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly products: ProductsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List suppliers',
    description:
      'Filter by country (ISO code or name); `q` searches company and contact names. ' +
      'Deleted suppliers are hidden unless includeDeleted=true.',
  })
  @ApiPaginatedResponse(SupplierDto)
  listSuppliers(@Query() query: ListSuppliersQueryDto) {
    return this.suppliers.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a supplier by id or code',
    description:
      'Code like SUP-001 (any case) or the ObjectId. Also returns deleted suppliers (see deletedAt).',
  })
  @ApiIdOrCodeParam('SUP-001')
  @ApiOkResponse({ type: SupplierDto })
  @ApiProblemResponses(404)
  getSupplier(@Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter) {
    return this.suppliers.get(filter);
  }

  @Get(':id/products')
  @ApiOperation({
    summary: 'List the products a supplier provides',
    description:
      'Same filters as listProducts, with the supplier fixed by the path.',
  })
  @ApiIdOrCodeParam('SUP-001')
  @ApiPaginatedResponse(ProductDto)
  @ApiProblemResponses(404)
  async listSupplierProducts(
    @Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter,
    @Query() query: ListSupplierProductsQueryDto,
  ) {
    const supplier = await this.suppliers.get(filter);
    return this.products.list({ ...query, supplierId: supplier.code });
  }

  @Post()
  @ApiOperation({
    summary: 'Create a supplier',
    description:
      'The next code is assigned automatically; the country name comes from address.countryCode.',
  })
  @ApiCreatedResponse({ type: SupplierDto })
  createSupplier(@Body() dto: CreateSupplierDto) {
    return this.suppliers.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a supplier',
    description:
      'Send only the fields to change; contact and address are replaced as a whole. A new ' +
      'company name is also applied to its products. Deleted suppliers return 409.',
  })
  @ApiIdOrCodeParam('SUP-001')
  @ApiOkResponse({ type: SupplierDto })
  @ApiProblemResponses(404, 409)
  updateSupplier(
    @Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliers.update(filter, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a supplier (soft)',
    description:
      'Sets deletedAt: hidden from lists and unusable for new products; its existing ' +
      'products are unchanged. Returns the supplier.',
  })
  @ApiIdOrCodeParam('SUP-001')
  @ApiOkResponse({ type: SupplierDto })
  @ApiProblemResponses(404)
  deleteSupplier(@Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter) {
    return this.suppliers.remove(filter);
  }
}
