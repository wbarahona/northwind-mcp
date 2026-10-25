import { RATE_SCALE, toCents, toScaledInt } from '../money';

export interface LineInput {
  unitPrice: unknown;
  quantity: unknown;
  discount: unknown;
}

export interface OrderTotalsInCents {
  /** Per line: unitPrice × quantity × (1 − discount), rounded half-up to the cent. */
  lineTotals: bigint[];
  /** Σ unitPrice × quantity, before discounts. */
  subtotal: bigint;
  /** Σ (gross − lineTotal). */
  discount: bigint;
  /** subtotal − discount: product revenue, the figure analytics report. */
  net: bigint;
  freight: bigint;
  /** net + freight: what the customer pays. */
  total: bigint;
}

const RATE_ONE = 10n ** BigInt(RATE_SCALE);

/**
 * Exact order math in integer cents. Rounds each line to the cent, as classic Northwind's
 * "Order Subtotals" view does. Returns undefined if any input is missing or malformed,
 * leaving it to schema validation to report which.
 */
export function computeOrderTotals(
  lines: readonly LineInput[],
  freight: unknown,
): OrderTotalsInCents | undefined {
  const freightCents = toCents(freight);
  if (freightCents === undefined) return undefined;

  const lineTotals: bigint[] = [];
  let subtotal = 0n;
  let net = 0n;

  for (const line of lines) {
    const price = toCents(line.unitPrice);
    const rate = toScaledInt(line.discount, RATE_SCALE);
    const quantity = line.quantity;
    if (
      price === undefined ||
      rate === undefined ||
      rate > RATE_ONE ||
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 0
    ) {
      return undefined;
    }

    const gross = price * BigInt(quantity);
    const lineTotal = roundHalfUp(gross * (RATE_ONE - rate), RATE_ONE);

    lineTotals.push(lineTotal);
    subtotal += gross;
    net += lineTotal;
  }

  return {
    lineTotals,
    subtotal,
    discount: subtotal - net,
    net,
    freight: freightCents,
    total: net + freightCents,
  };
}

/** Non-negative integer division rounded half-up. */
function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return (numerator % denominator) * 2n >= denominator
    ? quotient + 1n
    : quotient;
}
