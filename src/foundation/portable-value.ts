import { PIPELINE_LIMITS } from './bounds.js';
import { appendJsonPointer, type JsonPointer } from './json-pointer.js';
import { compareUnicodeCodePoints, isNfcString } from './unicode.js';

export type JsonScalar = null | boolean | number | string;
export type JsonValue = JsonScalar | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type PipelineFailure = {
  readonly code: string;
  readonly path: JsonPointer;
};

export type PortableValueResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly failure: PipelineFailure };

type InspectionContext = {
  readonly activeObjects: WeakSet<object>;
  visitedValues: number;
};

export type PortableNormalizationSession = {
  readonly normalize: (input: unknown, path: JsonPointer) => PortableValueResult;
};

const rejected = (path: JsonPointer): PortableValueResult => ({
  ok: false,
  failure: { code: 'CANONICAL_INPUT', path },
});

const inspectNumber = (value: number, path: JsonPointer): PortableValueResult =>
  Number.isSafeInteger(value)
    ? { ok: true, value: Object.is(value, -0) ? 0 : value }
    : rejected(path);

const inspectString = (value: string, path: JsonPointer): PortableValueResult =>
  isNfcString(value) ? { ok: true, value } : rejected(path);

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

const readDataDescriptor = (value: object, key: PropertyKey): PropertyDescriptor | null => {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      return null;
    }
    return descriptor;
  } catch {
    return null;
  }
};

const readArrayLength = (value: readonly unknown[]): number | null => {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
    return descriptor && 'value' in descriptor && Number.isSafeInteger(descriptor.value)
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
};

const withActiveObject = (
  value: object,
  path: JsonPointer,
  context: InspectionContext,
  inspect: () => PortableValueResult,
): PortableValueResult => {
  if (context.activeObjects.has(value)) {
    return rejected(path);
  }
  context.activeObjects.add(value);
  try {
    return inspect();
  } finally {
    context.activeObjects.delete(value);
  }
};

const inspectArray = (
  value: readonly unknown[],
  path: JsonPointer,
  depth: number,
  context: InspectionContext,
): PortableValueResult => {
  const length = readArrayLength(value);
  if (
    length === null ||
    length > PIPELINE_LIMITS.portableValue.arrayItems ||
    readPrototype(value) !== Array.prototype
  ) {
    return rejected(path);
  }
  const keys = readOwnKeys(value);
  if (
    keys?.length !== length + 1 ||
    !keys.includes('length') ||
    keys.some((key) => typeof key !== 'string')
  ) {
    return rejected(path);
  }
  return withActiveObject(value, path, context, () => {
    const output: JsonValue[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      const descriptor = readDataDescriptor(value, key);
      if (descriptor === null) {
        return rejected(appendJsonPointer(path, key));
      }
      const result = inspectValue(
        descriptor.value,
        appendJsonPointer(path, key),
        depth + 1,
        context,
      );
      if (!result.ok) {
        return result;
      }
      output.push(result.value);
    }
    return { ok: true, value: Object.freeze(output) };
  });
};

const inspectObject = (
  value: object,
  path: JsonPointer,
  depth: number,
  context: InspectionContext,
): PortableValueResult => {
  const prototype = readPrototype(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return rejected(path);
  }
  const ownKeys = readOwnKeys(value);
  if (ownKeys === null || ownKeys.length > PIPELINE_LIMITS.portableValue.objectKeys) {
    return rejected(path);
  }
  const keys: string[] = [];
  for (const key of ownKeys) {
    if (typeof key !== 'string') {
      return rejected(path);
    }
    keys.push(key);
  }
  keys.sort(compareUnicodeCodePoints);
  if (keys.some((key) => !isNfcString(key))) {
    return rejected(path);
  }
  return withActiveObject(value, path, context, () => {
    const output: Record<string, JsonValue> = {};
    for (const key of keys) {
      const keyPath = appendJsonPointer(path, key);
      const descriptor = readDataDescriptor(value, key);
      if (descriptor === null) {
        return rejected(keyPath);
      }
      const result = inspectValue(descriptor.value, keyPath, depth + 1, context);
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
  });
};

const inspectValue = (
  value: unknown,
  path: JsonPointer,
  depth: number,
  context: InspectionContext,
): PortableValueResult => {
  context.visitedValues += 1;
  if (
    depth > PIPELINE_LIMITS.portableValue.depth ||
    context.visitedValues > PIPELINE_LIMITS.portableValue.visitedValues
  ) {
    return rejected(path);
  }
  if (value === null || typeof value === 'boolean') {
    return { ok: true, value };
  }
  if (typeof value === 'number') {
    return inspectNumber(value, path);
  }
  if (typeof value === 'string') {
    return inspectString(value, path);
  }
  if (typeof value !== 'object') {
    return rejected(path);
  }
  try {
    return Array.isArray(value)
      ? inspectArray(value, path, depth, context)
      : inspectObject(value, path, depth, context);
  } catch {
    return rejected(path);
  }
};

export const createPortableNormalizationSession = (): PortableNormalizationSession => {
  const context: InspectionContext = { activeObjects: new WeakSet(), visitedValues: 0 };
  return Object.freeze({
    normalize: (input: unknown, path: JsonPointer): PortableValueResult =>
      inspectValue(input, path, 0, context),
  });
};

export const normalizePortableValue = (input: unknown): PortableValueResult =>
  createPortableNormalizationSession().normalize(input, '');

export const isPortableValue = (input: unknown): input is JsonValue =>
  normalizePortableValue(input).ok;
