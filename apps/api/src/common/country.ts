const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** ISO user-assigned / reserved codes and groupings ICU names but that aren't countries. */
const NOT_A_COUNTRY = /^(AA|Q[M-Z]|X[A-Z]|ZZ|EU|EZ|UN)$/;

/**
 * English country name for an ISO 3166-1 alpha-2 code ("DE" → "Germany"), or undefined when
 * the code isn't a known region. Uses the ICU data that ships with Node.
 */
export function countryName(code: string): string | undefined {
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper) || NOT_A_COUNTRY.test(upper)) return undefined;
  try {
    const name = regionNames.of(upper);
    return name && name !== upper && name !== 'Unknown Region'
      ? name
      : undefined;
  } catch {
    return undefined;
  }
}
