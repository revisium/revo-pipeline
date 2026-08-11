import { PIPELINE_LIMITS } from './bounds.js';
import { isNfcString, unicodeCodePointLength } from './unicode.js';

const forbiddenIdentifierCharacter = /[\p{Cc}/~]/u;

export const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' &&
  isNfcString(value) &&
  unicodeCodePointLength(value) >= 1 &&
  unicodeCodePointLength(value) <= PIPELINE_LIMITS.identifierCodePoints &&
  !forbiddenIdentifierCharacter.test(value);

export const isDisplayString = (value: unknown): value is string =>
  typeof value === 'string' &&
  isNfcString(value) &&
  unicodeCodePointLength(value) <= PIPELINE_LIMITS.displayStringCodePoints;
