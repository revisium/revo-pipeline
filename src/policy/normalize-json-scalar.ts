export const normalizeJsonScalar = (
  value: null | boolean | number | string,
): null | boolean | number | string => {
  if (typeof value === 'string') {
    return value.normalize('NFC');
  }
  if (typeof value === 'number' && Object.is(value, -0)) {
    return 0;
  }
  return value;
};
