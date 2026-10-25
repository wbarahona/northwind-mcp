import { Schema, type SchemaOptions, Types } from 'mongoose';
import { isMoney, isRate, normalizeMoney, normalizeRate } from '../money';

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

/** Decimal128 amount, normalized to 2 decimals and never negative. */
export function moneyField(required = true) {
  return {
    type: Schema.Types.Decimal128,
    required,
    set: normalizeMoney,
    validate: {
      validator: isMoney,
      message:
        '{PATH} must be a non-negative amount with at most 2 decimal places',
    },
  };
}

/** Decimal128 rate between 0 and 1 (e.g. a 15% discount is 0.15). */
export function rateField() {
  return {
    type: Schema.Types.Decimal128,
    required: true,
    default: '0',
    set: normalizeRate,
    validate: {
      validator: isRate,
      message: '{PATH} must be between 0 and 1 with at most 4 decimal places',
    },
  };
}

export function intField(min = 0, defaultValue?: number) {
  return {
    type: Number,
    required: true,
    min,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    validate: {
      validator: Number.isInteger,
      message: '{PATH} must be an integer',
    },
  };
}

/** Readable, unique code. The unique index is declared here; the format is per collection. */
export function codeField(pattern: RegExp) {
  return {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    match: [
      pattern,
      '{PATH} "{VALUE}" does not match the expected format',
    ] as const,
  };
}

export const requiredString = { type: String, required: true, trim: true };
export const optionalString = { type: String, trim: true, default: null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const emailField = {
  type: String,
  trim: true,
  lowercase: true,
  default: null,
  match: [EMAIL, '{PATH} must be a valid email address'] as const,
};

/** Soft delete marker; null while the record is active. */
export const deletedAtField = { type: Date, default: null };

/** Options every top-level collection uses. */
export function collectionOptions(collection: string): SchemaOptions {
  return { collection, timestamps: true, versionKey: false };
}

// ---------------------------------------------------------------------------
// Embedded value objects
// ---------------------------------------------------------------------------

export interface Address {
  street: string;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
  /** ISO 3166-1 alpha-2, e.g. `DE`. */
  countryCode: string;
}

export const AddressSchema = new Schema<Address>(
  {
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

export interface Contact {
  name: string;
  title: string | null;
  email: string | null;
  /** E.164 when it could be parsed, e.g. `+49300074321`. */
  phone: string | null;
}

export const ContactSchema = new Schema<Contact>(
  {
    name: requiredString,
    title: optionalString,
    email: emailField,
    phone: optionalString,
  },
  { _id: false },
);

// ---------------------------------------------------------------------------
// Copied references ("snapshots"): the _id and code of another document plus its
// display name, so reads need no joins. Kept in sync when the original is renamed.
// ---------------------------------------------------------------------------

export interface NamedRef {
  _id: Types.ObjectId;
  code: string;
  name: string;
}

export interface CompanyRef {
  _id: Types.ObjectId;
  code: string;
  companyName: string;
}

const refFields = {
  _id: { type: Schema.Types.ObjectId, required: true },
  code: { type: String, required: true },
};

export const NamedRefSchema = new Schema<NamedRef>(
  { ...refFields, name: requiredString },
  { _id: false },
);

export const CompanyRefSchema = new Schema<CompanyRef>(
  { ...refFields, companyName: requiredString },
  { _id: false },
);
