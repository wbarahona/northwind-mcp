import { Schema } from 'mongoose';
import { codePattern } from '../codes';
import {
  type Address,
  AddressSchema,
  codeField,
  collectionOptions,
  type Contact,
  ContactSchema,
  deletedAtField,
  optionalString,
  requiredString,
} from './common';

export interface Supplier {
  /** e.g. `SUP-001` */
  code: string;
  companyName: string;
  contact: Contact;
  address: Address;
  fax: string | null;
  homePage: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const SupplierSchema = new Schema<Supplier>(
  {
    code: codeField(codePattern('suppliers')),
    companyName: requiredString,
    contact: { type: ContactSchema, required: true },
    address: { type: AddressSchema, required: true },
    fax: optionalString,
    homePage: optionalString,
    deletedAt: deletedAtField,
  },
  collectionOptions('suppliers'),
);

SupplierSchema.index({ companyName: 'text', 'contact.name': 'text' });
SupplierSchema.index({ 'address.countryCode': 1 });
