/** Strips diacritics: "Taquería" → "Taqueria". */
export function asciiFold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** "Alfreds Futterkiste" → "alfreds-futterkiste" (for email domains). */
export function slug(text: string, separator = '-'): string {
  return asciiFold(text)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, 'g'), '');
}

/**
 * Deterministic email on the reserved `.example` TLD (RFC 2606), so it can never reach a
 * real inbox: ("Maria Anders", "Alfreds Futterkiste") → maria.anders@alfreds-futterkiste.example
 */
export function exampleEmail(personName: string, organization: string): string {
  return `${slug(personName, '.')}@${slug(organization)}.example`;
}

/** Multi-line addresses ("Coventry House\nMiner Rd.") become one line. */
export function singleLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Access stored hyperlinks as "display#url#". Keeps the URL when there is a web address;
 * local file links like "#CAJUN.HTM#" become null.
 */
export function accessHyperlinkUrl(raw: string | null): string | null {
  if (!raw) return null;
  const url = raw.split('#').find((part) => /^https?:\/\//i.test(part.trim()));
  return url?.trim() ?? null;
}
