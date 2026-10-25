import type { Customer, OrderSummary } from '@northwind/api-client';
import { z } from 'zod';
import { Address, compact, Day, day, Money } from './common';
import { sumMoney } from './money';

const Contact = z.object({
  name: z.string(),
  title: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
});

const deleted = z
  .string()
  .optional()
  .describe('Set when the customer was deleted; old orders still refer to it');

export const CustomerRow = z.object({
  code: z.string(),
  name: z.string(),
  contact: Contact.pick({ name: true, title: true }),
  city: z.string(),
  country: z.string(),
  deleted,
});

export const OrderStats = z.object({
  orders: z.number().describe('All orders ever placed'),
  pending: z.number().describe('Not shipped yet'),
  lifetimeRevenue: Money.describe(
    'Net sales over all their orders (after discounts, before freight)',
  ),
  firstOrderDate: Day.optional(),
  lastOrderDate: Day.optional(),
});

export const CustomerView = z.object({
  code: z.string(),
  name: z.string(),
  contact: Contact,
  address: Address.omit({ name: true }),
  fax: z.string().optional(),
  deleted,
  orderStats: OrderStats,
});
export type CustomerView = z.infer<typeof CustomerView>;

export function presentCustomerRow(c: Customer): z.infer<typeof CustomerRow> {
  return compact({
    code: c.code,
    name: c.companyName,
    contact: compact({ name: c.contact.name, title: c.contact.title }),
    city: c.address.city,
    country: c.address.country,
    deleted: c.deletedAt && day(c.deletedAt),
  });
}

/** Exact totals over a customer's orders, so nobody has to add them up. */
export function orderStats(orders: OrderSummary[]): z.infer<typeof OrderStats> {
  const dates = orders.map((o) => o.orderDate).sort();
  return compact({
    orders: orders.length,
    pending: orders.filter((o) => o.status === 'pending').length,
    lifetimeRevenue: sumMoney(orders.map((o) => o.totals.net)),
    firstOrderDate: dates[0] && day(dates[0]),
    lastOrderDate: dates.at(-1) && day(dates.at(-1)!),
  });
}

export function presentCustomer(
  c: Customer,
  orders: OrderSummary[],
): CustomerView {
  return compact({
    code: c.code,
    name: c.companyName,
    contact: compact({
      name: c.contact.name,
      title: c.contact.title,
      email: c.contact.email,
      phone: c.contact.phone,
    }),
    address: compact({
      street: c.address.street,
      city: c.address.city,
      region: c.address.region,
      postalCode: c.address.postalCode,
      country: c.address.country,
      countryCode: c.address.countryCode,
    }),
    fax: c.fax,
    deleted: c.deletedAt && day(c.deletedAt),
    orderStats: orderStats(orders),
  });
}
