import { Schema } from 'mongoose';
import { codePattern } from '../codes';
import {
  codeField,
  collectionOptions,
  deletedAtField,
  optionalString,
  requiredString,
} from './common';

export interface Shipper {
  /** e.g. `SHP-01` */
  code: string;
  companyName: string;
  /** E.164 when it could be parsed. */
  phone: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const ShipperSchema = new Schema<Shipper>(
  {
    code: codeField(codePattern('shippers')),
    companyName: requiredString,
    phone: optionalString,
    deletedAt: deletedAtField,
  },
  collectionOptions('shippers'),
);
