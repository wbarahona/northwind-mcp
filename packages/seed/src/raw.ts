import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Row shapes of data/raw/*.json: original Northwind tables and column names. */
export interface RawCategory {
  CategoryID: number;
  CategoryName: string;
  Description: string | null;
}

export interface RawCustomer {
  CustomerID: string;
  CompanyName: string;
  ContactName: string;
  ContactTitle: string | null;
  Address: string;
  City: string;
  Region: string | null;
  PostalCode: string | null;
  Country: string;
  Phone: string | null;
  Fax: string | null;
}

export interface RawEmployee {
  EmployeeID: number;
  LastName: string;
  FirstName: string;
  Title: string | null;
  TitleOfCourtesy: string | null;
  BirthDate: string | null;
  HireDate: string | null;
  Address: string;
  City: string;
  Region: string | null;
  PostalCode: string | null;
  Country: string;
  HomePhone: string | null;
  Extension: string | null;
  Notes: string | null;
  ReportsTo: number | null;
  PhotoPath: string | null;
}

export interface RawEmployeeTerritory {
  EmployeeID: number;
  TerritoryID: string;
}

export interface RawOrderDetail {
  OrderID: number;
  ProductID: number;
  /** Exact decimal text, e.g. "9.8". */
  UnitPrice: string;
  Quantity: number;
  /** Exact decimal text, e.g. "0.15". */
  Discount: string;
}

export interface RawOrder {
  OrderID: number;
  CustomerID: string;
  EmployeeID: number;
  OrderDate: string;
  RequiredDate: string | null;
  ShippedDate: string | null;
  ShipVia: number;
  Freight: string;
  ShipName: string;
  ShipAddress: string;
  ShipCity: string;
  ShipRegion: string | null;
  ShipPostalCode: string | null;
  ShipCountry: string;
}

export interface RawProduct {
  ProductID: number;
  ProductName: string;
  SupplierID: number;
  CategoryID: number;
  QuantityPerUnit: string | null;
  UnitPrice: string;
  UnitsInStock: number;
  UnitsOnOrder: number;
  ReorderLevel: number;
  Discontinued: number;
}

export interface RawRegion {
  RegionID: number;
  RegionDescription: string;
}

export interface RawShipper {
  ShipperID: number;
  CompanyName: string;
  Phone: string | null;
}

export interface RawSupplier {
  SupplierID: number;
  CompanyName: string;
  ContactName: string;
  ContactTitle: string | null;
  Address: string;
  City: string;
  Region: string | null;
  PostalCode: string | null;
  Country: string;
  Phone: string | null;
  Fax: string | null;
  HomePage: string | null;
}

export interface RawTerritory {
  TerritoryID: string;
  TerritoryDescription: string;
  RegionID: number;
}

export interface RawData {
  categories: RawCategory[];
  customers: RawCustomer[];
  employees: RawEmployee[];
  employeeTerritories: RawEmployeeTerritory[];
  orderDetails: RawOrderDetail[];
  orders: RawOrder[];
  products: RawProduct[];
  regions: RawRegion[];
  shippers: RawShipper[];
  suppliers: RawSupplier[];
  territories: RawTerritory[];
}

/** data/raw sits next to both src/ (tests) and dist/ (CLI). */
export const RAW_DATA_DIR = join(__dirname, '..', 'data', 'raw');

export function loadRawData(dir = RAW_DATA_DIR): RawData {
  const read = <T>(file: string): T[] =>
    JSON.parse(readFileSync(join(dir, file), 'utf8')) as T[];

  return {
    categories: read('categories.json'),
    customers: read('customers.json'),
    employees: read('employees.json'),
    employeeTerritories: read('employee-territories.json'),
    orderDetails: read('order-details.json'),
    orders: read('orders.json'),
    products: read('products.json'),
    regions: read('regions.json'),
    shippers: read('shippers.json'),
    suppliers: read('suppliers.json'),
    territories: read('territories.json'),
  };
}
