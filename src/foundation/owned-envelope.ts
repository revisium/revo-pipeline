import { PIPELINE_LIMITS } from './bounds.js';
import { appendJsonPointer, type JsonPointer } from './json-pointer.js';
import { inspectArray, inspectObject, readIsArray } from './owned-envelope-inspection.js';
import { type JsonValue, type PipelineFailure } from './portable-value.js';
import { isNfcString } from './unicode.js';

export type OwnedEnvelopeResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly failure: PipelineFailure };

export type OwnedEnvelopeObjectLimit = (path: JsonPointer) => number;

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
  objectLimit: OwnedEnvelopeObjectLimit,
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
  let maximumObjectProperties: number;
  try {
    maximumObjectProperties = objectLimit(path);
  } catch {
    return failure('CANONICAL_INPUT', path);
  }
  if (!Number.isSafeInteger(maximumObjectProperties) || maximumObjectProperties < 0) {
    return failure('CANONICAL_INPUT', path);
  }
  const inspection = inspectObject(input, path, maximumObjectProperties);
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

type PrimitiveDisposition =
  | { readonly kind: 'container'; readonly input: object }
  | { readonly kind: 'normalized' }
  | { readonly kind: 'failure'; readonly result: OwnedEnvelopeResult };

const normalizePrimitive = (
  input: unknown,
  path: JsonPointer,
  assign: Assignment,
): PrimitiveDisposition => {
  if (input === null || typeof input === 'boolean') {
    assign(input);
    return { kind: 'normalized' };
  }
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) {
      return { kind: 'failure', result: failure('CANONICAL_INPUT', path) };
    }
    assign(Object.is(input, -0) ? 0 : input);
    return { kind: 'normalized' };
  }
  if (typeof input === 'string') {
    if (!isNfcString(input)) {
      return { kind: 'failure', result: failure('CANONICAL_INPUT', path) };
    }
    assign(input);
    return { kind: 'normalized' };
  }
  return typeof input === 'object'
    ? { kind: 'container', input }
    : { kind: 'failure', result: failure('CANONICAL_INPUT', path) };
};

const processVisitTask = (
  task: VisitTask,
  activeObjects: WeakSet<object>,
  maximumArrayItems: number,
  objectLimit: OwnedEnvelopeObjectLimit,
  tasks: InspectionTask[],
): OwnedEnvelopeResult | null => {
  const primitive = normalizePrimitive(task.input, task.path, task.assign);
  if (primitive.kind === 'failure') {
    return primitive.result;
  }
  if (primitive.kind === 'normalized') {
    return null;
  }

  const current = primitive.input;
  if (activeObjects.has(current) || task.depth > OWNED_ENVELOPE_MAX_DEPTH) {
    return failure('CANONICAL_INPUT', task.path);
  }
  activeObjects.add(current);
  return enqueueContainer(
    current,
    task.path,
    task.assign,
    task.depth,
    maximumArrayItems,
    objectLimit,
    tasks,
  );
};

const processInspectionTask = (
  task: InspectionTask,
  activeObjects: WeakSet<object>,
  maximumArrayItems: number,
  objectLimit: OwnedEnvelopeObjectLimit,
  tasks: InspectionTask[],
): OwnedEnvelopeResult | null => {
  if (task.kind === 'visit') {
    return processVisitTask(task, activeObjects, maximumArrayItems, objectLimit, tasks);
  }
  activeObjects.delete(task.input);
  task.assign(Object.freeze(task.output));
  return null;
};

export const normalizeOwnedEnvelope = (
  input: unknown,
  maximumArrayItems: number,
  objectLimit: OwnedEnvelopeObjectLimit = () => PIPELINE_LIMITS.portableValue.objectKeys,
  maximumVisitedValues: number = Number.MAX_SAFE_INTEGER,
): OwnedEnvelopeResult => {
  if (
    !Number.isSafeInteger(maximumArrayItems) ||
    maximumArrayItems < 0 ||
    !Number.isSafeInteger(maximumVisitedValues) ||
    maximumVisitedValues < 1
  ) {
    throw new TypeError('Invalid owned envelope array bound.');
  }

  let normalized: JsonValue = null;
  const activeObjects = new WeakSet<object>();
  const tasks: InspectionTask[] = [
    { kind: 'visit', input, path: '', depth: 0, assign: (value) => (normalized = value) },
  ];
  let visitedValues = 0;

  while (tasks.length > 0) {
    const task = tasks.pop();
    if (task === undefined) {
      break;
    }
    if (task.kind === 'visit') {
      visitedValues += 1;
      if (visitedValues > maximumVisitedValues) {
        return failure('BOUND_EXCEEDED', task.path);
      }
    }
    const taskFailure = processInspectionTask(
      task,
      activeObjects,
      maximumArrayItems,
      objectLimit,
      tasks,
    );
    if (taskFailure !== null) {
      return taskFailure;
    }
  }

  return { ok: true, value: normalized };
};
