import { isNfcString } from './unicode.js';

export type JsonPointer = '' | `/${string}`;

export type JsonPointerLookup =
  | { readonly found: true; readonly value: unknown }
  | { readonly found: false };

const encodedTilde = /~[01]/gu;
const invalidTilde = /~(?![01])/u;
export const JSON_ARRAY_INDEX_PATTERN = '^(?:0|[1-9]\\d*)$';
const jsonArrayIndexPattern = new RegExp(JSON_ARRAY_INDEX_PATTERN, 'u');
const missing: JsonPointerLookup = Object.freeze({ found: false });

export const isCanonicalJsonArrayIndex = (value: string): boolean =>
  jsonArrayIndexPattern.test(value);

export const escapeJsonPointerToken = (token: string): string =>
  token.replaceAll('~', '~0').replaceAll('/', '~1');

export const unescapeJsonPointerToken = (token: string): string | null => {
  if (invalidTilde.test(token)) {
    return null;
  }
  return token.replace(encodedTilde, (escape) => (escape === '~0' ? '~' : '/'));
};

export const parseJsonPointer = (value: unknown): readonly string[] | null => {
  if (value === '') {
    return [];
  }
  if (typeof value !== 'string' || !value.startsWith('/')) {
    return null;
  }
  const tokens: string[] = [];
  for (const encodedToken of value.slice(1).split('/')) {
    const token = unescapeJsonPointerToken(encodedToken);
    if (token === null || !isNfcString(token)) {
      return null;
    }
    tokens.push(token);
  }
  return tokens;
};

export const isJsonPointer = (value: unknown): value is JsonPointer =>
  parseJsonPointer(value) !== null;

export const appendJsonPointer = (pointer: JsonPointer, token: string): JsonPointer =>
  `${pointer}/${escapeJsonPointerToken(token)}`;

const readOwnDataProperty = (value: object, token: string): JsonPointerLookup => {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, token);
    return descriptor && 'value' in descriptor ? { found: true, value: descriptor.value } : missing;
  } catch {
    return missing;
  }
};

type ContainerInspection = { readonly array: boolean; readonly length: number | null };

const inspectContainer = (value: object): ContainerInspection | null => {
  try {
    const array = Array.isArray(value);
    Reflect.getPrototypeOf(value);
    Reflect.ownKeys(value);
    if (!array) {
      return { array: false, length: null };
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
    return descriptor && 'value' in descriptor && Number.isSafeInteger(descriptor.value)
      ? { array: true, length: descriptor.value }
      : null;
  } catch {
    return null;
  }
};

const readArrayIndex = (value: object, length: number, token: string): JsonPointerLookup => {
  if (!isCanonicalJsonArrayIndex(token)) {
    return missing;
  }
  const index = Number(token);
  return Number.isSafeInteger(index) && index < length
    ? readOwnDataProperty(value, token)
    : missing;
};

export const readJsonPointer = (value: unknown, pointer: JsonPointer): JsonPointerLookup => {
  const tokens = parseJsonPointer(pointer);
  if (tokens === null) {
    return missing;
  }
  let current = value;
  for (const token of tokens) {
    if (typeof current !== 'object' || current === null) {
      return missing;
    }
    const inspection = inspectContainer(current);
    if (inspection === null) {
      return missing;
    }
    const lookup = inspection.array
      ? readArrayIndex(current, inspection.length ?? 0, token)
      : readOwnDataProperty(current, token);
    if (!lookup.found) {
      return missing;
    }
    current = lookup.value;
  }
  if (typeof current === 'object' && current !== null && inspectContainer(current) === null) {
    return missing;
  }
  return { found: true, value: current };
};
