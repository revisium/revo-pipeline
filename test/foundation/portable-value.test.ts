import { describe, expect, it } from 'vitest';

import {
  PIPELINE_LIMITS,
  normalizePortableValue,
  type JsonValue,
  type PortableValueResult,
} from '../../src/foundation/index.js';

const failure = (value: unknown) => {
  const result: PortableValueResult = normalizePortableValue(value);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected portable value rejection.');
  }
  return result.failure;
};

const isJsonObject = (value: JsonValue): value is { readonly [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

describe('portable JSON values', () => {
  it('copies, normalizes negative zero, orders keys, and recursively freezes', () => {
    const source = { z: -0, a: [true, null, { value: 1 }] };
    const result = normalizePortableValue(source);

    expect(result).toEqual({ ok: true, value: { a: [true, null, { value: 1 }], z: 0 } });
    if (!result.ok) {
      return;
    }
    expect(result.value).not.toBe(source);
    expect(Object.isFrozen(result.value)).toBe(true);
    if (!isJsonObject(result.value)) {
      throw new Error('Expected an object result.');
    }
    expect(Object.keys(result.value)).toEqual(['a', 'z']);
    const nested = result.value['a'];
    expect(Array.isArray(nested)).toBe(true);
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(Array.isArray(nested) ? nested[2] : undefined)).toBe(true);
  });

  it('accepts null-prototype objects and preserves an own __proto__ data key safely', () => {
    const source: Record<string, unknown> = {};
    Reflect.setPrototypeOf(source, null);
    Object.defineProperty(source, '__proto__', { enumerable: true, value: 'safe' });
    const result = normalizePortableValue(source);

    expect(result).toEqual({ ok: true, value: { ['__proto__']: 'safe' } });
    if (!result.ok || typeof result.value !== 'object' || result.value === null) {
      throw new Error('Expected an object result.');
    }
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect(Object.hasOwn(result.value, '__proto__')).toBe(true);
  });

  it.each([
    ['fraction', 1.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['undefined', undefined],
    ['function', () => undefined],
    ['symbol', Symbol('value')],
    ['bigint', 1n],
    ['decomposed string', 'e\u0301'],
    ['unpaired high surrogate', '\ud800'],
    ['unpaired low surrogate', '\udc00'],
    ['custom prototype', new Date(0)],
  ])('rejects %s without rendering the value', (_name, value) => {
    expect(failure(value)).toEqual({ code: 'CANONICAL_INPUT', path: '' });
  });

  it('accepts a valid astral pair and neighboring surrogate pairs', () => {
    expect(normalizePortableValue('😀')).toEqual({ ok: true, value: '😀' });
    expect(normalizePortableValue('😀🚀')).toEqual({ ok: true, value: '😀🚀' });
  });

  it('rejects accessors without invoking them and reports an escaped stable path', () => {
    let getterCalls = 0;
    const source = {};
    Object.defineProperty(source, 'a/b~', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'secret';
      },
    });

    expect(failure(source)).toEqual({ code: 'CANONICAL_INPUT', path: '/a~1b~0' });
    expect(getterCalls).toBe(0);
  });

  it('rejects cycles, symbols, non-enumerable properties, and sparse arrays', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(failure(cyclic)).toEqual({ code: 'CANONICAL_INPUT', path: '/self' });

    const symbolic = { value: true };
    Object.defineProperty(symbolic, Symbol('secret'), { enumerable: true, value: 'secret' });
    expect(failure(symbolic)).toEqual({ code: 'CANONICAL_INPUT', path: '' });

    const hidden = { value: true };
    Object.defineProperty(hidden, 'secret', { enumerable: false, value: 'secret' });
    expect(failure(hidden)).toEqual({ code: 'CANONICAL_INPUT', path: '/secret' });

    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = true;
    expect(failure(sparse)).toEqual({ code: 'CANONICAL_INPUT', path: '' });
  });

  it('does not apply display-string limits to general portable strings or keys', () => {
    const longString = 'x'.repeat(PIPELINE_LIMITS.displayStringCodePoints + 1);
    const result = normalizePortableValue({ [longString]: longString });

    expect(result).toEqual({ ok: true, value: { [longString]: longString } });
  });

  it('enforces fixed array, object, depth, and visited-value limits', () => {
    expect(failure(Array(PIPELINE_LIMITS.portableValue.arrayItems + 1).fill(null)).code).toBe(
      'CANONICAL_INPUT',
    );
    expect(
      failure(
        Object.fromEntries(
          Array.from({ length: PIPELINE_LIMITS.portableValue.objectKeys + 1 }, (_, index) => [
            String(index),
            null,
          ]),
        ),
      ).code,
    ).toBe('CANONICAL_INPUT');

    let deep: unknown = null;
    for (let depth = 0; depth <= PIPELINE_LIMITS.portableValue.depth; depth += 1) {
      deep = { deep };
    }
    expect(failure(deep).code).toBe('CANONICAL_INPUT');

    const manyValues = Array.from({ length: 65 }, () =>
      Array.from({ length: PIPELINE_LIMITS.portableValue.arrayItems }, () => null),
    );
    expect(failure(manyValues).code).toBe('CANONICAL_INPUT');
  });

  it('redacts failures from hostile and revoked proxy reflection', () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const hostileValues = [
      revoked.proxy,
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error('prototype-secret');
          },
        },
      ),
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('keys-secret');
          },
        },
      ),
      new Proxy(
        { value: true },
        {
          getOwnPropertyDescriptor() {
            throw new Error('descriptor-secret');
          },
        },
      ),
      new Proxy([true], {
        getOwnPropertyDescriptor() {
          throw new Error('array-secret');
        },
      }),
    ];

    for (const value of hostileValues) {
      const result = normalizePortableValue(value);
      expect(result).toMatchObject({ ok: false, failure: { code: 'CANONICAL_INPUT' } });
      expect(JSON.stringify(result)).not.toMatch(/secret/u);
    }
  });
});
