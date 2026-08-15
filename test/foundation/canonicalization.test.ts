import canonicalize from 'canonicalize';
import { describe, expect, it } from 'vitest';

import {
  canonicalizeOwnedValue,
  canonicalizePortableValue,
  computeDomainDigest,
} from '../../src/foundation/index.js';

const canonical = (value: unknown) => {
  const result = canonicalizePortableValue(value);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('Expected canonicalization success.');
  }
  return result.canonical;
};

const captureOwnedCanonicalFailure = (value: unknown): Error => {
  try {
    canonicalizeOwnedValue(value);
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }
  throw new TypeError('Expected owned canonicalization to fail.');
};

describe('validated RFC 8785 canonicalization', () => {
  it('uses exact canonicalize@4.0.0 bytes after portable validation', () => {
    const left = canonical({ z: -0, text: 'é', escaped: '\b\n"\\', a: [2, 1] });
    const right = canonical({ a: [2, 1], escaped: '\b\n"\\', text: 'é', z: 0 });

    expect(left.text).toBe('{"a":[2,1],"escaped":"\\b\\n\\\"\\\\","text":"é","z":0}');
    expect(right.text).toBe(left.text);
    expect(right.bytes).toEqual(left.bytes);
    expect(new TextDecoder().decode(left.bytes)).toBe(left.text);
  });

  it('preserves ordered arrays while ignoring object insertion order', () => {
    expect(canonical({ b: 2, a: 1 }).text).toBe(canonical({ a: 1, b: 2 }).text);
    expect(canonical([1, 2]).text).not.toBe(canonical([2, 1]).text);
  });

  it.each([
    ['astral UTF-16 key order', { '\ue000': 2, '😀': 1 }, '{"😀":1,"":2}'],
    ['composed Unicode', 'é', '"é"'],
    [
      'minimum and maximum safe integers',
      [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      '[-9007199254740991,9007199254740991]',
    ],
    ['negative zero', -0, '0'],
    ['non-ASCII key and value', { ключ: 'значение' }, '{"ключ":"значение"}'],
    ['control characters', '\u0000\b\t\n\f\r', '"\\u0000\\b\\t\\n\\f\\r"'],
  ])('pins the exact %s canonical bytes', (_name, value, expectedText) => {
    const result = canonical(value);
    expect(result.text).toBe(expectedText);
    expect(result.bytes).toEqual(new TextEncoder().encode(expectedText));
  });

  it.each(['e\u0301', '\ud800', 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid input %j before serialization',
    (value) => {
      expect(canonicalizePortableValue(value)).toEqual({
        ok: false,
        failure: { code: 'CANONICAL_INPUT', path: '' },
      });
    },
  );

  it('does not invoke a rejected toJSON accessor', () => {
    let getterCalls = 0;
    const value = {};
    Object.defineProperty(value, 'toJSON', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return () => 'secret';
      },
    });

    expect(canonicalizePortableValue(value)).toEqual({
      ok: false,
      failure: { code: 'CANONICAL_INPUT', path: '/toJSON' },
    });
    expect(getterCalls).toBe(0);
  });

  it('pins the representative canonical round trip', () => {
    const input = {
      zero: -0,
      text: 'é',
      astral: '😀',
      controls: '\u0000\b\t\n\f\r"\\',
      bounds: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      order: { z: 0, '\ue000': 2, '😀': 1, a: 'é' },
    };
    const inputSnapshot = structuredClone(input);
    const originalKeys = Object.keys(input);
    const originalOrderKeys = Object.keys(input.order);
    const expectedText =
      '{"astral":"😀","bounds":[-9007199254740991,9007199254740991],"controls":"\\u0000\\b\\t\\n\\f\\r\\\"\\\\","order":{"a":"é","z":0,"😀":1,"":2},"text":"é","zero":0}';
    const expectedDigest =
      'sha256:051ad16d8e6ed7e49ddaa4cf05bc5d7cc0f960ecdf2b08fddbc6258a31a4802f';

    const first = canonical(input);
    const parsed: unknown = JSON.parse(first.text);
    const second = canonical(parsed);
    const firstDigest = computeDomainDigest('pipeline-source/v1', input);
    const secondDigest = computeDomainDigest('pipeline-source/v1', parsed);

    expect(first.text).toBe(expectedText);
    expect(first.bytes).toEqual(new TextEncoder().encode(expectedText));
    expect(parsed).toEqual(first.value);
    expect(second.text).toBe(expectedText);
    expect(second.bytes).toEqual(first.bytes);
    expect(firstDigest).toEqual({ ok: true, digest: expectedDigest });
    expect(secondDigest).toEqual(firstDigest);
    expect(Object.keys(input)).toEqual(originalKeys);
    expect(Object.keys(input.order)).toEqual(originalOrderKeys);
    expect(input).toEqual(inputSnapshot);
    expect(Object.is(input.zero, -0)).toBe(true);
  });
});

describe('owned canonical value invariants', () => {
  it('accepts deep trusted-owned data beyond the portable depth limit without mutation', () => {
    let value: unknown = 'é';
    for (let depth = 0; depth < 64; depth += 1) {
      value = { nested: value };
    }
    const snapshot = JSON.stringify(value);

    const portable = canonicalizePortableValue(value);
    expect(portable.ok).toBe(false);
    if (portable.ok) {
      throw new TypeError('Expected portable depth rejection.');
    }
    expect(portable.failure.code).toBe('CANONICAL_INPUT');
    expect(canonicalizeOwnedValue(value).text).toContain('é');
    expect(JSON.stringify(value)).toBe(snapshot);
  });

  it.each([
    ['fractional number', { value: 1.5 }],
    ['unsafe integer', { value: Number.MAX_SAFE_INTEGER + 1 }],
    ['decomposed string', { value: 'e\u0301' }],
    ['unpaired surrogate string', { value: '\ud800' }],
    ['decomposed object key', Object.fromEntries([['e\u0301', null]])],
    ['unpaired surrogate object key', Object.fromEntries([['\ud800', null]])],
  ])('rejects an invalid owned %s with one fixed error', (_name, value) => {
    const error = captureOwnedCanonicalFailure(value);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe('Invalid owned canonical value.');
    expect(Object.hasOwn(error, 'cause')).toBe(false);
  });

  it('delegates trusted owned serialization directly to canonicalize@4.0.0', () => {
    const value = { order: { '\ue000': 2, '😀': 1 }, text: 'é', values: [2, 1] };
    expect(canonicalizeOwnedValue(value).text).toBe(canonicalize(value));
  });

  it('keeps hostile reflection at the portable boundary before library serialization', () => {
    let getterCalls = 0;
    const accessor = {};
    Object.defineProperty(accessor, 'secret', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('getter-secret');
      },
    });
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('proxy-secret');
        },
      },
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    for (const value of [accessor, hostile, revoked.proxy]) {
      expect(canonicalizePortableValue(value)).toMatchObject({
        ok: false,
        failure: { code: 'CANONICAL_INPUT' },
      });
    }
    expect(getterCalls).toBe(0);
  });
});
