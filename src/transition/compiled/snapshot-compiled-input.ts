import {
  compareUnicodeCodePoints,
  inspectPortableValue,
  PIPELINE_LIMITS,
} from '../../policy/index.js';

type PortableValue =
  | null
  | boolean
  | number
  | string
  | readonly PortableValue[]
  | { readonly [key: string]: PortableValue };

const equalsCanonicalPortableValue = (input: unknown, canonical: unknown): boolean => {
  if (typeof input === 'number' && typeof canonical === 'number') {
    return Object.is(input, canonical);
  }
  if (input === null || typeof input !== 'object') {
    return input === canonical;
  }
  if (
    canonical === null ||
    typeof canonical !== 'object' ||
    Array.isArray(input) !== Array.isArray(canonical)
  ) {
    return false;
  }
  const inputKeys = Object.keys(input).sort(compareUnicodeCodePoints);
  const canonicalKeys = Object.keys(canonical).sort(compareUnicodeCodePoints);
  return (
    inputKeys.length === canonicalKeys.length &&
    inputKeys.every((key, index) => {
      if (key !== canonicalKeys[index]) {
        return false;
      }
      const inputDescriptor = Object.getOwnPropertyDescriptor(input, key);
      const canonicalDescriptor = Object.getOwnPropertyDescriptor(canonical, key);
      return (
        inputDescriptor !== undefined &&
        canonicalDescriptor !== undefined &&
        'value' in inputDescriptor &&
        'value' in canonicalDescriptor &&
        equalsCanonicalPortableValue(inputDescriptor.value, canonicalDescriptor.value)
      );
    })
  );
};

export const snapshotCompiledInput = (input: unknown): PortableValue | undefined => {
  const inspected = inspectPortableValue(input, {
    maxArrayLength: PIPELINE_LIMITS.facts.total,
    maxStringCodePoints: PIPELINE_LIMITS.portable.displayCodePoints,
  });
  return inspected.ok && equalsCanonicalPortableValue(input, inspected.value)
    ? inspected.value
    : undefined;
};
