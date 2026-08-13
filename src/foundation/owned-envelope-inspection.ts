import { reflectOwnDescriptor, reflectOwnKeys, reflectPrototype } from './hostile-reflection.js';
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

const readDataValue = (value: object, key: PropertyKey): unknown => {
  const descriptor = reflectOwnDescriptor(value, key);
  return descriptor?.enumerable && 'value' in descriptor ? descriptor.value : invalid;
};

const readArrayLength = (value: object): number | null => {
  const descriptor = reflectOwnDescriptor(value, 'length');
  const length: unknown = descriptor !== null && 'value' in descriptor ? descriptor.value : null;
  return typeof length === 'number' && Number.isSafeInteger(length) ? length : null;
};

export const inspectArray = (
  input: object,
  path: JsonPointer,
  maximumArrayItems: number,
): { readonly values: readonly unknown[] } | InspectionFailure => {
  const prototype = reflectPrototype(input);
  const keys = reflectOwnKeys(input);
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
  const prototype = reflectPrototype(input);
  const ownKeys = reflectOwnKeys(input);
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
