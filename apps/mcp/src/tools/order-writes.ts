import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import {
  type NorthwindClient,
  NorthwindApiError,
  unwrap,
} from '@northwind/api-client';
import { z } from 'zod';
import { type RefKind, References } from '../lookup/references';
import { today } from '../periods';
import {
  type OrderView,
  OrderView as OrderViewSchema,
  presentOrder,
  summarizeOrder,
} from '../presenters/order';
import {
  amountArg,
  codeArg,
  dateArg,
  discountArg,
  optional,
  orderCode,
  quantityArg,
  shipToArg,
} from './args';
import { guarded, present } from './result';

const sentence = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ');

/** Writes change data but never delete it; each says whether repeating it is harmless. */
const write = (
  hints: Pick<ToolAnnotations, 'destructiveHint' | 'idempotentHint'>,
): ToolAnnotations => ({ readOnlyHint: false, openWorldHint: false, ...hints });

const orderArg = codeArg(
  'Order code, e.g. ORD-11078 (the bare number 11078 also works)',
);
const productArg = codeArg('Product code (PRD-001) or exact name, e.g. "Chai"');

const money = (amount: number | undefined) => amount?.toFixed(2);
const rate = (value: number | undefined) =>
  value === undefined ? undefined : String(value);

/** A reference the model typed as a code: if the API says it wasn't found, suggest close matches. */
interface TypedRef {
  /** The API's field name, e.g. "customerId" or "lines.1.productId". */
  field: string;
  kind: RefKind;
  code: string;
  input: string;
}

async function suggestOnMissing<T>(
  refs: References,
  typed: TypedRef[],
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof NorthwindApiError && error.status === 400) {
      for (const problem of error.problem.errors ?? []) {
        const ref = typed.find((r) => r.field === problem.field);
        if (ref && problem.messages.some((m) => m.includes('was not found'))) {
          await refs.assertExists(ref.kind, ref.code, ref.input);
        }
      }
    }
    throw error;
  }
}

const describeLine = (view: OrderView, productCode: string) => {
  const line = view.lines.find((l) => l.product.code === productCode);
  return line ? `${line.product.name} (${line.product.code})` : productCode;
};

export function registerOrderWriteTools(
  server: McpServer,
  api: NorthwindClient,
  apiUrl: string,
  now: () => Date,
): void {
  const getOrder = (code: string) =>
    unwrap(api.GET('/v1/orders/{id}', { params: { path: { id: code } } }));

  server.registerTool(
    'place_order',
    {
      title: 'Place order',
      description:
        'Create a new order at current list prices. It starts as pending: lines, freight, ' +
        'shipper, required date and ship-to can be changed until ship_order. Customer, employee, ' +
        'products and shipper can be given by code or exact name. Discontinued products are ' +
        'refused. Every call creates another order, so do not repeat a call that succeeded.',
      inputSchema: {
        customer: codeArg('Customer code (ALFKI) or company name'),
        employee: codeArg(
          'Sales employee taking the order: code (EMP-001) or full name',
        ),
        lines: z
          .array(
            z.object({
              product: productArg,
              quantity: quantityArg,
              discount: optional(
                discountArg(
                  'Rate 0 to 1, e.g. 0.1 (or "10%") for 10% off; default 0',
                ),
              ),
            }),
          )
          .min(1)
          .max(50)
          .describe('One entry per product (each product once)'),
        shipper: optional(
          codeArg(
            'Shipper code (SHP-01) or name; can also be chosen when shipping',
          ),
        ),
        requiredDate: optional(
          dateArg('Date the customer needs it by, YYYY-MM-DD'),
        ),
        freight: optional(amountArg('Freight charge, e.g. 12.50; default 0')),
        shipTo: optional(shipToArg),
      },
      outputSchema: OrderViewSchema.shape,
      annotations: write({ destructiveHint: false, idempotentHint: false }),
    },
    guarded(apiUrl, async (args) => {
      const refs = new References(api);
      const head = await refs.resolveAll({
        customer: { kind: 'customer', input: args.customer },
        employee: { kind: 'employee', input: args.employee },
        shipper: { kind: 'shipper', input: args.shipper },
      });
      const products = await Promise.all(
        args.lines.map((line) => refs.resolve('product', line.product)),
      );
      const typed: TypedRef[] = [
        ...head.typed.map((r) => ({ ...r, field: `${r.arg}Id` })),
        ...products.flatMap((p, i) =>
          p.note
            ? []
            : [
                {
                  field: `lines.${i}.productId`,
                  kind: 'product' as const,
                  code: p.code,
                  input: args.lines[i]!.product,
                },
              ],
        ),
      ];

      const order = await suggestOnMissing(refs, typed, () =>
        unwrap(
          api.POST('/v1/orders', {
            body: {
              customerId: head.codes.customer!,
              employeeId: head.codes.employee!,
              shipperId: head.codes.shipper,
              requiredDate: args.requiredDate,
              freight: money(args.freight),
              shipTo: args.shipTo,
              lines: args.lines.map((line, i) => ({
                productId: products[i]!.code,
                quantity: line.quantity,
                discount: rate(line.discount),
              })),
            },
          }),
        ),
      );
      const view = presentOrder(order);
      return present(
        sentence(
          ...head.notes,
          ...products.flatMap((p) => (p.note ? [p.note] : [])),
          `Placed. ${summarizeOrder(view)}`,
          'It can be changed until it ships.',
        ),
        view,
      );
    }),
  );

  server.registerTool(
    'update_order',
    {
      title: 'Update order',
      description:
        "Change a pending order's sales employee, shipper, required date, freight or ship-to " +
        'address (give only what changes). Shipped orders cannot be changed. To change products, ' +
        'use add_order_line, update_order_line or remove_order_line.',
      inputSchema: {
        order: orderArg,
        employee: optional(codeArg('New sales employee: code or full name')),
        shipper: optional(codeArg('New shipper: code (SHP-01) or name')),
        requiredDate: optional(dateArg('New required date, YYYY-MM-DD')),
        freight: optional(amountArg('New freight charge, e.g. 12.50')),
        shipTo: optional(shipToArg),
      },
      outputSchema: OrderViewSchema.shape,
      annotations: write({ destructiveHint: false, idempotentHint: true }),
    },
    guarded(apiUrl, async (args) => {
      const changes = (
        ['employee', 'shipper', 'requiredDate', 'freight', 'shipTo'] as const
      ).filter((field) => args[field] !== undefined);
      if (changes.length === 0) {
        throw new Error(
          'Nothing to change: give at least one of employee, shipper, requiredDate, freight or shipTo.',
        );
      }
      const refs = new References(api);
      const resolved = await refs.resolveAll({
        employee: { kind: 'employee', input: args.employee },
        shipper: { kind: 'shipper', input: args.shipper },
      });
      const code = orderCode(args.order);
      const order = await suggestOnMissing(
        refs,
        resolved.typed.map((r) => ({ ...r, field: `${r.arg}Id` })),
        () =>
          unwrap(
            api.PATCH('/v1/orders/{id}', {
              params: { path: { id: code } },
              body: {
                employeeId: resolved.codes.employee,
                shipperId: resolved.codes.shipper,
                requiredDate: args.requiredDate,
                freight: money(args.freight),
                shipTo: args.shipTo,
              },
            }),
          ),
      );
      const view = presentOrder(order);
      return present(
        sentence(
          ...resolved.notes,
          `Updated ${changes.join(', ')}.`,
          summarizeOrder(view),
        ),
        view,
      );
    }),
  );

  server.registerTool(
    'add_order_line',
    {
      title: 'Add order line',
      description:
        'Add a product to a pending order at its current list price. If the product is already ' +
        'on the order, use update_order_line instead. Discontinued products are refused.',
      inputSchema: {
        order: orderArg,
        product: productArg,
        quantity: quantityArg,
        discount: optional(
          discountArg(
            'Rate 0 to 1, e.g. 0.1 (or "10%") for 10% off; default 0',
          ),
        ),
      },
      outputSchema: OrderViewSchema.shape,
      annotations: write({ destructiveHint: false, idempotentHint: false }),
    },
    guarded(apiUrl, async (args) => {
      const refs = new References(api);
      const product = await refs.resolve('product', args.product);
      const order = await suggestOnMissing(
        refs,
        product.note
          ? []
          : [
              {
                field: 'productId',
                kind: 'product',
                code: product.code,
                input: args.product,
              },
            ],
        () =>
          unwrap(
            api.POST('/v1/orders/{id}/lines', {
              params: { path: { id: orderCode(args.order) } },
              body: {
                productId: product.code,
                quantity: args.quantity,
                discount: rate(args.discount),
              },
            }),
          ),
      );
      const view = presentOrder(order);
      const line = view.lines.find((l) => l.product.code === product.code);
      return present(
        sentence(
          product.note,
          `Added ${args.quantity} × ${describeLine(view, product.code)}` +
            `${line ? ` at ${line.unitPrice}` : ''}.`,
          summarizeOrder(view),
        ),
        view,
      );
    }),
  );

  server.registerTool(
    'update_order_line',
    {
      title: 'Update order line',
      description:
        "Change the quantity and/or discount of a product that's already on a pending order. " +
        'The unit price stays as it was when the line was added.',
      inputSchema: {
        order: orderArg,
        product: productArg,
        quantity: optional(quantityArg),
        discount: optional(
          discountArg(
            'New rate 0 to 1, e.g. 0.1 (or "10%"); 0 removes the discount',
          ),
        ),
      },
      outputSchema: OrderViewSchema.shape,
      annotations: write({ destructiveHint: false, idempotentHint: true }),
    },
    guarded(apiUrl, async (args) => {
      if (args.quantity === undefined && args.discount === undefined) {
        throw new Error('Nothing to change: give quantity, discount or both.');
      }
      const product = await new References(api).resolve(
        'product',
        args.product,
      );
      const order = await unwrap(
        api.PATCH('/v1/orders/{id}/lines/{productId}', {
          params: {
            path: { id: orderCode(args.order), productId: product.code },
          },
          body: { quantity: args.quantity, discount: rate(args.discount) },
        }),
      );
      const view = presentOrder(order);
      const line = view.lines.find((l) => l.product.code === product.code);
      return present(
        sentence(
          product.note,
          `Updated ${describeLine(view, product.code)}` +
            `${line ? `: quantity ${line.quantity}, discount ${line.discount}` : ''}.`,
          summarizeOrder(view),
        ),
        view,
      );
    }),
  );

  server.registerTool(
    'remove_order_line',
    {
      title: 'Remove order line',
      description:
        'Remove a product from a pending order. An order keeps at least one line, so the last ' +
        'line cannot be removed.',
      inputSchema: { order: orderArg, product: productArg },
      outputSchema: OrderViewSchema.shape,
      annotations: write({ destructiveHint: true, idempotentHint: true }),
    },
    guarded(apiUrl, async (args) => {
      const product = await new References(api).resolve(
        'product',
        args.product,
      );
      const code = orderCode(args.order);
      // Read the name first: after removal the line (and its product name) is gone.
      const before = presentOrder(await getOrder(code));
      const order = await unwrap(
        api.DELETE('/v1/orders/{id}/lines/{productId}', {
          params: { path: { id: code, productId: product.code } },
        }),
      );
      const view = presentOrder(order);
      return present(
        sentence(
          product.note,
          `Removed ${describeLine(before, product.code)}.`,
          summarizeOrder(view),
        ),
        view,
      );
    }),
  );

  server.registerTool(
    'ship_order',
    {
      title: 'Ship order',
      description:
        'Mark a pending order as shipped. This is final: a shipped order can never be changed ' +
        'again. Needs a shipper, given here or set on the order before. shippedDate defaults ' +
        'to now.',
      inputSchema: {
        order: orderArg,
        shipper: optional(
          codeArg(
            'Shipper code (SHP-01) or name, unless the order already has one',
          ),
        ),
        shippedDate: optional(
          dateArg('Ship date, YYYY-MM-DD (default now; today means now)'),
        ),
      },
      outputSchema: OrderViewSchema.shape,
      annotations: write({ destructiveHint: true, idempotentHint: false }),
    },
    guarded(apiUrl, async (args) => {
      const refs = new References(api);
      const resolved = await refs.resolveAll({
        shipper: { kind: 'shipper', input: args.shipper },
      });
      const order = await suggestOnMissing(
        refs,
        resolved.typed.map((r) => ({ ...r, field: `${r.arg}Id` })),
        () =>
          unwrap(
            api.POST('/v1/orders/{id}/ship', {
              params: { path: { id: orderCode(args.order) } },
              body: {
                shipperId: resolved.codes.shipper,
                // "Today" means now: midnight today would fall before an order placed today.
                shippedDate:
                  args.shippedDate === today(now())
                    ? undefined
                    : args.shippedDate,
              },
            }),
          ),
      );
      const view = presentOrder(order);
      return present(
        sentence(
          ...resolved.notes,
          `Shipped with ${view.shipper?.name ?? 'the chosen shipper'} on ${view.shippedDate}.`,
          summarizeOrder(view),
          'The order is now final and cannot be changed.',
        ),
        view,
      );
    }),
  );
}
