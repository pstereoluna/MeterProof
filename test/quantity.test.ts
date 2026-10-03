import assert from 'node:assert/strict';
import test from 'node:test';
import { exactQuantity, sumQuantities } from '../src/quantity';

test('exact quantities retain safe numbers and serialize larger integers without rounding', () => {
  assert.equal(exactQuantity(750n), 750);
  assert.equal(exactQuantity('9007199254740991'), Number.MAX_SAFE_INTEGER);
  assert.equal(exactQuantity(9007199254740993n), '9007199254740993');
  assert.equal(sumQuantities([Number.MAX_SAFE_INTEGER, 2]), '9007199254740993');
  assert.equal(sumQuantities(['9007199254740993', 2]), '9007199254740995');
  assert.equal(sumQuantities([]), 0);
  assert.equal(exactQuantity(10n ** 25n + 1n), '10000000000000000000000001');
  assert.equal(JSON.stringify({ total: exactQuantity(9007199254740993n) }), '{"total":"9007199254740993"}');
});

test('quantity boundaries reject already rounded numbers and malformed decimal strings', () => {
  for (const value of [Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -1, 1.5, -1n,
    '1e20', '01', '+1', '-1', '1.0', '', ' 1']) {
    assert.throws(() => exactQuantity(value), RangeError);
  }
});
