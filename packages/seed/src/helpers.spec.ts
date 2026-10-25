import { normalizeCountry } from './countries';
import { computeDateShift, parseIsoDate, utcToday } from './dates';
import { seedObjectId } from './ids';
import { normalizePhone } from './phones';
import { accessHyperlinkUrl, exampleEmail, singleLine, slug } from './text';

describe('computeDateShift', () => {
  const latest = parseIsoDate('1998-05-06'); // a Wednesday

  it.each(['2026-10-22', '2026-10-19', '2027-02-28', '2030-01-01'])(
    'puts the latest order 7–13 days before %s, on the same weekday',
    (anchorText) => {
      const anchor = parseIsoDate(anchorText);
      const { days, shift } = computeDateShift(latest, anchor);
      const shifted = shift(latest);
      const daysBefore = (anchor.getTime() - shifted.getTime()) / 86_400_000;

      expect(days % 7).toBe(0);
      expect(daysBefore).toBeGreaterThanOrEqual(7);
      expect(daysBefore).toBeLessThan(14);
      expect(shifted.getUTCDay()).toBe(latest.getUTCDay());
    },
  );

  it('rejects malformed dates', () => {
    expect(() => parseIsoDate('7/4/1996')).toThrow(/YYYY-MM-DD/);
    expect(() => parseIsoDate('1996-13-45')).toThrow();
  });

  it('truncates the current time to UTC midnight', () => {
    expect(utcToday(new Date('2026-10-22T23:59:59.999Z')).toISOString()).toBe(
      '2026-10-22T00:00:00.000Z',
    );
  });
});

describe('text helpers', () => {
  it('builds .example emails without diacritics or punctuation', () => {
    expect(exampleEmail('Maria Anders', 'Alfreds Futterkiste')).toBe(
      'maria.anders@alfreds-futterkiste.example',
    );
    expect(exampleEmail('Antonio Moreno', 'Antonio Moreno Taquería')).toBe(
      'antonio.moreno@antonio-moreno-taqueria.example',
    );
    expect(slug("Bon app'")).toBe('bon-app');
    expect(slug('Bottom-Dollar Markets & Co.')).toBe(
      'bottom-dollar-markets-and-co',
    );
  });

  it('joins multi-line addresses', () => {
    expect(singleLine('Coventry House\nMiner Rd.')).toBe(
      'Coventry House, Miner Rd.',
    );
  });

  it('extracts web URLs from Access hyperlinks', () => {
    expect(
      accessHyperlinkUrl(
        "Mayumi's (on the World Wide Web)#http://www.microsoft.com/accessdev/sampleapps/mayumi.htm#",
      ),
    ).toBe('http://www.microsoft.com/accessdev/sampleapps/mayumi.htm');
    expect(accessHyperlinkUrl('#CAJUN.HTM#')).toBeNull();
    expect(accessHyperlinkUrl(null)).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('converts to E.164 using the record country', () => {
    expect(normalizePhone('030-0074321', 'DE')).toEqual({
      phone: '+49300074321',
      keptAsIs: false,
    });
    expect(normalizePhone('(503) 555-9831', 'US').phone).toBe('+15035559831');
  });

  it('keeps numbers from retired numbering plans as written', () => {
    // France moved from 8 to 10 digits in 1996.
    expect(normalizePhone('26.47.15.10', 'FR')).toEqual({
      phone: '26.47.15.10',
      keptAsIs: true,
    });
  });

  it('treats blanks as no phone', () => {
    expect(normalizePhone(null, 'DE')).toEqual({
      phone: null,
      keptAsIs: false,
    });
    expect(normalizePhone('  ', 'DE')).toEqual({
      phone: null,
      keptAsIs: false,
    });
  });
});

describe('normalizeCountry', () => {
  it('modernizes names and adds ISO codes', () => {
    expect(normalizeCountry('UK')).toEqual({
      name: 'United Kingdom',
      code: 'GB',
    });
    expect(normalizeCountry('USA')).toEqual({
      name: 'United States',
      code: 'US',
    });
  });

  it('fails loudly on unknown countries', () => {
    expect(() => normalizeCountry('Atlantis')).toThrow(/Unknown country/);
  });
});

describe('seedObjectId', () => {
  it('is deterministic per collection and code', () => {
    expect(seedObjectId('customers', 'ALFKI')).toEqual(
      seedObjectId('customers', 'ALFKI'),
    );
    expect(seedObjectId('customers', 'ALFKI')).not.toEqual(
      seedObjectId('customers', 'ANATR'),
    );
    expect(seedObjectId('orders', 'X')).not.toEqual(
      seedObjectId('products', 'X'),
    );
  });

  it('carries a fixed 2026-01-01 timestamp', () => {
    expect(
      seedObjectId('orders', 'ORD-10248').getTimestamp().toISOString(),
    ).toBe('2026-01-01T00:00:00.000Z');
  });
});
