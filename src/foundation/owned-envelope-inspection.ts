import { appendJsonPointer, type JsonPointer } from './json-pointer.js';
import { type PipelineFailure } from './portable-value.js';
import { compareUnicodeCodePoints, isNfcString } from './unicode.js';

type InspectionFailure = {
  readonly ok: false;
  readonly failure: PipelineFailure;
};

const failure = (code: PipelineFailure['code'], path: JsonPointer): InspectionFailure => ({
  ok: false,
  failure: { code, path },
});

const invalid = Symbol('invalid-owned-envelope-value');

const readOwnKeys = (value: object): readonly PropertyKey[] | null => {
  try {
    return Reflect.ownKeys(value);
  } catch {
    return null;
  }
};

const readPrototype = (value: object): object | null | undefined => {
  try {
    return Reflect.getPrototypeOf(value);
  } catch {
    return undefined;
  }
};

export const readIsArray = (value: object): boolean | null => {
  try {
    return Array.isArray(value);
  } catch {
    return null;
  }
};

const readDataValue = (value: object, key: PropertyKey): unknown => {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && 'value' in descriptor ? descriptor.value : invalid;
  } catch {
    return invalid;
  }
};

const readArrayLength = (value: object): number | null => {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
    const length: unknown = descriptor && 'value' in descriptor ? descriptor.value : null;
    return typeof length === 'number' && Number.isSafeInteger(length) ? length : null;
  } catch {
    return null;
  }
};

export const inspectArray = (
  input: object,
  path: JsonPointer,
  maximumArrayItems: number,
): { readonly values: readonly unknown[] } | InspectionFailure => {
  const prototype = readPrototype(input);
  const keys = readOwnKeys(input);
  const length = readArrayLength(input);
  if (
    prototype !== Array.prototype ||
    keys === null ||
    length === null ||
    keys.length !== length + 1 ||
    !keys.includes('length') ||
    keys.some((key) => typeof key !== 'string')
  ) {
    return failure('CANONICAL_INPUT', path);
  }
  if (length > maximumArrayItems) {
    return failure('BOUND_EXCEEDED', path);
  }
  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const value = readDataValue(input, String(index));
    if (value === invalid) {
      return failure('CANONICAL_INPUT', appendJsonPointer(path, String(index)));
    }
    values.push(value);
  }
  return { values };
};

export const inspectObject = (
  input: object,
  path: JsonPointer,
  maximumObjectProperties: number,
): { readonly entries: readonly (readonly [string, unknown])[] } | InspectionFailure => {
  const prototype = readPrototype(input);
  const ownKeys = readOwnKeys(input);
  if ((prototype !== Object.prototype && prototype !== null) || ownKeys === null) {
    return failure('CANONICAL_INPUT', path);
  }
  if (ownKeys.length > maximumObjectProperties) {
    return failure('BOUND_EXCEEDED', path);
  }
  const keys: string[] = [];
  for (const key of ownKeys) {
    if (typeof key !== 'string' || !isNfcString(key)) {
      return failure('CANONICAL_INPUT', path);
    }
    keys.push(key);
  }
  keys.sort(compareUnicodeCodePoints);
  const entries: [string, unknown][] = [];
  for (const key of keys) {
    const value = readDataValue(input, key);
    if (value === invalid) {
      return failure('CANONICAL_INPUT', appendJsonPointer(path, key));
    }
    entries.push([key, value]);
  }
  return { entries };
};
