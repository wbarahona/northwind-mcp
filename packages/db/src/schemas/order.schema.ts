import { Schema, type Types } from 'mongoose';
import { codePattern } from '../codes';
import { centsToDecimal128 } from '../money';
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
  rateField,
  requiredString,
} from './common';
import { computeOrderTotals } from './order-totals';

export const ORDER_STATUSES = ['pending', 'shipped'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface ShipTo {
  name: string;
  street: string;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
  countryCode: string;
}

export interface OrderLine {
  /** Copied reference to the product. */
  product: NamedRef;
  /** Price at the time of sale; does not follow later product price changes. */
  unitPrice: Types.Decimal128;
  quantity: number;
  /** Rate between 0 and 1, e.g. 0.15 for 15% off. */
  discount: Types.Decimal128;
  /** Computed: unitPrice × quantity × (1 − discount), rounded to the cent. */
  lineTotal: Types.Decimal128;
}

export interface OrderTotals {
  /** Σ unitPrice × quantity, before discounts. */
  subtotal: Types.Decimal128;
  discount: Types.Decimal128;
  /** subtotal − discount: product revenue. */
  net: Types.Decimal128;
  freight: Types.Decimal128;
  /** net + freight. */
  total: Types.Decimal128;
}

export interface Order {
  /** e.g. `ORD-10248` */
  code: string;
  customer: CompanyRef;
  /** `name` is "First Last". */
  employee: NamedRef;
  shipper: CompanyRef | null;
  orderDate: Date;
  requiredDate: Date | null;
  shippedDate: Date | null;
  freight: Types.Decimal128;
  shipTo: ShipTo;
  lines: OrderLine[];
  /** Computed on every save from lines and freight. */
  totals: OrderTotals;
  /** Derived on every save: `shipped` once `shippedDate` is set. */
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

const ShipToSchema = new Schema<ShipTo>(
  {
    name: requiredString,
    street: requiredString,
    city: requiredString,
    region: optionalString,
    postalCode: optionalString,
    country: requiredString,
    countryCode: {
      type: String,
      required: true,
      uppercase: true,
      match: [/^[A-Z]{2}$/, '{PATH} must be an ISO 3166-1 alpha-2 code'],
    },
  },
  { _id: false },
);

const OrderLineSchema = new Schema<OrderLine>(
  {
    product: { type: NamedRefSchema, required: true },
    unitPrice: moneyField(),
    quantity: intField(1),
    discount: rateField(),
    lineTotal: moneyField(),
  },
  { _id: false },
);

const OrderTotalsSchema = new Schema<OrderTotals>(
  {
    subtotal: moneyField(),
    discount: moneyField(),
    net: moneyField(),
    freight: moneyField(),
    total: moneyField(),
  },
  { _id: false },
);

export const OrderSchema = new Schema<Order>(
  {
    code: codeField(codePattern('orders')),
    customer: { type: CompanyRefSchema, required: true },
    employee: { type: NamedRefSchema, required: true },
    shipper: { type: CompanyRefSchema, default: null },
    orderDate: { type: Date, required: true },
    requiredDate: { type: Date, default: null },
    shippedDate: { type: Date, default: null },
    freight: { ...moneyField(), default: '0.00' },
    shipTo: { type: ShipToSchema, required: true },
    lines: {
      type: [OrderLineSchema],
      validate: [
        {
          validator: (lines: OrderLine[]) => lines.length > 0,
          message: 'An order needs at least one line',
        },
        {
          validator: (lines: OrderLine[]) => {
            const ids = lines.map((line) => String(line.product?._id));
            return new Set(ids).size === ids.length;
          },
          message: 'Each product can appear only once per order',
        },
      ],
    },
    totals: { type: OrderTotalsSchema, required: true },
    status: {
      type: String,
      required: true,
      enum: ORDER_STATUSES,
      default: 'pending',
    },
  },
  {
    ...collectionOptions('orders'),
    // Orders are edited by load-modify-save; a version check makes concurrent edits fail
    // with a VersionError instead of silently overwriting each other.
    versionKey: '__v',
    optimisticConcurrency: true,
  },
);

/**
 * Derived fields are recomputed before every validation, so they can't drift from the
 * lines. Runs on save(), create() and insertMany(); query updates (updateOne,
 * findOneAndUpdate) bypass document middleware, so services must load, modify and save().
 */
OrderSchema.pre('validate', function () {
  this.status = this.shippedDate ? 'shipped' : 'pending';

  const totals = computeOrderTotals(this.lines, this.freight);
  if (!totals) return; // malformed input: let validation report the specific fields

  this.lines.forEach((line, i) => {
    line.lineTotal = centsToDecimal128(totals.lineTotals[i] ?? 0n);
  });
  this.totals = {
    subtotal: centsToDecimal128(totals.subtotal),
    discount: centsToDecimal128(totals.discount),
    net: centsToDecimal128(totals.net),
    freight: centsToDecimal128(totals.freight),
    total: centsToDecimal128(totals.total),
  };
});

// Customer / employee order history, newest first.
OrderSchema.index({ 'customer._id': 1, orderDate: -1 });
OrderSchema.index({ 'employee._id': 1, orderDate: -1 });
// Date-range analytics and default listing.
OrderSchema.index({ orderDate: -1 });
// Orders containing a product.
OrderSchema.index({ 'lines.product._id': 1 });
// Overdue: pending orders past their required date.
OrderSchema.index({ status: 1, requiredDate: 1 });
