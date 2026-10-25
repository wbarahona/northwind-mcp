/** Every country in classic Northwind, with a modern display name and ISO 3166-1 alpha-2 code. */
const COUNTRIES: Record<string, { name: string; code: string }> = {
  Argentina: { name: 'Argentina', code: 'AR' },
  Australia: { name: 'Australia', code: 'AU' },
  Austria: { name: 'Austria', code: 'AT' },
  Belgium: { name: 'Belgium', code: 'BE' },
  Brazil: { name: 'Brazil', code: 'BR' },
  Canada: { name: 'Canada', code: 'CA' },
  Denmark: { name: 'Denmark', code: 'DK' },
  Finland: { name: 'Finland', code: 'FI' },
  France: { name: 'France', code: 'FR' },
  Germany: { name: 'Germany', code: 'DE' },
  Ireland: { name: 'Ireland', code: 'IE' },
  Italy: { name: 'Italy', code: 'IT' },
  Japan: { name: 'Japan', code: 'JP' },
  Mexico: { name: 'Mexico', code: 'MX' },
  Netherlands: { name: 'Netherlands', code: 'NL' },
  Norway: { name: 'Norway', code: 'NO' },
  Poland: { name: 'Poland', code: 'PL' },
  Portugal: { name: 'Portugal', code: 'PT' },
  Singapore: { name: 'Singapore', code: 'SG' },
  Spain: { name: 'Spain', code: 'ES' },
  Sweden: { name: 'Sweden', code: 'SE' },
  Switzerland: { name: 'Switzerland', code: 'CH' },
  UK: { name: 'United Kingdom', code: 'GB' },
  USA: { name: 'United States', code: 'US' },
  Venezuela: { name: 'Venezuela', code: 'VE' },
};

/** Throws on an unknown country so a gap in the table can't slip through silently. */
export function normalizeCountry(raw: string): { name: string; code: string } {
  const country = COUNTRIES[raw.trim()];
  if (!country) throw new Error(`Unknown country in source data: "${raw}"`);
  return country;
}
