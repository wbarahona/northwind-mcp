import { isMoney, isRate } from '@northwind/db';
import { Transform } from 'class-transformer';
import { Matches, ValidateBy, type ValidationOptions } from 'class-validator';

/** Decimal amount ≥ 0 with at most 2 decimals; a decimal string ("18.00") or a JSON number. */
export function IsMoneyAmount(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isMoneyAmount',
      validator: {
        validate: (value: unknown) =>
          (typeof value === 'string' || typeof value === 'number') &&
          isMoney(value),
        defaultMessage: () =>
          '$property must be a non-negative amount with at most 2 decimal places, e.g. "18.00"',
      },
    },
    options,
  );
}

/** Discount rate between 0 and 1 with at most 4 decimals (0.15 = 15% off). */
export function IsDiscountRate(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isDiscountRate',
      validator: {
        validate: (value: unknown) =>
          (typeof value === 'string' || typeof value === 'number') &&
          isRate(value),
        defaultMessage: () =>
          '$property must be between 0 and 1 (e.g. 0.15 for 15% off), at most 4 decimal places',
      },
    },
    options,
  );
}

export const E164 = /^\+[1-9]\d{6,14}$/;

export function IsE164Phone(options?: ValidationOptions): PropertyDecorator {
  return Matches(E164, {
    message: '$property must be an E.164 phone number, e.g. "+49300074321"',
    ...options,
  });
}

const ID_OR_CODE = /^([0-9a-fA-F]{24}|[A-Za-z0-9][A-Za-z0-9-]{0,31})$/;

/** A reference by ObjectId or readable code ("CAT-01", "ALFKI"). */
export function IsIdOrCode(options?: ValidationOptions): PropertyDecorator {
  return Matches(ID_OR_CODE, {
    message: '$property must be an ObjectId or a code such as "CAT-01"',
    ...options,
  });
}

/**
 * Query strings are text: maps "true"/"false" (and 1/0) to booleans. Anything else is left
 * as-is so `@IsBoolean()` rejects it instead of silently treating it as true.
 */
export function ToBoolean(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === '1' || value === true) return true;
    if (value === 'false' || value === '0' || value === false) return false;
    return value;
  });
}
