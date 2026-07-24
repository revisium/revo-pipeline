import { PIPELINE_LIMITS } from './pipeline-limits.js';

const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (current >= 0xdc00 && current <= 0xdfff) {
      return true;
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
