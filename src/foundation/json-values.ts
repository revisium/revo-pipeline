import type { JsonValue } from './portable-value.js';

const isJsonArray = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value);

export const countJsonValues = (value: JsonValue, limit: number): number => {
  const pending: JsonValue[] = [value];
  let count = 0;
  while (pending.length > 0 && count <= limit) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    count += 1;
    if (isJsonArray(current)) {
      pending.push(...current);
    } else if (typeof current === 'object' && current !== null) {
      pending.push(...Object.values(current));
    }
  }
  return count;
};
