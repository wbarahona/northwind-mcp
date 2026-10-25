import {
  type CountryCode,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';

export interface PhoneResult {
  phone: string | null;
  /** True when the number couldn't be read as a phone number and was kept as written. */
  keptAsIs: boolean;
}

/**
 * Converts a Northwind phone ("030-0074321", "(5) 555-4729") to E.164 using the record's
 * country. Uses "possible" (length) rather than "valid" (real number ranges): the data is
 * full of fictional 555 numbers that are well-formed but not assigned.
 */
export function normalizePhone(
  raw: string | null,
  countryCode: string,
): PhoneResult {
  if (raw === null || raw.trim() === '')
    return { phone: null, keptAsIs: false };

  const parsed = parsePhoneNumberFromString(raw, countryCode as CountryCode);
  if (parsed?.isPossible()) return { phone: parsed.number, keptAsIs: false };
  return { phone: raw.trim(), keptAsIs: true };
}
