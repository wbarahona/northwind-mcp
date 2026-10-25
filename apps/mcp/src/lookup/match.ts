/** Something a model can refer to by code or by name. */
export interface Candidate {
  code: string;
  name: string;
}

/** Lower-case, accents removed, punctuation as spaces: "Côte de Blaye" → "cote de blaye". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Edit distance where swapping two neighbouring letters counts as one edit
 * (optimal string alignment), so "ALKFI" is one edit from "ALFKI".
 */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = best;
    }
  }
  return d[a.length]![b.length]!;
}

/** The candidate whose code or name is exactly the input (ignoring case, accents, punctuation). */
export function exactMatch(
  input: string,
  candidates: readonly Candidate[],
): Candidate | undefined {
  const wanted = normalize(input);
  const hits = candidates.filter(
    (c) => normalize(c.code) === wanted || normalize(c.name) === wanted,
  );
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * The one candidate whose name contains the input as whole words ("Dairy" → "Dairy
 * Products", "Fuller" → "Andrew Fuller"). None when several names contain it.
 */
export function partialMatch(
  input: string,
  candidates: readonly Candidate[],
): Candidate | undefined {
  const wanted = normalize(input);
  if (wanted.length < 3) return undefined;
  const hits = candidates.filter((c) =>
    ` ${normalize(c.name)} `.includes(` ${wanted} `),
  );
  return hits.length === 1 ? hits[0] : undefined;
}

/** 0 = same, 1 = nothing alike. */
function distance(input: string, candidate: Candidate): number {
  const q = normalize(input);
  if (!q) return 1;
  const name = normalize(candidate.name);
  const relative = (a: string, b: string) =>
    editDistance(a, b) / Math.max(a.length, b.length);

  const scores = [
    relative(q.replace(/ /g, ''), normalize(candidate.code).replace(/ /g, '')),
    relative(q, name),
    // A typo in one word of a longer name: "Futerkiste" → "Alfreds Futterkiste".
    ...name.split(' ').map((word) => relative(q, word)),
  ];
  // Part of the name: "Dairy" → "Dairy Products", "Alfreds" → "Alfreds Futterkiste".
  if (q.length >= 3 && name.includes(q)) scores.push(0.1);
  return Math.min(...scores);
}

/**
 * Up to `max` candidates that look like what the model meant, best first. Used when a code
 * or name doesn't match anything, so the model gets suggestions instead of a dead end.
 */
export function closeMatches(
  input: string,
  candidates: readonly Candidate[],
  max = 3,
): Candidate[] {
  return candidates
    .map((candidate) => ({ candidate, score: distance(input, candidate) }))
    .filter(({ score }) => score <= 0.4)
    .sort(
      (a, b) =>
        a.score - b.score || a.candidate.code.localeCompare(b.candidate.code),
    )
    .slice(0, max)
    .map(({ candidate }) => candidate);
}
