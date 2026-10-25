import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  type Counter,
  ModelName,
  nextCode,
  type Order,
  type Shipper,
} from '@northwind/db';
import type { Connection, Model } from 'mongoose';
import {
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
  CreateShipperDto,
  ListShippersQueryDto,
  UpdateShipperDto,
} from './shippers.dto';
import { SHIPPER_SORT } from './shippers.dto';

@Injectable()
export class ShippersService {
  constructor(
    @InjectModel(ModelName.Shipper) private readonly shippers: Model<Shipper>,
    @InjectModel(ModelName.Order) private readonly orders: Model<Order>,
    @InjectModel(ModelName.Counter) private readonly counters: Model<Counter>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  list(query: ListShippersQueryDto) {
    return findPage(this.shippers, activeFilter(query.includeDeleted), query, {
      sortable: SHIPPER_SORT.fields,
      defaultSort: SHIPPER_SORT.default,
    });
  }

  get(filter: IdOrCodeFilter) {
    return findOneOrFail(this.shippers, filter, 'Shipper');
  }

  async create(dto: CreateShipperDto) {
    const shipper = await this.shippers.create({
      ...dto,
      code: await nextCode(this.counters, 'shippers'),
    });
    return shipper.toObject();
  }

  async update(filter: IdOrCodeFilter, dto: UpdateShipperDto) {
    const shipper = await findDocumentOrFail(this.shippers, filter, 'Shipper');
    assertNotDeleted(shipper, 'Shipper');
    const renamed =
      dto.companyName !== undefined && dto.companyName !== shipper.companyName;
    shipper.set(dto);

    await this.connection.transaction(async (session) => {
      await shipper.save({ session });
      if (renamed) {
        await this.orders.updateMany(
          { status: 'pending', 'shipper._id': shipper._id },
          { $set: { 'shipper.companyName': shipper.companyName } },
          { session },
        );
      }
    });
    return shipper.toObject();
  }

  async remove(filter: IdOrCodeFilter) {
    return softDelete(
      await findDocumentOrFail(this.shippers, filter, 'Shipper'),
    );
  }
}
