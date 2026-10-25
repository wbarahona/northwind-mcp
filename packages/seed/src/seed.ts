import {
  type ModelName,
  type NorthwindModels,
  registerModels,
} from '@northwind/db';
import type { Connection } from 'mongoose';
import { utcToday } from './dates';
import { loadRawData, type RawData } from './raw';
import { transform, type TransformReport } from './transform';

/** Classic Northwind row counts; the seed fails if the database doesn't match. */
export const EXPECTED_COUNTS = {
  Category: 8,
  Counter: 7,
  Customer: 91,
  Employee: 9,
  Order: 830,
  Product: 77,
  Region: 4,
  Shipper: 3,
  Supplier: 29,
} as const satisfies Record<ModelName, number>;

/** Embedded rows: order lines, region territories, employee–territory assignments. */
export const EXPECTED_EMBEDDED_COUNTS = {
  orderLines: 2155,
  territories: 53,
  employeeTerritories: 49,
} as const;

export interface SeedOptions {
  /** The date the dataset is shifted towards (UTC midnight). Defaults to today. */
  anchor?: Date;
  /** Raw rows; defaults to the vendored data/raw files. */
  raw?: RawData;
}

export interface SeedResult extends TransformReport {
  anchor: Date;
  counts: Record<ModelName, number>;
  embeddedCounts: Record<keyof typeof EXPECTED_EMBEDDED_COUNTS, number>;
  durationMs: number;
}

/**
 * Idempotent: drops the Northwind collections, rebuilds their indexes, inserts the
 * transformed data through the shared schemas (so validation and order totals apply),
 * sets the code counters, then verifies the counts. Only touches Northwind collections.
 */
export async function seedDatabase(
  connection: Connection,
  options: SeedOptions = {},
): Promise<SeedResult> {
  const started = Date.now();
  const anchor = options.anchor ?? utcToday();
  const { documents, report } = transform(options.raw ?? loadRawData(), anchor);
  const models = registerModels(connection);
  const all = Object.values(models);

  // Let any automatic index builds from model registration finish before dropping.
  await Promise.all(all.map((model) => model.init()));
  await Promise.all(all.map((model) => dropIfExists(model)));
  // Indexes first, so unique constraints also guard the inserts.
  await Promise.all(all.map((model) => model.syncIndexes()));

  await models.Category.insertMany(documents.categories);
  await models.Shipper.insertMany(documents.shippers);
  await models.Supplier.insertMany(documents.suppliers);
  await models.Region.insertMany(documents.regions);
  await models.Customer.insertMany(documents.customers);
  await models.Employee.insertMany(documents.employees);
  await models.Product.insertMany(documents.products);
  await models.Order.insertMany(documents.orders);
  await models.Counter.insertMany(
    Object.entries(documents.counters).map(([_id, seq]) => ({ _id, seq })),
  );

  const { counts, embeddedCounts } = await verify(models);
  return {
    ...report,
    anchor,
    counts,
    embeddedCounts,
    durationMs: Date.now() - started,
  };
}

async function dropIfExists(model: NorthwindModels[ModelName]): Promise<void> {
  try {
    await model.collection.drop();
  } catch (error) {
    // 26 = NamespaceNotFound: the collection didn't exist yet.
    if ((error as { code?: number }).code !== 26) throw error;
  }
}

async function verify(models: NorthwindModels) {
  const counts = Object.fromEntries(
    await Promise.all(
      Object.entries(models).map(async ([name, model]) => [
        name,
        await model.estimatedDocumentCount(),
      ]),
    ),
  ) as Record<ModelName, number>;

  const sizeOf = async (
    model: NorthwindModels['Order' | 'Region' | 'Employee'],
    path: string,
  ) => {
    const [result] = await model.aggregate<{ n: number }>([
      { $group: { _id: null, n: { $sum: { $size: `$${path}` } } } },
    ]);
    return result?.n ?? 0;
  };
  const embeddedCounts = {
    orderLines: await sizeOf(models.Order, 'lines'),
    territories: await sizeOf(models.Region, 'territories'),
    employeeTerritories: await sizeOf(models.Employee, 'territories'),
  };

  const mismatches = [
    ...Object.entries(EXPECTED_COUNTS).map(([name, expected]) => [
      name,
      expected,
      counts[name as ModelName],
    ]),
    ...Object.entries(EXPECTED_EMBEDDED_COUNTS).map(([name, expected]) => [
      name,
      expected,
      embeddedCounts[name as keyof typeof embeddedCounts],
    ]),
  ].filter(([, expected, actual]) => expected !== actual);

  if (mismatches.length > 0) {
    throw new Error(
      `Seed verification failed:\n${mismatches
        .map(
          ([name, expected, actual]) =>
            `  - ${String(name)}: expected ${String(expected)}, got ${String(actual)}`,
        )
        .join('\n')}`,
    );
  }
  return { counts, embeddedCounts };
}
