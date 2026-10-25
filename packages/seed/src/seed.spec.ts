import { nextCode, registerModels } from '@northwind/db';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Connection } from 'mongoose';
import { parseIsoDate } from './dates';
import { seedObjectId } from './ids';
import { loadRawData } from './raw';
import { seedDatabase } from './seed';

describe('seedDatabase (integration)', () => {
  let mongo: MongoMemoryReplSet;
  let connection: Connection;
  const anchor = parseIsoDate('2026-10-22');

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    connection = await mongoose
      .createConnection(mongo.getUri('northwind-seed-test'), {
        autoIndex: false,
      })
      .asPromise();
  });

  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
  });

  it('loads and verifies every collection', async () => {
    const result = await seedDatabase(connection, { anchor });

    expect(result.counts).toEqual({
      Category: 8,
      Counter: 7,
      Customer: 91,
      Employee: 9,
      Order: 830,
      Product: 77,
      Region: 4,
      Shipper: 3,
      Supplier: 29,
    });
    expect(result.embeddedCounts).toEqual({
      orderLines: 2155,
      territories: 53,
      employeeTerritories: 49,
    });
  });

  it('computes order totals through the shared schema', async () => {
    const { Order } = registerModels(connection);
    const order = await Order.findOne({ code: 'ORD-10248' }).orFail();

    expect(order.totals.subtotal.toString()).toBe('440.00');
    expect(order.totals.total.toString()).toBe('472.38');
    expect(order.status).toBe('shipped');
  });

  it('matches classic Northwind sales totals', async () => {
    const { Order } = registerModels(connection);
    const [sums] = await Order.aggregate<{ subtotal: unknown; net: unknown }>([
      {
        $group: {
          _id: null,
          subtotal: { $sum: '$totals.subtotal' },
          net: { $sum: '$totals.net' },
        },
      },
    ]);

    // Gross sales: exactly the classic figure.
    expect(String(sums?.subtotal)).toBe('1354458.59');
    // Net sales: 0.25 above the often-quoted 1,265,793.04, because each line is
    // rounded to the cent here while that figure rounds only the grand total.
    expect(String(sums?.net)).toBe('1265793.29');
  });

  it('is idempotent and keeps ids stable across reseeds', async () => {
    const { Customer } = registerModels(connection);
    const before = await Customer.findOne({ code: 'ALFKI' }).orFail();

    const result = await seedDatabase(connection, { anchor });
    const after = await Customer.findOne({ code: 'ALFKI' }).orFail();

    expect(result.counts.Customer).toBe(91);
    expect(after._id).toEqual(before._id);
    expect(after._id).toEqual(seedObjectId('customers', 'ALFKI'));
  });

  it('continues code sequences after the legacy numbers', async () => {
    const { Counter } = registerModels(connection);

    expect(await nextCode(Counter, 'orders')).toBe('ORD-11078');
    expect(await nextCode(Counter, 'products')).toBe('PRD-078');
  });

  it('fails on inconsistent source data instead of loading it', async () => {
    const raw = loadRawData();
    raw.orders[0] = { ...raw.orders[0]!, CustomerID: 'NOONE' };

    await expect(seedDatabase(connection, { anchor, raw })).rejects.toThrow(
      /Missing customer NOONE/,
    );
  });
});
