import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type Counter,
  type Customer,
  type Employee,
  ModelName,
  nextCode,
  type Order,
  type Product,
  type Shipper,
} from '@northwind/db';
import type { HydratedDocument, Model, QueryFilter } from 'mongoose';
import { toAddress } from '../common/crud/address';
import { aggregatePage } from '../common/crud/aggregate';
import {
  findDocumentOrFail,
  findOneOrFail,
  findPage,
  refFilter,
  resolveReference,
} from '../common/crud/crud';
import { ValidationException } from '../common/errors/validation.exception';
import {
  type IdOrCodeFilter,
  toIdOrCodeFilter,
} from '../common/ids/id-or-code';
import type {
  CreateOrderDto,
  ListOrdersQueryDto,
  OrderLineInputDto,
  OverdueOrdersQueryDto,
  ShipOrderDto,
  UpdateOrderDto,
  UpdateOrderLineDto,
} from './orders.dto';
import { ORDER_SORT } from './orders.dto';

type OrderDocument = HydratedDocument<Order>;

/**
 * Orders are always changed by load → modify → save(), so the schema recomputes line
 * totals, totals and status, and optimistic concurrency rejects conflicting edits (409).
 */
@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(ModelName.Order) private readonly orders: Model<Order>,
    @InjectModel(ModelName.Customer)
    private readonly customers: Model<Customer>,
    @InjectModel(ModelName.Employee)
    private readonly employees: Model<Employee>,
    @InjectModel(ModelName.Shipper) private readonly shippers: Model<Shipper>,
    @InjectModel(ModelName.Product) private readonly products: Model<Product>,
    @InjectModel(ModelName.Counter) private readonly counters: Model<Counter>,
  ) {}

  list(query: ListOrdersQueryDto) {
    const filter: QueryFilter<Order> = {};
    if (query.customerId)
      Object.assign(filter, refFilter('customer', query.customerId));
    if (query.employeeId)
      Object.assign(filter, refFilter('employee', query.employeeId));
    if (query.shipperId)
      Object.assign(filter, refFilter('shipper', query.shipperId));
    if (query.productId)
      Object.assign(filter, refFilter('lines.product', query.productId));
    if (query.status) filter.status = query.status;
    if (query.from || query.to) {
      filter.orderDate = {
        ...(query.from && { $gte: query.from }),
        ...(query.to && { $lt: query.to }),
      };
    }

    return findPage(this.orders, filter, query, {
      sortable: ORDER_SORT.fields,
      defaultSort: ORDER_SORT.default,
      projection: { lines: 0, __v: 0 },
    });
  }

  get(filter: IdOrCodeFilter) {
    return findOneOrFail(this.orders, filter, 'Order');
  }

  /** Orders past their required date, most overdue first, with the days late. */
  overdue(query: OverdueOrdersQueryDto) {
    const asOf = query.asOf ?? new Date();
    const open = { status: 'pending', requiredDate: { $ne: null, $lt: asOf } };
    const shippedLate = {
      status: 'shipped',
      requiredDate: { $ne: null },
      $expr: { $gt: ['$shippedDate', '$requiredDate'] },
    };
    const match =
      query.kind === 'open'
        ? open
        : query.kind === 'shipped-late'
          ? shippedLate
          : { $or: [open, shippedLate] };

    return aggregatePage(
      this.orders,
      [
        { $match: match },
        {
          $set: {
            daysLate: {
              $dateDiff: {
                startDate: '$requiredDate',
                endDate: { $ifNull: ['$shippedDate', asOf] },
                unit: 'day',
              },
            },
          },
        },
        { $sort: { daysLate: -1, code: 1 } },
        { $project: { lines: 0, __v: 0 } },
      ],
      query,
    );
  }

  async create(dto: CreateOrderDto) {
    const [customer, employee, shipper, lines] = await Promise.all([
      resolveReference(
        this.customers,
        dto.customerId,
        'customerId',
        'Customer',
      ),
      resolveReference(
        this.employees,
        dto.employeeId,
        'employeeId',
        'Employee',
      ),
      dto.shipperId ? this.shipperRef(dto.shipperId) : null,
      this.buildLines(dto.lines),
    ]);

    const orderDate = dto.orderDate ?? new Date();
    assertNotBefore(dto.requiredDate, orderDate, 'requiredDate');

    const order = await this.orders.create({
      code: await nextCode(this.counters, 'orders'),
      customer: {
        _id: customer._id,
        code: customer.code,
        companyName: customer.companyName,
      },
      employee: {
        _id: employee._id,
        code: employee.code,
        name: `${employee.firstName} ${employee.lastName}`,
      },
      shipper,
      orderDate,
      requiredDate: dto.requiredDate ?? null,
      freight: dto.freight ?? '0',
      shipTo: dto.shipTo
        ? { name: dto.shipTo.name, ...toAddress(dto.shipTo, 'shipTo') }
        : { name: customer.companyName, ...customer.address },
      lines,
    });
    return order.toObject();
  }

  async update(filter: IdOrCodeFilter, dto: UpdateOrderDto) {
    const order = await this.pendingOrder(filter);

    if (dto.employeeId) {
      const employee = await resolveReference(
        this.employees,
        dto.employeeId,
        'employeeId',
        'Employee',
      );
      order.employee = {
        _id: employee._id,
        code: employee.code,
        name: `${employee.firstName} ${employee.lastName}`,
      };
    }
    if (dto.shipperId) order.shipper = await this.shipperRef(dto.shipperId);
    if (dto.requiredDate) {
      assertNotBefore(dto.requiredDate, order.orderDate, 'requiredDate');
      order.requiredDate = dto.requiredDate;
    }
    if (dto.freight !== undefined) order.set('freight', dto.freight);
    if (dto.shipTo) {
      order.shipTo = {
        name: dto.shipTo.name,
        ...toAddress(dto.shipTo, 'shipTo'),
      };
    }

    await order.save();
    return order.toObject();
  }

  async ship(filter: IdOrCodeFilter, dto: ShipOrderDto) {
    const order = await this.pendingOrder(filter);

    if (dto.shipperId) order.shipper = await this.shipperRef(dto.shipperId);
    if (!order.shipper) {
      throw new ValidationException([
        {
          field: 'shipperId',
          messages: ['The order has no shipper yet; choose one to ship it.'],
        },
      ]);
    }
    const shippedDate = dto.shippedDate ?? new Date();
    assertNotBefore(shippedDate, order.orderDate, 'shippedDate');
    order.shippedDate = shippedDate;

    await order.save();
    return order.toObject();
  }

  async addLine(filter: IdOrCodeFilter, dto: OrderLineInputDto) {
    const order = await this.pendingOrder(filter);
    const [line] = await this.buildLines([dto], 'productId');
    if (
      order.lines.some((existing) =>
        existing.product._id.equals(line!.product._id),
      )
    ) {
      throw new ConflictException(
        `${line!.product.code} is already on ${order.code}; update that line instead.`,
      );
    }
    // set() casts through the line schema; lineTotal is computed by the pre-validate hook.
    order.set('lines', [...order.lines, line]);

    await order.save();
    return order.toObject();
  }

  async updateLine(
    filter: IdOrCodeFilter,
    product: string,
    dto: UpdateOrderLineDto,
  ) {
    const order = await this.pendingOrder(filter);
    const index = this.lineIndex(order, product);
    // Set through the order so the schema's setters (decimal normalization) apply.
    if (dto.quantity !== undefined)
      order.set(`lines.${index}.quantity`, dto.quantity);
    if (dto.discount !== undefined)
      order.set(`lines.${index}.discount`, dto.discount);

    await order.save();
    return order.toObject();
  }

  async removeLine(filter: IdOrCodeFilter, product: string) {
    const order = await this.pendingOrder(filter);
    const index = this.lineIndex(order, product);
    if (order.lines.length === 1) {
      throw new ConflictException(
        `That is the only line on ${order.code}; an order needs at least one.`,
      );
    }
    order.lines.splice(index, 1);

    await order.save();
    return order.toObject();
  }

  // -------------------------------------------------------------------------

  private async pendingOrder(filter: IdOrCodeFilter): Promise<OrderDocument> {
    const order = await findDocumentOrFail(this.orders, filter, 'Order');
    if (order.status !== 'pending') {
      throw new ConflictException(
        `Order ${order.code} was shipped on ${order.shippedDate?.toISOString().slice(0, 10)} ` +
          'and can no longer be changed.',
      );
    }
    return order;
  }

  private lineIndex(order: OrderDocument, product: string): number {
    const filter = toIdOrCodeFilter(product);
    const index = order.lines.findIndex((line) =>
      'code' in filter
        ? line.product.code === filter.code
        : line.product._id.equals(filter._id),
    );
    if (index === -1) {
      throw new NotFoundException(
        `Product "${product}" is not on order ${order.code}.`,
      );
    }
    return index;
  }

  private async shipperRef(idOrCode: string) {
    const shipper = await resolveReference(
      this.shippers,
      idOrCode,
      'shipperId',
      'Shipper',
    );
    return {
      _id: shipper._id,
      code: shipper.code,
      companyName: shipper.companyName,
    };
  }

  /**
   * Resolves products and copies their current price. Rejects unknown, discontinued and
   * repeated products, naming the offending line (`lines.2.productId`).
   */
  private async buildLines(inputs: OrderLineInputDto[], fieldPrefix = 'lines') {
    const field = (i: number) =>
      fieldPrefix === 'lines' ? `lines.${i}.productId` : fieldPrefix;

    const lines = await Promise.all(
      inputs.map(async (input, i) => {
        const product = await resolveReference(
          this.products,
          input.productId,
          field(i),
          'Product',
        );
        if (product.discontinued) {
          throw new ValidationException([
            {
              field: field(i),
              messages: [`${product.code} (${product.name}) is discontinued.`],
            },
          ]);
        }
        return {
          product: { _id: product._id, code: product.code, name: product.name },
          unitPrice: product.unitPrice,
          quantity: input.quantity,
          discount: input.discount ?? '0',
        };
      }),
    );

    const seen = new Map<string, number>();
    lines.forEach((line, i) => {
      const key = line.product._id.toHexString();
      const first = seen.get(key);
      if (first !== undefined) {
        throw new ValidationException([
          {
            field: field(i),
            messages: [
              `${line.product.code} is already on line ${first}; combine the quantities.`,
            ],
          },
        ]);
      }
      seen.set(key, i);
    });
    return lines;
  }
}

function assertNotBefore(
  date: Date | undefined,
  reference: Date,
  field: string,
): void {
  if (date && date < reference) {
    throw new ValidationException([
      {
        field,
        messages: [
          `${field} must not be before the order date (${reference.toISOString()}).`,
        ],
      },
    ]);
  }
}
