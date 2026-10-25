/**
 * Compile-time checks, run by `typecheck`: the generated types match the API's contract.
 * Each @ts-expect-error must fail to compile; if a type changes, typecheck fails here.
 */
import type { Order, Product } from './index';

declare const order: Order;
declare const product: Product;

// Money is a decimal string, never a number.
export const total: string = order.totals.total;
// @ts-expect-error unitPrice is a string such as "18.00"
export const price: number = product.unitPrice;

// Status is a closed set.
export const status: 'pending' | 'shipped' = order.status;

// Not-yet-shipped orders have no shipper or shipped date.
// @ts-expect-error shippedDate can be null
export const shipped: string = order.shippedDate;
export const shipper: string | undefined = order.shipper?.code;
