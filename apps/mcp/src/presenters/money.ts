/**
 * Exact arithmetic on the API's decimal strings ("1234.56"), in integer cents, so totals
 * and shares never pick up floating-point errors.
 */
export function toCents(amount: string): bigint {
  const match = /^(-?)([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(amount);
  if (!match) throw new Error(`Not a money amount: "${amount}"`);
  const cents =
    BigInt(match[2]!) * 100n + BigInt((match[3] ?? '0').padEnd(2, '0'));
  return match[1] ? -cents : cents;
}

export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

export function sumMoney(amounts: string[]): string {
  return fromCents(amounts.reduce((sum, a) => sum + toCents(a), 0n));
}

/** part / whole as a percentage with two decimals (half up); 0 when whole is 0. */
export function percentOf(part: string, whole: string): number {
  const w = toCents(whole);
  if (w === 0n) return 0;
  const basisPoints = (toCents(part) * 20000n + w) / (2n * w);
  return Number(basisPoints) / 100;
}
