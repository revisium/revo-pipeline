import type { JsonPointer } from '../../../foundation/index.js';
import type { ProgramRepeatCondition } from '../../../program/index.js';
import { resolveSelector, type SelectorEnvironment } from '../selectors.js';

export type ConditionResult =
  | { readonly ok: true; readonly value: boolean }
  | { readonly ok: false; readonly path: JsonPointer };

const evaluateCompoundCondition = (
  condition: Extract<ProgramRepeatCondition, { readonly kind: 'all' | 'any' }>,
  environment: SelectorEnvironment,
): ConditionResult => {
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
};

const evaluateNotCondition = (
  condition: Extract<ProgramRepeatCondition, { readonly kind: 'not' }>,
  environment: SelectorEnvironment,
): ConditionResult => {
  const result = evaluateRepeatCondition(condition.condition, environment);
  return result.ok ? Object.freeze({ ok: true, value: !result.value }) : result;
};

export const evaluateRepeatCondition = (
  condition: ProgramRepeatCondition,
  environment: SelectorEnvironment,
): ConditionResult => {
  if (condition.kind === 'all' || condition.kind === 'any') {
    return evaluateCompoundCondition(condition, environment);
  }
  if (condition.kind === 'not') {
    return evaluateNotCondition(condition, environment);
  }
  const selected = resolveSelector(condition.selector, environment);
  if (condition.kind === 'exists') {
    return Object.freeze({ ok: true, value: selected.ok });
  }
  if (!selected.ok) {
    return selected;
  }
  if (typeof selected.value === 'object' && selected.value !== null) {
    const path = 'pointer' in condition.selector ? condition.selector.pointer : '';
    return Object.freeze({ ok: false, path });
  }
  const scalar = selected.value;
  return Object.freeze({
    ok: true,
    value:
      condition.kind === 'equals' ? scalar === condition.value : condition.values.includes(scalar),
  });
};
