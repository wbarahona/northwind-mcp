import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type NorthwindClient, unwrap } from '@northwind/api-client';
import { z } from 'zod';
import { References } from '../lookup/references';
import { Ref } from '../presenters/common';
import {
  CustomerRow,
  CustomerView,
  presentCustomer,
  presentCustomerRow,
} from '../presenters/customer';
import {
  EmployeeRow,
  EmployeeView,
  presentEmployee,
  presentEmployeeRow,
} from '../presenters/employee';
import { listView, PageFields, pageSummary } from '../presenters/page';
import {
  presentProduct,
  presentProductRow,
  ProductRow,
  ProductView,
} from '../presenters/product';
import {
  CategoryRow,
  presentCategory,
  presentRegion,
  presentShipper,
  presentSupplier,
  RegionRow,
  ShipperRow,
  SupplierRow,
} from '../presenters/reference';
import {
  amountArg,
  boolArg,
  codeArg,
  DEFAULT_LIMIT,
  enumArg,
  optional,
  pagingArgs,
  textArg,
} from './args';
import { guarded, present, READ_ONLY } from './result';

/** Every page of a list (a customer has at most a few dozen orders; capped as a safeguard). */
async function allPages<T>(
  fetchPage: (
    page: number,
  ) => Promise<{ data: T[]; meta: { totalPages: number } }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, meta } = await fetchPage(page);
    all.push(...data);
    if (page >= meta.totalPages) break;
  }
  return all;
}

const sentence = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ');

const suggestionsField = z
  .array(Ref)
  .optional()
  .describe('Close matches, when a search found nothing');

const PRODUCT_SORT = {
  code: 'code',
  name: 'name',
  cheapest: 'unitPrice,code',
  most_expensive: '-unitPrice,code',
  lowest_stock: 'unitsInStock,code',
  highest_stock: '-unitsInStock,code',
} as const;
const productSorts = Object.keys(PRODUCT_SORT) as [
  keyof typeof PRODUCT_SORT,
  ...(keyof typeof PRODUCT_SORT)[],
];

const REFERENCE_KINDS = [
  'categories',
  'shippers',
  'suppliers',
  'regions',
] as const;

export function registerLookupTools(
  server: McpServer,
  api: NorthwindClient,
  apiUrl: string,
): void {
  // ---------------------------------------------------------------- customers

  server.registerTool(
    'find_customers',
    {
      title: 'Find customers',
      description:
        'Search the companies that buy from Northwind, by words in the company or contact name, ' +
        'by country (name or ISO code) and/or city. Each result has the customer code, company, ' +
        'contact name and title, city and country. Call get_customer for phone, email and ' +
        'address, and find_orders with the customer code for their orders.',
      inputSchema: {
        query: optional(
          textArg('Whole words of the company or contact name, e.g. "Alfreds"'),
        ),
        country: optional(
          textArg('Country name or ISO code, e.g. Germany or DE'),
        ),
        city: optional(textArg('City, e.g. London')),
        ...pagingArgs,
      },
      outputSchema: {
        items: z.array(CustomerRow),
        ...PageFields,
        suggestions: suggestionsField,
      },
      annotations: READ_ONLY,
    },
    guarded(apiUrl, async ({ query, country, city, page, limit }) => {
      const result = await unwrap(
        api.GET('/v1/customers', {
          params: {
            query: {
              q: query,
              country,
              city,
              page,
              limit: limit ?? DEFAULT_LIMIT,
            },
          },
        }),
      );
      const items = result.data.map(presentCustomerRow);
      const suggestions =
        result.meta.total === 0 && query
          ? await new References(api).suggest('customer', query)
          : [];
      return present(
        sentence(
          pageSummary(['customer', 'customers'], result.meta, items.length),
          suggestions.length > 0 &&
            `Close matches for "${query}": ${suggestions.map((s) => `${s.code} (${s.name})`).join(', ')}.`,
        ),
        {
          ...listView(items, result.meta),
          ...(suggestions.length && { suggestions }),
        },
      );
    }),
  );

  server.registerTool(
    'get_customer',
    {
      title: 'Get customer',
      description:
        'Get one customer: company, contact person (name, title, email, phone), address, fax, ' +
        'and order statistics (number of orders, pending orders, lifetime revenue, first and last ' +
        'order date). Accepts the five-letter code (ALFKI) or the exact company name; if nothing ' +
        'matches, the error lists close matches. For the orders themselves, call find_orders.',
      inputSchema: {
        customer: codeArg(
          'Customer code, e.g. ALFKI, or the company name, e.g. "Alfreds Futterkiste"',
        ),
      },
      outputSchema: CustomerView.shape,
      annotations: READ_ONLY,
    },
    guarded(apiUrl, async ({ customer }) => {
      const { value, note } = await new References(api).fetchOne(
        'customer',
        customer,
        (code) =>
          unwrap(
            api.GET('/v1/customers/{id}', { params: { path: { id: code } } }),
          ),
      );
      const orders = await allPages((page) =>
        unwrap(
          api.GET('/v1/customers/{id}/orders', {
            params: { path: { id: value.code }, query: { page, limit: 100 } },
          }),
        ),
      );
      const view = presentCustomer(value, orders);
      const stats = view.orderStats;
      return present(
        sentence(
          note,
          `${view.name} (${view.code}), ${view.address.city}, ${view.address.country}; ` +
            `contact ${view.contact.name}${view.contact.title ? `, ${view.contact.title}` : ''}.`,
          stats.orders
            ? `${stats.orders} orders from ${stats.firstOrderDate} to ${stats.lastOrderDate}, ` +
                `lifetime revenue ${stats.lifetimeRevenue}, ${stats.pending} pending.`
            : 'No orders yet.',
          view.deleted && `Deleted on ${view.deleted}.`,
        ),
        view,
      );
    }),
  );

  // ---------------------------------------------------------------- products

  server.registerTool(
    'find_products',
    {
      title: 'Find products',
      description:
        'Search the catalog by words in the product name, category, supplier, price range and/or ' +
        'stock. Each result has the product code and name, category, supplier, current unit price, ' +
        'pack size and units in stock. Discontinued products are left out unless ' +
        'includeDiscontinued is true. Call get_product for reorder levels and units on order.',
      inputSchema: {
        query: optional(
          textArg('Whole words of the product name, e.g. "Chai"'),
        ),
        category: optional(
          codeArg('Category code (CAT-01) or name, e.g. "Dairy Products"'),
        ),
        supplier: optional(codeArg('Supplier code (SUP-001) or company name')),
        minPrice: optional(amountArg('Lowest unit price, inclusive')),
        maxPrice: optional(amountArg('Highest unit price, inclusive')),
        inStock: optional(
          boolArg('true: only products in stock; false: only out of stock'),
        ),
        includeDiscontinued: optional(
          boolArg('Also list discontinued products (default false)'),
        ),
        sort: optional(
          enumArg(productSorts, 'Order of results (default code)'),
        ),
        ...pagingArgs,
      },
      outputSchema: {
        items: z.array(ProductRow),
        ...PageFields,
        suggestions: suggestionsField,
      },
      annotations: READ_ONLY,
    },
    guarded(apiUrl, async (args) => {
      const refs = new References(api);
      const resolved = await refs.resolveAll({
        category: { kind: 'category', input: args.category },
        supplier: { kind: 'supplier', input: args.supplier },
      });
      const result = await unwrap(
        api.GET('/v1/products', {
          params: {
            query: {
              q: args.query,
              categoryId: resolved.codes.category,
              supplierId: resolved.codes.supplier,
              minPrice: args.minPrice?.toString(),
              maxPrice: args.maxPrice?.toString(),
              inStock: args.inStock,
              discontinued: args.includeDiscontinued ? undefined : false,
              sort: args.sort && PRODUCT_SORT[args.sort],
              page: args.page,
              limit: args.limit ?? DEFAULT_LIMIT,
            },
          },
        }),
      );
      if (result.meta.total === 0) await refs.checkEmpty(resolved);
      const items = result.data.map(presentProductRow);
      const suggestions =
        result.meta.total === 0 && args.query
          ? await refs.suggest('product', args.query)
          : [];
      return present(
        sentence(
          ...resolved.notes,
          pageSummary(['product', 'products'], result.meta, items.length),
          result.meta.total === 0 &&
            !args.includeDiscontinued &&
            'Discontinued products are left out; set includeDiscontinued to include them.',
          suggestions.length > 0 &&
            `Close matches for "${args.query}": ${suggestions.map((s) => `${s.code} (${s.name})`).join(', ')}.`,
        ),
        {
          ...listView(items, result.meta),
          ...(suggestions.length && { suggestions }),
        },
      );
    }),
  );

  server.registerTool(
    'get_product',
    {
      title: 'Get product',
      description:
        'Get one product: category, supplier, current unit price, pack size, units in stock and on ' +
        'order, reorder level, whether it needs reordering, and whether it is discontinued. ' +
        'Accepts the code (PRD-001, or the classic number 1) or the exact product name.',
      inputSchema: {
        product: codeArg(
          'Product code, e.g. PRD-001, or the name, e.g. "Chai"',
        ),
      },
      outputSchema: ProductView.shape,
      annotations: READ_ONLY,
    },
    guarded(apiUrl, async ({ product }) => {
      const { value, note } = await new References(api).fetchOne(
        'product',
        product,
        (code) =>
          unwrap(
            api.GET('/v1/products/{id}', { params: { path: { id: code } } }),
          ),
      );
      const view = presentProduct(value);
      return present(
        sentence(
          note,
          `${view.name} (${view.code}): ${view.unitPrice} per ${view.quantityPerUnit ?? 'unit'}, ` +
            `${view.unitsInStock} in stock, ${view.unitsOnOrder} on order, reorder level ${view.reorderLevel}.`,
          view.discontinued && 'Discontinued: it cannot be ordered.',
          view.needsReorder && 'Needs reordering.',
        ),
        view,
      );
    }),
  );

  // ---------------------------------------------------------------- employees

  server.registerTool(
    'find_employees',
    {
      title: 'Find employees',
      description:
        "List Northwind's sales staff, optionally by part of the name, by manager, or by the " +
        'sales territory they cover. Each result has the employee code, name, title, manager, ' +
        'hire date, city and territory names. Call get_employee for contact details, notes and ' +
        'direct reports.',
      inputSchema: {
        query: optional(textArg('Part of the first or last name, e.g. "Dav"')),
        manager: optional(
          codeArg(
            'Only people reporting to this employee: code (EMP-002) or full name',
          ),
        ),
        territory: optional(
          codeArg(
            'Only people covering this territory: 5-digit code or name, e.g. Boston',
          ),
        ),
        ...pagingArgs,
      },
      outputSchema: { items: z.array(EmployeeRow), ...PageFields },
      annotations: READ_ONLY,
    },
    guarded(apiUrl, async ({ query, manager, territory, page, limit }) => {
      const refs = new References(api);
      const resolved = await refs.resolveAll({
        manager: { kind: 'employee', input: manager },
        territory: { kind: 'territory', input: territory },
      });
      const result = await unwrap(
        api.GET('/v1/employees', {
          params: {
            query: {
              q: query,
              reportsToId: resolved.codes.manager,
              territory: resolved.codes.territory,
              page,
              limit: limit ?? DEFAULT_LIMIT,
            },
          },
        }),
      );
      if (result.meta.total === 0) await refs.checkEmpty(resolved);
      const items = result.data.map(presentEmployeeRow);
      return present(
        sentence(
          ...resolved.notes,
          pageSummary(['employee', 'employees'], result.meta, items.length),
        ),
        listView(items, result.meta),
      );
    }),
  );

  server.registerTool(
    'get_employee',
    {
      title: 'Get employee',
      description:
        'Get one employee: title, contact details, birth and hire dates, address, manager, direct ' +
        'reports, territories (with region codes) and biography notes. Accepts the code (EMP-001, ' +
        'or the classic number 1) or the full name, e.g. "Nancy Davolio".',
      inputSchema: {
        employee: codeArg('Employee code, e.g. EMP-001, or the full name'),
      },
      outputSchema: EmployeeView.shape,
      annotations: READ_ONLY,
    },
    guarded(apiUrl, async ({ employee }) => {
      const { value, note } = await new References(api).fetchOne(
        'employee',
        employee,
        (code) =>
          unwrap(
            api.GET('/v1/employees/{id}', { params: { path: { id: code } } }),
          ),
      );
      const reports = await unwrap(
        api.GET('/v1/employees/{id}/reports', {
          params: { path: { id: value.code }, query: { limit: 100 } },
        }),
      );
      const view = presentEmployee(value, reports.data);
      return present(
        sentence(
          note,
          `${view.name} (${view.code})${view.title ? `, ${view.title}` : ''}` +
            `${view.reportsTo ? `, reports to ${view.reportsTo.name}` : ''}; ` +
            `${view.directReports.length} direct report${view.directReports.length === 1 ? '' : 's'}, ` +
            `${view.territories.length} territor${view.territories.length === 1 ? 'y' : 'ies'}.`,
          view.deleted && `Left on ${view.deleted}.`,
        ),
        view,
      );
    }),
  );

  // ---------------------------------------------------------------- reference data

  server.registerTool(
    'list_reference_data',
    {
      title: 'List reference data',
      description:
        'List one of the small lookup tables in full: categories (product groups), shippers ' +
        '(carriers), suppliers (with contact and country) or regions (with their sales ' +
        'territories). Use it to find a code by name or to see every option.',
      inputSchema: {
        kind: enumArg(REFERENCE_KINDS, 'Which table'),
      },
      outputSchema: {
        kind: z.enum(REFERENCE_KINDS),
        items: z.array(
          z.union([CategoryRow, ShipperRow, SupplierRow, RegionRow]),
        ),
        ...PageFields,
      },
      annotations: READ_ONLY,
    },
    guarded(apiUrl, async ({ kind }) => {
      const query = { params: { query: { limit: 100 } } };
      const { items, meta } = await (async () => {
        switch (kind) {
          case 'categories': {
            const r = await unwrap(api.GET('/v1/categories', query));
            return { items: r.data.map(presentCategory), meta: r.meta };
          }
          case 'shippers': {
            const r = await unwrap(api.GET('/v1/shippers', query));
            return { items: r.data.map(presentShipper), meta: r.meta };
          }
          case 'suppliers': {
            const r = await unwrap(api.GET('/v1/suppliers', query));
            return { items: r.data.map(presentSupplier), meta: r.meta };
          }
          case 'regions': {
            const r = await unwrap(api.GET('/v1/regions', query));
            return { items: r.data.map(presentRegion), meta: r.meta };
          }
        }
      })();
      return present(
        pageSummary(
          [kind.replace(/ies$/, 'y').replace(/s$/, ''), kind],
          meta,
          items.length,
        ),
        { kind, ...listView<unknown>(items, meta) },
      );
    }),
  );
}
