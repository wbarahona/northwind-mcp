import { Schema } from 'mongoose';
import { codePattern, TERRITORY_CODE } from '../codes';
import {
  type Address,
  AddressSchema,
  codeField,
  collectionOptions,
  deletedAtField,
  emailField,
  type NamedRef,
  NamedRefSchema,
  optionalString,
  requiredString,
} from './common';

export interface EmployeeTerritory {
  code: string;
  name: string;
  /** Code of the region the territory belongs to, e.g. `REG-01`. */
  regionCode: string;
}

export interface Employee {
  /** e.g. `EMP-001` */
  code: string;
  firstName: string;
  lastName: string;
  title: string | null;
  titleOfCourtesy: string | null;
  email: string | null;
  /** E.164 when it could be parsed. */
  phone: string | null;
  extension: string | null;
  birthDate: Date | null;
  hireDate: Date | null;
  address: Address;
  notes: string | null;
  /** Manager, as a copied reference (`name` is "First Last"); null at the top. */
  reportsTo: NamedRef | null;
  territories: EmployeeTerritory[];
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeTerritorySchema = new Schema<EmployeeTerritory>(
  {
    code: {
      type: String,
      required: true,
      match: [TERRITORY_CODE, '{PATH} must be 5 digits'] as const,
    },
    name: requiredString,
    regionCode: {
      type: String,
      required: true,
      match: codePattern('regions'),
    },
  },
  { _id: false },
);

export const EmployeeSchema = new Schema<Employee>(
  {
    code: codeField(codePattern('employees')),
    firstName: requiredString,
    lastName: requiredString,
    title: optionalString,
    titleOfCourtesy: optionalString,
    email: emailField,
    phone: optionalString,
    extension: optionalString,
    birthDate: { type: Date, default: null },
    hireDate: { type: Date, default: null },
    address: { type: AddressSchema, required: true },
    notes: optionalString,
    reportsTo: { type: NamedRefSchema, default: null },
    territories: { type: [EmployeeTerritorySchema], default: [] },
    deletedAt: deletedAtField,
  },
  collectionOptions('employees'),
);

EmployeeSchema.index({ 'reportsTo._id': 1 });
EmployeeSchema.index({ 'territories.code': 1 });
