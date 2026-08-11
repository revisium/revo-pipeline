import { PIPELINE_LIMITS } from './bounds.js';
import { appendJsonPointer, type JsonPointer } from './json-pointer.js';
import { type JsonValue, type PipelineFailure } from './portable-value.js';
import { compareUnicodeCodePoints, isNfcString } from './unicode.js';

export type OwnedEnvelopeResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly failure: PipelineFailure };

type Assignment = (value: JsonValue) => void;

type VisitTask = {
  readonly kind: 'visit';
  readonly input: unknown;
  readonly path: JsonPointer;
  readonly depth: number;
  readonly assign: Assignment;
};

type ExitTask = {
  readonly kind: 'exit';
  readonly input: object;
  readonly output: JsonValue[] | Record<string, JsonValue>;
  readonly assign: Assignment;
};

type InspectionTask = VisitTask | ExitTask;

// Above the deepest valid source envelope: 32 nested regions plus a depth-16
// ValueSchema or embedded portable value and their closed container fields.
const OWNED_ENVELOPE_MAX_DEPTH = 256;

const failure = (code: PipelineFailure['code'], path: JsonPointer): OwnedEnvelopeResult => ({
  ok: false,
  failure: { code, path },
});

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

const readIsArray = (value: object): boolean | null => {
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

const invalid = Symbol('invalid-owned-envelope-value');

const readArrayLength = (value: object): number | null => {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
    const length: unknown = descriptor && 'value' in descriptor ? descriptor.value : null;
    return typeof length === 'number' && Number.isSafeInteger(length) ? length : null;
  } catch {
    return null;
  }
};

const inspectArray = (
  input: object,
  path: JsonPointer,
  maximumArrayItems: number,
): { readonly values: readonly unknown[] } | OwnedEnvelopeResult => {
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

const inspectObject = (
  input: object,
  path: JsonPointer,
): { readonly entries: readonly (readonly [string, unknown])[] } | OwnedEnvelopeResult => {
  const prototype = readPrototype(input);
  const ownKeys = readOwnKeys(input);
  if ((prototype !== Object.prototype && prototype !== null) || ownKeys === null) {
    return failure('CANONICAL_INPUT', path);
  }
  if (ownKeys.length > PIPELINE_LIMITS.portableValue.objectKeys) {
    return failure('BOUND_EXCEEDED', path);
  }
  const keys: string[] = [];
  for (const key of ownKeys) {
    if (typeof key !== 'string') {
      return failure('CANONICAL_INPUT', path);
    }
    if (!isNfcString(key)) {
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

const assignObjectEntry =
  (output: Record<string, JsonValue>, key: string): Assignment =>
  (value) => {
    Object.defineProperty(output, key, {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    });
  };

const enqueueContainer = (
  input: object,
  path: JsonPointer,
  assign: Assignment,
  depth: number,
  maximumArrayItems: number,
  tasks: InspectionTask[],
): OwnedEnvelopeResult | null => {
  const isArray = readIsArray(input);
  if (isArray === null) {
    return failure('CANONICAL_INPUT', path);
  }
  if (isArray) {
    const inspection = inspectArray(input, path, maximumArrayItems);
    if ('ok' in inspection) {
      return inspection;
    }
    const output: JsonValue[] = [];
    tasks.push({ kind: 'exit', input, output, assign });
    for (let index = inspection.values.length - 1; index >= 0; index -= 1) {
      tasks.push({
        kind: 'visit',
        input: inspection.values[index],
        path: appendJsonPointer(path, String(index)),
        depth: depth + 1,
        assign: (value) => {
          output[index] = value;
        },
      });
    }
    return null;
  }
  const inspection = inspectObject(input, path);
  if ('ok' in inspection) {
    return inspection;
  }
  const output: Record<string, JsonValue> = {};
  tasks.push({ kind: 'exit', input, output, assign });
  for (let index = inspection.entries.length - 1; index >= 0; index -= 1) {
    const entry = inspection.entries[index];
    if (entry !== undefined) {
      const [key, value] = entry;
      tasks.push({
        kind: 'visit',
        input: value,
        path: appendJsonPointer(path, key),
        depth: depth + 1,
        assign: assignObjectEntry(output, key),
      });
    }
  }
  return null;
};

export const normalizeOwnedEnvelope = (
  input: unknown,
  maximumArrayItems: number,
): OwnedEnvelopeResult => {
  if (!Number.isSafeInteger(maximumArrayItems) || maximumArrayItems < 0) {
    throw new TypeError('Invalid owned envelope array bound.');
  }

  let normalized: JsonValue = null;
  const activeObjects = new WeakSet<object>();
  const tasks: InspectionTask[] = [
    { kind: 'visit', input, path: '', depth: 0, assign: (value) => (normalized = value) },
  ];

  while (tasks.length > 0) {
    const task = tasks.pop();
    if (task === undefined) {
      break;
    }
    if (task.kind === 'exit') {
      activeObjects.delete(task.input);
      task.assign(Object.freeze(task.output));
      continue;
    }
    const { input: current, path, depth, assign } = task;
    if (current === null || typeof current === 'boolean') {
      assign(current);
      continue;
    }
    if (typeof current === 'number') {
      if (!Number.isSafeInteger(current)) {
        return failure('CANONICAL_INPUT', path);
      }
      assign(Object.is(current, -0) ? 0 : current);
      continue;
    }
    if (typeof current === 'string') {
      if (!isNfcString(current)) {
        return failure('CANONICAL_INPUT', path);
      }
      assign(current);
      continue;
    }
    if (typeof current !== 'object' || activeObjects.has(current)) {
      return failure('CANONICAL_INPUT', path);
    }
    if (depth > OWNED_ENVELOPE_MAX_DEPTH) {
      return failure('CANONICAL_INPUT', path);
    }

    activeObjects.add(current);
    const containerFailure = enqueueContainer(
      current,
      path,
      assign,
      depth,
      maximumArrayItems,
      tasks,
    );
    if (containerFailure !== null) {
      return containerFailure;
    }
  }

  return { ok: true, value: normalized };
};
