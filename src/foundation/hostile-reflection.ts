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
