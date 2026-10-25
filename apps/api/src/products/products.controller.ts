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
  CreateProductDto,
  ListProductsQueryDto,
  LowStockProductDto,
  LowStockQueryDto,
  ProductDto,
  UpdateProductDto,
} from './products.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiProblemResponses(400, 401, 429)
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({
    summary: 'List products',
    description:
      'Products with their category, supplier, current price and stock. Filter by category, ' +
      'supplier, price range, stock or discontinued status; `q` searches product names.',
  })
  @ApiPaginatedResponse(ProductDto)
  listProducts(@Query() query: ListProductsQueryDto) {
    return this.products.list(query);
  }

  @Get('low-stock')
  @ApiOperation({
    summary: 'Products that need reordering',
    description:
      'Active products whose units in stock plus units on order are at or below the reorder ' +
      'level, largest shortfall first.',
  })
  @ApiPaginatedResponse(LowStockProductDto)
  listLowStockProducts(@Query() query: LowStockQueryDto) {
    return this.products.lowStock(query);
  }

  // Declared after the fixed paths above so ':id' doesn't capture "low-stock".
  @Get(':id')
  @ApiOperation({
    summary: 'Get a product by id or code',
    description:
      'Code like PRD-001 (any case) or the ObjectId. Includes current price and stock.',
  })
  @ApiIdOrCodeParam('PRD-001')
  @ApiOkResponse({ type: ProductDto })
  @ApiProblemResponses(404)
  getProduct(@Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter) {
    return this.products.get(filter);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a product',
    description: 'The next code (PRD-078, …) is assigned automatically.',
  })
  @ApiCreatedResponse({ type: ProductDto })
  createProduct(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a product',
    description:
      'Send only the fields to change. A new name also updates pending orders; a new price ' +
      'applies to future orders only.',
  })
  @ApiIdOrCodeParam('PRD-001')
  @ApiOkResponse({ type: ProductDto })
  @ApiProblemResponses(404)
  updateProduct(
    @Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(filter, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a product',
    description:
      'Only for products that no order has used (409 otherwise). To retire a product that ' +
      'has sales, update it with "discontinued": true instead. Returns the deleted product.',
  })
  @ApiIdOrCodeParam('PRD-001')
  @ApiOkResponse({ type: ProductDto })
  @ApiProblemResponses(404, 409)
  deleteProduct(@Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter) {
    return this.products.remove(filter);
  }
}
