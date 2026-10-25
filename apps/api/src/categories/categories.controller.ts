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
  ListCategoryProductsQueryDto,
  ProductDto,
} from '../products/products.dto';
import { ProductsService } from '../products/products.service';
import {
  CategoryDto,
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from './categories.dto';
import { CategoriesService } from './categories.service';

@ApiTags('categories')
@ApiProblemResponses(400, 401, 429)
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly products: ProductsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List product categories',
    description:
      'All 8 classic categories (Beverages, Condiments, …) plus any added since.',
  })
  @ApiPaginatedResponse(CategoryDto)
  listCategories(@Query() query: ListCategoriesQueryDto) {
    return this.categories.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a category by id or code',
    description:
      'Code like CAT-01 (any case) or the ObjectId. Use listCategoryProducts for its products.',
  })
  @ApiIdOrCodeParam('CAT-01')
  @ApiOkResponse({ type: CategoryDto })
  @ApiProblemResponses(404)
  getCategory(@Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter) {
    return this.categories.get(filter);
  }

  @Get(':id/products')
  @ApiOperation({
    summary: 'List the products in a category',
    description:
      'Same filters as listProducts; the category is fixed by the path.',
  })
  @ApiIdOrCodeParam('CAT-01')
  @ApiPaginatedResponse(ProductDto)
  @ApiProblemResponses(404)
  async listCategoryProducts(
    @Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter,
    @Query() query: ListCategoryProductsQueryDto,
  ) {
    const category = await this.categories.get(filter);
    return this.products.list({ ...query, categoryId: category.code });
  }

  @Post()
  @ApiOperation({
    summary: 'Create a category',
    description: 'The next code is assigned automatically.',
  })
  @ApiCreatedResponse({ type: CategoryDto })
  @ApiProblemResponses(409)
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a category',
    description: 'A new name is also applied to every product in the category.',
  })
  @ApiIdOrCodeParam('CAT-01')
  @ApiOkResponse({ type: CategoryDto })
  @ApiProblemResponses(404, 409)
  updateCategory(
    @Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(filter, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete an empty category',
    description:
      'Fails with 409 while products are in it. Returns the deleted category.',
  })
  @ApiIdOrCodeParam('CAT-01')
  @ApiOkResponse({ type: CategoryDto })
  @ApiProblemResponses(404, 409)
  deleteCategory(@Param('id', ParseIdOrCodePipe) filter: IdOrCodeFilter) {
    return this.categories.remove(filter);
  }
}
