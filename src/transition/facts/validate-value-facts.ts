import { compareUnicodeCodePoints, isValidKey, PIPELINE_LIMITS } from '../../policy/index.js';
import type { PipelineValueFact } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { DecisionFaultCollector } from './decision-fault-collector.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactFields = (value: Record<string, unknown>, fields: readonly string[]): boolean => {
  const keys = Object.keys(value).sort(compareUnicodeCodePoints);
  const expected = [...fields].sort(compareUnicodeCodePoints);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};

export const validateValueFacts = (
  input: readonly unknown[],
  context: DecisionContext,
  faults: DecisionFaultCollector,
): readonly PipelineValueFact[] => {
  const definitions = new Map(context.compiled.snapshot.facts.map((fact) => [fact.key, fact]));
  const seen = new Set<string>();
  const values: PipelineValueFact[] = [];
  input.forEach((entry, index) => {
    const path = `/values/${index}`;
    if (!isRecord(entry) || !hasExactFields(entry, ['key', 'value']) || !isValidKey(entry.key)) {
      faults.add('FACT_TYPE', path, 'Invalid value fact.');
      return;
    }
    const key = entry.key;
    const definition = definitions.get(key);
    if (seen.has(key)) {
      faults.add('FACT_DUPLICATE', `${path}/key`, 'Duplicate value fact.');
      return;
    }
    seen.add(key);
    if (!definition) {
      faults.add('FACT_FOREIGN', `${path}/key`, 'Foreign value fact.');
      return;
    }
    const value = entry.value;
    const actualType = value === null ? 'null' : typeof value;
    const validScalar =
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isSafeInteger(value));
    if (!validScalar || actualType !== definition.type) {
      faults.add('FACT_TYPE', `${path}/value`, 'Value fact type mismatch.');
      return;
    }
    if (
      typeof value === 'string' &&
      Array.from(value.normalize('NFC')).length > PIPELINE_LIMITS.portable.displayCodePoints
    ) {
      faults.add('FACT_LIMIT', `${path}/value`, 'Value fact string limit exceeded.');
      return;
    }
    values.push({ key, value });
  });
  return values;
};
