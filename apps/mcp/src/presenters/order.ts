import type {
  Customer,
  Order,
  OrderSummary,
  OverdueOrder,
} from '@northwind/api-client';
import { z } from 'zod';
import { Address, compact, Day, day, Money, Ref } from './common';

export const OrderLineView = z.object({
  product: Ref,
  unitPrice: Money.describe('Price per unit when the order was placed'),
  quantity: z.number(),
  discount: z.string().describe('Rate between 0 and 1; "0.15" is 15% off'),
  lineTotal: Money.describe('unitPrice × quantity × (1 − discount)'),
});

export const OrderTotalsView = z.object({
  subtotal: Money.describe('Before discounts'),
  discount: Money,
  net: Money.describe('subtotal − discount: the product revenue'),
  freight: Money,
  total: Money.describe('net + freight: what the customer pays'),
});

export const OrderView = z.object({
  code: z.string(),
  status: z
    .enum(['pending', 'shipped'])
    .describe('Only pending orders can be changed'),
  customer: Ref,
  employee: Ref.describe('The sales employee who took the order'),
  shipper: Ref.optional().describe('Absent until chosen or shipped'),
  orderDate: Day,
  requiredDate: Day.optional(),
  shippedDate: Day.optional().describe('Absent until shipped'),
  shipTo: Address,
  lines: z.array(OrderLineView),
  totals: OrderTotalsView,
});
export type OrderView = z.infer<typeof OrderView>;

export function presentOrder(order: Order): OrderView {
  return compact({
    code: order.code,
    status: order.status,
    customer: { code: order.customer.code, name: order.customer.companyName },
    employee: { code: order.employee.code, name: order.employee.name },
    shipper: order.shipper && {
      code: order.shipper.code,
      name: order.shipper.companyName,
    },
    orderDate: day(order.orderDate),
    requiredDate: order.requiredDate && day(order.requiredDate),
    shippedDate: order.shippedDate && day(order.shippedDate),
    shipTo: compact({
      name: order.shipTo.name,
      street: order.shipTo.street,
      city: order.shipTo.city,
      region: order.shipTo.region,
      postalCode: order.shipTo.postalCode,
      country: order.shipTo.country,
      countryCode: order.shipTo.countryCode,
    }),
    lines: order.lines.map((line) => ({
      product: { code: line.product.code, name: line.product.name },
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      discount: line.discount,
      lineTotal: line.lineTotal,
    })),
    totals: {
      subtotal: order.totals.subtotal,
      discount: order.totals.discount,
      net: order.totals.net,
      freight: order.totals.freight,
      total: order.totals.total,
    },
  });
}

/** One line for the model: what the order is, before the data. */
export function summarizeOrder(order: OrderView): string {
  const when =
    order.status === 'shipped'
      ? `placed ${order.orderDate}, shipped ${order.shippedDate}`
      : `placed ${order.orderDate}, pending (not shipped yet)`;
  const lines = `${order.lines.length} line${order.lines.length === 1 ? '' : 's'}`;
  return (
    `Order ${order.code} for ${order.customer.name} (${order.customer.code}), ${when}: ` +
    `${lines}, net ${order.totals.net}, total ${order.totals.total} including ${order.totals.freight} freight.`
  );
}

export const OrderSummaryView = z.object({
  code: z.string(),
  status: z.enum(['pending', 'shipped']),
  customer: Ref,
  employee: Ref,
  orderDate: Day,
  requiredDate: Day.optional(),
  shippedDate: Day.optional(),
  net: Money.describe('Product revenue after discounts, before freight'),
  total: Money.describe('net + freight'),
  lines: z
    .array(OrderLineView)
    .optional()
    .describe('Only when includeLines was set'),
});
export type OrderSummaryView = z.infer<typeof OrderSummaryView>;

export function presentOrderSummary(
  order: OrderSummary,
  full?: Order,
): OrderSummaryView {
  return compact({
    code: order.code,
    status: order.status,
    customer: { code: order.customer.code, name: order.customer.companyName },
    employee: { code: order.employee.code, name: order.employee.name },
    orderDate: day(order.orderDate),
    requiredDate: order.requiredDate && day(order.requiredDate),
    shippedDate: order.shippedDate && day(order.shippedDate),
    net: order.totals.net,
    total: order.totals.total,
    lines: full && presentOrder(full).lines,
  });
}

export const OverdueOrderView = OrderSummaryView.omit({
  lines: true,
  customer: true,
}).extend({
  daysLate: z
    .number()
    .describe(
      'Days past the required date (still open), or shipped this many days late',
    ),
  customer: Ref.extend({
    contact: z
      .object({
        name: z.string(),
        title: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
      })
      .optional()
      .describe('Who to call about it'),
  }),
});

/** Overdue rows carry the customer's contact, so "who should we call?" needs no second call. */
export function presentOverdueOrder(
  order: OverdueOrder,
  customers: ReadonlyMap<string, Customer>,
): z.infer<typeof OverdueOrderView> {
  const { lines: _lines, customer, ...summary } = presentOrderSummary(order);
  const found = customers.get(customer.code);
  return {
    ...summary,
    daysLate: order.daysLate,
    customer: compact({
      ...customer,
      contact:
        found &&
        compact({
          name: found.contact.name,
          title: found.contact.title,
          phone: found.contact.phone,
          email: found.contact.email,
        }),
    }),
  };
}
