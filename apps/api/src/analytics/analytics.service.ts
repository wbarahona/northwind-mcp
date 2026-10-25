import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ModelName, type Order } from '@northwind/db';
import type { Model, PipelineStage, Types } from 'mongoose';
import { countryFilter, refFilter } from '../common/crud/crud';
import { ValidationException } from '../common/errors/validation.exception';
import { averageMoney, money, percentOf, sumMoney } from '../common/money';
import type {
  AnalyticsRangeQueryDto,
  SalesByProductQueryDto,
  SalesOverTimeQueryDto,
  TopCustomersQueryDto,
} from './analytics.dto';
import { nextPeriod, periodLabel, periodRange, periodStart } from './periods';

/** Upper bound on generated periods, e.g. a daily report over many years. */
const MAX_PERIODS = 1000;

type Decimal = Types.Decimal128;
interface Ref {
  _id: Types.ObjectId;
  code: string;
}

/**
 * Sales reports over orders. Revenue is always `totals.net`: product revenue after
 * discounts, without freight. Names come from the current product, customer, employee and
 * shipper records (shipped orders keep historical copies of names).
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(ModelName.Order) private readonly orders: Model<Order>,
  ) {}

  async salesOverTime(query: SalesOverTimeQueryDto) {
    const unit = query.granularity;
    const rows = await this.orders.aggregate<{
      _id: Date;
      revenue: Decimal;
      orders: number;
    }>([
      this.match(query),
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$orderDate',
              unit,
              startOfWeek: 'monday',
              timezone: 'UTC',
            },
          },
          revenue: { $sum: '$totals.net' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Fill gaps so every period in the range appears, with zeros where nothing sold.
    const first = query.from ?? rows[0]?._id;
    const last = query.to ? new Date(query.to.getTime() - 1) : rows.at(-1)?._id;
    if (!first || !last) return { range: this.range(query), data: [] };
    if (this.tooMany(first, last, unit)) {
      throw new ValidationException([
        {
          field: 'granularity',
          messages: [
            `More than ${MAX_PERIODS} periods; use a coarser granularity or a shorter range.`,
          ],
        },
      ]);
    }

    const byPeriod = new Map(rows.map((row) => [row._id.getTime(), row]));
    const data = periodRange(first, last, unit).map((start) => {
      const row = byPeriod.get(start.getTime());
      const revenue = row ? money(row.revenue) : '0.00';
      return {
        periodStart: start,
        label: periodLabel(start, unit),
        revenue,
        orders: row?.orders ?? 0,
        averageOrderValue: row ? averageMoney(revenue, row.orders) : '0.00',
      };
    });
    return { range: this.range(query), data };
  }

  async salesByCategory(query: AnalyticsRangeQueryDto) {
    const rows = await this.orders.aggregate<{
      category: Ref & { name: string };
      revenue: Decimal;
      units: number;
      orders: number;
    }>([
      this.match(query),
      { $unwind: '$lines' },
      // Per product first (77 rows), so the product lookup stays small.
      {
        $group: {
          _id: '$lines.product._id',
          revenue: { $sum: '$lines.lineTotal' },
          units: { $sum: '$lines.quantity' },
          orders: { $addToSet: '$_id' },
        },
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      {
        $group: {
          _id: '$product.category._id',
          category: { $first: '$product.category' },
          revenue: { $sum: '$revenue' },
          units: { $sum: '$units' },
          orderSets: { $push: '$orders' },
        },
      },
      {
        $project: {
          category: 1,
          revenue: 1,
          units: 1,
          orders: { $size: unionOf('$orderSets') },
        },
      },
      { $sort: { revenue: -1, 'category.code': 1 } },
    ]);

    const total = sumMoney(rows.map((row) => row.revenue));
    return {
      range: this.range(query),
      data: rows.map((row) => ({
        category: row.category,
        revenue: money(row.revenue),
        units: row.units,
        orders: row.orders,
        sharePercent: percentOf(money(row.revenue), total),
      })),
    };
  }

  async salesByProduct(query: SalesByProductQueryDto) {
    const sortKey = query.sortBy === 'units' ? 'units' : 'revenue';
    const rows = await this.orders.aggregate<{
      product: Ref & { name: string; category: Ref & { name: string } };
      revenue: Decimal;
      units: number;
      orders: number;
    }>([
      this.match(query),
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.product._id',
          revenue: { $sum: '$lines.lineTotal' },
          units: { $sum: '$lines.quantity' },
          orders: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      ...(query.categoryId
        ? [{ $match: refFilter('product.category', query.categoryId) }]
        : []),
      { $sort: { [sortKey]: -1, 'product.code': 1 } },
      { $limit: query.limit },
    ]);

    return {
      range: this.range(query),
      data: rows.map((row) => ({
        product: {
          _id: row.product._id,
          code: row.product.code,
          name: row.product.name,
        },
        category: row.product.category,
        revenue: money(row.revenue),
        units: row.units,
        orders: row.orders,
      })),
    };
  }

  async topCustomers(query: TopCustomersQueryDto) {
    const rows = await this.orders.aggregate<{
      customer: Ref & { companyName: string; address: { countryCode: string } };
      revenue: Decimal;
      orders: number;
      lastOrderDate: Date;
    }>([
      this.match(query),
      {
        $group: {
          _id: '$customer._id',
          revenue: { $sum: '$totals.net' },
          orders: { $sum: 1 },
          lastOrderDate: { $max: '$orderDate' },
        },
      },
      {
        $lookup: {
          from: 'customers',
          localField: '_id',
          foreignField: '_id',
          as: 'customer',
        },
      },
      { $unwind: '$customer' },
      ...(query.country
        ? [{ $match: countryFilter('customer.address', query.country) }]
        : []),
      { $sort: { revenue: -1, 'customer.code': 1 } },
      { $limit: query.limit },
    ]);

    return {
      range: this.range(query),
      data: rows.map((row) => {
        const revenue = money(row.revenue);
        return {
          customer: {
            _id: row.customer._id,
            code: row.customer.code,
            companyName: row.customer.companyName,
          },
          countryCode: row.customer.address.countryCode,
          revenue,
          orders: row.orders,
          averageOrderValue: averageMoney(revenue, row.orders),
          lastOrderDate: row.lastOrderDate,
        };
      }),
    };
  }

  async salesByEmployee(query: AnalyticsRangeQueryDto) {
    const rows = await this.orders.aggregate<{
      employee: Ref & {
        firstName: string;
        lastName: string;
        title: string | null;
      };
      revenue: Decimal;
      orders: number;
      customers: number;
    }>([
      this.match(query),
      {
        $group: {
          _id: '$employee._id',
          revenue: { $sum: '$totals.net' },
          orders: { $sum: 1 },
          customers: { $addToSet: '$customer._id' },
        },
      },
      {
        $lookup: {
          from: 'employees',
          localField: '_id',
          foreignField: '_id',
          as: 'employee',
        },
      },
      { $unwind: '$employee' },
      { $set: { customers: { $size: '$customers' } } },
      { $sort: { revenue: -1, 'employee.code': 1 } },
    ]);

    return {
      range: this.range(query),
      data: rows.map((row) => {
        const revenue = money(row.revenue);
        return {
          employee: {
            _id: row.employee._id,
            code: row.employee.code,
            name: `${row.employee.firstName} ${row.employee.lastName}`,
          },
          title: row.employee.title,
          revenue,
          orders: row.orders,
          averageOrderValue: averageMoney(revenue, row.orders),
          customers: row.customers,
        };
      }),
    };
  }

  async salesByCountry(query: AnalyticsRangeQueryDto) {
    const rows = await this.orders.aggregate<{
      _id: string;
      country: string;
      revenue: Decimal;
      orders: number;
      customers: number;
    }>([
      this.match(query),
      {
        $group: {
          _id: '$shipTo.countryCode',
          country: { $first: '$shipTo.country' },
          revenue: { $sum: '$totals.net' },
          orders: { $sum: 1 },
          customers: { $addToSet: '$customer._id' },
        },
      },
      { $set: { customers: { $size: '$customers' } } },
      { $sort: { revenue: -1, _id: 1 } },
    ]);

    const total = sumMoney(rows.map((row) => row.revenue));
    return {
      range: this.range(query),
      data: rows.map((row) => ({
        country: row.country,
        countryCode: row._id,
        revenue: money(row.revenue),
        orders: row.orders,
        customers: row.customers,
        sharePercent: percentOf(money(row.revenue), total),
      })),
    };
  }

  /** Shipped orders only: speed, lateness and freight per shipper. */
  async shippingPerformance(query: AnalyticsRangeQueryDto) {
    const rows = await this.orders.aggregate<{
      shipper: Ref & { companyName: string };
      shippedOrders: number;
      averageDaysToShip: number;
      lateShipments: number;
      totalFreight: Decimal;
      averageFreight: Decimal;
    }>([
      this.match(query),
      { $match: { status: 'shipped', shipper: { $ne: null } } },
      {
        $group: {
          _id: '$shipper._id',
          shippedOrders: { $sum: 1 },
          averageDaysToShip: {
            $avg: {
              $dateDiff: {
                startDate: '$orderDate',
                endDate: '$shippedDate',
                unit: 'day',
              },
            },
          },
          lateShipments: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$requiredDate', null] },
                    { $gt: ['$shippedDate', '$requiredDate'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalFreight: { $sum: '$totals.freight' },
          averageFreight: { $avg: '$totals.freight' },
        },
      },
      {
        $lookup: {
          from: 'shippers',
          localField: '_id',
          foreignField: '_id',
          as: 'shipper',
        },
      },
      { $unwind: '$shipper' },
      { $set: { averageFreight: { $round: ['$averageFreight', 2] } } },
      { $sort: { 'shipper.code': 1 } },
    ]);

    return {
      range: this.range(query),
      data: rows.map((row) => ({
        shipper: {
          _id: row.shipper._id,
          code: row.shipper.code,
          companyName: row.shipper.companyName,
        },
        shippedOrders: row.shippedOrders,
        averageDaysToShip: Math.round(row.averageDaysToShip * 10) / 10,
        lateShipments: row.lateShipments,
        onTimePercent:
          Math.round(
            ((row.shippedOrders - row.lateShipments) / row.shippedOrders) *
              1000,
          ) / 10,
        totalFreight: money(row.totalFreight),
        averageFreight: money(row.averageFreight),
      })),
    };
  }

  // -------------------------------------------------------------------------

  private match(query: AnalyticsRangeQueryDto): PipelineStage.Match {
    if (query.from && query.to && query.from >= query.to) {
      throw new ValidationException([
        { field: 'to', messages: ['to must be after from.'] },
      ]);
    }
    return {
      $match: {
        ...((query.from || query.to) && {
          orderDate: {
            ...(query.from && { $gte: query.from }),
            ...(query.to && { $lt: query.to }),
          },
        }),
        ...(query.status && { status: query.status }),
      },
    };
  }

  private range(query: AnalyticsRangeQueryDto) {
    return {
      from: query.from ?? null,
      to: query.to ?? null,
      status: query.status ?? null,
    };
  }

  private tooMany(
    first: Date,
    last: Date,
    unit: SalesOverTimeQueryDto['granularity'],
  ): boolean {
    let count = 0;
    for (let p = periodStart(first, unit); p <= last; p = nextPeriod(p, unit)) {
      if (++count > MAX_PERIODS) return true;
    }
    return false;
  }
}

/** Union of an array of arrays (for distinct counts across grouped sets). */
function unionOf(path: string) {
  return {
    $reduce: {
      input: path,
      initialValue: [],
      in: { $setUnion: ['$$value', '$$this'] },
    },
  };
}
