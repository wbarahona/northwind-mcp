// The benchmark's questions, expected facts and scoring (see docs/benchmark.md).
// Facts come from packages/seed/data/raw, seeded with the 10388-day shift and asked in Q4 2026.

/** Lower case, no accents, no thousands separators, single spaces: "45,904.82" → "45904.82". */
export const normalize = (text) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\s+/g, ' ');

/** A fact is a phrase (matched loosely) or a regular expression (matched on normalized text). */
export const QUESTIONS = [
  {
    q: "What's in order 10248?",
    facts: [
      'Queso Cabrales',
      'Singaporean Hokkien Fried Mee',
      'Mozzarella di Giovanni',
      '472.38',
    ],
  },
  {
    q: 'Which products are low on stock?',
    facts: ['Nord-Ost Matjeshering', 'Outback Lager'],
    // Both are 5 short of their reorder level; 4B once reported Outback Lager's shortfall as 15.
    wrong: [/shortfall\W{0,4}(of\W{0,2})?(10|15|25)\b/],
  },
  {
    q: 'Show me the contact for customer ALFKI',
    facts: [
      'Maria Anders',
      'Sales Representative',
      /\+?49 ?30 ?0074321/,
      'maria.anders@alfreds-futterkiste.example',
    ],
  },
  {
    q: 'Who were the top 5 customers last year?',
    facts: [
      'QUICK-Stop',
      'Ernst Handel',
      'Save-a-lot Markets',
      'Rattlesnake Canyon Grocery',
      'Mère Paillarde',
      '45904.82',
    ],
  },
  {
    q: 'List the customers in Germany',
    facts: [
      'Alfreds Futterkiste',
      'Blauer See Delikatessen',
      'Die Wandernde Kuh',
      'Drachenblut Delikatessen',
      'Frankenversand',
      'Königlich Essen',
      'Lehmanns Marktstand',
      'Morgenstern Gesundkost',
      'Ottilies Käseladen',
      'QUICK-Stop',
      'Toms Spezialitäten',
    ],
  },
  {
    q: 'How much does Chai cost and how many are in stock?',
    facts: [/\b18(\.00)?\b/, /\b39\b/],
  },
  {
    q: 'What did Alfreds Futterkiste order most recently?',
    facts: [/\b(ord-)?11011\b/, 'Escargots de Bourgogne', 'Flotemysost'],
  },
  {
    q: 'Which supplier makes the products that are low on stock?',
    facts: ['Nord-Ost-Fisch Handelsgesellschaft', 'Pavlova'],
  },
  {
    q: 'Which employee sold the most this year, and what is their title?',
    facts: ['Janet Leverling', 'Sales Representative'],
  },
];

export function score(answer, { facts, wrong = [] }) {
  const text = normalize(answer);
  const has = (fact) =>
    fact instanceof RegExp ? fact.test(text) : text.includes(normalize(fact));
  const missing = facts.filter((f) => !has(f)).map(String);
  const wrongFound = wrong.filter((w) => w.test(text)).map(String);
  const found = facts.length - missing.length;
  const verdict =
    missing.length === 0 && wrongFound.length === 0
      ? 'pass'
      : found >= facts.length / 2
        ? 'partial'
        : 'fail';
  return { verdict, missing, wrong: wrongFound };
}
