import { PIPELINE_LIMITS } from './bounds.js';
import { isNfcString, unicodeCodePointLength } from './unicode.js';

const forbiddenIdentifierCharacter = /[\p{Cc}/~]/u;

export const isIdentifier = (value: unknown): value is string => {
  if (typeof value !== 'string' || !isNfcString(value)) {
    return false;
  }
  const length = unicodeCodePointLength(value);
  return (
    length >= 1 &&
    length <= PIPELINE_LIMITS.identifierCodePoints &&
    !forbiddenIdentifierCharacter.test(value)
  );
};

export const isDisplayString = (value: unknown): value is string => {
  if (typeof value !== 'string' || !isNfcString(value)) {
    return false;
  }
  return unicodeCodePointLength(value) <= PIPELINE_LIMITS.displayStringCodePoints;
};
