import { compareUnicodeCodePoints, PIPELINE_LIMITS } from '../../policy/index.js';
import { compiledCaptureLimit } from './compiled-capture-limit.js';
import type { CompiledInspectionFaultCollector } from './compiled-inspection-fault-collector.js';

type PortableValue =
  | null
  | boolean
  | number
  | string
  | readonly PortableValue[]
  | { readonly [key: string]: PortableValue };

interface CaptureContext {
  exhausted: boolean;
  readonly faults: CompiledInspectionFaultCollector;
  incomingOffsets: number;
  outgoingOffsets: number;
  regionMembers: number;
  visited: number;
}
const REFLECTION_FAILURE = Symbol('reflection-failure');

const escaped = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1');
const childPath = (path: string, key: string): string => `${path}/${escaped(key)}`;

const add = (
  context: CaptureContext,
  code: 'DECODE_TYPE' | 'DECODE_LIMIT' | 'DECODE_CANONICAL',
  path: string,
  message: string,
): undefined => {
  context.faults.add({ code, path, message });
  return undefined;
};

const safeReflect = <T>(
  operation: () => T,
  context: CaptureContext,
  path: string,
): T | typeof REFLECTION_FAILURE => {
  try {
    return operation();
  } catch {
    add(context, 'DECODE_TYPE', path, 'Compiled pipeline container reflection failed.');
    return REFLECTION_FAILURE;
  }
};

const capturePrimitive = (
  value: unknown,
  path: string,
  context: CaptureContext,
): PortableValue | undefined => {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      return add(context, 'DECODE_TYPE', path, 'Compiled pipeline number must be a safe integer.');
    }
    if (Object.is(value, -0)) {
      return add(context, 'DECODE_CANONICAL', path, 'Compiled pipeline number must not be -0.');
    }
    return value;
  }
  if (typeof value === 'string') {
    if (Array.from(value).length > PIPELINE_LIMITS.portable.displayCodePoints) {
      return add(context, 'DECODE_LIMIT', path, 'Compiled pipeline string exceeds its limit.');
    }
    if (value !== value.normalize('NFC')) {
      return add(context, 'DECODE_CANONICAL', path, 'Compiled pipeline string must be NFC.');
    }
    return value;
  }
  return add(context, 'DECODE_TYPE', path, 'Compiled pipeline value is not portable data.');
};

const captureDescriptors = (
  value: object,
  keys: readonly string[],
  path: string,
  depth: number,
  context: CaptureContext,
): Readonly<Record<string, PortableValue>> => {
  const output: Record<string, PortableValue> = {};
  for (const key of keys) {
    if (context.exhausted) {
      break;
    }
    const nextPath = childPath(path, key);
    const descriptor = safeReflect(
      () => Object.getOwnPropertyDescriptor(value, key),
      context,
      nextPath,
    );
    if (descriptor === REFLECTION_FAILURE) {
      continue;
    }
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      add(context, 'DECODE_TYPE', nextPath, 'Compiled pipeline property must be enumerable data.');
      continue;
    }
    const captured = captureValue(descriptor.value, nextPath, depth + 1, context);
    if (captured !== undefined) {
      Object.defineProperty(output, key, {
        configurable: false,
        enumerable: true,
        value: captured,
        writable: false,
      });
    }
  }
  return Object.freeze(output);
};

const captureArray = (
  value: object,
  path: string,
  depth: number,
  context: CaptureContext,
  ownKeys: readonly PropertyKey[],
): PortableValue | undefined => {
  const lengthDescriptor = safeReflect(
    () => {
      const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
      return descriptor && 'value' in descriptor && typeof descriptor.value === 'number'
        ? descriptor.value
        : undefined;
    },
    context,
    path,
  );
  if (
    lengthDescriptor === REFLECTION_FAILURE ||
    typeof lengthDescriptor !== 'number' ||
    !Number.isSafeInteger(lengthDescriptor) ||
    lengthDescriptor < 0
  ) {
    return add(context, 'DECODE_TYPE', path, 'Compiled pipeline array length is invalid.');
  }
  const length = lengthDescriptor;
  const limit = compiledCaptureLimit(path);
  if (length > limit.maximum) {
    return add(context, 'DECODE_LIMIT', path, 'Compiled pipeline collection exceeds its limit.');
  }
  const counter = limit.aggregate;
  if (counter !== undefined) {
    if (context[counter] + length > limit.maximum) {
      return add(
        context,
        'DECODE_LIMIT',
        childPath(path, String(limit.maximum - context[counter])),
        'Compiled pipeline aggregate collection exceeds its limit.',
      );
    }
    context[counter] += length;
  }
  const expected = Array.from({ length }, (_, index) => String(index));
  if (
    ownKeys.some((key) => typeof key === 'symbol') ||
    ownKeys.length !== length + 1 ||
    !expected.every((key) => ownKeys.includes(key))
  ) {
    return add(context, 'DECODE_TYPE', path, 'Compiled pipeline array shape is invalid.');
  }
  const captured = captureDescriptors(value, expected, path, depth, context);
  return Object.freeze(expected.flatMap((key) => (key in captured ? [captured[key]!] : [])));
};

const captureObject = (
  value: object,
  path: string,
  depth: number,
  context: CaptureContext,
  ownKeys: readonly PropertyKey[],
): PortableValue | undefined => {
  if (ownKeys.length > PIPELINE_LIMITS.portable.objectKeys) {
    return add(context, 'DECODE_LIMIT', path, 'Compiled pipeline object exceeds its key limit.');
  }
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    return add(context, 'DECODE_TYPE', path, 'Compiled pipeline object has a symbol key.');
  }
  const keys = ownKeys.filter((key): key is string => typeof key === 'string');
  return captureDescriptors(value, keys.toSorted(compareUnicodeCodePoints), path, depth, context);
};

const captureValue = (
  value: unknown,
  path: string,
  depth: number,
  context: CaptureContext,
): PortableValue | undefined => {
  if (context.exhausted) {
    return undefined;
  }
  context.visited += 1;
  if (context.visited > PIPELINE_LIMITS.portable.visitedValues) {
    context.exhausted = true;
    return add(context, 'DECODE_LIMIT', path, 'Compiled pipeline exceeds its value limit.');
  }
  if (depth > PIPELINE_LIMITS.portable.depth) {
    return add(context, 'DECODE_LIMIT', path, 'Compiled pipeline exceeds its depth limit.');
  }
  if (value === null || typeof value !== 'object') {
    return capturePrimitive(value, path, context);
  }
  const prototype = safeReflect(() => Reflect.getPrototypeOf(value), context, path);
  if (prototype === REFLECTION_FAILURE) {
    return undefined;
  }
  const ownKeys = safeReflect(() => Reflect.ownKeys(value), context, path);
  if (ownKeys === REFLECTION_FAILURE) {
    return undefined;
  }
  let array = false;
  try {
    array = Array.isArray(value);
  } catch {
    return add(context, 'DECODE_TYPE', path, 'Compiled pipeline container reflection failed.');
  }
  if (
    (array && prototype !== Array.prototype) ||
    (!array && prototype !== Object.prototype && prototype !== null)
  ) {
    return add(context, 'DECODE_TYPE', path, 'Compiled pipeline container prototype is invalid.');
  }
  return array
    ? captureArray(value, path, depth, context, ownKeys)
    : captureObject(value, path, depth, context, ownKeys);
};

export const snapshotCompiledInput = (
  input: unknown,
  faults: CompiledInspectionFaultCollector,
): PortableValue | undefined =>
  captureValue(input, '', 0, {
    exhausted: false,
    faults,
    incomingOffsets: 0,
    outgoingOffsets: 0,
    regionMembers: 0,
    visited: 0,
  });
