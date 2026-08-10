import { Type, type TObject, type TProperties } from 'typebox';

export type ClosedObjectOptions = {
  readonly $id?: string;
  readonly title?: string;
  readonly description?: string;
};

type NormalizedClosedObjectOptions = {
  $id?: string;
  title?: string;
  description?: string;
  additionalProperties: false;
};

const allowedOptionNames = new Set<string>(['$id', 'title', 'description']);

const invalidOptions = (): never => {
  throw new TypeError('Invalid closed object schema options.');
};

const normalizeOptions = (
  input: ClosedObjectOptions | undefined,
): NormalizedClosedObjectOptions => {
  const normalized: NormalizedClosedObjectOptions = { additionalProperties: false };
  if (input === undefined) {
    return normalized;
  }

  try {
    const prototype = Reflect.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidOptions();
    }
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string' || !allowedOptionNames.has(key)) {
        return invalidOptions();
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
      if (
        !descriptor?.enumerable ||
        !('value' in descriptor) ||
        typeof descriptor.value !== 'string'
      ) {
        return invalidOptions();
      }
      if (key === '$id') {
        normalized.$id = descriptor.value;
      } else if (key === 'title') {
        normalized.title = descriptor.value;
      } else {
        normalized.description = descriptor.value;
      }
    }
  } catch {
    return invalidOptions();
  }
  return normalized;
};

export const closedObject = <const Properties extends TProperties>(
  properties: Properties,
  options?: ClosedObjectOptions,
): TObject<Properties> => Type.Object(properties, normalizeOptions(options));
