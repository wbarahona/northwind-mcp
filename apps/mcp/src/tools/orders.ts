import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  type Customer,
  type NorthwindClient,
  type Supplier,
  unwrap,
} from '@northwind/api-client';
import { z } from 'zod';
import { References } from '../lookup/references';
import {
  OrderSummaryView,
  OrderView,
  OverdueOrderView,
  presentOrder,
  presentOrderSummary,
  presentOverdueOrder,
  summarizeOrder,
} from '../presenters/order';
import { listView, PageFields, pageSummary } from '../presenters/page';
import { LowStockRow, presentLowStockRow } from '../presenters/product';
import {
  boolArg,
  codeArg,
  dateArg,
  DEFAULT_LIMIT,
  enumArg,
  optional,
  orderCode,
  pagingArgs,
} from './args';
import { guarded, present, READ_ONLY } from './result';

const sentence = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ');

const ORDER_SORT = {
  newest: '-orderDate,-code',
  oldest: 'orderDate,code',
  largest: '-totals.total,-orderDate',
} as const;
const orderSorts = Object.keys(ORDER_SORT) as [
  keyof typeof ORDER_SORT,
  ...(keyof typeof ORDER_SORT)[],
];

/** With line items each order costs an extra request, so those pages are kept short. */
const MAX_WITH_LINES = 10;

const OVERDUE_KIND = {
  open: 'open',
  shipped_late: 'shipped-late',
  all: 'all',
} as const;

const orderArg = codeArg(
  'Order code, e.g. ORD-10248 (the bare number 10248 also works)',
);

/** Fetches each distinct record once, in parallel: `byCode(codes, fetchOne)`. */
async function byCode<T>(
  codes: string[],
  fetchOne: (code: string) => Promise<T>,
): Promise<Map<string, T>> {
  const unique = [...new Set(codes)];
  const values = await Promise.all(unique.map(fetchOne));
  return new Map(unique.map((code, i) => [code, values[i]!]));
}

export function registerOrderTools(
  server: McpServer,
  api: NorthwindClient,
  apiUrl: string,
): void {
  server.registerTool(
    'find_orders',
    {
      title: 'Find orders',
      description:
        'List orders, newest first by default, filtered by customer, sales employee, product, ' +
        'shipper, status and/or order date. Each result has the order code, status, customer, ' +
        'employee, dates, net and total. Line items (products) are NOT included unless ' +
        'includeLines is true; otherwise call get_order for them. Customers, employees, products ' +
        'and shippers can be given by code or exact name. Date range: from is inclusive, to is ' +
        'exclusive (March 2026 = from 2026-03-01 to 2026-04-01).',
      inputSchema: {
        customer: optional(codeArg('Customer code (ALFKI) or company name')),
        employee: optional(
          codeArg(
            'Sales employee code (EMP-001) or full name, e.g. "Nancy Davolio"',
          ),
        ),
        product: optional(
          codeArg(
            'Only orders containing this product: code (PRD-001) or name',
          ),
        ),
        shipper: optional(codeArg('Shipper code (SHP-01) or company name')),
        status: optional(
          enumArg(
            ['pending', 'shipped'],
            'pending: not shipped yet (can still be changed); shipped: dispatched',
          ),
        ),
        from: optional(
          dateArg('Orders placed on or after this date, YYYY-MM-DD'),
        ),
        to: optional(
          dateArg('Orders placed before this date (exclusive), YYYY-MM-DD'),
        ),
        sort: optional(
          enumArg(
            orderSorts,
            'newest (default), oldest, or largest total first',
          ),
        ),
        includeLines: optional(
          boolArg(
            `Include each order's products (at most ${MAX_WITH_LINES} orders per page)`,
          ),
        ),
        ...pagingArgs,
      },
      outputSchema: { items: z.array(OrderSummaryView), ...PageFields },
      annotations: READ_ONLY,
    },
    guarded(apiUrl, async (args) => {
      const refs = new References(api);
      const resolved = await refs.resolveAll({
        customer: { kind: 'customer', input: args.customer },
        employee: { kind: 'employee', input: args.employee },
        product: { kind: 'product', input: args.product },
        shipper: { kind: 'shipper', input: args.shipper },
      });
      const limit = Math.min(
        args.limit ?? DEFAULT_LIMIT,
        args.includeLines ? MAX_WITH_LINES : Infinity,
      );
      const result = await unwrap(
        api.GET('/v1/orders', {
          params: {
            query: {
              customerId: resolved.codes.customer,
              employeeId: resolved.codes.employee,
              productId: resolved.codes.product,
              shipperId: resolved.codes.shipper,
              status: args.status,
              from: args.from,
              to: args.to,
              sort: args.sort && ORDER_SORT[args.sort],
              page: args.page,
              limit,
            },
          },
        }),
      );
      if (result.meta.total === 0) await refs.checkEmpty(resolved);

      const full = args.includeLines
        ? await byCode(
            result.data.map((o) => o.code),
            (code) =>
              unwrap(
                api.GET('/v1/orders/{id}', { params: { path: { id: code } } }),
              ),
          )
        : undefined;
      const items = result.data.map((o) =>
        presentOrderSummary(o, full?.get(o.code)),
      );
      return present(
        sentence(
          ...resolved.notes,
          pageSummary(['order', 'orders'], result.meta, items.length),
          !args.includeLines &&
            items.length > 0 &&
            // A concrete next step: small models act on "get_order with ORD-11011" far more
            // reliably than on a general hint (docs/benchmark.md).
            `Products are not listed here: to see them, call get_order with an order code (e.g. ${items[0]!.code}), or set includeLines.`,
        ),
        listView(items, result.meta),
      );
    }),
  );

  server.registerTool(
    'get_order',
    {
      title: 'Get order',
      description:
        'Get one order in full: customer, sales employee, shipper, dates, ship-to address, ' +
        'every line (product code and name, unit price, quantity, discount, line total) and the ' +
        'totals (subtotal, discount, net, freight, total). Status "pending" means not shipped yet; ' +
        'only pending orders can be changed.',
      inputSchema: { order: orderArg },
      outputSchema: OrderView.shape,
      annotations: READ_ONLY,
    },
    guarded(apiUrl, async ({ order }) => {
      const found = await unwrap(
        api.GET('/v1/orders/{id}', {
          params: { path: { id: orderCode(order) } },
        }),
      );
      const view = presentOrder(found);
      return present(summarizeOrder(view), view);
    }),
  );

  server.registerTool(
    'find_overdue_orders',
    {
      title: 'Find overdue orders',
      description:
        'Late orders, most overdue first. kind "open" (default): not shipped and past the ' +
        'required date. "shipped_late": shipped after the required date. "all": both. Each result ' +
        'has the order, days late, and the customer contact (name, title, phone, email) to follow ' +
        'up with. asOf sets the day to measure from (default today).',
      inputSchema: {
        kind: optional(
          enumArg(
            ['open', 'shipped_late', 'all'],
            'Which late orders (default open)',
          ),
        ),
        asOf: optional(
          dateArg(
            'Measure lateness as of this date, YYYY-MM-DD (default today)',
          ),
        ),
        ...pagingArgs,
      },
      outputSchema: { items: z.array(OverdueOrderView), ...PageFields },
      annotations: READ_ONLY,
    },
    guarded(apiUrl, async ({ kind, asOf, page, limit }) => {
      const result = await unwrap(
        api.GET('/v1/orders/overdue', {
          params: {
            query: {
              kind: OVERDUE_KIND[kind ?? 'open'],
              asOf,
              page,
              limit: limit ?? DEFAULT_LIMIT,
            },
          },
        }),
      );
      const customers = await byCode<Customer>(
        result.data.map((o) => o.customer.code),
        (code) =>
          unwrap(
            api.GET('/v1/customers/{id}', { params: { path: { id: code } } }),
          ),
      );
      const items = result.data.map((o) => presentOverdueOrder(o, customers));
      const label =
        kind === 'shipped_late'
          ? ['order shipped late', 'orders shipped late']
          : kind === 'all'
            ? ['late order', 'late orders']
            : ['open overdue order', 'open overdue orders'];
      return present(
        sentence(
          pageSummary(label as [string, string], result.meta, items.length),
          asOf && `Measured as of ${asOf}.`,
        ),
        listView(items, result.meta),
      );
    }),
  );

  server.registerTool(
    'find_low_stock_products',
    {
      title: 'Find low-stock products',
      description:
        'Active products that need reordering: units in stock plus units on order are at or ' +
        'below the reorder level. Largest shortfall first. Each result has stock figures, the ' +
        'category, and the supplier with the contact to call to reorder.',
      inputSchema: { ...pagingArgs },
      outputSchema: { items: z.array(LowStockRow), ...PageFields },
      annotations: READ_ONLY,
    },
    guarded(apiUrl, async ({ page, limit }) => {
      const result = await unwrap(
        api.GET('/v1/products/low-stock', {
          params: { query: { page, limit: limit ?? DEFAULT_LIMIT } },
        }),
      );
      const suppliers = await byCode<Supplier>(
        result.data.map((p) => p.supplier.code),
        (code) =>
          unwrap(
            api.GET('/v1/suppliers/{id}', { params: { path: { id: code } } }),
          ),
      );
      const items = result.data.map((p) => presentLowStockRow(p, suppliers));
      return present(
        pageSummary(
          ['product needs reordering', 'products need reordering'],
          result.meta,
          items.length,
        ),
        listView(items, result.meta),
      );
    }),
  );
}
