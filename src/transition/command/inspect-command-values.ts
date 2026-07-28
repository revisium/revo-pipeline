import { isValidKey } from '../../policy/index.js';
import type { JsonScalar, PipelineValueFact } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { ReductionDiagnosticCollector } from '../reduction/reduction-diagnostic-collector.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, fields: readonly string[]): boolean =>
  Object.keys(value).length === fields.length && fields.every((field) => field in value);
const scalarType = (value: unknown): string => (value === null ? 'null' : typeof value);
const isScalar = (value: unknown): value is JsonScalar =>
  value === null ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)) ||
  (typeof value === 'string' && value === value.normalize('NFC'));

export const inspectCommandValues = (
  values: readonly unknown[],
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): readonly PipelineValueFact[] => {
  const facts = new Map(
    context.compiled.snapshot.facts.map((fact, index) => [fact.key, { fact, index }]),
  );
  const seen = new Set<string>();
  return values
    .flatMap((item, index) => {
      const path = `/command/values/${index}`;
      if (
        !isRecord(item) ||
        !exact(item, ['key', 'value']) ||
        !isValidKey(item['key']) ||
        !isScalar(item['value'])
      ) {
        faults.add('COMMAND_SCHEMA', path, 'Command value fact is invalid.');
        return [];
      }
      if (seen.has(item['key'])) {
        faults.add('COMMAND_DUPLICATE', `${path}/key`, 'Command value key is duplicated.');
      }
      seen.add(item['key']);
      const declared = facts.get(item['key']);
      if (!declared) {
        faults.add('COMMAND_TARGET', `${path}/key`, 'Command value fact is not declared.');
      } else if (scalarType(item['value']) !== declared.fact.type) {
        faults.add('COMMAND_SCHEMA', `${path}/value`, 'Command value type is invalid.');
      }
      return [{ key: item['key'], value: item['value'] }];
    })
    .toSorted(
      (left, right) => (facts.get(left.key)?.index ?? 999) - (facts.get(right.key)?.index ?? 999),
    );
};
