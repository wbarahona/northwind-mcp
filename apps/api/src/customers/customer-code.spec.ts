import { customerCodeCandidates } from './customer-code';

const first = (name: string) => customerCodeCandidates(name).next().value;

describe('customerCodeCandidates', () => {
  it.each([
    ['Blue Moon Bakery', 'BLUMO'],
    ['Alfreds Futterkiste', 'ALFFU'],
    ['Antonio Moreno Taquería', 'ANTMO'],
    ["B's Beverages", 'BSBEV'],
    ['Ernst Handel', 'ERNHA'],
    ['Zé', 'ZEXXX'],
    ['QUICK-Stop', 'QUIST'],
  ])('%s → %s', (name, code) => {
    expect(first(name)).toBe(code);
  });

  it('offers alternatives for collisions, all valid codes', () => {
    const candidates = [...customerCodeCandidates('Blue Moon Bakery')];

    expect(candidates.slice(0, 3)).toEqual(['BLUMO', 'BLUMA', 'BLUMB']);
    expect(new Set(candidates).size).toBe(candidates.length);
    expect(candidates).toHaveLength(26 * 26); // every BLU?? combination, BLUMO first
    expect(candidates.every((c) => /^[A-Z]{5}$/.test(c))).toBe(true);
  });
});
