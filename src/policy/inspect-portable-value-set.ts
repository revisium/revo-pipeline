import { compareUnicodeCodePoints } from './compare-unicode-code-points.js';
import { PIPELINE_LIMITS } from './pipeline-limits.js';

type Issue = { readonly code: 'type' | 'limit'; readonly path: string };
type Result = { readonly value: unknown; readonly issues: readonly Issue[] };
type Context = { visits: number; exhausted: boolean; readonly issues: Issue[] };

const escapeSegment = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1');
const rejected = (context: Context, code: Issue['code'], path: string): null => {
  context.issues.push({ code, path });
  return null;
};

const inspectNumber = (input: number, path: string, context: Context): number | null => {
  if (!Number.isSafeInteger(input)) {
    return rejected(context, 'type', path);
  }
  return Object.is(input, -0) ? 0 : input;
};

const inspect = (input: unknown, path: string, depth: number, context: Context): unknown => {
  if (context.exhausted) {
    return null;
  }
  context.visits += 1;
  if (context.visits > PIPELINE_LIMITS.portable.visitedValues) {
    context.exhausted = true;
    return rejected(context, 'limit', path);
  }
  if (depth > PIPELINE_LIMITS.portable.depth) {
    return rejected(context, 'limit', path);
  }
  if (input === null || typeof input === 'boolean') {
    return input;
  }
  if (typeof input === 'number') {
    return inspectNumber(input, path, context);
  }
  if (typeof input === 'string') {
    const normalized = input.normalize('NFC');
    return Array.from(normalized).length <= PIPELINE_LIMITS.portable.displayCodePoints
      ? normalized
      : rejected(context, 'type', path);
  }
  if (typeof input !== 'object') {
    return rejected(context, 'type', path);
  }
  const isArray = Array.isArray(input);
  if (isArray && input.length > PIPELINE_LIMITS.facts.total) {
    return rejected(context, 'limit', path);
  }
  const prototype = Reflect.getPrototypeOf(input);
  if (
    (isArray && prototype !== Array.prototype) ||
    (!isArray && prototype !== Object.prototype && prototype !== null)
  ) {
    return rejected(context, 'type', path);
  }
  const ownKeys = Reflect.ownKeys(input);
  if (ownKeys.length > (isArray ? Number.MAX_SAFE_INTEGER : PIPELINE_LIMITS.portable.objectKeys)) {
    return rejected(context, 'limit', path);
  }
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    return rejected(context, 'type', path);
  }
  const reflectedKeys = ownKeys.filter(
    (key): key is string => typeof key === 'string' && (!isArray || key !== 'length'),
  );
  if (
    isArray &&
    (reflectedKeys.length !== input.length ||
      reflectedKeys.some((key) => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length))
  ) {
    return rejected(context, 'type', path);
  }
  const keys = isArray
    ? Array.from({ length: input.length }, (_entry, index) => String(index))
    : reflectedKeys.toSorted(compareUnicodeCodePoints);
  const outputArray: unknown[] = [];
  const outputObject: Record<string, unknown> = {};
  for (const key of keys) {
    const childPath = `${path}/${escapeSegment(key)}`;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      const value = rejected(context, 'type', childPath);
      if (isArray) {
        outputArray.push(value);
      } else {
        outputObject[key] = value;
      }
      continue;
    }
    const value = inspect(descriptor.value, childPath, depth + 1, context);
    if (isArray) {
      outputArray.push(value);
    } else {
      outputObject[key] = value;
    }
    if (context.exhausted) {
      break;
    }
  }
  return isArray ? outputArray : outputObject;
};

export const inspectPortableValueSet = (input: unknown): Result => {
  const context: Context = { visits: 0, exhausted: false, issues: [] };
  return { value: inspect(input, '', 0, context), issues: context.issues };
};
