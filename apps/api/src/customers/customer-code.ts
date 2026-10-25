/**
 * Northwind-style customer codes: five upper-case letters from the company name, e.g.
 * "Blue Moon Bakery" → BLUMO (3 letters of the first word, then the following words).
 * Yields alternatives for collisions: BLUMA…BLUMZ, then BLUAA…BLUZZ.
 */
export function* customerCodeCandidates(
  companyName: string,
): Generator<string, void> {
  const words = companyName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
  const [first = '', ...rest] = words;

  let base = first.slice(0, 3) + rest.join('');
  base = (base + first.slice(3)).slice(0, 5).padEnd(5, 'X');
  const seen = new Set<string>();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const candidates = [
    base,
    ...[...alphabet].map((c) => base.slice(0, 4) + c),
    ...[...alphabet].flatMap((c1) =>
      [...alphabet].map((c2) => base.slice(0, 3) + c1 + c2),
    ),
  ];
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    yield candidate;
  }
}
