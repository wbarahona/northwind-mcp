import type { LowStockProduct, Product, Supplier } from '@northwind/api-client';
import { z } from 'zod';
import { compact, Money, Ref } from './common';

export const ProductRow = z.object({
  code: z.string(),
  name: z.string(),
  category: Ref,
  supplier: Ref,
  unitPrice: Money.describe('Current list price per unit'),
  quantityPerUnit: z.string().optional(),
  unitsInStock: z.number(),
  discontinued: z
    .literal(true)
    .optional()
    .describe(
      'Present only when discontinued; discontinued products cannot be ordered',
    ),
});

export const ProductView = ProductRow.extend({
  unitsOnOrder: z.number(),
  reorderLevel: z.number(),
  needsReorder: z
    .boolean()
    .describe(
      'In stock + on order is at or below the reorder level (active products only)',
    ),
});
export type ProductView = z.infer<typeof ProductView>;

export const LowStockRow = ProductRow.omit({
  supplier: true,
  discontinued: true,
}).extend({
  unitsOnOrder: z.number(),
  reorderLevel: z.number(),
  shortfall: z
    .number()
    .describe('reorderLevel − (unitsInStock + unitsOnOrder)'),
  supplier: Ref.extend({
    contact: z
      .object({
        name: z.string(),
        title: z.string().optional(),
        phone: z.string().optional(),
      })
      .optional()
      .describe('Who to call to reorder'),
  }),
});

const ref = (r: { code: string; name?: string; companyName?: string }) => ({
  code: r.code,
  name: r.name ?? r.companyName ?? '',
});

export function presentProductRow(p: Product): z.infer<typeof ProductRow> {
  return compact({
    code: p.code,
    name: p.name,
    category: ref(p.category),
    supplier: ref(p.supplier),
    unitPrice: p.unitPrice,
    quantityPerUnit: p.quantityPerUnit,
    unitsInStock: p.unitsInStock,
    discontinued: p.discontinued ? (true as const) : undefined,
  });
}

export function presentProduct(p: Product): ProductView {
  return {
    ...presentProductRow(p),
    unitsOnOrder: p.unitsOnOrder,
    reorderLevel: p.reorderLevel,
    needsReorder:
      !p.discontinued && p.unitsInStock + p.unitsOnOrder <= p.reorderLevel,
  };
}

/** Low-stock rows name the supplier and who to call there, so "who do we reorder from?" needs no second call. */
export function presentLowStockRow(
  p: LowStockProduct,
  suppliers: ReadonlyMap<string, Supplier>,
): z.infer<typeof LowStockRow> {
  const supplier = suppliers.get(p.supplier.code);
  return compact({
    code: p.code,
    name: p.name,
    category: ref(p.category),
    unitPrice: p.unitPrice,
    quantityPerUnit: p.quantityPerUnit,
    unitsInStock: p.unitsInStock,
    unitsOnOrder: p.unitsOnOrder,
    reorderLevel: p.reorderLevel,
    shortfall: p.shortfall,
    supplier: compact({
      ...ref(p.supplier),
      contact:
        supplier &&
        compact({
          name: supplier.contact.name,
          title: supplier.contact.title,
          phone: supplier.contact.phone,
        }),
    }),
  });
}
