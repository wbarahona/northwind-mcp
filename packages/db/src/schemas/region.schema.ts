import { Schema } from 'mongoose';
import { codePattern, TERRITORY_CODE } from '../codes';
import { codeField, collectionOptions, requiredString } from './common';

export interface Territory {
  /** Classic Northwind territory ID, e.g. `06897`. */
  code: string;
  name: string;
}

export interface Region {
  /** e.g. `REG-01` */
  code: string;
  name: string;
  territories: Territory[];
  createdAt: Date;
  updatedAt: Date;
}

const TerritorySchema = new Schema<Territory>(
  {
    code: {
      type: String,
      required: true,
      match: [TERRITORY_CODE, '{PATH} must be 5 digits'] as const,
    },
    name: requiredString,
  },
  { _id: false },
);

export const RegionSchema = new Schema<Region>(
  {
    code: codeField(codePattern('regions')),
    name: { ...requiredString, unique: true },
    territories: { type: [TerritorySchema], default: [] },
  },
  collectionOptions('regions'),
);

// A territory belongs to exactly one region. Partial, because regions with no territories
// would otherwise all index the same "missing" key and collide.
RegionSchema.index(
  { 'territories.code': 1 },
  {
    unique: true,
    partialFilterExpression: { 'territories.code': { $exists: true } },
  },
);
