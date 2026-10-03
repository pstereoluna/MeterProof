/** JSON-safe, exact, nonnegative integer. Small quantities retain the original API shape. */
export type Quantity = number | string;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function quantityInteger(value: Quantity | bigint): bigint {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError('A numeric quantity must be a nonnegative safe integer.');
  }
  if (typeof value === 'string' && !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new RangeError('A string quantity must be a canonical nonnegative integer.');
  }
  const integer = BigInt(value);
  if (integer < 0n) throw new RangeError('A quantity must be nonnegative.');
  return integer;
}

export function exactQuantity(value: Quantity | bigint): Quantity {
  const integer = quantityInteger(value);
  return integer <= MAX_SAFE ? Number(integer) : integer.toString();
}

export function sumQuantities(values: Iterable<Quantity>): Quantity {
  let sum = 0n;
  for (const value of values) sum += quantityInteger(value);
  return exactQuantity(sum);
}
