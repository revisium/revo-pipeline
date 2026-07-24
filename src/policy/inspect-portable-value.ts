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

type InspectionContext = {
  readonly maxArrayLength: number;
  readonly maxStringCodePoints: number;
  visitedValues: number;
};

type DescriptorResult =
  | { readonly ok: true; readonly descriptors: ReadonlyMap<string, PropertyDescriptor> }
  | { readonly ok: false; readonly result: PortableValueResult };

const escapedPathSegment = (value: string): string =>
  value.replaceAll('~', '~0').replaceAll('/', '~1');
const codePointLength = (value: string): number => Array.from(value).length;

const rejected = (code: PortableValueIssue['code'], path: string): PortableValueResult => ({
  ok: false,
  issue: { code, path },
});

const inspectNumber = (value: number, path: string): PortableValueResult =>
  Number.isSafeInteger(value)
    ? { ok: true, value: Object.is(value, -0) ? 0 : value }
    : rejected('number', path);

const inspectString = (
  value: string,
  path: string,
  maxStringCodePoints: number,
): PortableValueResult => {
  const normalized = value.normalize('NFC');
  return codePointLength(normalized) <= maxStringCodePoints
    ? { ok: true, value: normalized }
    : rejected('string', path);
};

const hasExactArrayKeys = (ownKeys: readonly PropertyKey[], length: number): boolean => {
  if (!ownKeys.includes('length')) {
    return false;
  }
  const stringKeys = ownKeys.filter(
    (key): key is string => typeof key === 'string' && key !== 'length',
  );
  const canonicalKeys = stringKeys.every(
    (key) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < length,
  );
  return canonicalKeys && new Set(stringKeys).size === length;
};

const readEnumerableDataDescriptors = (
  value: object,
  keys: readonly string[],
  pathForKey: (key: string) => string,
): DescriptorResult => {
  const descriptors = new Map<string, PropertyDescriptor>();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || 'get' in descriptor || 'set' in descriptor) {
      return { ok: false, result: rejected('accessor', pathForKey(key)) };
    }
    if (!descriptor.enumerable) {
      return { ok: false, result: rejected('non-enumerable', pathForKey(key)) };
    }
    descriptors.set(key, descriptor);
  }
  return { ok: true, descriptors };
};

const descriptorValue = (
  descriptors: ReadonlyMap<string, PropertyDescriptor>,
  key: string,
): unknown => {
  const descriptor = descriptors.get(key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};

const inspectArray = (
  value: unknown[],
  path: string,
  depth: number,
  context: InspectionContext,
): PortableValueResult => {
  if (value.length > context.maxArrayLength) {
    return rejected('array-length', path);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1) {
    return rejected('array-property', path);
  }
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    return rejected('symbol', path);
  }
  if (!hasExactArrayKeys(ownKeys, value.length)) {
    return rejected('array-property', path);
  }
  if (Reflect.getPrototypeOf(value) !== Array.prototype) {
    return rejected('prototype', path);
  }
  const keys = Array.from({ length: value.length }, (_, index) => String(index));
  const descriptorResult = readEnumerableDataDescriptors(value, keys, (key) => `${path}/${key}`);
  if (!descriptorResult.ok) {
    return descriptorResult.result;
  }
  const output: PortableJsonValue[] = [];
  for (const key of keys) {
    const result = inspectValue(
      descriptorValue(descriptorResult.descriptors, key),
      `${path}/${key}`,
      depth + 1,
      context,
    );
    if (!result.ok) {
      return result;
    }
    output.push(result.value);
  }
  return { ok: true, value: Object.freeze(output) };
};

const inspectObject = (
  value: object,
  path: string,
  depth: number,
  context: InspectionContext,
): PortableValueResult => {
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return rejected('prototype', path);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > PIPELINE_LIMITS.portable.objectKeys) {
    return rejected('object-keys', path);
  }
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    return rejected('symbol', path);
  }
  const keys = ownKeys
    .filter((key): key is string => typeof key === 'string')
    .sort(compareUnicodeCodePoints);
  const keyPath = (key: string): string => `${path}/${escapedPathSegment(key)}`;
  const descriptorResult = readEnumerableDataDescriptors(value, keys, keyPath);
  if (!descriptorResult.ok) {
    return descriptorResult.result;
  }
  const output: Record<string, PortableJsonValue> = {};
  for (const key of keys) {
    const result = inspectValue(
      descriptorValue(descriptorResult.descriptors, key),
      keyPath(key),
      depth + 1,
      context,
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

const inspectValue = (
  value: unknown,
  path: string,
  depth: number,
  context: InspectionContext,
): PortableValueResult => {
  context.visitedValues += 1;
  if (context.visitedValues > PIPELINE_LIMITS.portable.visitedValues) {
    return rejected('visited-values', path);
  }
  if (depth > PIPELINE_LIMITS.portable.depth) {
    return rejected('depth', path);
  }
  if (value === null || typeof value === 'boolean') {
    return { ok: true, value };
  }
  if (typeof value === 'number') {
    return inspectNumber(value, path);
  }
  if (typeof value === 'string') {
    return inspectString(value, path, context.maxStringCodePoints);
  }
  if (typeof value !== 'object') {
    return rejected('unsupported', path);
  }
  return Array.isArray(value)
    ? inspectArray(value, path, depth, context)
    : inspectObject(value, path, depth, context);
};

export const inspectPortableValue = (
  input: unknown,
  options: Readonly<{ maxArrayLength?: number; maxStringCodePoints?: number }> = {},
): PortableValueResult => {
  const context: InspectionContext = {
    maxArrayLength: options.maxArrayLength ?? PIPELINE_LIMITS.facts.total,
    maxStringCodePoints: options.maxStringCodePoints ?? PIPELINE_LIMITS.portable.displayCodePoints,
    visitedValues: 0,
  };
  return inspectValue(input, '', 0, context);
};
