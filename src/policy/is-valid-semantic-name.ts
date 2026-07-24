import { PIPELINE_LIMITS } from './pipeline-limits.js';

const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.codePointAt(index);
    if (current === undefined || (current >= 0xd800 && current <= 0xdfff)) {
      return true;
    }
    if (current > 0xffff) {
      index += 1;
    }
  }
  return false;
};

export const isValidSemanticName = (value: unknown): value is string =>
  typeof value === 'string' &&
  value === value.normalize('NFC') &&
  Array.from(value).length > 0 &&
  Array.from(value).length <= PIPELINE_LIMITS.portable.nameCodePoints &&
  !hasUnpairedSurrogate(value);
