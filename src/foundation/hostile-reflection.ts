export const reflectOwnKeys = (value: object): readonly PropertyKey[] | null => {
  try {
    return Reflect.ownKeys(value);
  } catch {
    return null;
  }
};

export const reflectPrototype = (value: object): object | null | undefined => {
  try {
    return Reflect.getPrototypeOf(value);
  } catch {
    return undefined;
  }
};

export const reflectOwnDescriptor = (
  value: object,
  key: PropertyKey,
): PropertyDescriptor | null => {
  try {
    return Reflect.getOwnPropertyDescriptor(value, key) ?? null;
  } catch {
    return null;
  }
};

export const reflectIsArray = (value: object): boolean | null => {
  try {
    return Array.isArray(value);
  } catch {
    return null;
  }
};

export const readOwnDataValue = (input: unknown, key: PropertyKey): unknown => {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const descriptor = reflectOwnDescriptor(input, key);
  return descriptor !== null && 'value' in descriptor ? descriptor.value : undefined;
};
