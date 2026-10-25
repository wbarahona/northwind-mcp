import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  type Category,
  type Counter,
  ModelName,
  nextCode,
  type Product,
} from '@northwind/db';
import type { Connection, Model, QueryFilter } from 'mongoose';
import {
  containsInsensitive,
  describe,
  findDocumentOrFail,
  findOneOrFail,
  findPage,
} from '../common/crud/crud';
import type { IdOrCodeFilter } from '../common/ids/id-or-code';
import type {
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from './categories.dto';
import { CATEGORY_SORT } from './categories.dto';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(ModelName.Category)
    private readonly categories: Model<Category>,
    @InjectModel(ModelName.Product) private readonly products: Model<Product>,
    @InjectModel(ModelName.Counter) private readonly counters: Model<Counter>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  list(query: ListCategoriesQueryDto) {
    const filter: QueryFilter<Category> = query.q
      ? {
          $or: [
            { name: containsInsensitive(query.q) },
            { description: containsInsensitive(query.q) },
          ],
        }
      : {};
    return findPage(this.categories, filter, query, {
      sortable: CATEGORY_SORT.fields,
      defaultSort: CATEGORY_SORT.default,
    });
  }

  get(filter: IdOrCodeFilter) {
    return findOneOrFail(this.categories, filter, 'Category');
  }

  async create(dto: CreateCategoryDto) {
    const category = await this.categories.create({
      ...dto,
      code: await nextCode(this.counters, 'categories'),
    });
    return category.toObject();
  }

  async update(filter: IdOrCodeFilter, dto: UpdateCategoryDto) {
    const category = await findDocumentOrFail(
      this.categories,
      filter,
      'Category',
    );
    const renamed = dto.name !== undefined && dto.name !== category.name;
    category.set(dto);

    await this.connection.transaction(async (session) => {
      await category.save({ session });
      if (renamed) {
        await this.products.updateMany(
          { 'category._id': category._id },
          { $set: { 'category.name': category.name } },
          { session },
        );
      }
    });
    return category.toObject();
  }

  /** Hard delete, only when no product is in the category. */
  async remove(filter: IdOrCodeFilter) {
    const category = await findOneOrFail(this.categories, filter, 'Category');
    const inUse = await this.products.countDocuments({
      'category._id': category._id,
    });
    if (inUse > 0) {
      throw new ConflictException(
        `${describe('Category', filter)} still has ${inUse} product(s). ` +
          'Move them to another category first.',
      );
    }
    await this.categories.deleteOne({ _id: category._id });
    return category;
  }
}
