import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { type Customer, ModelName, type Order } from '@northwind/db';
import type { Connection, Model, QueryFilter } from 'mongoose';
import { toAddress } from '../common/crud/address';
import {
  countryFilter,
  exactInsensitive,
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
import { customerCodeCandidates } from './customer-code';
import type {
  CreateCustomerDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './customers.dto';
import { CUSTOMER_SORT } from './customers.dto';

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(ModelName.Customer)
    private readonly customers: Model<Customer>,
    @InjectModel(ModelName.Order) private readonly orders: Model<Order>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  list(query: ListCustomersQueryDto) {
    const filter: QueryFilter<Customer> = {
      ...activeFilter(query.includeDeleted),
    };
    if (query.country)
      Object.assign(filter, countryFilter('address', query.country));
    if (query.city) filter['address.city'] = exactInsensitive(query.city);
    if (query.q) filter.$text = { $search: query.q };

    return findPage(this.customers, filter, query, {
      sortable: CUSTOMER_SORT.fields,
      defaultSort: CUSTOMER_SORT.default,
    });
  }

  get(filter: IdOrCodeFilter) {
    return findOneOrFail(this.customers, filter, 'Customer');
  }

  async create(dto: CreateCustomerDto) {
    const customer = await this.customers.create({
      ...dto,
      code: dto.code?.toUpperCase() ?? (await this.freeCode(dto.companyName)),
      address: toAddress(dto.address),
    });
    return customer.toObject();
  }

  async update(filter: IdOrCodeFilter, dto: UpdateCustomerDto) {
    const customer = await findDocumentOrFail(
      this.customers,
      filter,
      'Customer',
    );
    assertNotDeleted(customer, 'Customer');
    const renamed =
      dto.companyName !== undefined && dto.companyName !== customer.companyName;
    customer.set({
      ...dto,
      ...(dto.address && { address: toAddress(dto.address) }),
    });

    await this.connection.transaction(async (session) => {
      await customer.save({ session });
      if (renamed) {
        await this.orders.updateMany(
          { status: 'pending', 'customer._id': customer._id },
          { $set: { 'customer.companyName': customer.companyName } },
          { session },
        );
      }
    });
    return customer.toObject();
  }

  async remove(filter: IdOrCodeFilter) {
    return softDelete(
      await findDocumentOrFail(this.customers, filter, 'Customer'),
    );
  }

  /** First derived code that isn't taken (deleted customers keep theirs). */
  private async freeCode(companyName: string): Promise<string> {
    const candidates = [...customerCodeCandidates(companyName)];
    const taken = new Set(
      (
        await this.customers
          .find({ code: { $in: candidates } }, { code: 1 })
          .lean()
      ).map((c) => c.code),
    );
    const code = candidates.find((candidate) => !taken.has(candidate));
    if (!code) {
      throw new ConflictException(
        `No free customer code could be derived from "${companyName}"; send one in "code".`,
      );
    }
    return code;
  }
}
