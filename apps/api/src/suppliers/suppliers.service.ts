import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  type Counter,
  ModelName,
  nextCode,
  type Product,
  type Supplier,
} from '@northwind/db';
import type { Connection, Model, QueryFilter } from 'mongoose';
import { toAddress } from '../common/crud/address';
import {
  countryFilter,
  findDocumentOrFail,
  findOneOrFail,
  findPage,
} from '../common/crud/crud';
import {
  activeFilter,
  assertNotDeleted,
  softDelete,
} from '../common/crud/soft-delete';
import type { IdOrCodeFilter } from '../common/ids/id-or-code';
import type {
  CreateSupplierDto,
  ListSuppliersQueryDto,
  UpdateSupplierDto,
} from './suppliers.dto';
import { SUPPLIER_SORT } from './suppliers.dto';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectModel(ModelName.Supplier)
    private readonly suppliers: Model<Supplier>,
    @InjectModel(ModelName.Product) private readonly products: Model<Product>,
    @InjectModel(ModelName.Counter) private readonly counters: Model<Counter>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  list(query: ListSuppliersQueryDto) {
    const filter: QueryFilter<Supplier> = {
      ...activeFilter(query.includeDeleted),
    };
    if (query.country)
      Object.assign(filter, countryFilter('address', query.country));
    if (query.q) filter.$text = { $search: query.q };

    return findPage(this.suppliers, filter, query, {
      sortable: SUPPLIER_SORT.fields,
      defaultSort: SUPPLIER_SORT.default,
    });
  }

  get(filter: IdOrCodeFilter) {
    return findOneOrFail(this.suppliers, filter, 'Supplier');
  }

  async create(dto: CreateSupplierDto) {
    const supplier = await this.suppliers.create({
      ...dto,
      code: await nextCode(this.counters, 'suppliers'),
      address: toAddress(dto.address),
    });
    return supplier.toObject();
  }

  async update(filter: IdOrCodeFilter, dto: UpdateSupplierDto) {
    const supplier = await findDocumentOrFail(
      this.suppliers,
      filter,
      'Supplier',
    );
    assertNotDeleted(supplier, 'Supplier');
    const renamed =
      dto.companyName !== undefined && dto.companyName !== supplier.companyName;
    supplier.set({
      ...dto,
      ...(dto.address && { address: toAddress(dto.address) }),
    });

    await this.connection.transaction(async (session) => {
      await supplier.save({ session });
      if (renamed) {
        await this.products.updateMany(
          { 'supplier._id': supplier._id },
          { $set: { 'supplier.companyName': supplier.companyName } },
          { session },
        );
      }
    });
    return supplier.toObject();
  }

  /** Soft delete. Its products stay listed; new products can't use the supplier. */
  async remove(filter: IdOrCodeFilter) {
    return softDelete(
      await findDocumentOrFail(this.suppliers, filter, 'Supplier'),
    );
  }
}
