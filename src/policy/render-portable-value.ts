import { compareUnicodeCodePoints } from './compare-unicode-code-points.js';
import { inspectPortableValue } from './inspect-portable-value.js';
import { PIPELINE_LIMITS } from './pipeline-limits.js';

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareUnicodeCodePoints)) {
    Object.defineProperty(output, key, {
      configurable: false,
      enumerable: true,
      value: canonicalize(Object.getOwnPropertyDescriptor(value, key)?.value),
      writable: false,
    });
  }
  return output;
};

export const renderPortableValue = (value: unknown): string => {
  const inspected = inspectPortableValue(value);
  const rendered = inspected.ok
    ? (JSON.stringify(canonicalize(inspected.value)) ?? 'null')
    : `[non-portable:${inspected.issue.code}]`;
  return Array.from(rendered).slice(0, PIPELINE_LIMITS.portable.renderingCharacters).join('');
};
