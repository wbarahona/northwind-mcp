import { Schema, type Types } from 'mongoose';
import { codePattern } from '../codes';
import {
  codeField,
  collectionOptions,
  type CompanyRef,
  CompanyRefSchema,
  intField,
  moneyField,
  type NamedRef,
  NamedRefSchema,
  optionalString,
  requiredString,
} from './common';

export interface Product {
  /** e.g. `PRD-001` */
  code: string;
  name: string;
  /** Copied reference; the name is kept in sync when the category is renamed. */
  category: NamedRef;
  /** Copied reference; the name is kept in sync when the supplier is renamed. */
  supplier: CompanyRef;
  /** Free text, e.g. "10 boxes x 20 bags". */
  quantityPerUnit: string | null;
  /** Current list price. Orders copy it at sale time. */
  unitPrice: Types.Decimal128;
  unitsInStock: number;
  unitsOnOrder: number;
  /** Reorder when stock + on-order falls to this level. */
  reorderLevel: number;
  discontinued: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const ProductSchema = new Schema<Product>(
  {
    code: codeField(codePattern('products')),
    name: requiredString,
    category: { type: NamedRefSchema, required: true },
    supplier: { type: CompanyRefSchema, required: true },
    quantityPerUnit: optionalString,
    unitPrice: moneyField(),
    unitsInStock: intField(0, 0),
    unitsOnOrder: intField(0, 0),
    reorderLevel: intField(0, 0),
    discontinued: { type: Boolean, required: true, default: false },
  },
  collectionOptions('products'),
);

ProductSchema.index({ name: 'text' });
ProductSchema.index({ 'category._id': 1 });
ProductSchema.index({ 'supplier._id': 1 });
ProductSchema.index({ discontinued: 1 });
