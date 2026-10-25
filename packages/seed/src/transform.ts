import {
  type Address,
  type Category,
  type CodeSequence,
  type Customer,
  type Employee,
  formatCode,
  type Order,
  type OrderLine,
  type Product,
  type Region,
  type Shipper,
  type Supplier,
} from '@northwind/db';
import type { Types } from 'mongoose';
import { normalizeCountry } from './countries';
import { computeDateShift, parseIsoDate } from './dates';
import { seedObjectId } from './ids';
import { normalizePhone } from './phones';
import type { RawData } from './raw';
import { accessHyperlinkUrl, exampleEmail, singleLine } from './text';

/** A document as the seed writes it: money as decimal strings, Mongoose fills timestamps. */
type Plain<T> = T extends Types.Decimal128
  ? string
  : T extends Date | Types.ObjectId
    ? T
    : T extends (infer U)[]
      ? Plain<U>[]
      : T extends object
        ? { [K in keyof T]: Plain<T[K]> }
        : T;

export type SeedDoc<T> = Plain<Omit<T, 'createdAt' | 'updatedAt'>> & {
  _id: Types.ObjectId;
};

/** Totals, status and line totals are computed by the Order schema's pre-validate hook. */
export type SeedOrder = Omit<SeedDoc<Order>, 'totals' | 'status' | 'lines'> & {
  lines: Omit<Plain<OrderLine>, 'lineTotal'>[];
};

export interface SeedDocuments {
  categories: SeedDoc<Category>[];
  customers: SeedDoc<Customer>[];
  employees: SeedDoc<Employee>[];
  orders: SeedOrder[];
  products: SeedDoc<Product>[];
  regions: SeedDoc<Region>[];
  shippers: SeedDoc<Shipper>[];
  suppliers: SeedDoc<Supplier>[];
  /** Highest number used per prefixed-code sequence, for the counters collection. */
  counters: Record<CodeSequence, number>;
}

export interface TransformReport {
  /** Whole days added to every date (a multiple of 7). */
  dateShiftDays: number;
  /** Phones kept as written because they couldn't be read as numbers. */
  phonesKeptAsIs: { record: string; phone: string }[];
}

export interface TransformResult {
  documents: SeedDocuments;
  report: TransformReport;
}

/** Turns classic Northwind rows into documents for the collections in @northwind/db. */
export function transform(raw: RawData, anchor: Date): TransformResult {
  const phonesKeptAsIs: TransformReport['phonesKeptAsIs'] = [];
  const phone = (value: string | null, countryCode: string, record: string) => {
    const result = normalizePhone(value, countryCode);
    if (result.keptAsIs && result.phone) {
      phonesKeptAsIs.push({ record, phone: result.phone });
    }
    return result.phone;
  };

  const latestOrder = raw.orders
    .map((order) => parseIsoDate(order.OrderDate))
    .reduce((a, b) => (a > b ? a : b));
  const dateShift = computeDateShift(latestOrder, anchor);
  const date = (value: string | null) =>
    value === null ? null : dateShift.shift(parseIsoDate(value));

  const address = (row: {
    Address: string;
    City: string;
    Region: string | null;
    PostalCode: string | null;
    Country: string;
  }): Address => {
    const country = normalizeCountry(row.Country);
    return {
      street: singleLine(row.Address),
      city: row.City.trim(),
      region: row.Region?.trim() || null,
      postalCode: row.PostalCode?.trim() || null,
      country: country.name,
      countryCode: country.code,
    };
  };

  // --- lookups -------------------------------------------------------------
  const byId = <K, V>(rows: V[], key: (row: V) => K) =>
    new Map(rows.map((row) => [key(row), row]));
  const lookup = <K, V>(map: Map<K, V>, key: K, what: string): V => {
    const value = map.get(key);
    if (value === undefined) throw new Error(`Missing ${what} ${String(key)}`);
    return value;
  };

  // --- categories, shippers, suppliers, regions -----------------------------
  const categories = raw.categories.map((row) => {
    const code = formatCode('categories', row.CategoryID);
    return {
      _id: seedObjectId('categories', code),
      code,
      name: row.CategoryName.trim(),
      description: row.Description?.trim() || null,
    };
  });
  const categoryDoc = byId(categories, (c) => c.code);

  const shippers = raw.shippers.map((row) => {
    const code = formatCode('shippers', row.ShipperID);
    return {
      _id: seedObjectId('shippers', code),
      code,
      companyName: row.CompanyName.trim(),
      // Northwind's shippers have no country; they're all US-based.
      phone: phone(row.Phone, 'US', code),
      deletedAt: null,
    };
  });
  const shipperDoc = byId(shippers, (s) => s.code);

  const suppliers = raw.suppliers.map((row) => {
    const code = formatCode('suppliers', row.SupplierID);
    const addr = address(row);
    return {
      _id: seedObjectId('suppliers', code),
      code,
      companyName: row.CompanyName.trim(),
      contact: {
        name: row.ContactName.trim(),
        title: row.ContactTitle?.trim() || null,
        email: exampleEmail(row.ContactName, row.CompanyName),
        phone: phone(row.Phone, addr.countryCode, code),
      },
      address: addr,
      fax: phone(row.Fax, addr.countryCode, `${code} fax`),
      homePage: accessHyperlinkUrl(row.HomePage),
      deletedAt: null,
    };
  });
  const supplierDoc = byId(suppliers, (s) => s.code);

  const territoriesByRegion = new Map<
    number,
    { code: string; name: string }[]
  >();
  for (const row of raw.territories) {
    const list = territoriesByRegion.get(row.RegionID) ?? [];
    list.push({
      code: row.TerritoryID.trim(),
      name: row.TerritoryDescription.trim(),
    });
    territoriesByRegion.set(row.RegionID, list);
  }
  const regions = raw.regions.map((row) => {
    const code = formatCode('regions', row.RegionID);
    return {
      _id: seedObjectId('regions', code),
      code,
      name: row.RegionDescription.trim(),
      territories: (territoriesByRegion.get(row.RegionID) ?? []).sort((a, b) =>
        a.code.localeCompare(b.code),
      ),
    };
  });
  const territoryById = new Map(
    raw.territories.map((t) => [
      t.TerritoryID.trim(),
      {
        code: t.TerritoryID.trim(),
        name: t.TerritoryDescription.trim(),
        regionCode: formatCode('regions', t.RegionID),
      },
    ]),
  );

  // --- customers -------------------------------------------------------------
  const customers = raw.customers.map((row) => {
    const code = row.CustomerID.trim();
    const addr = address(row);
    return {
      _id: seedObjectId('customers', code),
      code,
      companyName: row.CompanyName.trim(),
      contact: {
        name: row.ContactName.trim(),
        title: row.ContactTitle?.trim() || null,
        email: exampleEmail(row.ContactName, row.CompanyName),
        phone: phone(row.Phone, addr.countryCode, code),
      },
      address: addr,
      fax: phone(row.Fax, addr.countryCode, `${code} fax`),
      deletedAt: null,
    };
  });
  const customerDoc = byId(customers, (c) => c.code);

  // --- employees -------------------------------------------------------------
  const employeeRows = byId(raw.employees, (e) => e.EmployeeID);
  const employeeCode = (id: number) => formatCode('employees', id);
  const employeeName = (id: number) => {
    const row = lookup(employeeRows, id, 'employee');
    return `${row.FirstName.trim()} ${row.LastName.trim()}`;
  };
  const employeeRef = (id: number) => {
    const code = employeeCode(id);
    return {
      _id: seedObjectId('employees', code),
      code,
      name: employeeName(id),
    };
  };

  const employees = raw.employees.map((row) => {
    const code = employeeCode(row.EmployeeID);
    const addr = address(row);
    const territories = raw.employeeTerritories
      .filter((et) => et.EmployeeID === row.EmployeeID)
      .map((et) => lookup(territoryById, et.TerritoryID.trim(), 'territory'))
      .sort((a, b) => a.code.localeCompare(b.code));
    return {
      _id: seedObjectId('employees', code),
      code,
      firstName: row.FirstName.trim(),
      lastName: row.LastName.trim(),
      title: row.Title?.trim() || null,
      titleOfCourtesy: row.TitleOfCourtesy?.trim() || null,
      email: exampleEmail(
        `${row.FirstName} ${row.LastName}`,
        'Northwind Traders',
      ),
      phone: phone(row.HomePhone, addr.countryCode, code),
      extension: row.Extension?.trim() || null,
      birthDate: date(row.BirthDate),
      hireDate: date(row.HireDate),
      address: addr,
      notes: row.Notes?.trim() || null,
      reportsTo: row.ReportsTo === null ? null : employeeRef(row.ReportsTo),
      territories,
      deletedAt: null,
    };
  });

  // --- products ----------------------------------------------------------------
  const products = raw.products.map((row) => {
    const code = formatCode('products', row.ProductID);
    const category = lookup(
      categoryDoc,
      formatCode('categories', row.CategoryID),
      'category',
    );
    const supplier = lookup(
      supplierDoc,
      formatCode('suppliers', row.SupplierID),
      'supplier',
    );
    return {
      _id: seedObjectId('products', code),
      code,
      name: row.ProductName.trim(),
      category: { _id: category._id, code: category.code, name: category.name },
      supplier: {
        _id: supplier._id,
        code: supplier.code,
        companyName: supplier.companyName,
      },
      quantityPerUnit: row.QuantityPerUnit?.trim() || null,
      unitPrice: row.UnitPrice,
      unitsInStock: row.UnitsInStock,
      unitsOnOrder: row.UnitsOnOrder,
      reorderLevel: row.ReorderLevel,
      discontinued: row.Discontinued === 1,
    };
  });
  const productDoc = byId(products, (p) => p.code);

  // --- orders ------------------------------------------------------------------
  const linesByOrder = new Map<number, RawData['orderDetails']>();
  for (const line of raw.orderDetails) {
    linesByOrder.set(line.OrderID, [
      ...(linesByOrder.get(line.OrderID) ?? []),
      line,
    ]);
  }

  const orders = raw.orders.map((row) => {
    const code = formatCode('orders', row.OrderID);
    const customer = lookup(customerDoc, row.CustomerID.trim(), 'customer');
    const shipper = lookup(
      shipperDoc,
      formatCode('shippers', row.ShipVia),
      'shipper',
    );
    const shipCountry = normalizeCountry(row.ShipCountry);
    const lines = (linesByOrder.get(row.OrderID) ?? []).map((line) => {
      const product = lookup(
        productDoc,
        formatCode('products', line.ProductID),
        'product',
      );
      return {
        product: { _id: product._id, code: product.code, name: product.name },
        // Historical sale price, often lower than the product's current list price.
        unitPrice: line.UnitPrice,
        quantity: line.Quantity,
        discount: line.Discount,
      };
    });

    return {
      _id: seedObjectId('orders', code),
      code,
      customer: {
        _id: customer._id,
        code: customer.code,
        companyName: customer.companyName,
      },
      employee: employeeRef(row.EmployeeID),
      shipper: {
        _id: shipper._id,
        code: shipper.code,
        companyName: shipper.companyName,
      },
      orderDate: lookupDate(date(row.OrderDate), code),
      requiredDate: date(row.RequiredDate),
      shippedDate: date(row.ShippedDate),
      freight: row.Freight,
      shipTo: {
        name: row.ShipName.trim(),
        street: singleLine(row.ShipAddress),
        city: row.ShipCity.trim(),
        region: row.ShipRegion?.trim() || null,
        postalCode: row.ShipPostalCode?.trim() || null,
        country: shipCountry.name,
        countryCode: shipCountry.code,
      },
      lines,
    };
  });

  const maxOf = (ids: number[]) => Math.max(...ids);
  return {
    documents: {
      categories,
      customers,
      employees,
      orders,
      products,
      regions,
      shippers,
      suppliers,
      counters: {
        categories: maxOf(raw.categories.map((r) => r.CategoryID)),
        employees: maxOf(raw.employees.map((r) => r.EmployeeID)),
        orders: maxOf(raw.orders.map((r) => r.OrderID)),
        products: maxOf(raw.products.map((r) => r.ProductID)),
        regions: maxOf(raw.regions.map((r) => r.RegionID)),
        shippers: maxOf(raw.shippers.map((r) => r.ShipperID)),
        suppliers: maxOf(raw.suppliers.map((r) => r.SupplierID)),
      },
    },
    report: { dateShiftDays: dateShift.days, phonesKeptAsIs },
  };
}

function lookupDate(value: Date | null, code: string): Date {
  if (value === null) throw new Error(`${code} has no order date`);
  return value;
}
