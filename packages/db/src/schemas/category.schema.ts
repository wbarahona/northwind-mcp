import { Schema } from 'mongoose';
import { codePattern } from '../codes';
import {
  codeField,
  collectionOptions,
  optionalString,
  requiredString,
} from './common';

export interface Category {
  /** e.g. `CAT-01` */
  code: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const CategorySchema = new Schema<Category>(
  {
    code: codeField(codePattern('categories')),
    name: { ...requiredString, unique: true },
    description: optionalString,
  },
  collectionOptions('categories'),
);
