import type { components } from '@northwind/api-client';
import { z } from 'zod';
import { PERIODS } from '../periods';
import { compact, Day, day, Money, Ref } from './common';
import { fromCents, percentOf, sumMoney, toCents } from './money';

type Schemas = components['schemas'];

/** The range a report covers, echoed in every result. */
export const RangeView = z.object({
  period: z.enum(PERIODS).optional(),
  from: Day.optional().describe('First day included'),
  to: Day.optional().describe('Exclusive end: the first day NOT included'),
  status: z.enum(['pending', 'shipped']).optional(),
});
export type RangeView = z.infer<typeof RangeView>;

// ------------------------------------------------------------------ over time

export const PeriodRow = z.object({
  label: z.string().describe('2026-03, 2026-Q1, 2026-W11, 2026 or 2026-03-02'),
  start: Day,
  revenue: Money,
  orders: z.number(),
  averageOrderValue: Money,
});

export const SalesTotals = z.object({
  revenue: Money,
  orders: z.number(),
  averageOrderValue: Money,
});

export function presentPeriod(
  p: Schemas['SalesPeriodDto'],
): z.infer<typeof PeriodRow> {
  return {
    label: p.label,
    start: day(p.periodStart),
    revenue: p.revenue,
    orders: p.orders,
    averageOrderValue: p.averageOrderValue,
  };
}

/** Revenue and orders summed over rows, with the average order value (half up, like the API). */
export function totals(
  rows: { revenue: string; orders: number }[],
): z.infer<typeof SalesTotals> {
  const revenue = sumMoney(rows.map((r) => r.revenue));
  const orders = rows.reduce((n, r) => n + r.orders, 0);
  const cents = toCents(revenue);
  return {
    revenue,
    orders,
    averageOrderValue: orders
      ? fromCents((cents * 2n + BigInt(orders)) / (2n * BigInt(orders)))
      : '0.00',
  };
}

// ------------------------------------------------------------------ breakdowns

export const BREAKDOWNS = [
  'category',
  'product',
  'customer',
  'employee',
  'country',
] as const;
export type Breakdown = (typeof BREAKDOWNS)[number];

/** One shape for every dimension; fields that don't apply are left out. */
export const BreakdownRow = z.object({
  rank: z.number(),
  code: z
    .string()
    .describe('Record code, or the ISO country code for by=country'),
  name: z.string(),
  revenue: Money,
  orders: z.number(),
  sharePercent: z
    .number()
    .optional()
    .describe('Share of total revenue in the range (complete lists only)'),
  units: z.number().optional(),
  averageOrderValue: Money.optional(),
  customers: z.number().optional().describe('Distinct customers'),
  category: Ref.optional().describe('by=product'),
  title: z.string().optional().describe('by=employee'),
  countryCode: z.string().optional().describe('by=customer'),
  lastOrderDate: Day.optional().describe('by=customer, within the range'),
});
export type BreakdownRow = z.infer<typeof BreakdownRow>;

type Unranked = Omit<BreakdownRow, 'rank'>;

export const breakdownRows = {
  category: (r: Schemas['CategorySalesDto']): Unranked => ({
    code: r.category.code,
    name: r.category.name,
    revenue: r.revenue,
    orders: r.orders,
    sharePercent: r.sharePercent,
    units: r.units,
  }),
  product: (r: Schemas['ProductSalesDto']): Unranked => ({
    code: r.product.code,
    name: r.product.name,
    revenue: r.revenue,
    orders: r.orders,
    units: r.units,
    category: { code: r.category.code, name: r.category.name },
  }),
  customer: (r: Schemas['CustomerSalesDto']): Unranked => ({
    code: r.customer.code,
    name: r.customer.companyName,
    revenue: r.revenue,
    orders: r.orders,
    averageOrderValue: r.averageOrderValue,
    countryCode: r.countryCode,
    lastOrderDate: day(r.lastOrderDate),
  }),
  employee: (r: Schemas['EmployeeSalesDto']): Unranked =>
    compact({
      code: r.employee.code,
      name: r.employee.name,
      revenue: r.revenue,
      orders: r.orders,
      averageOrderValue: r.averageOrderValue,
      customers: r.customers,
      title: r.title,
    }),
  country: (r: Schemas['CountrySalesDto']): Unranked => ({
    code: r.countryCode,
    name: r.country,
    revenue: r.revenue,
    orders: r.orders,
    sharePercent: r.sharePercent,
    customers: r.customers,
  }),
};

/** Adds shares where the API doesn't (the list must be complete for a share to mean anything). */
export function withShares(rows: Unranked[]): Unranked[] {
  const total = sumMoney(rows.map((r) => r.revenue));
  return rows.map((r) =>
    r.sharePercent === undefined
      ? { ...r, sharePercent: percentOf(r.revenue, total) }
      : r,
  );
}

export const rank = (rows: Unranked[]): BreakdownRow[] =>
  rows.map((r, i) => ({ rank: i + 1, ...r }));

// ------------------------------------------------------------------ shipping

export const ShipperRow = z.object({
  shipper: Ref,
  shippedOrders: z.number(),
  averageDaysToShip: z.number().describe('From order date to shipped date'),
  lateShipments: z.number().describe('Shipped after the required date'),
  onTimePercent: z.number(),
  totalFreight: Money,
  averageFreight: Money,
});

export function presentShipperPerformance(
  r: Schemas['ShipperPerformanceDto'],
): z.infer<typeof ShipperRow> {
  return {
    shipper: { code: r.shipper.code, name: r.shipper.companyName },
    shippedOrders: r.shippedOrders,
    averageDaysToShip: r.averageDaysToShip,
    lateShipments: r.lateShipments,
    onTimePercent: r.onTimePercent,
    totalFreight: r.totalFreight,
    averageFreight: r.averageFreight,
  };
}
