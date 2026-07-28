import { compareUnicodeCodePoints } from '../policy/index.js';
import type { CaptureReducerContext } from './capture-reducer-context.js';

type CaptureChild = (
  value: unknown,
  path: string,
  depth: number,
  context: CaptureReducerContext,
) => unknown;

const escaped = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');
const limitCode = (root: CaptureReducerContext['root']) =>
  root === '/snapshot' ? ('SNAPSHOT_LIMIT' as const) : ('COMMAND_LIMIT' as const);
const arrayLimit = (path: string): number => {
  if (path === '/snapshot/values' || path === '/command/values') {
    return 128;
  }
  if (path === '/snapshot/nodes' || path === '/snapshot/gateResolutions') {
    return 256;
  }
  if (path === '/snapshot/candidateVerdicts') {
    return 1_024;
  }
  return 16_384;
};

export const captureReducerContainer = (
  value: object,
  path: string,
  depth: number,
  context: CaptureReducerContext,
  capture: CaptureChild,
): unknown => {
  try {
    const array = Array.isArray(value);
    const prototype = Reflect.getPrototypeOf(value);
    if (
      (array && prototype !== Array.prototype) ||
      (!array && prototype !== Object.prototype && prototype !== null)
    ) {
      context.faults.add(context.code, path, 'Portable container prototype is invalid.');
      return undefined;
    }
    const length = arrayLength(value, array);
    if (array && length === undefined) {
      context.faults.add(context.code, path, 'Portable array length is invalid.');
      return undefined;
    }
    if (array && (length ?? 0) > arrayLimit(path)) {
      context.faults.add(limitCode(context.root), path, 'Portable array length limit exceeded.');
      return undefined;
    }
    const keys = Reflect.ownKeys(value);
    if (!validateKeys(keys, array, length ?? 0, path, context)) {
      return undefined;
    }
    const descriptors = collectDescriptors(value, keys, array, path, context);
    if (!descriptors) {
      return undefined;
    }
    const output: unknown[] | Record<string, unknown> = array ? [] : {};
    descriptors.forEach(({ key, child }) => {
      const captured = capture(child, `${path}/${escaped(key)}`, depth + 1, context);
      if (Array.isArray(output)) {
        output[Number(key)] = captured;
      } else {
        output[key] = captured;
      }
    });
    return output;
  } catch {
    context.faults.add(context.code, path, 'Portable container reflection failed.');
    return undefined;
  }
};

const arrayLength = (value: object, array: boolean): number | undefined => {
  if (!array) {
    return 0;
  }
  const descriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
  return descriptor &&
    'value' in descriptor &&
    typeof descriptor.value === 'number' &&
    Number.isSafeInteger(descriptor.value) &&
    descriptor.value >= 0
    ? descriptor.value
    : undefined;
};

const validateKeys = (
  keys: readonly PropertyKey[],
  array: boolean,
  length: number,
  path: string,
  context: CaptureReducerContext,
): boolean => {
  if (keys.length > 32 && !array) {
    context.faults.add(limitCode(context.root), path, 'Portable object key limit exceeded.');
    return false;
  }
  if (keys.some((key) => typeof key === 'symbol')) {
    context.faults.add(context.code, path, 'Portable container has a symbol key.');
    return false;
  }
  const indexes = keys.filter((key) => key !== 'length');
  if (
    array &&
    (keys.length !== length + 1 ||
      indexes.length !== length ||
      indexes.some((key, index) => key !== String(index)))
  ) {
    context.faults.add(context.code, path, 'Portable array is sparse or noncanonical.');
    return false;
  }
  return true;
};

const collectDescriptors = (
  value: object,
  keys: readonly PropertyKey[],
  array: boolean,
  path: string,
  context: CaptureReducerContext,
): readonly { readonly key: string; readonly child: unknown }[] | undefined => {
  const output: { key: string; child: unknown }[] = [];
  let failed = false;
  keys
    .flatMap((key) => (typeof key === 'string' && (!array || key !== 'length') ? [key] : []))
    .toSorted(compareUnicodeCodePoints)
    .forEach((key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        context.faults.add(
          context.code,
          `${path}/${escaped(key)}`,
          'Portable property descriptor is invalid.',
        );
        failed = true;
      } else {
        output.push({ key, child: descriptor.value });
      }
    });
  return failed ? undefined : output;
};
