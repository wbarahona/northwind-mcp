import type { Connection, Model, Schema } from 'mongoose';
import { type Counter, CounterSchema } from './codes';
import { type Category, CategorySchema } from './schemas/category.schema';
import { type Customer, CustomerSchema } from './schemas/customer.schema';
import { type Employee, EmployeeSchema } from './schemas/employee.schema';
import { type Order, OrderSchema } from './schemas/order.schema';
import { type Product, ProductSchema } from './schemas/product.schema';
import { type Region, RegionSchema } from './schemas/region.schema';
import { type Shipper, ShipperSchema } from './schemas/shipper.schema';
import { type Supplier, SupplierSchema } from './schemas/supplier.schema';

/** Model names, as used with `@InjectModel(ModelName.Order)` and `connection.model()`. */
export const ModelName = {
  Category: 'Category',
  Counter: 'Counter',
  Customer: 'Customer',
  Employee: 'Employee',
  Order: 'Order',
  Product: 'Product',
  Region: 'Region',
  Shipper: 'Shipper',
  Supplier: 'Supplier',
} as const;

export type ModelName = (typeof ModelName)[keyof typeof ModelName];

/** Document type per model name. */
export interface ModelTypes {
  Category: Category;
  Counter: Counter;
  Customer: Customer;
  Employee: Employee;
  Order: Order;
  Product: Product;
  Region: Region;
  Shipper: Shipper;
  Supplier: Supplier;
}

export interface ModelDefinition {
  name: ModelName;
  schema: Schema;
}

/** Every model, in a shape `MongooseModule.forFeature()` accepts directly. */
export const MODEL_DEFINITIONS: readonly ModelDefinition[] = [
  { name: ModelName.Category, schema: CategorySchema },
  { name: ModelName.Counter, schema: CounterSchema },
  { name: ModelName.Customer, schema: CustomerSchema },
  { name: ModelName.Employee, schema: EmployeeSchema },
  { name: ModelName.Order, schema: OrderSchema },
  { name: ModelName.Product, schema: ProductSchema },
  { name: ModelName.Region, schema: RegionSchema },
  { name: ModelName.Shipper, schema: ShipperSchema },
  { name: ModelName.Supplier, schema: SupplierSchema },
];

export type NorthwindModels = { [K in ModelName]: Model<ModelTypes[K]> };

/** Registers every model on a connection (outside Nest, e.g. in the seed). Idempotent. */
export function registerModels(connection: Connection): NorthwindModels {
  const entries = MODEL_DEFINITIONS.map(({ name, schema }) => [
    name,
    connection.models[name] ?? connection.model(name, schema),
  ]);
  return Object.fromEntries(entries) as NorthwindModels;
}
