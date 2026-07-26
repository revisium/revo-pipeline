import { describe, expect, test } from 'vitest';

import {
  inspectPortableValue,
  inspectPortableValueSet,
  PIPELINE_LIMITS,
} from '../../../src/policy/index.js';

const issue = (value: unknown, options?: Parameters<typeof inspectPortableValue>[1]) => {
  const result = inspectPortableValue(value, options);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected portable input rejection.');
  }
  return result.issue;
};

describe('bounded portable input inspection', () => {
  test('copies, normalizes and recursively freezes dense JSON data', () => {
    const source = { text: 'e\u0301', number: -0, nested: [true, null, { value: 1 }] };
    const result = inspectPortableValue(source);
    expect(result).toEqual({
      ok: true,
      value: { text: 'é', number: 0, nested: [true, null, { value: 1 }] },
    });
    if (!result.ok) {
      return;
    }
    expect(result.value).not.toBe(source);
    expect(Object.isFrozen(result.value)).toBe(true);
    if (typeof result.value !== 'object' || result.value === null || Array.isArray(result.value)) {
      throw new Error('Expected a portable object.');
    }
    if (!('nested' in result.value)) {
      throw new Error('Expected a nested property.');
    }
    const nested = result.value.nested;
    if (!Array.isArray(nested)) {
      throw new Error('Expected a portable nested array.');
    }
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested[2])).toBe(true);
    source.text = 'changed';
    expect(result.value).toMatchObject({ text: 'é' });
  });

  test('accepts null-prototype plain objects', () => {
    const value: unknown = Object.create(null);
    if (typeof value !== 'object' || value === null) {
      throw new Error('Expected an object.');
    }
    Object.defineProperty(value, 'safe', { enumerable: true, value: 1 });
    expect(inspectPortableValue(value)).toEqual({
      ok: true,
      value: { safe: 1 },
    });
  });

  test('copies an own __proto__ key without changing the output prototype', () => {
    const value = {};
    Object.defineProperty(value, '__proto__', { enumerable: true, value: 'safe' });
    const result = inspectPortableValue(value);
    if (!result.ok || typeof result.value !== 'object' || result.value === null) {
      throw new Error('Expected a portable object.');
    }
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect(Object.hasOwn(result.value, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(result.value, '__proto__')?.value).toBe('safe');
  });

  test('retains own __proto__ data in multi-fault inspection without prototype mutation', () => {
    const value = {};
    Object.defineProperty(value, '__proto__', { enumerable: true, value: 'safe' });
    Object.defineProperty(value, 'invalid', { enumerable: true, value: undefined });

    const result = inspectPortableValueSet(value);

    expect(result.issues).toEqual([{ code: 'type', path: '/invalid' }]);
    const output = typeof result.value === 'object' && result.value !== null ? result.value : null;
    expect(output).not.toBeNull();
    if (output === null) {
      throw new Error('Expected a portable object.');
    }
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(output, '__proto__')?.value).toBe('safe');
  });

  test('reads all sibling descriptors before traversing any descendant', () => {
    const reads: string[] = [];
    let getterCalls = 0;
    const child = new Proxy(
      { value: true },
      {
        getOwnPropertyDescriptor(target, key) {
          reads.push(`child:${String(key)}`);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    const subject = { a: child };
    Object.defineProperty(subject, 'b', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('accessors must not execute');
      },
    });
    const value = new Proxy(subject, {
      getOwnPropertyDescriptor(target, key) {
        reads.push(`root:${String(key)}`);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });

    expect(inspectPortableValueSet(value).issues).toEqual([{ code: 'type', path: '/b' }]);
    expect(reads).toEqual(['root:a', 'root:b', 'child:value']);
    expect(getterCalls).toBe(0);
  });

  test('normalizes multi-fault object traversal independently of insertion order', () => {
    const first = inspectPortableValueSet({ z: undefined, a: () => true });
    const second = inspectPortableValueSet({ a: () => true, z: undefined });

    expect(first).toEqual(second);
  });

  test.each([
    [Number.NaN, 'number'],
    [Number.POSITIVE_INFINITY, 'number'],
    [1.5, 'number'],
    [Number.MAX_SAFE_INTEGER + 1, 'number'],
    [undefined, 'unsupported'],
    [1n, 'unsupported'],
    [Symbol('value'), 'unsupported'],
    [() => undefined, 'unsupported'],
    [new Date(), 'prototype'],
  ])('rejects non-portable value %#', (value, code) => {
    expect(issue(value).code).toBe(code);
  });

  test('enforces string, array, object-key, depth and visited-value bounds', () => {
    expect(issue('abc', { maxStringCodePoints: 2 }).code).toBe('string');
    expect(issue([1, 2], { maxArrayLength: 1 }).code).toBe('array-length');
    expect(
      issue(Object.fromEntries(Array.from({ length: 33 }, (_, index) => [String(index), null])))
        .code,
    ).toBe('object-keys');

    let deep: unknown = null;
    for (let index = 0; index <= PIPELINE_LIMITS.portable.depth; index += 1) {
      deep = { deep };
    }
    expect(issue(deep).code).toBe('depth');

    const many = Array.from({ length: PIPELINE_LIMITS.portable.visitedValues }, () => null);
    expect(issue(many, { maxArrayLength: many.length }).code).toBe('visited-values');
  });

  test('prunes an oversized array before own-key, descriptor or element inspection', () => {
    let ownKeyReflections = 0;
    let descriptorReads = 0;
    let elementReads = 0;
    const target = [1, 2];
    const value = new Proxy(target, {
      get(current, key, receiver) {
        if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) {
          elementReads += 1;
        }
        const reflected: unknown = Reflect.get(current, key, receiver);
        return reflected;
      },
      getOwnPropertyDescriptor(current, key) {
        descriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(current, key);
      },
      ownKeys(current) {
        ownKeyReflections += 1;
        return Reflect.ownKeys(current);
      },
    });
    expect(issue(value, { maxArrayLength: 1 })).toEqual({
      code: 'array-length',
      path: '',
    });
    expect(ownKeyReflections).toBe(0);
    expect(descriptorReads).toBe(0);
    expect(elementReads).toBe(0);
  });

  test('reflects dense in-range array keys once and inspects numeric descriptors in order', () => {
    let ownKeyReflections = 0;
    const descriptorKeys: PropertyKey[] = [];
    let elementReads = 0;
    const target = [1, 2];
    const value = new Proxy(target, {
      get(current, key, receiver) {
        if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) {
          elementReads += 1;
        }
        const reflected: unknown = Reflect.get(current, key, receiver);
        return reflected;
      },
      getOwnPropertyDescriptor(current, key) {
        descriptorKeys.push(key);
        return Reflect.getOwnPropertyDescriptor(current, key);
      },
      ownKeys(current) {
        ownKeyReflections += 1;
        return Reflect.ownKeys(current);
      },
    });
    expect(inspectPortableValue(value)).toEqual({ ok: true, value: [1, 2] });
    expect(ownKeyReflections).toBe(1);
    expect(descriptorKeys).toEqual(['0', '1']);
    expect(elementReads).toBe(0);
  });

  test('uses one own-key reflection and no descriptors or descendants for a 33-key object', () => {
    let ownKeyReflections = 0;
    let descriptorReads = 0;
    let getterCalls = 0;
    const target = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [String(index), null]),
    );
    Object.defineProperty(target, 'dangerous', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return true;
      },
    });
    const value = new Proxy(target, {
      getOwnPropertyDescriptor(current, key) {
        descriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(current, key);
      },
      ownKeys(current) {
        ownKeyReflections += 1;
        return Reflect.ownKeys(current);
      },
    });
    expect(issue(value)).toEqual({ code: 'object-keys', path: '' });
    expect(ownKeyReflections).toBe(1);
    expect(descriptorReads).toBe(0);
    expect(getterCalls).toBe(0);
  });

  test('prunes sparse and extra-string arrays at the container without invoking accessors', () => {
    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = true;
    expect(issue(sparse)).toEqual({ code: 'array-property', path: '' });

    let getterCalls = 0;
    const extra = [true];
    Object.defineProperty(extra, 'extra', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return true;
      },
    });
    expect(issue(extra)).toEqual({ code: 'array-property', path: '' });
    expect(getterCalls).toBe(0);
  });

  test('prunes extra-symbol and many-extra-key arrays without descriptor or value reads', () => {
    let getterCalls = 0;
    const symbolic = [true];
    Object.defineProperty(symbolic, Symbol('extra'), {
      enumerable: true,
      get() {
        getterCalls += 1;
        return true;
      },
    });
    expect(issue(symbolic)).toEqual({ code: 'array-property', path: '' });

    const many = [true];
    for (let index = 0; index < 100; index += 1) {
      Object.defineProperty(many, `extra-${index}`, {
        enumerable: true,
        get() {
          getterCalls += 1;
          return true;
        },
      });
    }
    expect(issue(many)).toEqual({ code: 'array-property', path: '' });
    expect(getterCalls).toBe(0);
  });

  test('rejects a symbol that replaces a missing canonical array index', () => {
    const value: unknown[] = [];
    value.length = 1;
    Object.defineProperty(value, Symbol('replacement'), {
      enumerable: true,
      value: true,
    });
    expect(issue(value)).toEqual({ code: 'symbol', path: '' });
  });

  test('inspects every descriptor before reading any value', () => {
    let getterCalls = 0;
    const value = {};
    Object.defineProperties(value, {
      safe: { enumerable: true, value: 1 },
      dangerous: {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error('must not execute');
        },
      },
    });
    expect(issue(value)).toEqual({ code: 'accessor', path: '/dangerous' });
    expect(getterCalls).toBe(0);
  });

  test('rejects array accessors without invocation', () => {
    let getterCalls = 0;
    const value: unknown[] = [];
    Object.defineProperty(value, '0', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return true;
      },
    });
    value.length = 1;
    expect(issue(value)).toEqual({ code: 'accessor', path: '/0' });
    expect(getterCalls).toBe(0);
  });

  test('rejects symbols, non-enumerable properties and custom prototypes', () => {
    const symbolic = { safe: true, [Symbol('hidden')]: true };
    expect(issue(symbolic).code).toBe('symbol');

    const hidden = {};
    Object.defineProperty(hidden, 'secret', { enumerable: false, value: true });
    expect(issue(hidden)).toEqual({ code: 'non-enumerable', path: '/secret' });

    const inherited: unknown = Object.create({ inherited: true });
    if (typeof inherited !== 'object' || inherited === null) {
      throw new Error('Expected an object.');
    }
    Object.defineProperty(inherited, 'safe', { enumerable: true, value: true });
    expect(issue(inherited).code).toBe('prototype');
  });

  test('escapes object keys in issue paths', () => {
    const value = {};
    Object.defineProperty(value, 'a~/b', { enumerable: false, value: true });
    expect(issue(value)).toEqual({ code: 'non-enumerable', path: '/a~0~1b' });
  });

  test('normalizes object traversal independently of insertion order', () => {
    const first = inspectPortableValue({ z: 1, a: 2 });
    const second = inspectPortableValue({ a: 2, z: 1 });
    expect(first).toEqual(second);
    if (!first.ok || typeof first.value !== 'object' || first.value === null) {
      throw new Error('Expected a portable object.');
    }
    expect(Object.keys(first.value)).toEqual(['a', 'z']);
  });

  test('allows throwing proxy traps to propagate', () => {
    const value = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('proxy trap');
        },
      },
    );
    expect(() => inspectPortableValue(value)).toThrowError('proxy trap');
  });
});
