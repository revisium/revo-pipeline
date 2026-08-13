import type { ProgramRepeatCondition } from '../../../program/index.js';
import { resolveSelector, type SelectorEnvironment } from '../selectors.js';

export type ConditionResult =
  | { readonly ok: true; readonly value: boolean }
  | { readonly ok: false };

export const evaluateRepeatCondition = (
  condition: ProgramRepeatCondition,
  environment: SelectorEnvironment,
): ConditionResult => {
  if (condition.kind === 'all' || condition.kind === 'any') {
    const values: boolean[] = [];
    for (const child of condition.conditions) {
      const result = evaluateRepeatCondition(child, environment);
      if (!result.ok) {
        return result;
      }
      values.push(result.value);
    }
    return Object.freeze({
      ok: true,
      value: condition.kind === 'all' ? values.every(Boolean) : values.some(Boolean),
    });
  }
  if (condition.kind === 'not') {
    const result = evaluateRepeatCondition(condition.condition, environment);
    return result.ok ? Object.freeze({ ok: true, value: !result.value }) : result;
  }
  const selected = resolveSelector(condition.selector, environment);
  if (condition.kind === 'exists') {
    return Object.freeze({ ok: true, value: selected.ok });
  }
  if (!selected.ok || (typeof selected.value === 'object' && selected.value !== null)) {
    return Object.freeze({ ok: false });
  }
  const scalar = selected.value;
  return Object.freeze({
    ok: true,
    value:
      condition.kind === 'equals'
        ? scalar === condition.value
        : condition.values.some((value) => scalar === value),
  });
};
