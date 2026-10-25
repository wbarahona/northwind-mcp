import {
  closeMatches,
  editDistance,
  exactMatch,
  normalize,
  partialMatch,
} from './match';

const CUSTOMERS = [
  { code: 'ALFKI', name: 'Alfreds Futterkiste' },
  { code: 'ANATR', name: 'Ana Trujillo Emparedados y helados' },
  { code: 'ANTON', name: 'Antonio Moreno Taquería' },
  { code: 'AROUT', name: 'Around the Horn' },
  { code: 'ERNSH', name: 'Ernst Handel' },
  { code: 'SPECD', name: 'Spécialités du monde' },
];

const CATEGORIES = [
  { code: 'CAT-03', name: 'Confections' },
  { code: 'CAT-04', name: 'Dairy Products' },
  { code: 'CAT-07', name: 'Produce' },
];

describe('normalize', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalize('  Spécialités du monde! ')).toBe('specialites du monde');
    expect(normalize("Chef Anton's Gumbo-Mix")).toBe('chef anton s gumbo mix');
  });
});

describe('editDistance', () => {
  it('counts a swap of neighbouring letters as one edit', () => {
    expect(editDistance('alkfi', 'alfki')).toBe(1);
    expect(editDistance('alfki', 'alfki')).toBe(0);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('exactMatch', () => {
  it('matches a code or a whole name, loosely written', () => {
    expect(exactMatch('alfki', CUSTOMERS)?.code).toBe('ALFKI');
    expect(exactMatch('specialites du monde', CUSTOMERS)?.code).toBe('SPECD');
    expect(exactMatch('Alfreds', CUSTOMERS)).toBeUndefined();
  });
});

describe('partialMatch', () => {
  it('takes the one name that contains the input as whole words', () => {
    expect(partialMatch('Dairy', CATEGORIES)?.code).toBe('CAT-04');
    expect(partialMatch('ernst', CUSTOMERS)?.code).toBe('ERNSH');
  });

  it('refuses ambiguous, partial-word or very short input', () => {
    expect(partialMatch('An', CUSTOMERS)).toBeUndefined();
    // "Produce" is a whole name and also inside no other name; "Prod" is only part of a word.
    expect(partialMatch('Prod', CATEGORIES)).toBeUndefined();
    expect(
      partialMatch('Queso', [
        { code: 'PRD-011', name: 'Queso Cabrales' },
        { code: 'PRD-012', name: 'Queso Manchego La Pastora' },
      ]),
    ).toBeUndefined();
  });
});

describe('closeMatches', () => {
  it('finds a mistyped code', () => {
    expect(closeMatches('ALKFI', CUSTOMERS)).toEqual([CUSTOMERS[0]]);
  });

  it('finds a mistyped word of a longer name', () => {
    expect(closeMatches('Futerkiste', CUSTOMERS)).toEqual([CUSTOMERS[0]]);
  });

  it('finds names that contain the input, best first, at most three', () => {
    const products = [
      { code: 'PRD-011', name: 'Queso Cabrales' },
      { code: 'PRD-012', name: 'Queso Manchego La Pastora' },
      { code: 'PRD-031', name: 'Gorgonzola Telino' },
    ];
    expect(closeMatches('queso', products).map((c) => c.code)).toEqual([
      'PRD-011',
      'PRD-012',
    ]);
    expect(closeMatches('a', CUSTOMERS, 3).length).toBeLessThanOrEqual(3);
  });

  it('returns nothing for input unlike any candidate', () => {
    expect(closeMatches('Zzyzx Industries', CUSTOMERS)).toEqual([]);
    expect(closeMatches('   ', CUSTOMERS)).toEqual([]);
  });
});
