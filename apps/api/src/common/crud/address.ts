import type { Address } from '@northwind/db';
import { countryName } from '../country';
import type { AddressInputDto } from '../dto/address.dto';
import { ValidationException } from '../errors/validation.exception';

/** Request address → stored address, filling in the English country name from the ISO code. */
export function toAddress(input: AddressInputDto, field = 'address'): Address {
  const countryCode = input.countryCode.toUpperCase();
  const country = countryName(countryCode);
  if (!country) {
    throw new ValidationException([
      {
        field: `${field}.countryCode`,
        messages: [
          `"${input.countryCode}" is not an ISO 3166-1 alpha-2 country code.`,
        ],
      },
    ]);
  }
  return {
    street: input.street,
    city: input.city,
    region: input.region ?? null,
    postalCode: input.postalCode ?? null,
    country,
    countryCode,
  };
}
