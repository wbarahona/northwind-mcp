import { Schema } from 'mongoose';
import { CUSTOMER_CODE } from '../codes';
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

export interface Customer {
  /** Classic Northwind customer ID, e.g. `ALFKI`. */
  code: string;
  companyName: string;
  contact: Contact;
  address: Address;
  fax: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const CustomerSchema = new Schema<Customer>(
  {
    code: codeField(CUSTOMER_CODE),
    companyName: requiredString,
    contact: { type: ContactSchema, required: true },
    address: { type: AddressSchema, required: true },
    fax: optionalString,
    deletedAt: deletedAtField,
  },
  collectionOptions('customers'),
);

CustomerSchema.index({ companyName: 'text', 'contact.name': 'text' });
CustomerSchema.index({ 'address.countryCode': 1, 'address.city': 1 });
