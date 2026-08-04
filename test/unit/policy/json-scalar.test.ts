import { describe, expect, test } from 'vitest';

import {
  compareUnicodeCodePoints,
  isValidKey,
  isValidSemanticName,
  jsonScalarsEqual,
  normalizeJsonScalar,
} from '../../../src/policy/index.js';

describe('canonical JSON scalar policy', () => {
  test('normalizes NFC strings and negative zero', () => {
    expect(normalizeJsonScalar('e\u0301')).toBe('é');
    expect(normalizeJsonScalar(-0)).toBe(0);
    expect(Object.is(normalizeJsonScalar(-0), -0)).toBe(false);
    expect(normalizeJsonScalar(null)).toBeNull();
    expect(normalizeJsonScalar(true)).toBe(true);
  });

  test('uses type-sensitive canonical equality', () => {
    expect(jsonScalarsEqual('e\u0301', 'é')).toBe(true);
    expect(jsonScalarsEqual(-0, 0)).toBe(true);
    expect(jsonScalarsEqual(1, 1)).toBe(true);
    expect(jsonScalarsEqual(1, '1')).toBe(false);
    expect(jsonScalarsEqual(false, false)).toBe(true);
    expect(jsonScalarsEqual(null, null)).toBe(true);
  });

  test('orders strings by Unicode code points rather than UTF-16 code units', () => {
    expect(compareUnicodeCodePoints('a', 'a')).toBe(0);
    expect(compareUnicodeCodePoints('a', 'aa')).toBeLessThan(0);
    expect(compareUnicodeCodePoints('aa', 'a')).toBeGreaterThan(0);
    expect(compareUnicodeCodePoints('\u{10000}', '\u{e000}')).toBeGreaterThan(0);
    expect(compareUnicodeCodePoints('b', 'a')).toBeGreaterThan(0);
  });

  test('validates canonical semantic names and stricter keys', () => {
    expect(isValidSemanticName('name')).toBe(true);
    expect(isValidSemanticName('e\u0301')).toBe(false);
    expect(isValidSemanticName('')).toBe(false);
    expect(isValidSemanticName('x'.repeat(65))).toBe(false);
    expect(isValidSemanticName('\ud800')).toBe(false);
    expect(isValidSemanticName('\udc00')).toBe(false);
    expect(isValidSemanticName('\ud800x')).toBe(false);
    expect(isValidSemanticName('\u{1f680}')).toBe(true);
    expect(isValidSemanticName('semantic\u0000name')).toBe(true);
    expect(isValidSemanticName(1)).toBe(false);
    expect(isValidKey('node-key')).toBe(true);
    expect(isValidKey('node/key')).toBe(false);
    expect(isValidKey('node~key')).toBe(false);
    expect(isValidKey('node\u0000key')).toBe(false);
  });
});
