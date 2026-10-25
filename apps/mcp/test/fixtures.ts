import type { Order, ProblemDetails } from '@northwind/api-client';

const ref = (code: string, name: string) => ({
  id: '6955b9007f176b5b1a33c31c',
  code,
  name,
});

/** ORD-10248 as the API returns it (classic Northwind values, shifted dates). */
export const ORDER_10248: Order = {
  id: '6955b9007f176b5b1a33c31c',
  code: 'ORD-10248',
  customer: {
    id: '6955b9007f176b5b1a33c31d',
    code: 'VINET',
    companyName: 'Vins et alcools Chevalier',
  },
  employee: ref('EMP-005', 'Steven Buchanan'),
  shipper: {
    id: '6955b9007f176b5b1a33c31e',
    code: 'SHP-03',
    companyName: 'Federal Shipping',
  },
  orderDate: '2024-12-26T00:00:00.000Z',
  requiredDate: '2025-01-23T00:00:00.000Z',
  shippedDate: '2025-01-07T00:00:00.000Z',
  freight: '32.38',
  shipTo: {
    name: 'Vins et alcools Chevalier',
    street: "59 rue de l'Abbaye",
    city: 'Reims',
    region: null,
    postalCode: '51100',
    country: 'France',
    countryCode: 'FR',
  },
  lines: [
    {
      product: ref('PRD-011', 'Queso Cabrales'),
      unitPrice: '14.00',
      quantity: 12,
      discount: '0',
      lineTotal: '168.00',
    },
    {
      product: ref('PRD-042', 'Singaporean Hokkien Fried Mee'),
      unitPrice: '9.80',
      quantity: 10,
      discount: '0',
      lineTotal: '98.00',
    },
    {
      product: ref('PRD-072', 'Mozzarella di Giovanni'),
      unitPrice: '34.80',
      quantity: 5,
      discount: '0',
      lineTotal: '174.00',
    },
  ],
  totals: {
    subtotal: '440.00',
    discount: '0.00',
    net: '440.00',
    freight: '32.38',
    total: '472.38',
  },
  status: 'shipped',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** A pending order placed today: no shipper or shipped date yet, and a time of day. */
export const PENDING_ORDER: Order = {
  ...ORDER_10248,
  code: 'ORD-11078',
  shipper: null,
  orderDate: '2026-10-23T14:05:09.120Z',
  requiredDate: null,
  shippedDate: null,
  lines: [ORDER_10248.lines[0]!],
  status: 'pending',
};

export const problem = (
  status: number,
  title: string,
  detail: string,
): ProblemDetails => ({ type: 'about:blank', title, status, detail });
