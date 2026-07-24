import { compareUnicodeCodePoints } from './compare-unicode-code-points.js';
import { PIPELINE_LIMITS } from './pipeline-limits.js';

type PortableJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly PortableJsonValue[]
  | { readonly [key: string]: PortableJsonValue };

type PortableValueIssue = {
  readonly code:
    | 'depth'
    | 'object-keys'
    | 'visited-values'
    | 'array-length'
    | 'sparse-array'
    | 'accessor'
    | 'symbol'
    | 'non-enumerable'
    | 'array-property'
    | 'prototype'
    | 'number'
    | 'string'
    | 'unsupported';
  readonly path: string;
};

type PortableValueResult =
  | { readonly ok: true; readonly value: PortableJsonValue }
  | { readonly ok: false; readonly issue: PortableValueIssue };

const escapedPathSegment = (value: string): string =>
  value.replaceAll('~', '~0').replaceAll('/', '~1');
const codePointLength = (value: string): number => Array.from(value).length;

export const inspectPortableValue = (
  input: unknown,
  options: Readonly<{ maxArrayLength?: number; maxStringCodePoints?: number }> = {},
): PortableValueResult => {
  const maxArrayLength = options.maxArrayLength ?? PIPELINE_LIMITS.facts.total;
  const maxStringCodePoints =
    options.maxStringCodePoints ?? PIPELINE_LIMITS.portable.displayCodePoints;
  let visitedValues = 0;

  const inspect = (value: unknown, path: string, depth: number): PortableValueResult => {
    visitedValues += 1;
    if (visitedValues > PIPELINE_LIMITS.portable.visitedValues) {
      return { ok: false, issue: { code: 'visited-values', path } };
    }
    if (depth > PIPELINE_LIMITS.portable.depth) {
      return { ok: false, issue: { code: 'depth', path } };
    }
    if (value === null || typeof value === 'boolean') {
      return { ok: true, value };
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) {
        return { ok: false, issue: { code: 'number', path } };
      }
      return { ok: true, value: Object.is(value, -0) ? 0 : value };
    }
    if (typeof value === 'string') {
      const normalized = value.normalize('NFC');
      if (codePointLength(normalized) > maxStringCodePoints) {
        return { ok: false, issue: { code: 'string', path } };
      }
      return { ok: true, value: normalized };
    }
    if (typeof value !== 'object') {
      return { ok: false, issue: { code: 'unsupported', path } };
    }

    if (Array.isArray(value)) {
      if (value.length > maxArrayLength) {
        return { ok: false, issue: { code: 'array-length', path } };
      }
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== value.length + 1) {
        return { ok: false, issue: { code: 'array-property', path } };
      }
      if (ownKeys.some((key) => typeof key === 'symbol')) {
        return { ok: false, issue: { code: 'symbol', path } };
      }
      const keys = ownKeys.filter(
        (key): key is string => typeof key === 'string' && key !== 'length',
      );
      if (
        !ownKeys.includes('length') ||
        keys.some((key) => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
      ) {
        return { ok: false, issue: { code: 'array-property', path } };
      }
      const keySet = new Set(keys);
      for (let index = 0; index < value.length; index += 1) {
        if (!keySet.has(String(index))) {
          return { ok: false, issue: { code: 'array-property', path } };
        }
      }
      if (Reflect.getPrototypeOf(value) !== Array.prototype) {
        return { ok: false, issue: { code: 'prototype', path } };
      }
      const descriptors = new Map<string, PropertyDescriptor>();
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || 'get' in descriptor || 'set' in descriptor) {
          return { ok: false, issue: { code: 'accessor', path: `${path}/${key}` } };
        }
        if (!descriptor.enumerable) {
          return { ok: false, issue: { code: 'non-enumerable', path: `${path}/${key}` } };
        }
        descriptors.set(key, descriptor);
      }
      const output: PortableJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors.get(String(index));
        const result = inspect(
          descriptor && 'value' in descriptor ? descriptor.value : undefined,
          `${path}/${index}`,
          depth + 1,
        );
        if (!result.ok) {
          return result;
        }
        output.push(result.value);
      }
      return { ok: true, value: Object.freeze(output) };
    }

    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return { ok: false, issue: { code: 'prototype', path } };
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length > PIPELINE_LIMITS.portable.objectKeys) {
      return { ok: false, issue: { code: 'object-keys', path } };
    }
    if (ownKeys.some((key) => typeof key === 'symbol')) {
      return { ok: false, issue: { code: 'symbol', path } };
    }
    const keys = ownKeys
      .filter((key): key is string => typeof key === 'string')
      .sort(compareUnicodeCodePoints);
    const descriptors = new Map<string, PropertyDescriptor>();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || 'get' in descriptor || 'set' in descriptor) {
        return {
          ok: false,
          issue: { code: 'accessor', path: `${path}/${escapedPathSegment(key)}` },
        };
      }
      if (!descriptor.enumerable) {
        return {
          ok: false,
          issue: { code: 'non-enumerable', path: `${path}/${escapedPathSegment(key)}` },
        };
      }
      descriptors.set(key, descriptor);
    }
    const output: Record<string, PortableJsonValue> = {};
    for (const key of keys) {
      const descriptor = descriptors.get(key);
      const result = inspect(
        descriptor && 'value' in descriptor ? descriptor.value : undefined,
        `${path}/${escapedPathSegment(key)}`,
        depth + 1,
      );
      if (!result.ok) {
        return result;
      }
      Object.defineProperty(output, key, {
        configurable: false,
        enumerable: true,
        value: result.value,
        writable: false,
      });
    }
    return { ok: true, value: Object.freeze(output) };
  };

  return inspect(input, '', 0);
};
