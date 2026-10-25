import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  type Category,
  type Counter,
  ModelName,
  nextCode,
  type Order,
  type Product,
  type Supplier,
} from '@northwind/db';
import { type Connection, type Model, type QueryFilter, Types } from 'mongoose';
import {
  describe,
  findDocumentOrFail,
  findOneOrFail,
  findPage,
  refFilter,
  resolveReference,
} from '../common/crud/crud';
import { aggregatePage } from '../common/crud/aggregate';
import type { IdOrCodeFilter } from '../common/ids/id-or-code';
import type {
  CreateProductDto,
  ListProductsQueryDto,
  LowStockQueryDto,
  UpdateProductDto,
} from './products.dto';
import { PRODUCT_SORT } from './products.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(ModelName.Product) private readonly products: Model<Product>,
    @InjectModel(ModelName.Category)
    private readonly categories: Model<Category>,
    @InjectModel(ModelName.Supplier)
    private readonly suppliers: Model<Supplier>,
    @InjectModel(ModelName.Order) private readonly orders: Model<Order>,
    @InjectModel(ModelName.Counter) private readonly counters: Model<Counter>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  list(query: ListProductsQueryDto) {
    const filter: QueryFilter<Product> = {};
    if (query.categoryId)
      Object.assign(filter, refFilter('category', query.categoryId));
    if (query.supplierId)
      Object.assign(filter, refFilter('supplier', query.supplierId));
    if (query.discontinued !== undefined)
      filter.discontinued = query.discontinued;
    if (query.inStock !== undefined) {
      filter.unitsInStock = query.inStock ? { $gt: 0 } : 0;
    }
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      filter.unitPrice = {
        ...(query.minPrice !== undefined && { $gte: decimal(query.minPrice) }),
        ...(query.maxPrice !== undefined && { $lte: decimal(query.maxPrice) }),
      };
    }
    if (query.q) filter.$text = { $search: query.q };

    return findPage(this.products, filter, query, {
      sortable: PRODUCT_SORT.fields,
      defaultSort: PRODUCT_SORT.default,
    });
  }

  get(filter: IdOrCodeFilter) {
    return findOneOrFail(this.products, filter, 'Product');
  }

  /** Active products at or below their reorder level, counting units already on order. */
  lowStock(query: LowStockQueryDto) {
    const available = { $add: ['$unitsInStock', '$unitsOnOrder'] };
    return aggregatePage(
      this.products,
      [
        {
          $match: {
            discontinued: false,
            $expr: { $lte: [available, '$reorderLevel'] },
          },
        },
        { $set: { shortfall: { $subtract: ['$reorderLevel', available] } } },
        { $sort: { shortfall: -1, code: 1 } },
      ],
      query,
    );
  }

  async create(dto: CreateProductDto) {
    const { categoryId, supplierId, ...fields } = dto;
    const [category, supplier] = await Promise.all([
      resolveReference(this.categories, categoryId, 'categoryId', 'Category'),
      resolveReference(this.suppliers, supplierId, 'supplierId', 'Supplier'),
    ]);

    const product = await this.products.create({
      ...fields,
      code: await nextCode(this.counters, 'products'),
      category: { _id: category._id, code: category.code, name: category.name },
      supplier: {
        _id: supplier._id,
        code: supplier.code,
        companyName: supplier.companyName,
      },
    });
    return product.toObject();
  }

  async update(filter: IdOrCodeFilter, dto: UpdateProductDto) {
    const product = await findDocumentOrFail(this.products, filter, 'Product');
    const { categoryId, supplierId, ...fields } = dto;

    if (categoryId) {
      const category = await resolveReference(
        this.categories,
        categoryId,
        'categoryId',
        'Category',
      );
      product.category = {
        _id: category._id,
        code: category.code,
        name: category.name,
      };
    }
    if (supplierId) {
      const supplier = await resolveReference(
        this.suppliers,
        supplierId,
        'supplierId',
        'Supplier',
      );
      product.supplier = {
        _id: supplier._id,
        code: supplier.code,
        companyName: supplier.companyName,
      };
    }
    const renamed = fields.name !== undefined && fields.name !== product.name;
    product.set(fields);

    await this.connection.transaction(async (session) => {
      await product.save({ session });
      if (renamed) {
        // Keep copied names current on open orders; shipped orders keep their history.
        await this.orders.updateMany(
          { status: 'pending', 'lines.product._id': product._id },
          { $set: { 'lines.$[line].product.name': product.name } },
          { arrayFilters: [{ 'line.product._id': product._id }], session },
        );
      }
    });
    return product.toObject();
  }

  /** Hard delete, only for products no order has used; otherwise discontinue them. */
  async remove(filter: IdOrCodeFilter) {
    const product = await findOneOrFail(this.products, filter, 'Product');
    if (await this.orders.exists({ 'lines.product._id': product._id })) {
      throw new ConflictException(
        `${describe('Product', filter)} appears on orders and can't be deleted. ` +
          'Set "discontinued": true instead.',
      );
    }
    await this.products.deleteOne({ _id: product._id });
    return product;
  }
}

function decimal(value: string | number): Types.Decimal128 {
  return Types.Decimal128.fromString(String(value));
}
