import { normalizeJsonScalar } from './normalize-json-scalar.js';

export const jsonScalarsEqual = (
  left: null | boolean | number | string,
  right: null | boolean | number | string,
): boolean =>
  typeof left === typeof right && Object.is(normalizeJsonScalar(left), normalizeJsonScalar(right));
