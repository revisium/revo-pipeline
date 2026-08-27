import { reflectIsArray } from './hostile-reflection.js';
import { appendJsonPointer, type JsonPointer } from './json-pointer.js';
import type { JsonScalar, JsonValue, PipelineFailure } from './json-value-contracts.js';
import { inspectArray, inspectObject } from './owned-envelope-inspection.js';
import { isNfcString } from './unicode.js';

export type JsonValueTraversalObjectLimit = (path: JsonPointer) => number;

export type JsonValueTraversalPolicy = {
  readonly maximumDepth: number;
  readonly maximumArrayItems: number;
  readonly maximumVisitedValues: number;
  readonly objectLimit: JsonValueTraversalObjectLimit;
  readonly boundFailureCode: PipelineFailure['code'];
  readonly allowNonNfcObjectKeys?: boolean;
};

export type JsonValueTraversalResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly failure: PipelineFailure };

export type JsonValueTraversalSession = {
  readonly normalize: (input: unknown, path: JsonPointer) => JsonValueTraversalResult;
};

type Assignment = (value: JsonValue) => void;

type VisitTask = {
  readonly kind: 'visit';
  readonly input: unknown;
  readonly path: JsonPointer;
  readonly depth: number;
  readonly assign: Assignment | null;
};

type ExitTask = {
  readonly kind: 'exit';
  readonly input: object;
  readonly output: JsonValue[] | Record<string, JsonValue> | null;
  readonly assign: Assignment | null;
};

type TraversalTask = VisitTask | ExitTask;

const failure = (code: PipelineFailure['code'], path: JsonPointer): JsonValueTraversalResult => ({
  ok: false,
  failure: { code, path },
});

const assertPolicy = (policy: JsonValueTraversalPolicy): void => {
  if (
    !Number.isSafeInteger(policy.maximumDepth) ||
    policy.maximumDepth < 0 ||
    !Number.isSafeInteger(policy.maximumArrayItems) ||
    policy.maximumArrayItems < 0 ||
    !Number.isSafeInteger(policy.maximumVisitedValues) ||
    policy.maximumVisitedValues < 1
  ) {
    throw new TypeError('Invalid JSON value traversal bound.');
  }
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

const enqueueExit = (
  input: object,
  output: JsonValue[] | Record<string, JsonValue> | null,
  assign: Assignment | null,
  tasks: TraversalTask[],
): void => {
  tasks.push({ kind: 'exit', input, output, assign });
};

const enqueueArrayContainer = (
  input: object,
  task: VisitTask,
  policy: JsonValueTraversalPolicy,
  tasks: TraversalTask[],
): JsonValueTraversalResult | null => {
  const inspection = inspectArray(
    input,
    task.path,
    policy.maximumArrayItems,
    policy.boundFailureCode,
  );
  if ('ok' in inspection) {
    return inspection;
  }
  const assign = task.assign;
  const output: JsonValue[] | null = assign === null ? null : [];
  enqueueExit(input, output, assign, tasks);
  for (let index = inspection.values.length - 1; index >= 0; index -= 1) {
    tasks.push({
      kind: 'visit',
      input: inspection.values[index],
      path: appendJsonPointer(task.path, String(index)),
      depth: task.depth + 1,
      assign:
        output === null
          ? null
          : (value) => {
              output[index] = value;
            },
    });
  }
  return null;
};

const enqueueObjectContainer = (
  input: object,
  task: VisitTask,
  policy: JsonValueTraversalPolicy,
  tasks: TraversalTask[],
): JsonValueTraversalResult | null => {
  let maximumObjectProperties: number;
  try {
    maximumObjectProperties = policy.objectLimit(task.path);
  } catch {
    return failure('CANONICAL_INPUT', task.path);
  }
  if (!Number.isSafeInteger(maximumObjectProperties) || maximumObjectProperties < 0) {
    return failure('CANONICAL_INPUT', task.path);
  }
  const inspection = inspectObject(
    input,
    task.path,
    maximumObjectProperties,
    policy.boundFailureCode,
    policy.allowNonNfcObjectKeys,
  );
  if ('ok' in inspection) {
    return inspection;
  }
  const assign = task.assign;
  const output: Record<string, JsonValue> | null = assign === null ? null : {};
  enqueueExit(input, output, assign, tasks);
  for (let index = inspection.entries.length - 1; index >= 0; index -= 1) {
    const entry = inspection.entries[index];
    if (entry !== undefined) {
      const [key, value] = entry;
      tasks.push({
        kind: 'visit',
        input: value,
        path: appendJsonPointer(task.path, key),
        depth: task.depth + 1,
        assign: output === null ? null : assignObjectEntry(output, key),
      });
    }
  }
  return null;
};

const enqueueContainer = (
  input: object,
  task: VisitTask,
  policy: JsonValueTraversalPolicy,
  tasks: TraversalTask[],
): JsonValueTraversalResult | null => {
  const isArray = reflectIsArray(input);
  if (isArray === null) {
    return failure('CANONICAL_INPUT', task.path);
  }
  return isArray
    ? enqueueArrayContainer(input, task, policy, tasks)
    : enqueueObjectContainer(input, task, policy, tasks);
};

type PrimitiveDisposition =
  | { readonly kind: 'container'; readonly input: object }
  | { readonly kind: 'scalar'; readonly value: JsonScalar }
  | { readonly kind: 'failure'; readonly result: JsonValueTraversalResult };

const normalizePrimitive = (input: unknown, path: JsonPointer): PrimitiveDisposition => {
  if (input === null || typeof input === 'boolean') {
    return { kind: 'scalar', value: input };
  }
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) {
      return { kind: 'failure', result: failure('CANONICAL_INPUT', path) };
    }
    return { kind: 'scalar', value: Object.is(input, -0) ? 0 : input };
  }
  if (typeof input === 'string') {
    if (!isNfcString(input)) {
      return { kind: 'failure', result: failure('CANONICAL_INPUT', path) };
    }
    return { kind: 'scalar', value: input };
  }
  return typeof input === 'object'
    ? { kind: 'container', input }
    : { kind: 'failure', result: failure('CANONICAL_INPUT', path) };
};

const writeScalar = (value: JsonScalar, assign: Assignment | null): void => assign?.(value);

const processExitTask = (task: ExitTask, activeObjects: WeakSet<object>): void => {
  activeObjects.delete(task.input);
  if (task.output !== null && task.assign !== null) {
    task.assign(Object.freeze(task.output));
  }
};

const processVisitTask = (
  task: VisitTask,
  policy: JsonValueTraversalPolicy,
  visited: { count: number },
  activeObjects: WeakSet<object>,
  tasks: TraversalTask[],
): JsonValueTraversalResult | null => {
  visited.count += 1;
  if (visited.count > policy.maximumVisitedValues) {
    return failure(policy.boundFailureCode, task.path);
  }
  if (task.depth > policy.maximumDepth) {
    return failure('CANONICAL_INPUT', task.path);
  }
  const primitive = normalizePrimitive(task.input, task.path);
  if (primitive.kind === 'failure') {
    return primitive.result;
  }
  if (primitive.kind === 'scalar') {
    writeScalar(primitive.value, task.assign);
    return null;
  }
  if (activeObjects.has(primitive.input)) {
    return failure('CANONICAL_INPUT', task.path);
  }
  activeObjects.add(primitive.input);
  return enqueueContainer(primitive.input, task, policy, tasks);
};

const traverseWithPolicy = (
  input: unknown,
  path: JsonPointer,
  policy: JsonValueTraversalPolicy,
  visited: { count: number },
  assign: Assignment | null,
): JsonValueTraversalResult => {
  const activeObjects = new WeakSet<object>();
  const tasks: TraversalTask[] = [{ kind: 'visit', input, path, depth: 0, assign }];

  while (tasks.length > 0) {
    const task = tasks.pop();
    if (task === undefined) {
      break;
    }
    if (task.kind === 'exit') {
      processExitTask(task, activeObjects);
      continue;
    }
    const containerFailure = processVisitTask(task, policy, visited, activeObjects, tasks);
    if (containerFailure !== null) {
      return containerFailure;
    }
  }

  return { ok: true, value: null };
};

const normalizeWithPolicy = (
  input: unknown,
  path: JsonPointer,
  policy: JsonValueTraversalPolicy,
  visited: { count: number },
): JsonValueTraversalResult => {
  let normalized: JsonValue = null;
  const result = traverseWithPolicy(input, path, policy, visited, (value) => (normalized = value));
  return result.ok ? { ok: true, value: normalized } : result;
};

export const createJsonValueTraversalSession = (
  policy: JsonValueTraversalPolicy,
): JsonValueTraversalSession => {
  assertPolicy(policy);
  const visited = { count: 0 };
  return Object.freeze({
    normalize: (input: unknown, path: JsonPointer) =>
      normalizeWithPolicy(input, path, policy, visited),
  });
};

export const normalizeJsonValueWithPolicy = (
  input: unknown,
  policy: JsonValueTraversalPolicy,
): JsonValueTraversalResult => createJsonValueTraversalSession(policy).normalize(input, '');

const ownedCanonicalPolicy: JsonValueTraversalPolicy = Object.freeze({
  maximumDepth: Number.MAX_SAFE_INTEGER,
  maximumArrayItems: Number.MAX_SAFE_INTEGER,
  maximumVisitedValues: Number.MAX_SAFE_INTEGER,
  objectLimit: () => Number.MAX_SAFE_INTEGER,
  boundFailureCode: 'CANONICAL_INPUT',
});

// This only checks the internal owned-value precondition. Public hostile input first
// passes portable normalization, which captures it into plain frozen JSON values.
export const isOwnedCanonicalJsonValue = (input: unknown): boolean =>
  traverseWithPolicy(input, '', ownedCanonicalPolicy, { count: 0 }, null).ok;
